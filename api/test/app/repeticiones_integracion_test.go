//go:build integration

package app_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/app"
	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

const urlPublicaDePrueba = "https://app.b.test"

// apiArmada es el enrutador de producción (`app.ArmarEnrutador`, con la configuración leída como en `servir`) sobre una
// base propia y migrada.
//
// apiArmada le completa las cabeceras de cliente a los pedidos que no traen ninguna (csrftest); apiArmadaCruda no.
func apiArmada(t *testing.T) (http.Handler, *pgxpool.Pool) {
	t.Helper()
	h, _, pool := apiArmadaCruda(t)
	return csrftest.ConCabeceras(h), pool
}

// apiArmadaCruda es apiArmada sin completar nada: lo que llega es lo que ve la defensa contra CSRF. Devuelve también el
// Enrutador, para recorrer sus rutas.
func apiArmadaCruda(t *testing.T) (http.Handler, *servidor.Enrutador, *pgxpool.Pool) {
	t.Helper()
	h, e, pool, _ := apiArmadaConEspera(t)
	return h, e, pool
}

// apiArmadaConEspera es apiArmadaCruda y además la función que espera el trabajo en segundo plano (los correos y lo que
// crear la cuenta hace fuera del pedido), para las pruebas que miden lo que dura el pedido solo.
func apiArmadaConEspera(t *testing.T) (http.Handler, *servidor.Enrutador, *pgxpool.Pool, func()) {
	t.Helper()
	pool := pgtest.Nueva(t)
	entorno := map[string]string{
		"CORREO_SMTP": "127.0.0.1:1", "CORREO_REMITENTE": "a@b.test", "CORREO_PRIVACIDAD": "p@b.test",
		"URL_PUBLICA": urlPublicaDePrueba,
	}
	cfg, err := config.Cargar(func(k string) string { return entorno[k] })
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancelar := context.WithCancel(context.Background())
	e, esperar, err := app.ArmarEnrutador(ctx, cfg, pool, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cancelar(); esperar() })
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h), e, pool, esperar
}

// persona siembra una cuenta adulta con sesión, y la deja verificada y autorizada o no; devuelve su token (Bearer).
func persona(t *testing.T, pool *pgxpool.Pool, correo string, verificada, autorizada bool) (token, id string) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa) VALUES ('Laura', 'adulta') RETURNING id::text`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, $2, $3)`, id, correo, verificada); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if autorizada {
		for _, f := range []string{"cuenta_y_acceso", "funciones_financieras"} {
			if _, err := pool.Exec(ctx, `INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, $2, '1.0', now())`, id, f); err != nil {
				t.Fatal(err)
			}
		}
	}
	token, huella := seguridad.NuevoTokenOpaco()
	if _, err := pool.Exec(ctx, `INSERT INTO sesion (hash_token, persona_id, vence_en) VALUES ($1, $2::uuid, now() + interval '30 days')`, huella, id); err != nil {
		t.Fatal(err)
	}
	return token, id
}

func enviar(h http.Handler, token, metodo, ruta, cuerpo string, cabeceras ...string) (int, string) {
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	r.RemoteAddr = "10.1.1.1:1"
	r.Header.Set("Authorization", "Bearer "+token)
	for i := 0; i < len(cabeceras); i += 2 {
		if cabeceras[i+1] == "" {
			r.Header.Del(cabeceras[i])
		} else {
			r.Header.Set(cabeceras[i], cabeceras[i+1])
		}
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	return rr.Code, strings.TrimSpace(rr.Body.String())
}

var rutasDeUS60 = [][3]string{
	{"GET", "/api/v1/repeticiones/pendientes", ""},
	{"POST", "/api/v1/repeticiones/0192f3c4-0000-7000-8000-0000000000ee/confirmacion", `{"fecha":"2026-11-11"}`},
	{"POST", "/api/v1/repeticiones/0192f3c4-0000-7000-8000-0000000000ee/omision", `{"fecha":"2026-11-11"}`},
	{"POST", "/api/v1/repeticiones/decisiones", `{"decisiones":[]}`},
}

// Una cuenta con el correo sin verificar recibe 403 `verificacion_pendiente` en las cuatro rutas, antes de leer o tocar nada.
func TestLasRutasDeFechasPorConfirmarDanVerificacionPendienteConElCorreoSinVerificar(t *testing.T) {
	h, pool := apiArmada(t)
	token, _ := persona(t, pool, "sin@ejemplo.test", false, true)
	for _, p := range rutasDeUS60 {
		if codigo, cuerpo := enviar(h, token, p[0], p[1], p[2], "Content-Type", "application/json"); codigo != 403 || cuerpo != `{"error":"verificacion_pendiente"}` {
			t.Errorf("%s %s: %d %s", p[0], p[1], codigo, cuerpo)
		}
	}
}

// El cableado de producción pasa URL_PUBLICA a la defensa contra CSRF: con el `Origin` configurado el POST entra; con
// otro, 403 sin cambiar nada.
func TestElCableadoDeProduccionPasaURLPublicaALaDefensaContraCSRF(t *testing.T) {
	h, pool := apiArmada(t)
	token, id := persona(t, pool, "laura@ejemplo.test", true, true)
	var recurrente string
	hoy := fechas.HoyEnColombia(time.Now())
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO movimiento_recurrente (persona_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio)
		 VALUES ($1::uuid, 'gasto', 4, 'mensual', 100, 'efectivo', $2) RETURNING id::text`, id, hoy).Scan(&recurrente); err != nil {
		t.Fatal(err)
	}
	ruta := "/api/v1/repeticiones/" + recurrente + "/omision"
	cuerpo := fmt.Sprintf(`{"fecha":%q}`, hoy.Format(time.DateOnly))
	sinCliente := []string{"X-Alcanzamos-Cliente", "", "Authorization", "Bearer " + token}
	json := []string{"Content-Type", "application/json"}

	if codigo, resp := enviar(h, token, "POST", ruta, cuerpo, append(append(append([]string{}, json...), sinCliente...), "Origin", "https://otro.test")...); codigo != 403 {
		t.Errorf("Origin ajeno: %d %s", codigo, resp)
	}
	var omitidas int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM ocurrencia_omitida`).Scan(&omitidas); err != nil || omitidas != 0 {
		t.Fatalf("el rechazo no guarda nada: %d %v", omitidas, err)
	}
	if codigo, resp := enviar(h, token, "POST", ruta, cuerpo, append(append(append([]string{}, json...), sinCliente...), "Origin", urlPublicaDePrueba)...); codigo != 204 {
		t.Errorf("Origin de URL_PUBLICA: %d %s", codigo, resp)
	}
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM ocurrencia_omitida`).Scan(&omitidas); err != nil || omitidas != 1 {
		t.Errorf("la omisión se guardó: %d %v", omitidas, err)
	}
}
