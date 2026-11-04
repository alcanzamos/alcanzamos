//go:build integration

package app_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/alcanzamos/alcanzamos/api/src/app"
	"github.com/alcanzamos/alcanzamos/api/src/argon2id"
	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// US-53 de punta a punta, con el servidor armado de verdad y una base propia: entrar, borrar la cuenta, y comprobar
// que la sesión, la cookie y la cuenta ya no sirven y que no quedó ningún dato personal en el registro.
func TestBorrarLaCuentaDePuntaAPunta(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	const correo, clave = "laura@ejemplo.test", "lluvia café tren azul"
	hash, err := argon2id.Predeterminado().Hashear(ctx, clave)
	if err != nil {
		t.Fatal(err)
	}
	var persona string
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa) VALUES ('Laura', 'adulta') RETURNING id::text`).Scan(&persona); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, '` + correo + `', true)`,
		`INSERT INTO credencial (persona_id, hash) VALUES ($1::uuid, '` + hash + `')`,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, 'cuenta_y_acceso', '1.0', now() - interval '1 day')`,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, 'funciones_financieras', '1.0', now() - interval '1 day')`,
		`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, 'gasto', 1000, current_date, 'efectivo', 'mercado', 1)`,
	} {
		if _, err := tx.Exec(ctx, q, persona); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	entorno := map[string]string{
		"CORREO_SMTP": "127.0.0.1:1", "CORREO_REMITENTE": "a@b.test", "CORREO_PRIVACIDAD": "p@b.test",
		"URL_PUBLICA": "https://app.b.test", "SESION_SENUELO_CLAVE": base64.StdEncoding.EncodeToString(make([]byte, 32)),
	}
	cfg, err := config.Cargar(func(k string) string { return entorno[k] })
	if err != nil {
		t.Fatal(err)
	}
	registro := &bytes.Buffer{}
	enrutador, esperar, err := app.ArmarEnrutador(ctx, cfg, pool, slog.New(slog.NewJSONHandler(registro, nil)))
	if err != nil {
		t.Fatal(err)
	}
	defer esperar()
	api, err := enrutador.Construir()
	if err != nil {
		t.Fatal(err)
	}
	h := servidor.ManejadorConAPI(api)
	llamar := func(metodo, ruta, cuerpo string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
		r.RemoteAddr = "203.0.113.7:4321"
		for _, c := range cookies {
			r.AddCookie(c)
		}
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		return rr
	}

	entrada := llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+clave+`"}`)
	if entrada.Code != 200 || len(entrada.Result().Cookies()) != 1 {
		t.Fatalf("entrar: %d %s", entrada.Code, entrada.Body)
	}
	cookie := entrada.Result().Cookies()[0]
	otraEntrada := llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+clave+`"}`)
	otraCookie := otraEntrada.Result().Cookies()[0]

	if rr := llamar("GET", "/api/v1/cuenta/borrado", "", cookie); rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"hogar":null,"menores":[]}` {
		t.Fatalf("resumen: %d %s", rr.Code, rr.Body)
	}
	if rr := llamar("POST", "/api/v1/cuenta/borrado", `{"contrasena":"otra clave distinta"}`, cookie); rr.Code != 400 {
		t.Fatalf("contraseña mal: %d %s", rr.Code, rr.Body)
	}
	if n := cuentaDe(t, pool, persona); n != 1 {
		t.Fatal("con la contraseña mal no se borra nada")
	}

	rr := llamar("POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+clave+`"}`, cookie)
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"cuenta_borrada"}` {
		t.Fatalf("borrar: %d %s", rr.Code, rr.Body)
	}
	if cs := rr.Result().Cookies(); len(cs) != 1 || cs[0].MaxAge >= 0 || cs[0].Value != "" {
		t.Errorf("la cookie se manda a borrar: %+v", cs)
	}
	if n := cuentaDe(t, pool, persona); n != 0 {
		t.Error("la cuenta sigue")
	}
	for _, tabla := range []string{"movimiento", "credencial", "perfil_adulto", "sesion"} {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM `+tabla).Scan(&n); err != nil || n != 0 {
			t.Errorf("%s: quedan %d filas (%v)", tabla, n, err)
		}
	}
	var retiradas int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NOT NULL AND conservar_hasta > current_date + interval '2 years'`, persona).Scan(&retiradas)
	if retiradas != 2 {
		t.Errorf("la prueba mínima de las autorizaciones: %d", retiradas)
	}

	// Ninguna sesión sirve, la que borró ni la del otro dispositivo; ni se puede entrar, ni borrar otra vez.
	for _, c := range []*http.Cookie{cookie, otraCookie} {
		if rr := llamar("GET", "/api/v1/cuenta/borrado", "", c); rr.Code != 401 {
			t.Errorf("la sesión sigue sirviendo: %d", rr.Code)
		}
	}
	if rr := llamar("POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+clave+`"}`, cookie); rr.Code != 401 {
		t.Errorf("segunda vez: %d", rr.Code)
	}
	if rr := llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+clave+`"}`); rr.Code != 401 {
		t.Errorf("entrar con la cuenta borrada: %d", rr.Code)
	}

	// E17-ECO 3.13: ni el correo, ni la contraseña, ni lo que escribió, ni el token quedaron en el registro. El id
	// interno de la cuenta solo puede estar en un evento de seguridad (el de la contraseña mal escrita).
	for _, dato := range []string{correo, clave, "otra clave distinta", "mercado", cookie.Value} {
		if strings.Contains(registro.String(), dato) {
			t.Errorf("el registro lleva %q:\n%s", dato, registro)
		}
	}
	for _, linea := range strings.Split(registro.String(), "\n") {
		if strings.Contains(linea, persona) && !strings.Contains(linea, `"evento_seguridad"`) {
			t.Errorf("el id de la cuenta fuera de un evento de seguridad: %s", linea)
		}
	}
}

func cuentaDe(t *testing.T, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, persona string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM persona WHERE id = $1::uuid`, persona).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
