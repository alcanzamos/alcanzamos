package main

import (
	"context"
	"io"
	"log/slog"
	"testing"
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
