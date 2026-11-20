package servidor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"
)

// Servir atiende en ln hasta que ctx se cancele; luego deja terminar las peticiones en curso, con un plazo de 10 s.
// No registra peticiones ni direcciones IP. El servidor de net/http escribe sus propios errores (de un pánico, de
// una petición mal formada) con la dirección del cliente: ErrorLog los descarta.
func Servir(ctx context.Context, ln net.Listener, h http.Handler, registro *slog.Logger) error {
	srv := nuevoServidor(h)
	errs := make(chan error, 1)
	go func() { errs <- srv.Serve(ln) }()

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	registro.Info("apagando el servidor")
	plazo, cancelar := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelar()
	if err := srv.Shutdown(plazo); err != nil {
		return err
	}
	if err := <-errs; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	registro.Info("servidor detenido")
	return nil
}

func nuevoServidor(h http.Handler) *http.Server {
	return &http.Server{
		Handler:           h,
		ErrorLog:          log.New(io.Discard, "", 0),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

// Ejecutar es el programa: lee el entorno (getenv), valida, abre el puerto y sirve hasta que ctx se cancele
// (main lo cancela con SIGTERM o SIGINT). Los registros van a salida en JSON y los errores de arranque a errores.
// Devuelve el código de salida: 0 si se apagó bien y 1 si no pudo arrancar.
func Ejecutar(ctx context.Context, getenv func(string) string, salida, errores io.Writer) int {
	fallar := func(err error) int {
		fmt.Fprintln(errores, "error:", err)
		return 1
	}
	cfg, err := LeerConfig(getenv)
	if err != nil {
		return fallar(err)
	}
	raiz := os.DirFS(cfg.Directorio)
	if info, err := os.Stat(cfg.Directorio); err != nil || !info.IsDir() {
		return fallar(fmt.Errorf("%s no es una carpeta que se pueda leer", VarDirectorio))
	}
	if info, err := os.Stat(cfg.Directorio + "/index.html"); err != nil || info.IsDir() {
		return fallar(fmt.Errorf("%s no tiene index.html: ¿está compilada la web?", VarDirectorio))
	}
	ln, err := net.Listen("tcp", ":"+strconv.Itoa(cfg.Puerto))
	if err != nil {
		return fallar(fmt.Errorf("no se pudo abrir el puerto %d: %w", cfg.Puerto, err))
	}
	registro := slog.New(slog.NewJSONHandler(salida, nil))
	registro.Info("servidor iniciado", "puerto", ln.Addr().(*net.TCPAddr).Port, "directorio", cfg.Directorio, "origen_api", cfg.OrigenAPI)
	if err := Servir(ctx, ln, Manejador(raiz, cfg), registro); err != nil {
		return fallar(err)
	}
	return 0
}
