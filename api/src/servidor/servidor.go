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

	"github.com/alcanzamos/alcanzamos/api/src/web"
)

// politicaCSP es la Content-Security-Policy de todas las respuestas. La web carga todo del mismo
// origen (sin scripts ni estilos en línea, sin terceros), así que admite una política estricta.
// web/vite.config.ts (preview.headers) y web/e2e/csp.spec.ts repiten este texto: si cambia aquí,
// debe cambiar allá.
const politicaCSP = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

// Manejador devuelve el ServeMux con la web embebida y un /api/ sin rutas registradas.
func Manejador() http.Handler {
	return ManejadorConRaiz(web.Archivos())
}

// ManejadorConRaiz es Manejador con otra raíz de la web (Manejador usa la embebida).
func ManejadorConRaiz(raizWeb fs.FS) http.Handler {
	return manejadorConAPI(raizWeb, http.HandlerFunc(noEncontradoAPI))
}

// ManejadorConAPI es Manejador con las rutas de /api/ ya construidas por el Enrutador.
func ManejadorConAPI(api http.Handler) http.Handler {
	return manejadorConAPI(web.Archivos(), api)
}

// conCSP añade la Content-Security-Policy a toda respuesta, incluidos los errores 404 y 405.
func conCSP(siguiente http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", politicaCSP)
		siguiente.ServeHTTP(w, r)
	})
}

// manejadorConAPI arma las rutas: /salud en la raíz, el API bajo /api/ y la web en todo lo demás.
// Todo endpoint nuevo del API va bajo /api/.
func manejadorConAPI(raizWeb fs.FS, api http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /salud", salud)
	mux.Handle("/api/", api)
	mux.Handle("/", aplicacionWeb(raizWeb))
	return conCSP(conPeticion(mux))
}

func salud(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"estado": "ok"})
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
