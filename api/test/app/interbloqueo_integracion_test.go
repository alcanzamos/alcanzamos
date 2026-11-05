//go:build integration

package app_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/app"
	"github.com/alcanzamos/alcanzamos/api/src/argon2id"
	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

const vClave = "lluvia café tren azul"

type vBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *vBuf) Write(p []byte) (int, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.b.Write(p) }
func (s *vBuf) String() string              { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

type vEnt struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	db   string
	log  *vBuf
	hash string
	obs  *pgx.Conn
}

func vArmar(t *testing.T) *vEnt {
	t.Helper()
	pool := pgtest.Nueva(t)
	entorno := map[string]string{
		"CORREO_SMTP": "127.0.0.1:1", "CORREO_REMITENTE": "a@b.test", "CORREO_PRIVACIDAD": "p@b.test",
		"URL_PUBLICA": urlPublicaDePrueba, "SESION_SENUELO_CLAVE": base64.StdEncoding.EncodeToString(make([]byte, 32)),
	}
	cfg, err := config.Cargar(func(k string) string { return entorno[k] })
	if err != nil {
		t.Fatal(err)
	}
	reg := &vBuf{}
	ctx, cancelar := context.WithCancel(context.Background())
	e, esperar, err := app.ArmarEnrutador(ctx, cfg, pool, slog.New(slog.NewJSONHandler(reg, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cancelar(); esperar() })
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(servidor.ManejadorConAPI(h))
	t.Cleanup(srv.Close)
	hash, err := argon2id.Predeterminado().Hashear(context.Background(), vClave)
	if err != nil {
		t.Fatal(err)
	}
	obs, err := pgx.Connect(context.Background(), pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { obs.Close(context.Background()) })
	return &vEnt{srv: srv, pool: pool, db: pool.Config().ConnConfig.Database, log: reg, hash: hash, obs: obs}
}

type vCuenta struct {
	id, tokA, tokB string
	recs           []string
}

func vHoy() time.Time { return fechas.HoyEnColombia(time.Now()) }

// vFechas: las 4 fechas semanales pendientes (inicio = hoy-21).
func vFechas() []string {
	h := vHoy()
	return []string{h.AddDate(0, 0, -21).Format(time.DateOnly), h.AddDate(0, 0, -14).Format(time.DateOnly), h.AddDate(0, 0, -7).Format(time.DateOnly), h.Format(time.DateOnly)}
}

func (e *vEnt) sembrar(t *testing.T, correo string, k int, monto int64) vCuenta {
	t.Helper()
	ctx := context.Background()
	tokA, id := persona(t, e.pool, correo, true, true)
	tokB, huella := seguridad.NuevoTokenOpaco()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO sesion (hash_token, persona_id, vence_en) VALUES ($1, $2::uuid, now() + interval '30 days')`, []any{huella, id}},
		{`INSERT INTO credencial (persona_id, hash) VALUES ($1::uuid, $2)`, []any{id, e.hash}},
	} {
		if _, err := e.pool.Exec(ctx, q.sql, q.args...); err != nil {
			t.Fatal(err)
		}
	}
	c := vCuenta{id: id, tokA: tokA, tokB: tokB}
	for i := 0; i < k; i++ {
		var r string
		if err := e.pool.QueryRow(ctx,
			`INSERT INTO movimiento_recurrente (persona_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio, creado_en)
			 VALUES ($1::uuid, 'gasto', 4, 'semanal', $2, 'efectivo', $3, now() - interval '22 days') RETURNING id::text`,
			id, monto, vHoy().AddDate(0, 0, -21)).Scan(&r); err != nil {
			t.Fatal(err)
		}
		c.recs = append(c.recs, r)
	}
	sort.Strings(c.recs)
	return c
}

func (e *vEnt) pedir(token, metodo, ruta, cuerpo string) (int, []byte) {
	req, _ := http.NewRequest(metodo, e.srv.URL+ruta, strings.NewReader(cuerpo))
	req.Header.Set("Authorization", "Bearer "+token)
	if metodo == "POST" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := e.srv.Client().Do(req)
	if err != nil {
		return -1, []byte(err.Error())
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

func vCodigo(b []byte) string {
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		if len(b) > 0 && b[0] == 'P' {
			return "zip"
		}
		return strings.TrimSpace(string(b))
	}
	for _, k := range []string{"error", "estado"} {
		if v, ok := m[k].(string); ok {
			return v
		}
	}
	return "json"
}

func (e *vEnt) borrar(c vCuenta) (int, []byte) {
	return e.pedir(c.tokA, "POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+vClave+`"}`)
}

// decisiones: todas las fechas de las repeticiones; las impares, «No pasó».
func vDecisiones(recs []string, fs []string) string {
	var d []string
	for _, r := range recs {
		for j, f := range fs {
			d = append(d, fmt.Sprintf(`{"recurrente_id":%q,"fecha":%q,"omitida":%t}`, r, f, j%2 == 1))
		}
	}
	return `{"decisiones":[` + strings.Join(d, ",") + `]}`
}

type vEstado struct{ persona, cred, ses, movs, recs, omit, huerfanos int }

func (e *vEnt) estado(t *testing.T, c vCuenta) vEstado {
	t.Helper()
	var s vEstado
	if err := e.obs.QueryRow(context.Background(), `SELECT
	  (SELECT count(*) FROM persona WHERE id = $1::uuid),
	  (SELECT count(*) FROM credencial WHERE persona_id = $1::uuid),
	  (SELECT count(*) FROM sesion WHERE persona_id = $1::uuid),
	  (SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid OR recurrente_id = ANY($2::uuid[])),
	  (SELECT count(*) FROM movimiento_recurrente WHERE persona_id = $1::uuid OR id = ANY($2::uuid[])),
	  (SELECT count(*) FROM ocurrencia_omitida WHERE recurrente_id = ANY($2::uuid[])),
	  (SELECT (SELECT count(*) FROM movimiento m WHERE m.hogar_id IS NULL AND NOT EXISTS (SELECT 1 FROM persona p WHERE p.id = m.persona_id))
	        + (SELECT count(*) FROM movimiento_recurrente r WHERE r.hogar_id IS NULL AND NOT EXISTS (SELECT 1 FROM persona p WHERE p.id = r.persona_id))
	        + (SELECT count(*) FROM ocurrencia_omitida o WHERE NOT EXISTS (SELECT 1 FROM movimiento_recurrente r WHERE r.id = o.recurrente_id)))`,
		c.id, c.recs).Scan(&s.persona, &s.cred, &s.ses, &s.movs, &s.recs, &s.omit, &s.huerfanos); err != nil {
		t.Fatal(err)
	}
	return s
}

// deadlocks: cierra las conexiones del pool y lee pg_stat_database hasta que el contador se estabiliza.
func (e *vEnt) deadlocks(t *testing.T) int64 {
	t.Helper()
	e.pool.Reset()
	var ultimo int64 = -1
	estables := 0
	for i := 0; i < 40 && estables < 4; i++ {
		var n int64
		c, err := pgx.Connect(context.Background(), e.pool.Config().ConnString())
		if err != nil {
			t.Fatal(err)
		}
		_ = c.QueryRow(context.Background(), `SELECT pg_stat_clear_snapshot()`).Scan(new(any))
		if err := c.QueryRow(context.Background(), `SELECT deadlocks FROM pg_stat_database WHERE datname = $1`, e.db).Scan(&n); err != nil {
			t.Fatal(err)
		}
		c.Close(context.Background())
		if n == ultimo {
			estables++
		} else {
			estables, ultimo = 0, n
		}
		time.Sleep(250 * time.Millisecond) // espera de estadísticas, no de interleaving
	}
	return ultimo
}

// sinInterbloqueos falla si la base abortó alguna transacción por bloqueo mutuo (cierra el pool de trabajo antes de leer).
func (e *vEnt) sinInterbloqueos(t *testing.T, caso string) {
	t.Helper()
	if n := e.deadlocks(t); n != 0 {
		t.Errorf("%s: %d interbloqueos en la base", caso, n)
	}
}

const (
	esperaPersonaCompartida = "SELECT 1 FROM persona WHERE id = $1::uuid FOR KEY SHARE"
	esperaPersonaExclusiva  = "SELECT 1 FROM persona WHERE id = $1::uuid FOR UPDATE"
	esperaRepeticiones      = "SELECT id::text FROM movimiento_recurrente WHERE id = ANY%"
	esperaBorrarRepeticion  = "DELETE FROM movimiento_recurrente%"
	esperaInsertarMov       = "INSERT INTO movimiento %"
)

var vPermitidosUS60 = map[int]bool{200: true, 201: true, 204: true, 401: true, 404: true, 409: true}

type vRonda struct {
	nombre string
	k      int
	us60   func(e *vEnt, c vCuenta) []string // devuelve "código error" de cada pedido
}

func vCarrera(t *testing.T, r vRonda, rondas int) {
	e := vArmar(t)
	cuentas := map[string]int{}
	var fallos []string
	for i := 0; i < rondas; i++ {
		c := e.sembrar(t, fmt.Sprintf("v%d-%s@ejemplo.test", i, strings.ReplaceAll(r.nombre, " ", "")), r.k, 1234)
		inicio := make(chan struct{})
		var wg sync.WaitGroup
		var dc int
		var db []byte
		var us []string
		wg.Add(2)
		go func() { defer wg.Done(); <-inicio; dc, db = e.borrar(c) }()
		go func() {
			defer wg.Done()
			<-inicio
			// desfase natural, distinto en cada ronda, para que el pedido caiga antes, durante y después del borrado
			if d := time.Duration(i%10) * 6 * time.Millisecond; d > 0 {
				time.Sleep(d)
			}
			us = r.us60(e, c)
		}()
		close(inicio)
		wg.Wait()
		cuentas[fmt.Sprintf("borrado %d %s", dc, vCodigo(db))]++
		for _, u := range us {
			cuentas["us60 "+u]++
			var code int
			_, _ = fmt.Sscanf(u, "%d", &code)
			if !vPermitidosUS60[code] || strings.Contains(u, "conflicto_concurrente") {
				fallos = append(fallos, fmt.Sprintf("ronda %d: US-60 %s", i, u))
			}
		}
		s := e.estado(t, c)
		if dc != 200 {
			fallos = append(fallos, fmt.Sprintf("ronda %d: borrado %d %s %+v", i, dc, db, s))
		}
		if s.persona+s.cred+s.ses+s.movs+s.recs+s.omit+s.huerfanos != 0 {
			fallos = append(fallos, fmt.Sprintf("ronda %d: borrado %d pero quedan %+v", i, dc, s))
		}
	}
	dl := e.deadlocks(t)
	errores := strings.Count(e.log.String(), `"level":"ERROR"`)
	t.Logf("%s: %d rondas; deadlocks=%d; líneas ERROR=%d; códigos=%v", r.nombre, rondas, dl, errores, cuentas)
	if dl != 0 {
		t.Errorf("%s: %d interbloqueos en la base", r.nombre, dl)
	}
	if errores > 0 {
		t.Errorf("%s: %d líneas ERROR en el registro: %s", r.nombre, errores, vSoloErrores(e.log.String()))
	}
	for _, f := range fallos {
		t.Error(f)
	}
}

func vSoloErrores(s string) string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if strings.Contains(l, `"level":"ERROR"`) || strings.Contains(l, `"level":"WARN"`) {
			out = append(out, l)
		}
	}
	if len(out) > 5 {
		out = out[:5]
	}
	return strings.Join(out, "\n")
}

func vRes(code int, b []byte) string { return fmt.Sprintf("%d %s", code, vCodigo(b)) }

// vRondas son pocas a propósito (CI): los casos forzados de abajo cubren de forma determinista cada ciclo conocido.
const vRondas = 8

func TestInterbloqueoCarreraBorradoVsDecisiones(t *testing.T) {
	fs := vFechas()
	vCarrera(t, vRonda{nombre: "decisiones", k: 3, us60: func(e *vEnt, c vCuenta) []string {
		return []string{vRes(e.pedir(c.tokB, "POST", "/api/v1/repeticiones/decisiones", vDecisiones(c.recs, fs)))}
	}}, vRondas)
}

func TestInterbloqueoCarreraBorradoVsDecisionesEnTandas(t *testing.T) {
	fs := vFechas()
	vCarrera(t, vRonda{nombre: "decisiones en tandas", k: 3, us60: func(e *vEnt, c vCuenta) []string {
		var out []string
		for _, f := range fs {
			out = append(out, vRes(e.pedir(c.tokB, "POST", "/api/v1/repeticiones/decisiones", vDecisiones(c.recs, []string{f}))))
		}
		return out
	}}, vRondas)
}

func TestInterbloqueoCarreraBorradoVsConfirmacion(t *testing.T) {
	fs := vFechas()
	vCarrera(t, vRonda{nombre: "confirmacion", k: 2, us60: func(e *vEnt, c vCuenta) []string {
		var out []string
		for _, f := range fs {
			for _, r := range c.recs {
				out = append(out, vRes(e.pedir(c.tokB, "POST", "/api/v1/repeticiones/"+r+"/confirmacion", fmt.Sprintf(`{"fecha":%q,"monto_centavos":555}`, f))))
			}
		}
		return out
	}}, vRondas)
}

func TestInterbloqueoCarreraBorradoVsOmision(t *testing.T) {
	fs := vFechas()
	vCarrera(t, vRonda{nombre: "omision", k: 2, us60: func(e *vEnt, c vCuenta) []string {
		var out []string
		for _, f := range fs {
			for _, r := range c.recs {
				out = append(out, vRes(e.pedir(c.tokB, "POST", "/api/v1/repeticiones/"+r+"/omision", fmt.Sprintf(`{"fecha":%q}`, f))))
			}
		}
		return out
	}}, vRondas)
}

func TestInterbloqueoCarreraBorradoVsPendientes(t *testing.T) {
	vCarrera(t, vRonda{nombre: "pendientes", k: 2, us60: func(e *vEnt, c vCuenta) []string {
		var out []string
		for range 6 {
			out = append(out, vRes(e.pedir(c.tokB, "GET", "/api/v1/repeticiones/pendientes", "")))
		}
		return out
	}}, vRondas)
}

// Tres dispositivos a la vez con «Confirmar todos» por tandas: intenta agotar los 3 intentos del borrado.
func TestInterbloqueoCarreraBorradoVsTresDispositivos(t *testing.T) {
	fs := vFechas()
	vCarrera(t, vRonda{nombre: "tres dispositivos", k: 4, us60: func(e *vEnt, c vCuenta) []string {
		var mu sync.Mutex
		var out []string
		var wg sync.WaitGroup
		for w := 0; w < 3; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for j, f := range fs {
					recs := []string{c.recs[(w+j)%4], c.recs[(w+j+1)%4]}
					s := vRes(e.pedir(c.tokB, "POST", "/api/v1/repeticiones/decisiones", vDecisiones(recs, []string{f})))
					mu.Lock()
					out = append(out, s)
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
		return out
	}}, vRondas)
}

// ---------- Interleavings forzados ----------

// esperarBloqueo espera (sin dormir: consulta sin pausa) a que una conexión esté esperando un candado de la base en una
// sentencia que coincide con alguno de los patrones LIKE.
func (e *vEnt) esperarBloqueo(t *testing.T, patrones ...string) {
	t.Helper()
	limite := time.Now().Add(20 * time.Second)
	for time.Now().Before(limite) {
		var n int
		if err := e.obs.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ANY ($1::text[])`, patrones).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			return
		}
	}
	t.Fatalf("nadie quedó esperando un candado en %q", patrones)
}

func (e *vEnt) retener(t *testing.T, sql string, args ...any) pgx.Tx {
	t.Helper()
	c, err := pgx.Connect(context.Background(), e.pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close(context.Background()) })
	tx, err := c.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
	return tx
}

type vResultado struct {
	code int
	body []byte
}

func vAsync(f func() (int, []byte)) chan vResultado {
	ch := make(chan vResultado, 1)
	go func() { c, b := f(); ch <- vResultado{c, b} }()
	return ch
}

// F1: Decidir bloquea la repetición menor y espera la mayor (retenida); el borrado entra y espera en DELETE
// movimiento_recurrente; se suelta la retenida: Decidir pasa al INSERT (llave de persona) contra el borrado.
func TestInterbloqueoForzadoDecidirPrimeroBorradoDespues(t *testing.T) {
	e := vArmar(t)
	fs := vFechas()
	for i := 0; i < 3; i++ {
		c := e.sembrar(t, fmt.Sprintf("f1-%d@ejemplo.test", i), 2, 1234)
		h := e.retener(t, `SELECT 1 FROM movimiento_recurrente WHERE id = $1::uuid FOR UPDATE`, c.recs[1])
		dec := vAsync(func() (int, []byte) {
			return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/decisiones", vDecisiones(c.recs, fs[:1]))
		})
		e.esperarBloqueo(t, esperaRepeticiones)
		bor := vAsync(func() (int, []byte) { return e.borrar(c) })
		e.esperarBloqueo(t, esperaBorrarRepeticion, esperaPersonaExclusiva)
		if err := h.Commit(context.Background()); err != nil {
			t.Fatal(err)
		}
		d, b := <-dec, <-bor
		s := e.estado(t, c)
		t.Logf("F1 ronda %d: decisiones %d %s; borrado %d %s; estado %+v", i, d.code, vCodigo(d.body), b.code, vCodigo(b.body), s)
		if d.code >= 500 || vCodigo(d.body) == "conflicto_concurrente" || b.code != 200 || s.persona+s.movs+s.recs+s.omit+s.huerfanos != 0 {
			t.Errorf("F1 ronda %d: resultado inválido", i)
		}
	}
	e.sinInterbloqueos(t, "F1")
}

// F2: el borrado tiene la persona y espera el perfil (retenido); Decidir bloquea la repetición y espera en el INSERT (llave
// de persona); se suelta el perfil: el borrado llega a DELETE movimiento_recurrente.
func TestInterbloqueoForzadoBorradoPrimeroDecidirDespues(t *testing.T) {
	e := vArmar(t)
	fs := vFechas()
	for i, ruta := range []string{"decisiones", "confirmacion"} {
		c := e.sembrar(t, fmt.Sprintf("f2-%d@ejemplo.test", i), 2, 1234)
		h := e.retener(t, `SELECT 1 FROM perfil_adulto WHERE persona_id = $1::uuid FOR UPDATE`, c.id)
		bor := vAsync(func() (int, []byte) { return e.borrar(c) })
		e.esperarBloqueo(t, "SELECT 1 FROM perfil_adulto WHERE persona_id%")
		var dec chan vResultado
		switch ruta {
		case "decisiones":
			dec = vAsync(func() (int, []byte) {
				return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/decisiones", vDecisiones(c.recs, fs[:1]))
			})
		case "confirmacion":
			dec = vAsync(func() (int, []byte) {
				return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/"+c.recs[0]+"/confirmacion", fmt.Sprintf(`{"fecha":%q}`, fs[0]))
			})
		}
		e.esperarBloqueo(t, esperaInsertarMov, esperaPersonaCompartida)
		if err := h.Commit(context.Background()); err != nil {
			t.Fatal(err)
		}
		d, b := <-dec, <-bor
		s := e.estado(t, c)
		t.Logf("F2 %s: US-60 %d %s; borrado %d %s; estado %+v", ruta, d.code, vCodigo(d.body), b.code, vCodigo(b.body), s)
		if d.code >= 500 || vCodigo(d.body) == "conflicto_concurrente" || b.code != 200 || s.persona+s.movs+s.recs+s.omit+s.huerfanos != 0 {
			t.Errorf("F2 %s: resultado inválido", ruta)
		}
	}
	e.sinInterbloqueos(t, "F2")
}

// F3: el borrado ya borró las repeticiones y espera en DELETE meta (retenida); Decidir espera la repetición borrada.
func TestInterbloqueoForzadoRepeticionBorradaMientrasDecidirEspera(t *testing.T) {
	e := vArmar(t)
	fs := vFechas()
	for i, ruta := range []string{"decisiones", "confirmacion", "omision", "pendientes", "datos"} {
		c := e.sembrar(t, fmt.Sprintf("f3-%d@ejemplo.test", i), 2, 1234)
		var meta string
		if err := e.pool.QueryRow(context.Background(), `INSERT INTO meta (persona_id, nombre, monto_objetivo) VALUES ($1::uuid, 'viaje', 1000) RETURNING id::text`, c.id).Scan(&meta); err != nil {
			t.Fatal(err)
		}
		h := e.retener(t, `SELECT 1 FROM meta WHERE id = $1::uuid FOR UPDATE`, meta)
		bor := vAsync(func() (int, []byte) { return e.borrar(c) })
		e.esperarBloqueo(t, "DELETE FROM meta%")
		var dec chan vResultado
		esperar := true
		switch ruta {
		case "decisiones":
			dec = vAsync(func() (int, []byte) {
				return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/decisiones", vDecisiones(c.recs, fs[:2]))
			})
		case "confirmacion":
			dec = vAsync(func() (int, []byte) {
				return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/"+c.recs[0]+"/confirmacion", fmt.Sprintf(`{"fecha":%q}`, fs[0]))
			})
		case "omision":
			dec = vAsync(func() (int, []byte) {
				return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/"+c.recs[0]+"/omision", fmt.Sprintf(`{"fecha":%q}`, fs[0]))
			})
		case "pendientes":
			esperar = false
			r1, b1 := e.pedir(c.tokB, "GET", "/api/v1/repeticiones/pendientes", "")
			dec = make(chan vResultado, 1)
			dec <- vResultado{r1, b1}
		case "datos":
			esperar = false
			r1, b1 := e.pedir(c.tokB, "GET", "/api/v1/cuenta/datos", "")
			dec = make(chan vResultado, 1)
			dec <- vResultado{r1, b1}
		}
		if esperar {
			e.esperarBloqueo(t, esperaRepeticiones, esperaPersonaCompartida)
		}
		if err := h.Commit(context.Background()); err != nil {
			t.Fatal(err)
		}
		d, b := <-dec, <-bor
		s := e.estado(t, c)
		t.Logf("F3 %s: US-60 %d %s; borrado %d %s; estado %+v", ruta, d.code, vCodigo(d.body), b.code, vCodigo(b.body), s)
		if d.code >= 500 || b.code != 200 || s.persona+s.movs+s.recs+s.omit+s.huerfanos != 0 {
			t.Errorf("F3 %s: resultado inválido", ruta)
		}
		// después del borrado, las cuatro rutas con la sesión borrada
		for _, p := range [][3]string{{"GET", "/api/v1/repeticiones/pendientes", ""}, {"POST", "/api/v1/repeticiones/" + c.recs[0] + "/confirmacion", `{"fecha":"` + fs[0] + `"}`}, {"POST", "/api/v1/repeticiones/" + c.recs[0] + "/omision", `{"fecha":"` + fs[0] + `"}`}, {"POST", "/api/v1/repeticiones/decisiones", vDecisiones(c.recs, fs[:1])}, {"GET", "/api/v1/cuenta/datos", ""}} {
			if code, body := e.pedir(c.tokB, p[0], p[1], p[2]); code != 401 {
				t.Errorf("después del borrado %s %s: %d %s", p[0], p[1], code, body)
			}
		}
	}
	e.sinInterbloqueos(t, "F3")
}

// F4: repetición compartida en un hogar que sigue (Q administra): el borrado no la borra, la deja sin nombre (SET NULL).
// Se fuerza a Decidir a esperar la llave de persona mientras el borrado avanza. ¿23503 sin traducir (500)?
func TestInterbloqueoForzadoRepeticionCompartida(t *testing.T) {
	e := vArmar(t)
	fs := vFechas()
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		c := e.sembrar(t, fmt.Sprintf("f4-%d@ejemplo.test", i), 0, 1234)
		_, q := persona(t, e.pool, fmt.Sprintf("f4q-%d@ejemplo.test", i), true, true)
		var hogar, rec string
		tx, _ := e.pool.Begin(ctx)
		if err := tx.QueryRow(ctx, `INSERT INTO hogar (nombre, creado_en, administrador_id) VALUES ('Casa', current_date, $1::uuid) RETURNING id::text`, q).Scan(&hogar); err != nil {
			t.Fatal(err)
		}
		for j, p := range []string{q, c.id} {
			if _, err := tx.Exec(ctx, `INSERT INTO miembro_hogar (persona_id, hogar_id, desde) VALUES ($1::uuid, $2::uuid, now() + $3 * interval '1 minute')`, p, hogar, j); err != nil {
				t.Fatal(err)
			}
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := e.pool.QueryRow(ctx,
			`INSERT INTO movimiento_recurrente (persona_id, hogar_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio, creado_en)
			 VALUES ($1::uuid, $2::uuid, 'gasto', 4, 'semanal', 999, 'efectivo', $3, now() - interval '22 days') RETURNING id::text`,
			c.id, hogar, vHoy().AddDate(0, 0, -21)).Scan(&rec); err != nil {
			t.Fatal(err)
		}
		c.recs = []string{rec}
		h := e.retener(t, `SELECT 1 FROM perfil_adulto WHERE persona_id = $1::uuid FOR UPDATE`, c.id)
		bor := vAsync(func() (int, []byte) { return e.borrar(c) })
		e.esperarBloqueo(t, "SELECT 1 FROM perfil_adulto WHERE persona_id%")
		dec := vAsync(func() (int, []byte) {
			return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/"+rec+"/confirmacion", fmt.Sprintf(`{"fecha":%q}`, fs[i]))
		})
		e.esperarBloqueo(t, esperaInsertarMov, esperaPersonaCompartida)
		if err := h.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		d, b := <-dec, <-bor
		var personaRec *string
		var movs int
		_ = e.obs.QueryRow(ctx, `SELECT persona_id::text, (SELECT count(*) FROM movimiento WHERE recurrente_id = $1::uuid) FROM movimiento_recurrente WHERE id = $1::uuid`, rec).Scan(&personaRec, &movs)
		t.Logf("F4 ronda %d: confirmacion %d %s; borrado %d %s; recurrente.persona_id=%v movs=%d", i, d.code, vCodigo(d.body), b.code, vCodigo(b.body), personaRec, movs)
		if d.code >= 500 || b.code != 200 {
			t.Errorf("F4 ronda %d: resultado inválido", i)
		}
	}
	e.sinInterbloqueos(t, "F4")
	if registro := vSoloErrores(e.log.String()); registro != "" {
		t.Errorf("F4: el registro trae errores: %s", registro)
	}
}

// ---------- Descarga contra confirmaciones ----------

func vLeerZIP(t *testing.T, b []byte) [][]string {
	t.Helper()
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("ZIP: %v", err)
	}
	for _, f := range z.File {
		if f.Name != "movimientos.csv" {
			continue
		}
		r, _ := f.Open()
		crudo, _ := io.ReadAll(r)
		r.Close()
		filas, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(crudo, []byte("\xEF\xBB\xBF")))).ReadAll()
		if err != nil {
			t.Fatal(err)
		}
		return filas[1:]
	}
	t.Fatal("sin movimientos.csv")
	return nil
}

func TestInterbloqueoDescargaContraConfirmaciones(t *testing.T) {
	e := vArmar(t)
	fs := vFechas()
	ctx := context.Background()
	cuentas := map[string]int{}
	for i := 0; i < vRondas; i++ {
		x := e.sembrar(t, fmt.Sprintf("dx-%d@ejemplo.test", i), 3, 1234)
		y := e.sembrar(t, fmt.Sprintf("dy-%d@ejemplo.test", i), 3, 77777)
		if _, err := e.pool.Exec(ctx, `INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, 'gasto', 88888, current_date, 'efectivo', 'ajeno-de-y', 1)`, y.id); err != nil {
			t.Fatal(err)
		}
		inicio := make(chan struct{})
		var wg sync.WaitGroup
		var mu sync.Mutex
		var zips [][]byte
		anotar := func(s string) { mu.Lock(); cuentas[s]++; mu.Unlock() }
		// X descarga 5 veces; X confirma en tandas; Y confirma en tandas; en las rondas impares X además borra su cuenta.
		wg.Add(3)
		go func() {
			defer wg.Done()
			<-inicio
			for range 5 {
				code, b := e.pedir(x.tokA, "GET", "/api/v1/cuenta/datos", "")
				anotar(fmt.Sprintf("datos %d %s", code, vCodigo(b)))
				if code == 200 {
					mu.Lock()
					zips = append(zips, b)
					mu.Unlock()
				}
			}
		}()
		for _, p := range []vCuenta{x, y} {
			go func() {
				defer wg.Done()
				<-inicio
				for _, f := range fs {
					code, b := e.pedir(p.tokB, "POST", "/api/v1/repeticiones/decisiones", vDecisiones(p.recs, []string{f}))
					anotar(fmt.Sprintf("decisiones %d %s", code, vCodigo(b)))
				}
			}()
		}
		if i%2 == 1 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-inicio
				code, b := e.borrar(x)
				anotar(fmt.Sprintf("borrado %d %s", code, vCodigo(b)))
			}()
		}
		close(inicio)
		wg.Wait()
		for _, z := range zips {
			for _, fila := range vLeerZIP(t, z) {
				// fila: fecha,tipo,monto,categoria,medio,descripcion,meta,sentido,compartido
				if fila[2] == "777.77" || fila[2] == "888.88" || strings.Contains(strings.Join(fila, ","), "ajeno") {
					t.Errorf("ronda %d: la descarga de X trae una fila de Y: %v", i, fila)
				}
				if fila[2] != "12.34" {
					t.Errorf("ronda %d: fila inesperada %v", i, fila)
				}
			}
		}
	}
	errores := strings.Count(e.log.String(), `"level":"ERROR"`)
	t.Logf("descarga: ERROR=%d; códigos=%v", errores, cuentas)
	e.sinInterbloqueos(t, "descarga contra confirmaciones")
	for k := range cuentas {
		if strings.Contains(k, " 500 ") || strings.Contains(k, "borrado") && !strings.Contains(k, "borrado 200 ") {
			t.Errorf("respuesta inesperada: %s", k)
		}
	}
	if errores > 0 {
		t.Errorf("líneas ERROR: %s", vSoloErrores(e.log.String()))
	}
}

// Orden de candados: Decidir contra inicio de sesión y registro (POST /api/v1/movimientos), con y sin borrado.
func TestInterbloqueoCarreraOrdenDeCandados(t *testing.T) {
	e := vArmar(t)
	fs := vFechas()
	hoy := vHoy().Format(time.DateOnly)
	cuentas := map[string]int{}
	var mu sync.Mutex
	anotar := func(s string) { mu.Lock(); cuentas[s]++; mu.Unlock() }
	var dlSin, dlCon int64
	for fase := 0; fase < 2; fase++ {
		for i := 0; i < vRondas; i++ {
			correo := fmt.Sprintf("o%d-%d@ejemplo.test", fase, i)
			c := e.sembrar(t, correo, 3, 1234)
			inicio := make(chan struct{})
			var wg sync.WaitGroup
			wg.Add(3)
			go func() {
				defer wg.Done()
				<-inicio
				for _, f := range fs {
					code, b := e.pedir(c.tokB, "POST", "/api/v1/repeticiones/decisiones", vDecisiones(c.recs, []string{f}))
					anotar(fmt.Sprintf("f%d decisiones %d %s", fase, code, vCodigo(b)))
				}
			}()
			go func() {
				defer wg.Done()
				<-inicio
				for range 3 {
					req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/sesiones", strings.NewReader(`{"identificador":"`+correo+`","contrasena":"`+vClave+`"}`))
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set("X-Alcanzamos-Cliente", "interbloqueo")
					resp, err := vCliente(fmt.Sprintf("127.0.%d.%d", 10+fase, 10+i)).Do(req)
					if err != nil {
						anotar("login error " + err.Error())
						continue
					}
					b, _ := io.ReadAll(resp.Body)
					resp.Body.Close()
					anotar(fmt.Sprintf("f%d login %d %s", fase, resp.StatusCode, vCodigo(b)))
				}
			}()
			go func() {
				defer wg.Done()
				<-inicio
				for j := range 3 {
					rep := ""
					if j == 1 {
						rep = `,"repeticion":{"periodicidad":"semanal"}`
					}
					code, b := e.pedir(c.tokA, "POST", "/api/v1/movimientos", `{"tipo":"gasto","monto_centavos":1000,"fecha":"`+hoy+`","categoria_id":4,"medio":"efectivo"`+rep+`}`)
					anotar(fmt.Sprintf("f%d registro %d %s", fase, code, vCodigo(b)))
				}
			}()
			if fase == 1 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-inicio
					req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/cuenta/borrado", strings.NewReader(`{"contrasena":"`+vClave+`"}`))
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set("Authorization", "Bearer "+c.tokA)
					code, b := -1, []byte(nil)
					if resp, err := vCliente(fmt.Sprintf("127.0.20.%d", 10+i)).Do(req); err == nil {
						b, _ = io.ReadAll(resp.Body)
						resp.Body.Close()
						code = resp.StatusCode
					}
					anotar(fmt.Sprintf("f%d borrado %d %s", fase, code, vCodigo(b)))
				}()
			}
			close(inicio)
			wg.Wait()
			if fase == 1 {
				if s := e.estado(t, c); (s.persona == 0) != (s.movs+s.recs+s.omit+s.huerfanos+s.ses+s.cred == 0) {
					t.Errorf("ronda %d: estado a medias %+v", i, s)
				}
			}
		}
		if fase == 0 {
			dlSin = e.deadlocks(t)
		} else {
			dlCon = e.deadlocks(t) - dlSin
		}
		if dlSin != 0 || dlCon != 0 {
			t.Errorf("fase %d: interbloqueos sin borrado=%d, con borrado=%d", fase, dlSin, dlCon)
		}
	}
	t.Logf("deadlocks sin borrado=%d, con borrado=%d; ERROR=%d; códigos=%v", dlSin, dlCon, strings.Count(e.log.String(), `"level":"ERROR"`), cuentas)
	for k := range cuentas {
		if strings.Contains(k, " 500 ") {
			t.Errorf("500: %s", k)
		}
	}
}

func vCliente(ip string) *http.Client {
	d := &net.Dialer{LocalAddr: &net.TCPAddr{IP: net.ParseIP(ip)}}
	return &http.Client{Transport: &http.Transport{DialContext: d.DialContext}}
}

// C2: orden por id contra orden del montón. Tres repeticiones cuyos ids (bajo < medio < alto) se insertaron en el orden
// alto, bajo, medio. Quien decide (solo omisiones, que no tocan la persona) bloquea la baja y espera la media, que retiene
// otra conexión; el borrado, que antes borraba en el orden del montón, tomaba la alta y esperaba la baja: al soltar la
// media, la decisión pedía la alta y se cerraba el ciclo.
func TestInterbloqueoForzadoOrdenDeIdContraOrdenDelMonton(t *testing.T) {
	e := vArmar(t)
	ctx := context.Background()
	fs := vFechas()
	c := e.sembrar(t, "c2@ejemplo.test", 0, 1234)
	ids := []string{"00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"}
	for _, i := range []int{2, 0, 1} { // alto, bajo, medio
		if _, err := e.pool.Exec(ctx,
			`INSERT INTO movimiento_recurrente (id, persona_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio, creado_en)
			 VALUES ($1::uuid, $2::uuid, 'gasto', 4, 'semanal', 1234, 'efectivo', $3, now() - interval '22 days')`,
			ids[i], c.id, vHoy().AddDate(0, 0, -21)); err != nil {
			t.Fatal(err)
		}
	}
	c.recs = ids
	h := e.retener(t, `SELECT 1 FROM movimiento_recurrente WHERE id = $1::uuid FOR UPDATE`, ids[1])
	var omitidas []string
	for _, r := range ids {
		omitidas = append(omitidas, fmt.Sprintf(`{"recurrente_id":%q,"fecha":%q,"omitida":true}`, r, fs[0]))
	}
	dec := vAsync(func() (int, []byte) {
		return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/decisiones", `{"decisiones":[`+strings.Join(omitidas, ",")+`]}`)
	})
	e.esperarBloqueo(t, esperaRepeticiones)
	bor := vAsync(func() (int, []byte) { return e.borrar(c) })
	e.esperarBloqueo(t, esperaBorrarRepeticion, esperaPersonaExclusiva)
	if err := h.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	d, b := <-dec, <-bor
	s := e.estado(t, c)
	t.Logf("C2: decisiones %d %s; borrado %d %s; estado %+v", d.code, vCodigo(d.body), b.code, vCodigo(b.body), s)
	if d.code >= 500 || vCodigo(d.body) == "conflicto_concurrente" || b.code != 200 || s.persona+s.movs+s.recs+s.omit+s.huerfanos != 0 {
		t.Errorf("C2: resultado inválido")
	}
	e.sinInterbloqueos(t, "C2")
}
