package app_test

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/app"
	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/accesotest"
)

// Esta tabla es el inventario de /api/: añadir una ruta obliga a añadirla aquí con su nivel (RNF-012, D-138).
var rutasEsperadas = []servidor.Ruta{
	{Patron: "POST /api/v1/cuentas", Nivel: seguridad.Publica},
	{Patron: "POST /api/v1/cuentas/verificacion", Nivel: seguridad.Publica},
	{Patron: "GET /api/v1/cuentas/estado", Nivel: seguridad.SinVerificar},
	{Patron: "POST /api/v1/cuentas/verificacion/reenvio", Nivel: seguridad.SinVerificar},
	{Patron: "POST /api/v1/cuentas/correo", Nivel: seguridad.SinVerificar},
	{Patron: "POST /api/v1/sesiones", Nivel: seguridad.Publica},
	{Patron: "DELETE /api/v1/sesiones/actual", Nivel: seguridad.SinVerificar},
	{Patron: "GET /api/v1/cuenta/seguridad", Nivel: seguridad.RequiereAutorizacion},
	{Patron: "POST /api/v1/recuperacion", Nivel: seguridad.Publica},
	{Patron: "POST /api/v1/recuperacion/contrasena", Nivel: seguridad.Publica},
	{Patron: "POST /api/v1/cuenta/contrasena", Nivel: seguridad.RequiereAutorizacion},
	{Patron: "GET /api/v1/autorizaciones", Nivel: seguridad.SinAutorizacion},
	{Patron: "POST /api/v1/autorizaciones", Nivel: seguridad.SinAutorizacion},
	{Patron: "POST /api/v1/autorizaciones/rechazo", Nivel: seguridad.SinAutorizacion},
	{Patron: "GET /api/v1/categorias", Nivel: seguridad.RequiereAutorizacion},
	{Patron: "POST /api/v1/movimientos", Nivel: seguridad.RequiereAutorizacion},
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
	e, _, err := app.ArmarEnrutador(context.Background(), cfg, pool, slog.New(slog.NewJSONHandler(io.Discard, nil)))
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

// «Nada se guarda antes de autorizar» (US-50, Ley 1581): solo estas rutas están por debajo de `requiere_autorizacion`, y
// ninguna guarda datos personales o financieros de la persona más allá de lo que hace falta para llegar a PN-64: crear
// la cuenta y verificar el correo (lo borra «No autorizo» o la tarea de 7 días, D-135), entrar, recuperar el acceso,
// cerrar sesión y las tres de la autorización. Una ruta nueva que escriba datos debe declararse `requiere_autorizacion`;
// si de verdad pertenece al ingreso, se suma aquí con la razón.
var rutasAntesDeAutorizar = map[string]bool{
	"POST /api/v1/cuentas":                      true, // crea la cuenta (PN-58)
	"POST /api/v1/cuentas/verificacion":         true, // confirma el correo
	"GET /api/v1/cuentas/estado":                true, // solo lee
	"POST /api/v1/cuentas/verificacion/reenvio": true, // enlace nuevo
	"POST /api/v1/cuentas/correo":               true, // corrige el correo de la cuenta sin verificar
	"POST /api/v1/sesiones":                     true, // entrar
	"DELETE /api/v1/sesiones/actual":            true, // salir
	"POST /api/v1/recuperacion":                 true, // pide el enlace
	"POST /api/v1/recuperacion/contrasena":      true, // elige la contraseña con el enlace
	"GET /api/v1/autorizaciones":                true, // PN-64: solo lee
	"POST /api/v1/autorizaciones":               true, // PN-64: autorizar
	"POST /api/v1/autorizaciones/rechazo":       true, // PN-64: «No autorizo», borra
}

func TestSoloLasRutasDelIngresoNoExigenAutorizacion(t *testing.T) {
	for _, r := range enrutadorDePrueba(t).Rutas() {
		if r.Nivel != seguridad.RequiereAutorizacion && !rutasAntesDeAutorizar[r.Patron] {
			t.Errorf("%s es %s: lo que guarda datos de la persona debe ser requiere_autorizacion", r.Patron, r.Nivel)
		}
		if r.Nivel == seguridad.RequiereAutorizacion && rutasAntesDeAutorizar[r.Patron] {
			t.Errorf("%s está en la lista del ingreso pero exige autorización", r.Patron)
		}
	}
}
