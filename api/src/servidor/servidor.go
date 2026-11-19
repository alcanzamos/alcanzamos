// Package servidor arma el servidor HTTP del API: ServeMux de la biblioteca estándar y apagado ordenado.
package servidor

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// politicaCSP es la Content-Security-Policy de todas las respuestas. El API solo responde JSON (y el ZIP de «descargar mis
// datos»), nunca una página: no carga nada y nadie lo incrusta (E11-INF 2.16, D-205 (10)). La web va en otro origen
// (ca-web), con su propia política (web/servidor/internal/servidor/config.go), que no es esta.
const politicaCSP = "default-src 'none'; frame-ancestors 'none'"

// politicaHSTS es el Strict-Transport-Security de todas las respuestas: un año y los subdominios. Sin `preload`:
// entrar en la lista de los navegadores casi no se deshace y es otra decisión. Va siempre, también sin TLS (en local, con
// http://): los navegadores la ignoran sobre HTTP, y así el servidor no necesita saber si hay TLS delante. Cloudflare va
// «DNS only» y la entrada de Container Apps no la agrega (E11-INF 2.16).
const politicaHSTS = "max-age=31536000; includeSubDomains"

// Manejador devuelve el ServeMux con /salud y un /api/ sin rutas registradas (404 en JSON). El API no sirve la web: la
// sirve ca-web, en otro origen (E11-INF 2.16). Todo lo que no es /salud ni /api/ responde 404.
func Manejador() http.Handler {
	return ManejadorConAPI(http.HandlerFunc(noEncontradoAPI))
}

// ManejadorConAPI es Manejador con las rutas de /api/ ya construidas por el Enrutador.
func ManejadorConAPI(api http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /salud", salud)
	return conCabecerasDeSeguridad(conPeticion(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Todo lo que empieza por /api/ en la ruta tal como llegó va derecho a api, sin pasar por este mux: si lo limpiara él,
		// una redirección canónica (`/api//v1/...`) saldría sin el CORS ni el `Vary: Origin` que pone api (cors.go).
		if strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		mux.ServeHTTP(w, r)
	})))
}

// noEncontradoAPI responde 404 en JSON a cualquier ruta desconocida bajo /api/.
func noEncontradoAPI(w http.ResponseWriter, _ *http.Request) {
	EscribirError(w, http.StatusNotFound, "no_encontrado")
}

// conCabecerasDeSeguridad añade la Content-Security-Policy, el Strict-Transport-Security y `X-Content-Type-Options: nosniff`
// a toda respuesta, incluidos los errores 404 y 405, el rechazo de CSRF, el límite de intentos y el preflight de CORS. Es el
// único lugar: ninguna ruta las pone.
func conCabecerasDeSeguridad(siguiente http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", politicaCSP)
		w.Header().Set("Strict-Transport-Security", politicaHSTS)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		siguiente.ServeHTTP(w, r)
	})
}

func salud(w http.ResponseWriter, _ *http.Request) {
	EscribirJSON(w, http.StatusOK, map[string]string{"estado": "ok"})
}

// Servir atiende en direccion hasta que ctx se cancele; luego apaga con un plazo de 10 s.
// api son las rutas de /api/ (Enrutador.Construir); con nil, /api/ solo responde 404.
func Servir(ctx context.Context, direccion string, log *slog.Logger, api http.Handler) error {
	h := Manejador()
	if api != nil {
		h = ManejadorConAPI(api)
	}
	srv := &http.Server{
		Addr:              direccion,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	errs := make(chan error, 1)
	go func() { errs <- srv.ListenAndServe() }()
	log.Info("servidor iniciado", "direccion", direccion)

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	log.Info("apagando el servidor")
	plazo, cancelar := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelar()
	if err := srv.Shutdown(plazo); err != nil {
		return err
	}
	if err := <-errs; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	log.Info("servidor detenido")
	return nil
}
