// Package servidor arma el servidor HTTP del API: ServeMux de la biblioteca estándar y apagado ordenado.
package servidor

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/web"
)

// politicaCSP es la Content-Security-Policy de todas las respuestas. La web carga todo del mismo
// origen (sin scripts ni estilos en línea, sin terceros), así que admite una política estricta.
// web/vite.config.ts (preview.headers) y web/e2e/csp.spec.ts repiten este texto: si cambia aquí,
// debe cambiar allá.
const politicaCSP = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

// Manejador devuelve el ServeMux con las rutas del API y la web embebida.
func Manejador() http.Handler {
	return manejador(web.Archivos())
}

// conCSP añade la Content-Security-Policy a toda respuesta, incluidos los errores 404 y 405.
func conCSP(siguiente http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", politicaCSP)
		siguiente.ServeHTTP(w, r)
	})
}

// manejador arma las rutas: /salud en la raíz, el API bajo /api/ y la web en todo lo demás.
// Todo endpoint nuevo del API va bajo /api/.
func manejador(raizWeb fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /salud", salud)
	mux.HandleFunc("/api/", noEncontradoAPI)
	mux.Handle("/", aplicacionWeb(raizWeb))
	return conCSP(mux)
}

func salud(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"estado": "ok"})
}

// Servir atiende en direccion hasta que ctx se cancele; luego apaga con un plazo de 10 s.
func Servir(ctx context.Context, direccion string, log *slog.Logger) error {
	srv := &http.Server{
		Addr:              direccion,
		Handler:           Manejador(),
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
