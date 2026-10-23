package main

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestSubcomandoDesconocidoFalla(t *testing.T) {
	err := ejecutar(context.Background(), []string{"nada"}, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err == nil {
		t.Fatal("se esperaba un error")
	}
}

func TestPuertoPorDefectoYPorEntorno(t *testing.T) {
	t.Setenv("PUERTO", "")
	if p := puerto(); p != "8080" {
		t.Fatalf("puerto %q", p)
	}
	t.Setenv("PUERTO", "9090")
	if p := puerto(); p != "9090" {
		t.Fatalf("puerto %q", p)
	}
}

func TestMigrarSinURLFalla(t *testing.T) {
	t.Setenv("BASE_DE_DATOS_URL", "")
	err := ejecutar(context.Background(), []string{"migrar"}, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err == nil {
		t.Fatal("se esperaba un error por falta de la URL")
	}
}

func TestTareasSinURLFalla(t *testing.T) {
	t.Setenv("BASE_DE_DATOS_URL", "")
	err := ejecutar(context.Background(), []string{"tareas"}, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err == nil {
		t.Fatal("se esperaba un error por falta de la URL")
	}
}

func TestElRegistroEscribeLaHoraEnUTC(t *testing.T) {
	var salida strings.Builder
	local := time.Date(2026, 10, 22, 18, 0, 0, 0, time.FixedZone("Bogota", -5*3600))
	r := slog.NewRecord(local, slog.LevelInfo, "hola", 0)
	if err := nuevoRegistro(&salida).Handler().Handle(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(salida.String(), `"time":"2026-10-22T23:00:00Z"`) {
		t.Fatalf("la hora debe salir en UTC: %s", salida.String())
	}
}

func TestServirSinConfiguracionFallaAntesDeConectar(t *testing.T) {
	for _, v := range []string{"CORREO_SMTP", "CORREO_REMITENTE", "CORREO_PRIVACIDAD", "URL_PUBLICA", "SESION_SENUELO_CLAVE"} {
		t.Setenv(v, "")
	}
	t.Setenv("BASE_DE_DATOS_URL", "postgres://nadie@127.0.0.1:1/nada")
	err := ejecutar(context.Background(), []string{"api"}, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err == nil || !strings.Contains(err.Error(), "CORREO_SMTP falta") || !strings.Contains(err.Error(), "URL_PUBLICA falta") ||
		!strings.Contains(err.Error(), "SESION_SENUELO_CLAVE falta") {
		t.Fatalf("se esperaba un error que nombre las variables que faltan: %v", err)
	}
}

// La clave de las sesiones de mentira es obligatoria y el error no la repite (D-143 (2)).
func TestServirConUnaClaveDeSenueloCortaFalla(t *testing.T) {
	t.Setenv("CORREO_SMTP", "127.0.0.1:1")
	t.Setenv("CORREO_REMITENTE", "a@b.test")
	t.Setenv("CORREO_PRIVACIDAD", "p@b.test")
	t.Setenv("URL_PUBLICA", "https://app.b.test")
	t.Setenv("SESION_SENUELO_CLAVE", "Y29ydGE")
	t.Setenv("BASE_DE_DATOS_URL", "postgres://nadie@127.0.0.1:1/nada")
	err := ejecutar(context.Background(), []string{"api"}, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err == nil || !strings.Contains(err.Error(), "SESION_SENUELO_CLAVE debe tener al menos 32 bytes") || strings.Contains(err.Error(), "Y29ydGE") {
		t.Fatalf("se esperaba el error de la clave corta, sin repetirla: %v", err)
	}
}
