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
