package main

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/internal/config"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor/accesotest"
)

// Esta tabla es el inventario de /api/: añadir una ruta obliga a añadirla aquí con su nivel (RNF-012, D-138).
var rutasEsperadas = []servidor.Ruta{
	{Patron: "POST /api/v1/cuentas", Nivel: seguridad.Publica},
}

func enrutadorDePrueba(t *testing.T) *servidor.Enrutador {
	t.Helper()
	// El pool no se conecta hasta que se usa: estas pruebas no necesitan base.
	pool, err := pgxpool.New(context.Background(), "postgres://nadie@127.0.0.1:1/nada")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	entorno := map[string]string{
		"CORREO_SMTP": "127.0.0.1:1", "CORREO_REMITENTE": "a@b.test", "CORREO_PRIVACIDAD": "p@b.test",
		"URL_PUBLICA": "https://app.b.test", "SESION_SENUELO_CLAVE": base64.StdEncoding.EncodeToString(make([]byte, 32)),
	}
	cfg, err := config.Cargar(func(k string) string { return entorno[k] })
	if err != nil {
		t.Fatal(err)
	}
	e, _, err := armarEnrutador(cfg, pool, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func TestTodaRutaDeAPITieneSuNivelDeclarado(t *testing.T) {
	e := enrutadorDePrueba(t)
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
}

// Ruta por ruta (SEG-010): cada ruta registrada responde lo que le toca a cada clase de Sujeto.
func TestCadaRutaRespondeSegunSuNivelParaCadaSujeto(t *testing.T) {
	accesotest.ProbarRutas(t, enrutadorDePrueba(t).Rutas())
}
