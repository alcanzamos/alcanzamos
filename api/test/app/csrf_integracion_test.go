//go:build integration

package app_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/argon2id"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

// todoLoGuardado es el número de filas de cada tabla: si un rechazo cambió algo, cambia.
func todoLoGuardado(t *testing.T, pool *pgxpool.Pool) func() string {
	t.Helper()
	return func() string {
		ctx := context.Background()
		filas, err := pool.Query(ctx, `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)
		if err != nil {
			t.Fatal(err)
		}
		tablas, err := pgx.CollectRows(filas, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		sort.Strings(tablas)
		var cuentas []string
		for _, tabla := range tablas {
			var n int
			if err := pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %q`, tabla)).Scan(&n); err != nil {
				t.Fatal(err)
			}
			cuentas = append(cuentas, fmt.Sprintf("%s=%d", tabla, n))
		}
		return strings.Join(cuentas, " ")
	}
}

// SEG-016 contra el API de producción con la base real: todos los POST, todos los casos (a) a (d), y un rechazo no crea
// ninguna fila (ni cuenta, ni sesión, ni movimiento).
func TestSEG016TodoPOSTRechazadoNoCambiaNada(t *testing.T) {
	api, e, pool := apiArmadaCruda(t)
	persona(t, pool, "laura@ejemplo.test", true, true)
	csrftest.ProbarDefensa(t, api, e.Rutas(), urlPublicaDePrueba, todoLoGuardado(t, pool))
}

// Reproducción de A-18 (SEG-016): `POST /api/v1/sesiones` con `text/plain`, `Origin` ajeno y `Sec-Fetch-Site: cross-site`
// con las credenciales buenas de una cuenta verificada ya no inicia sesión: 403, sin cookie y sin fila de sesión.
func TestSEG016ReproduccionDeA18NoIniciaSesion(t *testing.T) {
	api, _, pool := apiArmadaCruda(t)
	_, id := persona(t, pool, "laura@ejemplo.test", true, true)
	hash, err := argon2id.Predeterminado().Hashear(context.Background(), "lluvia café tren azul")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `INSERT INTO credencial (persona_id, hash) VALUES ($1::uuid, $2)`, id, hash); err != nil {
		t.Fatal(err)
	}
	cuerpo := `{"identificador":"laura@ejemplo.test","contrasena":"lluvia café tren azul"}`
	sesiones := func() int {
		var n int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	antes := sesiones()
	pedir := func(cabeceras map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/sesiones", strings.NewReader(cuerpo))
		r.RemoteAddr = "10.1.1.1:1"
		for k, v := range cabeceras {
			r.Header.Set(k, v)
		}
		rr := httptest.NewRecorder()
		api.ServeHTTP(rr, r)
		return rr
	}

	rr := pedir(map[string]string{"Content-Type": "text/plain", "Origin": "https://atacante.example", "Sec-Fetch-Site": "cross-site"})
	if rr.Code != 403 || strings.TrimSpace(rr.Body.String()) != `{"error":"solicitud_no_permitida"}` || len(rr.Header().Values("Set-Cookie")) != 0 || sesiones() != antes {
		t.Fatalf("el ataque de A-18: %d %s %v, sesiones %d (antes %d)", rr.Code, rr.Body, rr.Header(), sesiones(), antes)
	}

	// Y el mismo pedido bien hecho, desde la web, sí inicia sesión.
	rr = pedir(map[string]string{"Content-Type": "application/json", "Origin": urlPublicaDePrueba, "Sec-Fetch-Site": "same-origin"})
	if rr.Code != 200 || len(rr.Result().Cookies()) != 1 || sesiones() != antes+1 {
		t.Fatalf("la web con sus cabeceras: %d %s %v, sesiones %d", rr.Code, rr.Body, rr.Header(), sesiones())
	}
}
