package cuenta

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/correo"
	"github.com/alcanzamos/alcanzamos/api/internal/reloj"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/sesion"
)

// repoFalso guarda en memoria lo que recibiría el Repositorio y finge sus tres casos (D-141): correo libre, correo
// con una cuenta sin verificar (se reemplaza) y correo con una cuenta verificada.
type repoFalso struct {
	mu          sync.Mutex
	creadas     []NuevaCuenta
	reemplazos  int
	verificadas map[string]bool // correo → true si la cuenta existente está verificada
	err         error
}

func (r *repoFalso) Crear(_ context.Context, c NuevaCuenta) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return "", r.err
	}
	if verificada, existe := r.verificadas[c.Correo]; existe {
		if verificada {
			return "", ErrCorreoYaRegistrado
		}
		r.reemplazos++
	}
	if r.verificadas == nil {
		r.verificadas = map[string]bool{}
	}
	r.verificadas[c.Correo] = false
	r.creadas = append(r.creadas, c)
	return "0192f3c4-0000-7000-8000-000000000001", nil
}

type hasheadorFalso struct {
	mu        sync.Mutex
	llamadas  int
	contrasen []string
}

func (h *hasheadorFalso) Hashear(_ context.Context, c string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.llamadas++
	h.contrasen = append(h.contrasen, c)
	return "$argon2id$falso$" + c, nil
}

var ahoraDePrueba = time.Date(2026, 10, 22, 15, 0, 0, 0, time.UTC)

// entorno agrupa un Servicio con sus dobles.
type entorno struct {
	svc       *Servicio
	repo      *repoFalso
	correo    *correo.Falso
	hasher    *hasheadorFalso
	reloj     *reloj.Fijo
	limitador *seguridad.LimitadorDeIntentos
	senuelos  *senuelosContados
	registro  *bytes.Buffer
}

// senuelosContados es el generador real de sesiones de mentira, que además cuenta cuántas creó.
type senuelosContados struct {
	*sesion.Senuelos
	creados int
}

func (s *senuelosContados) Crear() string {
	s.creados++
	return s.Senuelos.Crear()
}

// Cantidad son las sesiones de mentira creadas hasta ahora.
func (s *senuelosContados) Cantidad() int { return s.creados }

func nuevoEntorno() *entorno {
	e := &entorno{repo: &repoFalso{}, correo: &correo.Falso{}, hasher: &hasheadorFalso{}, reloj: &reloj.Fijo{T: ahoraDePrueba}, registro: &bytes.Buffer{}}
	e.limitador = seguridad.NuevoLimitadorDeIntentos(e.reloj)
	real, err := sesion.NuevosSenuelos(bytes.Repeat([]byte{9}, 32), e.reloj)
	if err != nil {
		panic(err)
	}
	e.senuelos = &senuelosContados{Senuelos: real}
	e.svc = NuevoServicio(Dependencias{
		Repo: e.repo, Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
		Reloj: e.reloj, Limitador: e.limitador, Senuelos: e.senuelos, Log: slog.New(slog.NewJSONHandler(e.registro, nil)),
	})
	return e
}

func solicitudValida() SolicitudDeCuenta {
	return SolicitudDeCuenta{Correo: "  Laura@Ejemplo.TEST ", Contrasena: "lluvia café tren azul", Nombre: " Laura ", MayorDeEdad: true}
}

func TestCrearCuentaValida(t *testing.T) {
	e := nuevoEntorno()
	sesionNueva, err := e.svc.CrearCuenta(context.Background(), solicitudValida())
	if err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()

	if len(e.repo.creadas) != 1 || e.hasher.llamadas != 1 {
		t.Fatalf("creadas %d, hashes %d", len(e.repo.creadas), e.hasher.llamadas)
	}
	c := e.repo.creadas[0]
	if c.Correo != "laura@ejemplo.test" || c.Nombre != "Laura" || c.HashContrasena != "$argon2id$falso$lluvia café tren azul" {
		t.Errorf("cuenta normalizada: %+v", c)
	}
	if !c.VenceElEnlaceEn.Equal(ahoraDePrueba.Add(24*time.Hour)) || !c.Ahora.Equal(ahoraDePrueba) {
		t.Errorf("el enlace debe vencer a las 24 horas: %+v", c)
	}
	enviados := e.correo.Enviados()
	if len(enviados) != 1 || enviados[0].Destino != "laura@ejemplo.test" || enviados[0].Aviso {
		t.Fatalf("correos: %+v", enviados)
	}
	// Lo guardado es solo el SHA-256 de los tokens: el del enlace (el que viaja en el correo) y el de la sesión.
	huellaEnlace, err := seguridad.HuellaDeToken(enviados[0].Token)
	if err != nil || !bytes.Equal(huellaEnlace, c.HuellaDelEnlace) {
		t.Fatalf("la huella del enlace no corresponde al token enviado: %v", err)
	}
	huellaSesion, err := seguridad.HuellaDeToken(sesionNueva.Token)
	if err != nil || !bytes.Equal(huellaSesion, c.HuellaDeSesion) {
		t.Fatalf("la huella de la sesión no corresponde al token entregado: %v", err)
	}
	if sesionNueva.Token == enviados[0].Token {
		t.Error("la sesión y el enlace no pueden compartir token")
	}
	if e.senuelos.Cantidad() != 0 {
		t.Error("una cuenta real no crea sesión de mentira")
	}
	registro := e.registro.String()
	for _, secreto := range []string{enviados[0].Token, sesionNueva.Token, "laura", "lluvia"} {
		if strings.Contains(registro, secreto) {
			t.Errorf("el registro no debe llevar %q: %s", secreto, registro)
		}
	}
}

// D-141 (1): el correo de una cuenta sin verificar se trata como cuenta nueva (SEG-012).
func TestCorreoConCuentaSinVerificarSeRecrea(t *testing.T) {
	e := nuevoEntorno()
	e.repo.verificadas = map[string]bool{"laura@ejemplo.test": false}
	sesionNueva, err := e.svc.CrearCuenta(context.Background(), solicitudValida())
	if err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
	if e.repo.reemplazos != 1 || len(e.repo.creadas) != 1 {
		t.Fatalf("reemplazos %d, creadas %d", e.repo.reemplazos, len(e.repo.creadas))
	}
	enviados := e.correo.Enviados()
	if len(enviados) != 1 || enviados[0].Aviso || enviados[0].Token == "" {
		t.Fatalf("debe recibir la verificación nueva, no el aviso: %+v", enviados)
	}
	if h, _ := seguridad.HuellaDeToken(sesionNueva.Token); !bytes.Equal(h, e.repo.creadas[0].HuellaDeSesion) || e.senuelos.Cantidad() != 0 {
		t.Error("la sesión debe ser la real, no de mentira")
	}
}

// D-141 (2) y (3): con una cuenta verificada no se toca nada, la sesión es de mentira, Argon2id corre igual y el dueño
// recibe el aviso (SEG-013, SEG-014).
func TestCorreoConCuentaVerificadaDaSesionDeMentiraYAviso(t *testing.T) {
	e := nuevoEntorno()
	e.repo.verificadas = map[string]bool{"laura@ejemplo.test": true}
	sesionNueva, err := e.svc.CrearCuenta(context.Background(), solicitudValida())
	if err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
	if len(e.repo.creadas) != 0 {
		t.Fatal("no debe crear nada")
	}
	if e.hasher.llamadas != 1 {
		t.Errorf("Argon2id debe correr una vez también con el correo registrado: %d", e.hasher.llamadas)
	}
	enviados := e.correo.Enviados()
	if len(enviados) != 1 || !enviados[0].Aviso || enviados[0].Destino != "laura@ejemplo.test" || enviados[0].Token != "" {
		t.Fatalf("debe llegar solo el aviso, sin token: %+v", enviados)
	}
	if !e.senuelos.Reconoce(sesionNueva.Token) || e.senuelos.Cantidad() != 1 {
		t.Fatal("la sesión debe ser de mentira: firmada, reconocible sin guardarse")
	}
	if strings.Contains(e.registro.String(), sesionNueva.Token) || strings.Contains(e.registro.String(), "laura") {
		t.Errorf("el registro no debe llevar el token ni el correo: %s", e.registro)
	}
}

// D-140 (2): 3 correos por hora a una dirección, sumando verificación y aviso; la respuesta no cambia (SEG-009, SEG-014).
func TestElCuartoCorreoDeLaHoraNoSaleYLaRespuestaEsLaMisma(t *testing.T) {
	e := nuevoEntorno()
	e.repo.verificadas = map[string]bool{"laura@ejemplo.test": true}
	for i := range 5 {
		s, err := e.svc.CrearCuenta(context.Background(), solicitudValida())
		if err != nil || s.Token == "" {
			t.Fatalf("intento %d: %v", i+1, err)
		}
	}
	e.svc.Esperar()
	if n := len(e.correo.Enviados()); n != CorreosPorHoraEsperados {
		t.Fatalf("salieron %d correos, se esperaban %d", n, CorreosPorHoraEsperados)
	}
	e.reloj.T = ahoraDePrueba.Add(time.Hour)
	if _, err := e.svc.CrearCuenta(context.Background(), solicitudValida()); err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
	if n := len(e.correo.Enviados()); n != CorreosPorHoraEsperados+1 {
		t.Fatalf("a la hora debe salir otro: %d", n)
	}
}

// CorreosPorHoraEsperados es la cifra de D-140, repetida a propósito: si cambia en el limitador, esta prueba lo avisa.
const CorreosPorHoraEsperados = 3

func TestUnEnvioQueFallaSeRegistraSinCorreoNiToken(t *testing.T) {
	e := nuevoEntorno()
	e.correo.Error = errors.New("el servidor de correo no responde")
	s, err := e.svc.CrearCuenta(context.Background(), solicitudValida())
	if err != nil {
		t.Fatalf("la cuenta se crea aunque el correo falle: %v", err)
	}
	e.svc.Esperar()
	if !strings.Contains(e.registro.String(), "no se pudo enviar el correo") {
		t.Errorf("falta el registro del fallo: %s", e.registro)
	}
	if strings.Contains(e.registro.String(), "laura") || strings.Contains(e.registro.String(), s.Token) {
		t.Errorf("el registro no debe llevar el correo ni el token: %s", e.registro)
	}
}

func TestUnFalloDelRepositorioNoCreaSesionNiEnvia(t *testing.T) {
	e := nuevoEntorno()
	e.repo.err = errors.New("bd caída")
	if _, err := e.svc.CrearCuenta(context.Background(), solicitudValida()); err == nil {
		t.Fatal("se esperaba el error")
	}
	e.svc.Esperar()
	if len(e.correo.Enviados()) != 0 || e.senuelos.Cantidad() != 0 {
		t.Error("un fallo no debe enviar ni crear sesión de mentira")
	}
}

func TestCrearCuentaValidacion(t *testing.T) {
	casos := []struct {
		nombre string
		cambia func(*SolicitudDeCuenta)
		campos map[string]string
	}{
		{"correo vacío", func(s *SolicitudDeCuenta) { s.Correo = "  " }, map[string]string{"correo": CorreoVacio}},
		{"correo sin @", func(s *SolicitudDeCuenta) { s.Correo = "laura.ejemplo.test" }, map[string]string{"correo": CorreoInvalido}},
		{"correo sin dominio", func(s *SolicitudDeCuenta) { s.Correo = "laura@" }, map[string]string{"correo": CorreoInvalido}},
		{"correo con dominio sin punto", func(s *SolicitudDeCuenta) { s.Correo = "laura@ejemplo" }, map[string]string{"correo": CorreoInvalido}},
		{"correo con nombre y ángulos", func(s *SolicitudDeCuenta) { s.Correo = "Laura <laura@ejemplo.test>" }, map[string]string{"correo": CorreoInvalido}},
		{"correo con salto de línea", func(s *SolicitudDeCuenta) { s.Correo = "laura@ejemplo.test\r\nBcc: x@y.test" }, map[string]string{"correo": CorreoInvalido}},
		{"contraseña vacía", func(s *SolicitudDeCuenta) { s.Contrasena = "" }, map[string]string{"contrasena": ContrasenaVacia}},
		{"contraseña de 14", func(s *SolicitudDeCuenta) { s.Contrasena = "abcdefghijklmn" }, map[string]string{"contrasena": ContrasenaCorta}},
		{"contraseña de SecLists", func(s *SolicitudDeCuenta) { s.Contrasena = "123456789987654321" }, map[string]string{"contrasena": ContrasenaComun}},
		{"contraseña de la lista en español", func(s *SolicitudDeCuenta) { s.Contrasena = "tequieromucho2026" }, map[string]string{"contrasena": ContrasenaComun}},
		{"contraseña repetida", func(s *SolicitudDeCuenta) { s.Contrasena = "aaaaaaaaaaaaaaa" }, map[string]string{"contrasena": ContrasenaComun}},
		{"contraseña en secuencia", func(s *SolicitudDeCuenta) { s.Contrasena = "123456789012345" }, map[string]string{"contrasena": ContrasenaComun}},
		{"contraseña de teclado", func(s *SolicitudDeCuenta) { s.Contrasena = "qwertyuiopasdfg" }, map[string]string{"contrasena": ContrasenaComun}},
		{"contraseña con el correo", func(s *SolicitudDeCuenta) { s.Contrasena = "la-clave-de-laura-es-larga" }, map[string]string{"contrasena": ContrasenaPersonal}},
		{"contraseña con el nombre de la app", func(s *SolicitudDeCuenta) { s.Contrasena = "uso alcanzamos a diario" }, map[string]string{"contrasena": ContrasenaPersonal}},
		{"nombre vacío", func(s *SolicitudDeCuenta) { s.Nombre = " " }, map[string]string{"nombre": NombreVacio}},
		{"nombre de 61", func(s *SolicitudDeCuenta) { s.Nombre = strings.Repeat("ñ", 61) }, map[string]string{"nombre": NombreLargo}},
		{"nombre de 60", func(s *SolicitudDeCuenta) { s.Nombre = strings.Repeat("ñ", 60) }, nil},
		{"menor de edad o sin marcar", func(s *SolicitudDeCuenta) { s.MayorDeEdad = false }, map[string]string{"mayor_de_edad": MayorDeEdadRequerido}},
		{"todo mal a la vez", func(s *SolicitudDeCuenta) { *s = SolicitudDeCuenta{} }, map[string]string{
			"correo": CorreoVacio, "contrasena": ContrasenaVacia, "nombre": NombreVacio, "mayor_de_edad": MayorDeEdadRequerido}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno()
			sol := solicitudValida()
			c.cambia(&sol)
			_, err := e.svc.CrearCuenta(context.Background(), sol)
			e.svc.Esperar()
			if c.campos == nil {
				if err != nil {
					t.Fatalf("se esperaba éxito: %v", err)
				}
				return
			}
			var inv *ErrValidacion
			if !errors.As(err, &inv) {
				t.Fatalf("se esperaba *ErrValidacion: %v", err)
			}
			if len(inv.Campos) != len(c.campos) {
				t.Errorf("campos %v, se esperaban %v", inv.Campos, c.campos)
			}
			for k, v := range c.campos {
				if inv.Campos[k] != v {
					t.Errorf("campo %s = %q, se esperaba %q", k, inv.Campos[k], v)
				}
			}
			if len(e.repo.creadas) != 0 || len(e.correo.Enviados()) != 0 || e.hasher.llamadas != 0 {
				t.Error("una solicitud rechazada no calcula el hash, no crea ni envía nada")
			}
		})
	}
}

func TestPermitirCreacionCuentaTodosLosIntentos(t *testing.T) {
	e := nuevoEntorno()
	for i := range 20 {
		if !e.svc.PermitirCreacion("203.0.113.7") {
			t.Fatalf("el intento %d debía pasar", i+1)
		}
	}
	if e.svc.PermitirCreacion("203.0.113.7") {
		t.Fatal("el 21 se frena")
	}
}
