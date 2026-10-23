package servidor_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

func TestSaludResponde200ConJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	servidor.Manejador().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/salud", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("código %d, se esperaba 200", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type %q", ct)
	}
	var cuerpo map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &cuerpo); err != nil || cuerpo["estado"] != "ok" {
		t.Fatalf("cuerpo inesperado: %q (%v)", rr.Body.String(), err)
	}
}

func TestSaludSoloAceptaGET(t *testing.T) {
	rr := httptest.NewRecorder()
	servidor.Manejador().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/salud", nil))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("código %d, se esperaba 405", rr.Code)
	}
}

func TestRutaDesconocidaDelAPIDa404(t *testing.T) {
	rr := httptest.NewRecorder()
	servidor.Manejador().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/nada", nil))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("código %d, se esperaba 404", rr.Code)
	}
}

func TestServirApagaAlCancelarElContexto(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	direccion := l.Addr().String()
	l.Close()

	ctx, cancelar := context.WithCancel(context.Background())
	hecho := make(chan error, 1)
	go func() { hecho <- servidor.Servir(ctx, direccion, slog.New(slog.NewJSONHandler(io.Discard, nil)), nil) }()

	var resp *http.Response
	for i := 0; i < 50; i++ {
		if resp, err = http.Get("http://" + direccion + "/salud"); err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	cancelar()
	select {
	case err := <-hecho:
		if err != nil {
			t.Fatalf("Servir devolvió %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("el servidor no se apagó")
	}
}
