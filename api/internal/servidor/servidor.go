// Package servidor arma el servidor HTTP del API: ServeMux de la biblioteca estándar y apagado ordenado.
package servidor

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"
)

// Manejador devuelve el ServeMux con las rutas del API.
func Manejador() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /salud", salud)
	return mux
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
