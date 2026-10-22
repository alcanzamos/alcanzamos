//go:build integration

package main

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"strings"
	"testing"
)

func TestTareasConectaYTerminaSinError(t *testing.T) {
	if os.Getenv("BASE_DE_DATOS_URL") == "" {
		t.Skip("sin BASE_DE_DATOS_URL")
	}
	var salida bytes.Buffer
	if err := ejecutar(context.Background(), []string{"tareas"}, slog.New(slog.NewJSONHandler(&salida, nil))); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(salida.String(), "tareas: inicio") || !strings.Contains(salida.String(), "tareas: fin") {
		t.Fatalf("faltan los registros de inicio y fin: %s", salida.String())
	}
}
