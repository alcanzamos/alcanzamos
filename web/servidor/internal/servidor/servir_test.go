package servidor_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/web/servidor/internal/servidor"
)

// bufferSeguro es un io.Writer que se puede leer mientras otro hilo escribe.
type bufferSeguro struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *bufferSeguro) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *bufferSeguro) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// cerrar cierra y falla la prueba si no se pudo.
func cerrar(t *testing.T, c io.Closer) {
	t.Helper()
	if err := c.Close(); err != nil {
		t.Errorf("cerrar: %v", err)
	}
}

func escuchar(t *testing.T) net.Listener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	return ln
}

// arrancar corre Servir en un hilo y devuelve cómo pararlo y esperar su resultado.
func arrancar(t *testing.T, h http.Handler, log *slog.Logger) (url string, parar func(), resultado <-chan error) {
	t.Helper()
	ln := escuchar(t)
	ctx, cancelar := context.WithCancel(context.Background())
	res := make(chan error, 1)
	go func() { res <- servidor.Servir(ctx, ln, h, log) }()
	t.Cleanup(cancelar)
	return "http://" + ln.Addr().String(), cancelar, res
}

func esperarFin(t *testing.T, res <-chan error) {
	t.Helper()
	select {
	case err := <-res:
		if err != nil {
			t.Fatalf("Servir devolvió %v", err)
		}
	// Más que el plazo de apagado de Servir (10 s): una conexión sin petición tarda 5 s en contar como inactiva.
	case <-time.After(15 * time.Second):
		t.Fatal("Servir no terminó tras cancelar el contexto")
	}
}

func TestServirSirveYSeApagaConElContexto(t *testing.T) {
	url, parar, res := arrancar(t, manejadorDePrueba(t), slog.New(slog.NewJSONHandler(io.Discard, nil)))
	resp, err := http.Get(url + "/config.json")
	if err != nil {
		t.Fatal(err)
	}
	cerrar(t, resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("código %d", resp.StatusCode)
	}
	parar()
	esperarFin(t, res)
	if _, err := http.Get(url + "/"); err == nil {
		t.Fatal("el servidor sigue aceptando conexiones tras apagarse")
	}
}

func TestServirTerminaLasPeticionesEnCursoAlApagar(t *testing.T) {
	entro, soltar := make(chan struct{}), make(chan struct{})
	lento := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(entro)
		<-soltar
		if _, err := io.WriteString(w, "terminó"); err != nil {
			t.Errorf("escribir la respuesta: %v", err)
		}
	})
	url, parar, res := arrancar(t, lento, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	cuerpo := make(chan string, 1)
	go func() {
		resp, err := http.Get(url + "/")
		if err != nil {
			cuerpo <- "error: " + err.Error()
			return
		}
		defer cerrar(t, resp.Body)
		b, err := io.ReadAll(resp.Body)
		if err != nil {
			cuerpo <- "error: " + err.Error()
			return
		}
		cuerpo <- string(b)
	}()
	<-entro
	parar()
	select {
	case err := <-res:
		t.Fatalf("Servir terminó con una petición en curso (error %v)", err)
	case <-time.After(200 * time.Millisecond):
	}
	close(soltar)
	if got := <-cuerpo; got != "terminó" {
		t.Fatalf("respuesta %q; la petición en curso debe terminar", got)
	}
	esperarFin(t, res)
}

// Cada petición abre y cierra su conexión, para que el cliente no deje conexiones de reserva abiertas.
var clienteSinConexionesGuardadas = &http.Client{Transport: &http.Transport{DisableKeepAlives: true}}

func TestNoRegistraDireccionesIP(t *testing.T) {
	var registro bufferSeguro
	log := slog.New(slog.NewTextHandler(&registro, &slog.HandlerOptions{Level: slog.LevelDebug}))
	paniquea := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/panico" {
			panic("fallo de prueba")
		}
		manejadorDePrueba(t).ServeHTTP(w, r)
	})
	url, parar, res := arrancar(t, paniquea, log)
	for _, ruta := range []string{"/", "/config.json", "/assets/index-abc123.js", "/no-existe", "/panico"} {
		req, err := http.NewRequest(http.MethodGet, url+ruta, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("X-Forwarded-For", "203.0.113.7")
		req.Header.Set("X-Real-IP", "203.0.113.8")
		// El pánico de /panico corta la conexión: ahí el cliente recibe un error y no importa cuál.
		if resp, err := clienteSinConexionesGuardadas.Do(req); err == nil {
			cerrar(t, resp.Body)
		}
	}
	// Una petición mal formada también hace escribir al servidor de net/http.
	c, err := net.Dial("tcp", strings.TrimPrefix(url, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(c, "basura que no es HTTP\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(io.Discard, c); err != nil {
		t.Logf("leer la respuesta a la basura: %v", err)
	}
	cerrar(t, c)
	parar()
	esperarFin(t, res)
	salida := registro.String()
	for _, ip := range []string{"127.0.0.1", "203.0.113.7", "203.0.113.8", "[::1]"} {
		if strings.Contains(salida, ip) {
			t.Fatalf("el registro contiene la IP %s:\n%s", ip, salida)
		}
	}
}

func escribirWeb(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(indiceDePrueba), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestEjecutarSeNiegaAArrancar(t *testing.T) {
	dirSinIndice := t.TempDir()
	casos := []struct {
		nombre string
		env    map[string]string
		texto  string
	}{
		{"sin API_URL", map[string]string{"DIRECTORIO_WEB": escribirWeb(t)}, "API_URL falta"},
		{"API_URL con http", map[string]string{"API_URL": "http://api.alcanzamos.co", "DIRECTORIO_WEB": escribirWeb(t)}, "https://"},
		{"API_URL sin esquema", map[string]string{"API_URL": "api.alcanzamos.co", "DIRECTORIO_WEB": escribirWeb(t)}, "https://"},
		{"puerto inválido", map[string]string{"API_URL": origenAPI, "PUERTO": "x", "DIRECTORIO_WEB": escribirWeb(t)}, "PUERTO"},
		{"directorio sin index.html", map[string]string{"API_URL": origenAPI, "DIRECTORIO_WEB": dirSinIndice}, "index.html"},
		{"directorio que no existe", map[string]string{"API_URL": origenAPI, "DIRECTORIO_WEB": filepath.Join(dirSinIndice, "no-existe")}, "DIRECTORIO_WEB"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			var salida, errores bufferSeguro
			codigo := servidor.Ejecutar(context.Background(), entorno(c.env), &salida, &errores)
			if codigo != 1 {
				t.Fatalf("código de salida %d, se esperaba 1", codigo)
			}
			if !strings.Contains(errores.String(), c.texto) {
				t.Fatalf("stderr %q no contiene %q", errores.String(), c.texto)
			}
			if strings.Contains(salida.String(), "servidor iniciado") {
				t.Fatalf("no debe arrancar: %q", salida.String())
			}
		})
	}
}

func TestEjecutarArrancaYSeApagaSinErrores(t *testing.T) {
	var salida, errores bufferSeguro
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	env := map[string]string{"API_URL": origenAPI, "PUERTO": "0", "DIRECTORIO_WEB": escribirWeb(t)}
	codigo := make(chan int, 1)
	go func() { codigo <- servidor.Ejecutar(ctx, entorno(env), &salida, &errores) }()
	for i := 0; i < 100 && !strings.Contains(salida.String(), "servidor iniciado"); i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if !strings.Contains(salida.String(), "servidor iniciado") {
		t.Fatalf("no arrancó; stdout %q, stderr %q", salida.String(), errores.String())
	}
	cancelar()
	select {
	case c := <-codigo:
		if c != 0 {
			t.Fatalf("código de salida %d, se esperaba 0 (stderr %q)", c, errores.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Ejecutar no terminó tras cancelar el contexto")
	}
	if errores.String() != "" {
		t.Fatalf("stderr debe quedar vacío: %q", errores.String())
	}
	if !strings.Contains(salida.String(), "servidor detenido") {
		t.Fatalf("falta el aviso de apagado: %q", salida.String())
	}
}

// Una conexión abierta que nunca manda una petición (StateNew), como la que deja el Transport de un cliente
// cuando marca de más, no frena el apagado para siempre: net/http la trata como inactiva a los 5 s y Servir
// termina dentro de su plazo de 10 s. Esta prueba fija que esperarFin le da ese margen.
func TestServirTerminaConUnaConexionSinPeticion(t *testing.T) {
	url, parar, res := arrancar(t, manejadorDePrueba(t), slog.New(slog.NewTextHandler(io.Discard, nil)))
	c, err := net.Dial("tcp", strings.TrimPrefix(url, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cerrar(t, c) })
	parar()
	esperarFin(t, res)
}
