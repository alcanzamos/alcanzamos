package main

import (
	"io"
	"log/slog"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor/accesotest"
)

// Esta tabla es el inventario de /api/: añadir una ruta obliga a añadirla aquí con su nivel (RNF-012, D-138).
var rutasEsperadas = []servidor.Ruta{}

func TestTodaRutaDeAPITieneSuNivelDeclarado(t *testing.T) {
	e := armarEnrutador(slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if _, err := e.Construir(); err != nil {
		t.Fatalf("el servidor no arrancaría: %v", err)
	}
	obtenidas := e.Rutas()
	if len(obtenidas) != len(rutasEsperadas) {
		t.Fatalf("rutas registradas: %+v", obtenidas)
	}
	for i, r := range rutasEsperadas {
		if obtenidas[i] != r {
			t.Errorf("ruta %d: %+v, se esperaba %+v", i, obtenidas[i], r)
		}
	}
	for _, r := range obtenidas {
		if !r.Nivel.Valido() || r.Nivel == seguridad.NivelDeAcceso(0) {
			t.Errorf("la ruta %q no declara su nivel", r.Patron)
		}
	}
	if len(obtenidas) > 0 {
		accesotest.ProbarRutas(t, obtenidas)
	}
}
