//go:build integration

package main

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/internal/pgtest"
)

func TestTareasConectaYTerminaSinError(t *testing.T) {
	// Una base propia y migrada: las tareas consultan las tablas de cuenta.
	t.Setenv("BASE_DE_DATOS_URL", pgtest.Nueva(t).Config().ConnString())
	var salida bytes.Buffer
	if err := ejecutar(context.Background(), []string{"tareas"}, slog.New(slog.NewJSONHandler(&salida, nil))); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(salida.String(), "tareas: inicio") || !strings.Contains(salida.String(), "tareas: fin") ||
		!strings.Contains(salida.String(), `"ejecutadas":2`) {
		t.Fatalf("faltan los registros de inicio y fin: %s", salida.String())
	}
}
