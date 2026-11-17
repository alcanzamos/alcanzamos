//go:build integration

package app_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

const cuerpoDeCorreccion = `{"tipo":"gasto","monto_centavos":9999,"fecha":"2026-10-24","categoria_id":1,"medio":"efectivo","descripcion":"cambiado"}`

// movimientoDe siembra un gasto de la persona y devuelve su id.
func movimientoDe(t *testing.T, pool *pgxpool.Pool, persona string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(), `INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, 'gasto', 1000, '2026-10-23', 'efectivo', 'mercado', 1) RETURNING id::text`, persona).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// fotoDelMovimiento es todo lo que guarda el movimiento, o "borrado" si ya no está.
func fotoDelMovimiento(t *testing.T, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var foto string
	err := pool.QueryRow(context.Background(), `SELECT concat_ws('|', tipo, monto, fecha, medio, descripcion, categoria_id) FROM movimiento WHERE id = $1::uuid`, id).Scan(&foto)
	if err != nil {
		return "borrado"
	}
	return foto
}

// presupuestoDe siembra el presupuesto de Transporte del mes en curso (el de hoy en Colombia) de la persona y devuelve su id.
func presupuestoDe(t *testing.T, pool *pgxpool.Pool, persona string) string {
	t.Helper()
	h := vHoy()
	var id string
	err := pool.QueryRow(context.Background(), `INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, 8, $2, 1000) RETURNING id::text`,
		persona, time.Date(h.Year(), h.Month(), 1, 0, 0, 0, 0, time.UTC)).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// fotoDelPresupuesto es el monto guardado, o "borrado" si ya no está.
func fotoDelPresupuesto(t *testing.T, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var foto string
	if err := pool.QueryRow(context.Background(), `SELECT monto_asignado::text FROM presupuesto WHERE id = $1::uuid`, id).Scan(&foto); err != nil {
		return "borrado"
	}
	return foto
}

func sesionVale(t *testing.T, pool *pgxpool.Pool, token string) bool {
	t.Helper()
	huella, err := seguridad.HuellaDeToken(token)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM sesion WHERE hash_token = $1 AND vence_en > now()`, huella).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

// SEG-016 (a) a (d) en las cinco rutas que cambian algo y no son POST (D-194): `PUT` y `DELETE /api/v1/movimientos/{id}`,
// `PUT` y `DELETE /api/v1/presupuestos/{id}` y `DELETE /api/v1/sesiones/actual`. Cada rechazo responde su estado y su
// cuerpo exactos, sin `Set-Cookie`, y no cambia nada: el movimiento y el presupuesto quedan iguales o sin borrar y la
// sesión sigue valiendo. Con un cliente válido, la ruta sí actúa.
func TestSEG016PUTYDELETERechazadosNoCambianNada(t *testing.T) {
	api, _, pool := apiArmadaCruda(t)
	token, id := persona(t, pool, "laura@ejemplo.test", true, true)
	mov := movimientoDe(t, pool, id)
	antes := fotoDelMovimiento(t, pool, mov)
	if antes == "borrado" {
		t.Fatal("el movimiento no se sembró")
	}
	pre := presupuestoDe(t, pool, id)

	rutas := []struct{ metodo, ruta, cuerpo string }{
		{"PUT", "/api/v1/movimientos/" + mov, cuerpoDeCorreccion},
		{"DELETE", "/api/v1/movimientos/" + mov, ""},
		{"PUT", "/api/v1/presupuestos/" + pre, `{"monto_centavos":9999}`},
		{"DELETE", "/api/v1/presupuestos/" + pre, ""},
		{"DELETE", "/api/v1/sesiones/actual", ""},
	}
	for _, r := range rutas {
		for _, c := range csrftest.Casos(urlPublicaDePrueba) {
			if c.Estado == 0 {
				continue
			}
			t.Run(r.metodo+" "+r.ruta+" · "+c.Nombre, func(t *testing.T) {
				// Las cabeceras del caso, más la cookie de la sesión: la defensa va antes del guard, y la sesión valdría si pasara.
				req := httptest.NewRequest(r.metodo, r.ruta, strings.NewReader(r.cuerpo))
				req.RemoteAddr = "10.1.1.1:1"
				req.Header.Set("Cookie", sesion.NombreDeLaCookie+"="+token)
				for k, v := range c.Cabeceras {
					req.Header.Set(k, v)
				}
				rr := httptest.NewRecorder()
				api.ServeHTTP(rr, req)
				cuerpo := strings.TrimSpace(rr.Body.String())
				quiere, estado := `{"error":"solicitud_no_permitida"}`, http.StatusForbidden
				if c.Estado == 415 {
					quiere, estado = `{"error":"tipo_de_contenido_no_permitido"}`, http.StatusUnsupportedMediaType
				}
				if rr.Code != estado || cuerpo != quiere {
					t.Errorf("%d %s, se esperaba %d %s", rr.Code, cuerpo, estado, quiere)
				}
				if v := rr.Header().Values("Set-Cookie"); len(v) != 0 {
					t.Errorf("un rechazo no pone cookie: %v", v)
				}
				if despues := fotoDelMovimiento(t, pool, mov); despues != antes {
					t.Errorf("el movimiento cambió: %s, antes %s", despues, antes)
				}
				if despues := fotoDelPresupuesto(t, pool, pre); despues != "1000" {
					t.Errorf("el presupuesto cambió: %s", despues)
				}
				if !sesionVale(t, pool, token) {
					t.Error("la sesión ya no vale")
				}
			})
		}
	}

	// Con las cabeceras de la web sí actúan, en este orden: PUT y DELETE del movimiento, PUT y DELETE del presupuesto y
	// cierre de sesión.
	web := []string{"Sec-Fetch-Site", "same-origin", "Content-Type", "application/json"}
	if codigo, cuerpo := enviar(api, token, "PUT", rutas[0].ruta, rutas[0].cuerpo, web...); codigo != 200 || fotoDelMovimiento(t, pool, mov) == antes {
		t.Errorf("PUT válido: %d %s", codigo, cuerpo)
	}
	if codigo, cuerpo := enviar(api, token, "DELETE", rutas[1].ruta, "", web...); codigo != 204 || fotoDelMovimiento(t, pool, mov) != "borrado" {
		t.Errorf("DELETE válido del movimiento: %d %s", codigo, cuerpo)
	}
	if codigo, cuerpo := enviar(api, token, "PUT", rutas[2].ruta, rutas[2].cuerpo, web...); codigo != 200 || fotoDelPresupuesto(t, pool, pre) != "9999" {
		t.Errorf("PUT válido del presupuesto: %d %s", codigo, cuerpo)
	}
	if codigo, cuerpo := enviar(api, token, "DELETE", rutas[3].ruta, "", web...); codigo != 204 || fotoDelPresupuesto(t, pool, pre) != "borrado" {
		t.Errorf("DELETE válido del presupuesto: %d %s", codigo, cuerpo)
	}
	if codigo, cuerpo := enviar(api, token, "DELETE", rutas[4].ruta, "", web...); codigo != 204 || sesionVale(t, pool, token) {
		t.Errorf("DELETE válido de la sesión: %d %s", codigo, cuerpo)
	}
}

// SEG-016 (b) y (c) en las cinco rutas (D-194): con el Origin de URL_PUBLICA y con las cabeceras de Android sí actúan, y
// el cierre de Android sin `Content-Type` da 415 y la sesión sigue (lo que el cliente evita mandándolo siempre).
func TestSEG016PUTYDELETEPasanConOriginDeURLPublicaYConAndroid(t *testing.T) {
	for nombre, cab := range map[string][]string{
		"origin":  {"Authorization", "", "Cookie", "", "Origin", urlPublicaDePrueba, "Content-Type", "application/json"},
		"android": {"X-Alcanzamos-Cliente", "android", "Content-Type", "application/json"},
	} {
		t.Run(nombre, func(t *testing.T) {
			api, _, pool := apiArmadaCruda(t)
			token, id := persona(t, pool, "laura@ejemplo.test", true, true)
			mov := movimientoDe(t, pool, id)
			c := append([]string(nil), cab...)
			if nombre == "origin" {
				c[3] = sesion.NombreDeLaCookie + "=" + token
			}
			if codigo, cuerpo := enviar(api, token, "PUT", "/api/v1/movimientos/"+mov, cuerpoDeCorreccion, c...); codigo != 200 {
				t.Errorf("PUT: %d %s", codigo, cuerpo)
			}
			if codigo, cuerpo := enviar(api, token, "DELETE", "/api/v1/movimientos/"+mov, "", c...); codigo != 204 || fotoDelMovimiento(t, pool, mov) != "borrado" {
				t.Errorf("DELETE: %d %s", codigo, cuerpo)
			}
			pre := presupuestoDe(t, pool, id)
			if codigo, cuerpo := enviar(api, token, "PUT", "/api/v1/presupuestos/"+pre, `{"monto_centavos":9999}`, c...); codigo != 200 || fotoDelPresupuesto(t, pool, pre) != "9999" {
				t.Errorf("PUT del presupuesto: %d %s", codigo, cuerpo)
			}
			if codigo, cuerpo := enviar(api, token, "DELETE", "/api/v1/presupuestos/"+pre, "", c...); codigo != 204 || fotoDelPresupuesto(t, pool, pre) != "borrado" {
				t.Errorf("DELETE del presupuesto: %d %s", codigo, cuerpo)
			}
			if codigo, cuerpo := enviar(api, token, "DELETE", "/api/v1/sesiones/actual", "", c...); codigo != 204 || sesionVale(t, pool, token) {
				t.Errorf("cierre: %d %s", codigo, cuerpo)
			}
		})
	}
	api, _, pool := apiArmadaCruda(t)
	token, _ := persona(t, pool, "ana@ejemplo.test", true, true)
	if codigo, _ := enviar(api, token, "DELETE", "/api/v1/sesiones/actual", "", "X-Alcanzamos-Cliente", "android"); codigo != 415 || !sesionVale(t, pool, token) {
		t.Errorf("cierre de Android sin Content-Type: %d", codigo)
	}
}
