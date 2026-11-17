//go:build integration

package app_test

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// ---------- ayudantes del verificador ----------

func rCode(s string) int { var c int; _, _ = fmt.Sscanf(s, "%d", &c); return c }

func (e *vEnt) rHogar(t *testing.T, admin string, otros ...string) string {
	t.Helper()
	ctx := context.Background()
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var h string
	if err := tx.QueryRow(ctx, `INSERT INTO hogar (nombre, creado_en, administrador_id) VALUES ('Casa', current_date, $1::uuid) RETURNING id::text`, admin).Scan(&h); err != nil {
		t.Fatal(err)
	}
	for j, p := range append([]string{admin}, otros...) {
		if _, err := tx.Exec(ctx, `INSERT INTO miembro_hogar (persona_id, hogar_id, desde) VALUES ($1::uuid, $2::uuid, now() + $3 * interval '1 minute')`, p, h, j); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return h
}

func (e *vEnt) rRec(t *testing.T, persona string, hogar *string) string {
	t.Helper()
	var r string
	if err := e.pool.QueryRow(context.Background(),
		`INSERT INTO movimiento_recurrente (persona_id, hogar_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio, creado_en)
		 VALUES ($1::uuid, $2::uuid, 'gasto', 4, 'semanal', 1234, 'efectivo', $3, now() - interval '22 days') RETURNING id::text`,
		persona, hogar, vHoy().AddDate(0, 0, -21)).Scan(&r); err != nil {
		t.Fatal(err)
	}
	return r
}

var rMenorN int

func (e *vEnt) rMenor(t *testing.T, tutores ...string) string {
	t.Helper()
	ctx := context.Background()
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var m string
	rMenorN++
	q := func(sql string, args ...any) {
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%v: %s", err, sql)
		}
	}
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa) VALUES ('Mateo', 'menor') RETURNING id::text`).Scan(&m); err != nil {
		t.Fatal(err)
	}
	q(`INSERT INTO perfil_menor (persona_id, nombre_de_usuario) VALUES ($1::uuid, $2)`, m, fmt.Sprintf("menor.%d.%d", rMenorN, time.Now().UnixNano()))
	q(`INSERT INTO nacimiento_menor (persona_id, valor_cifrado, version_clave) VALUES ($1::uuid, decode(repeat('ab', 38), 'hex'), 1)`, m)
	for _, tu := range tutores {
		q(`INSERT INTO tutoria (tutor_id, menor_id, declaro_escuchar_al_menor, declaro_representacion, autorizacion_expresa, version_declaracion, inicio) VALUES ($1::uuid, $2::uuid, true, true, true, '1.0', current_date)`, tu, m)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return m
}

// rHuerfanos: datos propios sin dueño, omitidas sin repetición y autorizaciones vigentes de personas que ya no están.
func (e *vEnt) rHuerfanos(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.obs.QueryRow(context.Background(), `SELECT
	   (SELECT count(*) FROM movimiento m WHERE m.hogar_id IS NULL AND NOT EXISTS (SELECT 1 FROM persona p WHERE p.id = m.persona_id))
	 + (SELECT count(*) FROM movimiento_recurrente r WHERE r.hogar_id IS NULL AND NOT EXISTS (SELECT 1 FROM persona p WHERE p.id = r.persona_id))
	 + (SELECT count(*) FROM ocurrencia_omitida o WHERE NOT EXISTS (SELECT 1 FROM movimiento_recurrente r WHERE r.id = o.recurrente_id))
	 + (SELECT count(*) FROM autorizacion a WHERE a.retirada_en IS NULL AND NOT EXISTS (SELECT 1 FROM persona p WHERE p.id = a.titular_id))
	 + (SELECT count(*) FROM hogar h WHERE NOT EXISTS (SELECT 1 FROM miembro_hogar mh WHERE mh.hogar_id = h.id AND mh.persona_id = h.administrador_id))`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *vEnt) rExiste(t *testing.T, persona string) bool {
	var n int
	if err := e.obs.QueryRow(context.Background(), `SELECT count(*) FROM persona WHERE id = $1::uuid`, persona).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

func rCuerpoBorrado(menores ...string) string {
	if len(menores) == 0 {
		return `{"contrasena":"` + vClave + `"}`
	}
	return `{"contrasena":"` + vClave + `","confirma_menores":true,"menores":["` + strings.Join(menores, `","`) + `"]}`
}

type rBorrado struct {
	tok, cuerpo string
	ok          func(code int, cod string) bool // nil: solo 200
	desfase     time.Duration
}

type rOtro struct {
	nombre  string
	f       func(n int) string // "código error"
	veces   int                // 0: hasta que terminen los borrados
	desfase time.Duration
}

type rCaso struct {
	borrados []rBorrado
	otros    []rOtro
	despues  func() []string
}

type rInforme struct {
	deadlocks int64
	codigos   map[string]int
	lat       []time.Duration
	fallos    []string
}

// rCorrer: rondas en una barrera; los borrados salen a la vez y los otros pedidos se repiten mientras haya un borrado
// en curso (o `veces`). Cuenta los interbloqueos de la base de la prueba.
func rCorrer(t *testing.T, e *vEnt, nombre string, rondas int, armar func(i int) rCaso) rInforme {
	t.Helper()
	inf := rInforme{codigos: map[string]int{}}
	dl0 := e.deadlocks(t)
	var mu sync.Mutex
	anotar := func(s string) { mu.Lock(); inf.codigos[s]++; mu.Unlock() }
	for i := 0; i < rondas; i++ {
		c := armar(i)
		inicio, fin := make(chan struct{}), make(chan struct{})
		var wb, wo sync.WaitGroup
		for bi, b := range c.borrados {
			wb.Add(1)
			go func() {
				defer wb.Done()
				<-inicio
				if b.desfase > 0 {
					time.Sleep(b.desfase) // desfase natural de la carrera
				}
				t0 := time.Now()
				code, body := e.pedir(b.tok, "POST", "/api/v1/cuenta/borrado", b.cuerpo)
				d := time.Since(t0)
				cod := vCodigo(body)
				mu.Lock()
				inf.lat = append(inf.lat, d)
				mu.Unlock()
				anotar(fmt.Sprintf("borrado %d %s", code, cod))
				permitido := code == 200
				if b.ok != nil {
					permitido = b.ok(code, cod)
				}
				if !permitido {
					mu.Lock()
					inf.fallos = append(inf.fallos, fmt.Sprintf("%s ronda %d borrado %d: %d %s", nombre, i, bi, code, body))
					mu.Unlock()
				}
			}()
		}
		for _, o := range c.otros {
			wo.Add(1)
			go func() {
				defer wo.Done()
				<-inicio
				if o.desfase > 0 {
					time.Sleep(o.desfase) // desfase natural de la carrera, no sincronización
				}
				limite := time.Now().Add(30 * time.Second)
				for n := 0; ; n++ {
					s := o.f(n)
					anotar(o.nombre + " " + s)
					if code := rCode(s); code >= 500 || code < 0 {
						mu.Lock()
						inf.fallos = append(inf.fallos, fmt.Sprintf("%s ronda %d %s: %s", nombre, i, o.nombre, s))
						mu.Unlock()
					}
					if o.veces > 0 && n+1 >= o.veces {
						return
					}
					if o.veces == 0 {
						select {
						case <-fin:
							return
						default:
						}
						if time.Now().After(limite) {
							return
						}
					}
				}
			}()
		}
		close(inicio)
		wb.Wait()
		close(fin)
		wo.Wait()
		if c.despues != nil {
			for _, f := range c.despues() {
				inf.fallos = append(inf.fallos, fmt.Sprintf("%s ronda %d: %s", nombre, i, f))
			}
		}
		if n := e.rHuerfanos(t); n != 0 {
			inf.fallos = append(inf.fallos, fmt.Sprintf("%s ronda %d: %d huérfanos", nombre, i, n))
		}
	}
	inf.deadlocks = e.deadlocks(t) - dl0
	errores := strings.Count(e.log.String(), `"level":"ERROR"`) - strings.Count(e.log.String(), `"no se pudo enviar el correo"`)
	sort.Slice(inf.lat, func(a, b int) bool { return inf.lat[a] < inf.lat[b] })
	var p50, p95, mx time.Duration
	if n := len(inf.lat); n > 0 {
		p50, p95, mx = inf.lat[n/2], inf.lat[n*95/100], inf.lat[n-1]
	}
	t.Logf("RESULTADO %s: rondas=%d deadlocks=%d ERROR=%d borrado p50=%v p95=%v max=%v códigos=%v", nombre, rondas, inf.deadlocks, errores, p50, p95, mx, inf.codigos)
	if inf.deadlocks != 0 {
		t.Errorf("%s: %d interbloqueos", nombre, inf.deadlocks)
	}
	if errores > 0 {
		t.Errorf("%s: %d líneas ERROR: %s", nombre, errores, vSoloErrores(e.log.String()))
	}
	for k := range inf.codigos {
		if strings.Contains(k, "conflicto_concurrente") || strings.Contains(k, " 503 ") || strings.Contains(k, " 500 ") {
			t.Errorf("%s: respuesta inesperada %q x%d", nombre, k, inf.codigos[k])
		}
	}
	for _, f := range inf.fallos {
		t.Error(f)
	}
	return inf
}

// Pocas rondas por CI: los casos forzados (TestReverForzado*, TestInterbloqueoForzado*) llevan la garantía.
const rRondas = 6

func rDec(e *vEnt, tok string, recs, fs []string) func(int) string {
	return func(n int) string {
		// el orden de las repeticiones cambia en cada pedido
		r := append([]string(nil), recs...)
		if n%2 == 1 {
			sort.Sort(sort.Reverse(sort.StringSlice(r)))
		}
		f := fs
		if n%3 == 1 {
			f = fs[n%len(fs) : n%len(fs)+1]
		}
		return vRes(e.pedir(tok, "POST", "/api/v1/repeticiones/decisiones", vDecisiones(r, f)))
	}
}

func rSoloOmitir(e *vEnt, tok string, recs, fs []string) func(int) string {
	return func(n int) string {
		var d []string
		r := append([]string(nil), recs...)
		if n%2 == 1 {
			sort.Sort(sort.Reverse(sort.StringSlice(r)))
		}
		for _, x := range r {
			d = append(d, fmt.Sprintf(`{"recurrente_id":%q,"fecha":%q,"omitida":true}`, x, fs[n%len(fs)]))
		}
		return vRes(e.pedir(tok, "POST", "/api/v1/repeticiones/decisiones", `{"decisiones":[`+strings.Join(d, ",")+`]}`))
	}
}

func rDesfase(i int) time.Duration { return time.Duration(i%6) * 15 * time.Millisecond }

func (e *vEnt) rEstadoCero(t *testing.T, c vCuenta) []string {
	s := e.estado(t, c)
	if s.persona+s.cred+s.ses+s.movs+s.recs+s.omit+s.huerfanos != 0 {
		return []string{fmt.Sprintf("quedan datos %+v", s)}
	}
	return nil
}

// ---------- 1. Los ciclos C1, C2, C3: carreras naturales ----------

func TestReverCarreraUS60(t *testing.T) {
	fs := vFechas()
	casos := []struct {
		nombre string
		k      int
		otros  func(e *vEnt, c vCuenta) []rOtro
	}{
		{"decisiones", 3, func(e *vEnt, c vCuenta) []rOtro { return []rOtro{{nombre: "dec", f: rDec(e, c.tokB, c.recs, fs)}} }},
		{"solo omisiones", 3, func(e *vEnt, c vCuenta) []rOtro {
			return []rOtro{{nombre: "omi", f: rSoloOmitir(e, c.tokB, c.recs, fs)}}
		}},
		{"confirmacion", 2, func(e *vEnt, c vCuenta) []rOtro {
			return []rOtro{{nombre: "conf", f: func(n int) string {
				return vRes(e.pedir(c.tokB, "POST", "/api/v1/repeticiones/"+c.recs[n%2]+"/confirmacion", fmt.Sprintf(`{"fecha":%q,"monto_centavos":555}`, fs[(n/2)%4])))
			}}}
		}},
		{"omision", 2, func(e *vEnt, c vCuenta) []rOtro {
			return []rOtro{{nombre: "omision", f: func(n int) string {
				return vRes(e.pedir(c.tokB, "POST", "/api/v1/repeticiones/"+c.recs[n%2]+"/omision", fmt.Sprintf(`{"fecha":%q}`, fs[(n/2)%4])))
			}}}
		}},
		{"pendientes", 2, func(e *vEnt, c vCuenta) []rOtro {
			return []rOtro{{nombre: "pend", f: func(int) string { return vRes(e.pedir(c.tokB, "GET", "/api/v1/repeticiones/pendientes", "")) }}}
		}},
		{"tres dispositivos", 4, func(e *vEnt, c vCuenta) []rOtro {
			var o []rOtro
			for w := 0; w < 3; w++ {
				recs := []string{c.recs[w], c.recs[(w+1)%4], c.recs[(w+3)%4]}
				o = append(o, rOtro{nombre: fmt.Sprintf("dev%d", w), f: rDec(e, c.tokB, recs, fs)})
			}
			return o
		}},
		{"descarga", 3, func(e *vEnt, c vCuenta) []rOtro {
			return []rOtro{
				{nombre: "datos", f: func(int) string { return vRes(e.pedir(c.tokB, "GET", "/api/v1/cuenta/datos", "")) }},
				{nombre: "dec", f: rDec(e, c.tokB, c.recs, fs)},
			}
		}},
	}
	for _, cs := range casos {
		t.Run(cs.nombre, func(t *testing.T) {
			e := vArmar(t)
			rCorrer(t, e, cs.nombre, rRondas, func(i int) rCaso {
				c := e.sembrar(t, fmt.Sprintf("u%d-%s@ejemplo.test", i, strings.ReplaceAll(cs.nombre, " ", "")), cs.k, 1234)
				otros := cs.otros(e, c)
				for j := range otros {
					otros[j].desfase = rDesfase(i + j)
				}
				return rCaso{
					borrados: []rBorrado{{tok: c.tokA, cuerpo: rCuerpoBorrado()}},
					otros:    otros,
					despues:  func() []string { return e.rEstadoCero(t, c) },
				}
			})
		})
	}
}

// C3 en carrera: hogar con A (administra) y B; repeticiones compartidas de las dos; A borra mientras B y el otro
// dispositivo de A deciden sobre las suyas.
func TestReverCarreraHogarCompartido(t *testing.T) {
	fs := vFechas()
	e := vArmar(t)
	rCorrer(t, e, "hogar compartido", rRondas, func(i int) rCaso {
		a := e.sembrar(t, fmt.Sprintf("ha%d@ejemplo.test", i), 1, 1234)
		b := e.sembrar(t, fmt.Sprintf("hb%d@ejemplo.test", i), 0, 1234)
		h := e.rHogar(t, a.id, b.id)
		var aRecs, bRecs []string
		for j := 0; j < 2; j++ {
			aRecs = append(aRecs, e.rRec(t, a.id, &h))
			bRecs = append(bRecs, e.rRec(t, b.id, &h))
		}
		aTodas := append(append([]string(nil), a.recs...), aRecs...)
		return rCaso{
			borrados: []rBorrado{{tok: a.tokA, cuerpo: rCuerpoBorrado()}},
			otros: []rOtro{
				{nombre: "B dec", f: rDec(e, b.tokB, bRecs, fs), desfase: rDesfase(i)},
				{nombre: "B conf", f: func(n int) string {
					return vRes(e.pedir(b.tokA, "POST", "/api/v1/repeticiones/"+bRecs[n%2]+"/confirmacion", fmt.Sprintf(`{"fecha":%q}`, fs[(n/2)%4])))
				}, desfase: rDesfase(i + 2)},
				{nombre: "A dec", f: rDec(e, a.tokB, aTodas, fs), desfase: rDesfase(i + 1)},
			},
			despues: func() []string {
				var out []string
				if e.rExiste(t, a.id) {
					out = append(out, "A sigue")
				}
				var sinNombre, deB, admin int
				_ = e.obs.QueryRow(context.Background(), `SELECT
				   (SELECT count(*) FROM movimiento_recurrente WHERE id = ANY($1::uuid[]) AND persona_id IS NULL AND hogar_id = $3::uuid),
				   (SELECT count(*) FROM movimiento_recurrente WHERE id = ANY($2::uuid[]) AND persona_id = $4::uuid),
				   (SELECT count(*) FROM hogar WHERE id = $3::uuid AND administrador_id = $4::uuid)`, aRecs, bRecs, h, b.id).Scan(&sinNombre, &deB, &admin)
				if sinNombre != 2 || deB != 2 || admin != 1 {
					out = append(out, fmt.Sprintf("hogar: compartidas de A sin nombre=%d, de B=%d, B administra=%d", sinNombre, deB, admin))
				}
				return out
			},
		}
	})
}

// ---------- 2. ¿Ciclo nuevo? ----------

func TestReverCarreraCuenta(t *testing.T) {
	fs := vFechas()
	hoy := vHoy().Format(time.DateOnly)
	ip := 0
	cliente := func() *http.Client { ip++; return vCliente(fmt.Sprintf("127.0.%d.%d", 30+ip/200, 1+ip%200)) }
	publico := func(cl *http.Client, ruta, cuerpo string, cab ...string) string {
		req, _ := http.NewRequest("POST", e0url+ruta, strings.NewReader(cuerpo))
		req.Header.Set("Content-Type", "application/json")
		for k := 0; k+1 < len(cab); k += 2 {
			req.Header.Set(cab[k], cab[k+1])
		}
		resp, err := cl.Do(req)
		if err != nil {
			return "-1 " + err.Error()
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return vRes(resp.StatusCode, b)
	}
	sesionPerdida := func(code int, cod string) bool {
		return code == 200 || (code == 401 && cod == "sin_sesion") || (code == 400 && cod == "contrasena_incorrecta")
	}
	casos := []struct {
		nombre string
		otros  func(e *vEnt, c vCuenta, correo string, i int) []rOtro
		ok     func(int, string) bool
	}{
		{"login", func(e *vEnt, c vCuenta, correo string, i int) []rOtro {
			cl := cliente()
			return []rOtro{
				{nombre: "login", f: func(int) string {
					return publico(cl, "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+vClave+`"}`, "X-Alcanzamos-Cliente", "android")
				}},
				{nombre: "dec", f: rDec(e, c.tokB, c.recs, fs), desfase: rDesfase(i)},
			}
			// Los inicios de sesión en bucle pueden pasar el tope de sesiones por cuenta y expulsar la sesión con la que
			// se pide el borrado: entonces el borrado responde 401 sin_sesion, que es lo correcto, y `despues` comprueba
			// que la cuenta quedó entera. Con 2 CPU (el agente del pipeline) pasa a menudo.
		}, func(code int, cod string) bool { return code == 200 || (code == 401 && cod == "sin_sesion") }},
		{"cambio de contraseña", func(e *vEnt, c vCuenta, correo string, i int) []rOtro {
			return []rOtro{
				{nombre: "contrasena", veces: 1, f: func(int) string {
					return vRes(e.pedir(c.tokB, "POST", "/api/v1/cuenta/contrasena", `{"contrasena_actual":"`+vClave+`","contrasena_nueva":"otra clave larga de prueba 77"}`))
				}},
				{nombre: "dec", f: rDec(e, c.tokB, c.recs, fs)},
			}
		}, sesionPerdida},
		{"pedir enlace", func(e *vEnt, c vCuenta, correo string, i int) []rOtro {
			cl := cliente()
			return []rOtro{
				{nombre: "recuperacion", f: func(int) string { return publico(cl, "/api/v1/recuperacion", `{"correo":"`+correo+`"}`) }},
				{nombre: "dec", f: rDec(e, c.tokB, c.recs, fs), desfase: rDesfase(i)},
			}
		}, nil},
		{"fijar contraseña con enlace", func(e *vEnt, c vCuenta, correo string, i int) []rOtro {
			tok, huella := seguridad.NuevoTokenOpaco()
			if _, err := e.pool.Exec(context.Background(), `INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, vence_en) VALUES ($1, $2::uuid, 'recuperacion', now() + interval '1 hour')`, huella, c.id); err != nil {
				t.Fatal(err)
			}
			cl := cliente()
			return []rOtro{
				{nombre: "fijar", veces: 1, f: func(int) string {
					return publico(cl, "/api/v1/recuperacion/contrasena", `{"token":"`+tok+`","contrasena":"otra clave larga de prueba 77"}`)
				}},
				{nombre: "dec", f: rDec(e, c.tokB, c.recs, fs)},
			}
		}, sesionPerdida},
		{"registro", func(e *vEnt, c vCuenta, correo string, i int) []rOtro {
			return []rOtro{
				{nombre: "registro", f: func(n int) string {
					rep := ""
					if n%2 == 1 {
						rep = `,"repeticion":{"periodicidad":"semanal"}`
					}
					return vRes(e.pedir(c.tokB, "POST", "/api/v1/movimientos", `{"tipo":"gasto","monto_centavos":1000,"fecha":"`+hoy+`","categoria_id":4,"medio":"efectivo"`+rep+`}`))
				}},
				{nombre: "dec", f: rDec(e, c.tokB, c.recs, fs), desfase: rDesfase(i)},
			}
		}, nil},
	}
	for _, cs := range casos {
		t.Run(cs.nombre, func(t *testing.T) {
			e := vArmar(t)
			e0url = e.srv.URL
			rCorrer(t, e, cs.nombre, rRondas, func(i int) rCaso {
				correo := fmt.Sprintf("k%d-%d@ejemplo.test", i, len(cs.nombre))
				c := e.sembrar(t, correo, 3, 1234)
				return rCaso{
					borrados: []rBorrado{{tok: c.tokA, cuerpo: rCuerpoBorrado(), ok: cs.ok, desfase: time.Duration(i%10) * 25 * time.Millisecond}},
					otros:    cs.otros(e, c, correo, i),
					despues: func() []string {
						if e.rExiste(t, c.id) {
							return nil // la sesión se perdió por el cambio de contraseña: la cuenta sigue entera
						}
						return e.rEstadoCero(t, c)
					},
				}
			})
		})
	}
}

var e0url string

// R2: dos personas del mismo hogar borran a la vez; una tercera decide sobre sus compartidas, y los otros dispositivos
// de las dos deciden sobre las suyas.
func TestReverR2MismoHogar(t *testing.T) {
	fs := vFechas()
	e := vArmar(t)
	rCorrer(t, e, "R2", rRondas, func(i int) rCaso {
		a := e.sembrar(t, fmt.Sprintf("r2a%d@ejemplo.test", i), 1, 1234)
		b := e.sembrar(t, fmt.Sprintf("r2b%d@ejemplo.test", i), 1, 1234)
		c := e.sembrar(t, fmt.Sprintf("r2c%d@ejemplo.test", i), 0, 1234)
		h := e.rHogar(t, a.id, b.id, c.id)
		aR := append(append([]string(nil), a.recs...), e.rRec(t, a.id, &h))
		bR := append(append([]string(nil), b.recs...), e.rRec(t, b.id, &h))
		cR := []string{e.rRec(t, c.id, &h), e.rRec(t, c.id, &h)}
		return rCaso{
			borrados: []rBorrado{{tok: a.tokA, cuerpo: rCuerpoBorrado()}, {tok: b.tokA, cuerpo: rCuerpoBorrado()}},
			otros: []rOtro{
				{nombre: "A dec", f: rDec(e, a.tokB, aR, fs)},
				{nombre: "B dec", f: rDec(e, b.tokB, bR, fs), desfase: rDesfase(i)},
				{nombre: "C dec", f: rDec(e, c.tokB, cR, fs), desfase: rDesfase(i + 3)},
			},
			despues: func() []string {
				var out []string
				if e.rExiste(t, a.id) || e.rExiste(t, b.id) || !e.rExiste(t, c.id) {
					out = append(out, "personas mal")
				}
				var admin, deC int
				_ = e.obs.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM hogar WHERE id = $1::uuid AND administrador_id = $2::uuid),
				  (SELECT count(*) FROM movimiento_recurrente WHERE id = ANY($3::uuid[]) AND persona_id = $2::uuid AND hogar_id = $1::uuid)`, h, c.id, cR).Scan(&admin, &deC)
				if admin != 1 || deC != 2 {
					out = append(out, fmt.Sprintf("C administra=%d, compartidas de C=%d", admin, deC))
				}
				return out
			},
		}
	})
}

// R1: dos tutores del mismo menor borran a la vez (cada uno con su hogar y el menor en el hogar del primero).
func TestReverR1MismoMenor(t *testing.T) {
	fs := vFechas()
	e := vArmar(t)
	var mu sync.Mutex
	rCorrer(t, e, "R1", rRondas, func(i int) rCaso {
		t1 := e.sembrar(t, fmt.Sprintf("r1a%d@ejemplo.test", i), 2, 1234)
		t2 := e.sembrar(t, fmt.Sprintf("r1b%d@ejemplo.test", i), 2, 1234)
		m := e.rMenor(t, t1.id, t2.id)
		mR := []string{e.rRec(t, m, nil), e.rRec(t, m, nil)}
		otra := e.sembrar(t, fmt.Sprintf("r1o%d@ejemplo.test", i), 0, 1234)
		h1 := e.rHogar(t, t1.id, otra.id, m)
		oR := []string{e.rRec(t, otra.id, &h1)}
		t1R := append(append([]string(nil), t1.recs...), e.rRec(t, t1.id, &h1))
		exitos, cambiaron := 0, 0
		ok := func(code int, cod string) bool {
			mu.Lock()
			defer mu.Unlock()
			switch {
			case code == 200:
				exitos++
				return true
			case code == 409 && cod == "menores_cambiaron":
				cambiaron++
				return true
			}
			return false
		}
		return rCaso{
			borrados: []rBorrado{{tok: t1.tokA, cuerpo: rCuerpoBorrado(), ok: ok}, {tok: t2.tokA, cuerpo: rCuerpoBorrado(), ok: ok}},
			otros: []rOtro{
				{nombre: "T1 dec", f: rDec(e, t1.tokB, t1R, fs)},
				{nombre: "T2 dec", f: rDec(e, t2.tokB, t2.recs, fs), desfase: rDesfase(i)},
				{nombre: "otra dec", f: rDec(e, otra.tokB, oR, fs), desfase: rDesfase(i + 2)},
			},
			despues: func() []string {
				var out []string
				if exitos+cambiaron != 2 || exitos == 0 {
					out = append(out, fmt.Sprintf("éxitos=%d cambiaron=%d", exitos, cambiaron))
				}
				var recsM int
				_ = e.obs.QueryRow(context.Background(), `SELECT count(*) FROM movimiento_recurrente WHERE id = ANY($1::uuid[])`, mR).Scan(&recsM)
				if e.rExiste(t, m) != (recsM == 2) {
					out = append(out, fmt.Sprintf("menor existe=%v con %d repeticiones", e.rExiste(t, m), recsM))
				}
				return out
			},
		}
	})
}

// Tutor único con hogar: borra con su menor mientras la otra persona adulta del hogar y el otro dispositivo deciden.
func TestReverTutorUnicoConHogar(t *testing.T) {
	fs := vFechas()
	e := vArmar(t)
	rCorrer(t, e, "tutor único", rRondas, func(i int) rCaso {
		tu := e.sembrar(t, fmt.Sprintf("tu%d@ejemplo.test", i), 2, 1234)
		m := e.rMenor(t, tu.id)
		mR := []string{e.rRec(t, m, nil), e.rRec(t, m, nil)}
		otra := e.sembrar(t, fmt.Sprintf("tuo%d@ejemplo.test", i), 0, 1234)
		h := e.rHogar(t, tu.id, otra.id, m)
		oR := []string{e.rRec(t, otra.id, &h), e.rRec(t, otra.id, &h)}
		tuR := append(append([]string(nil), tu.recs...), e.rRec(t, tu.id, &h))
		return rCaso{
			borrados: []rBorrado{{tok: tu.tokA, cuerpo: rCuerpoBorrado(m)}},
			otros: []rOtro{
				{nombre: "T dec", f: rDec(e, tu.tokB, tuR, fs)},
				{nombre: "otra dec", f: rDec(e, otra.tokB, oR, fs), desfase: rDesfase(i)},
			},
			despues: func() []string {
				var recsM int
				_ = e.obs.QueryRow(context.Background(), `SELECT count(*) FROM movimiento_recurrente WHERE id = ANY($1::uuid[])`, mR).Scan(&recsM)
				if e.rExiste(t, m) || recsM != 0 || e.rExiste(t, tu.id) {
					return []string{fmt.Sprintf("menor existe=%v recs=%d", e.rExiste(t, m), recsM)}
				}
				return nil
			},
		}
	})
}

// ---------- 3. ¿FOR KEY SHARE deja al borrado esperando para siempre? ----------

func TestReverHambreDelBorrado(t *testing.T) {
	fs := vFechas()
	for _, n := range []int{3, 6} {
		t.Run(fmt.Sprintf("%d dispositivos", n), func(t *testing.T) {
			e := vArmar(t)
			rCorrer(t, e, fmt.Sprintf("hambre %d", n), rRondas, func(i int) rCaso {
				c := e.sembrar(t, fmt.Sprintf("hb%d-%d@ejemplo.test", n, i), 4, 1234)
				var o []rOtro
				for w := 0; w < n; w++ {
					f := rDec(e, c.tokB, c.recs, fs)
					if w%2 == 1 {
						f = rSoloOmitir(e, c.tokB, c.recs, fs)
					}
					o = append(o, rOtro{nombre: "dev", f: f})
				}
				return rCaso{borrados: []rBorrado{{tok: c.tokA, cuerpo: rCuerpoBorrado()}}, otros: o,
					despues: func() []string { return e.rEstadoCero(t, c) }}
			})
		})
	}
}

// ---------- 4. 403 → 401 ----------

// Carrera natural sin deslizar la sesión: GET seguidos con la sesión B mientras A borra.
func TestReverSesionDuranteElCommit(t *testing.T) {
	e := vArmar(t)
	inf := rCorrer(t, e, "sesión durante el commit", 15, func(i int) rCaso {
		c := e.sembrar(t, fmt.Sprintf("s%d@ejemplo.test", i), 1, 1234)
		var o []rOtro
		for w := 0; w < 4; w++ {
			ruta := []string{"/api/v1/repeticiones/pendientes", "/api/v1/movimientos", "/api/v1/cuenta/seguridad", "/api/v1/categorias"}[w]
			o = append(o, rOtro{nombre: ruta, f: func(int) string { return vRes(e.pedir(c.tokB, "GET", ruta, "")) }})
		}
		return rCaso{borrados: []rBorrado{{tok: c.tokA, cuerpo: rCuerpoBorrado()}}, otros: o}
	})
	for k, v := range inf.codigos {
		if strings.Contains(k, " 403 ") {
			t.Errorf("403 con la sesión de una cuenta que se borraba: %q x%d", k, v)
		}
	}
}

// Sin enmascarar: una cuenta real sin autorizar, o con la autorización retirada, o con el correo sin verificar.
func TestReverCuentaRealSinAutorizar(t *testing.T) {
	e := vArmar(t)
	ctx := context.Background()
	tokSin, _ := persona(t, e.pool, "sin@ejemplo.test", true, false)
	tokRet, idRet := persona(t, e.pool, "ret@ejemplo.test", true, true)
	if _, err := e.pool.Exec(ctx, `UPDATE autorizacion SET retirada_en = now() WHERE titular_id = $1::uuid AND finalidad = 'funciones_financieras'`, idRet); err != nil {
		t.Fatal(err)
	}
	tokNoVer, _ := persona(t, e.pool, "nover@ejemplo.test", false, false)
	tokVieja, idVieja := persona(t, e.pool, "vieja@ejemplo.test", true, false)
	huella, _ := seguridad.HuellaDeToken(tokVieja)
	if _, err := e.pool.Exec(ctx, `UPDATE sesion SET creada_en = now() - interval '10 minutes', ultimo_uso_en = now() - interval '10 minutes' WHERE hash_token = $1`, huella); err != nil {
		t.Fatal(err)
	}
	_ = idVieja
	for _, ruta := range []string{"/api/v1/repeticiones/pendientes", "/api/v1/cuenta/datos", "/api/v1/movimientos"} {
		for _, c := range []struct{ nombre, tok, quiere string }{
			{"sin autorizar", tokSin, "403 autorizacion_pendiente"},
			{"retirada", tokRet, "403 autorizacion_pendiente"},
			{"sin verificar", tokNoVer, "403 verificacion_pendiente"},
			{"sesión deslizada sin autorizar", tokVieja, "403 autorizacion_pendiente"},
			{"token desconocido", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "401 sin_sesion"},
		} {
			quiere := c.quiere
			if ruta == "/api/v1/cuenta/datos" && strings.HasPrefix(quiere, "403 autorizacion_pendiente") {
				// SC-E21-25, criterio 3: «Descargar mis datos» es `sin_autorizacion`, para la hoja de «No autorizo».
				quiere = "200 zip"
			}
			if got := vRes(e.pedir(c.tok, "GET", ruta, "")); got != quiere {
				t.Errorf("%s %s: %s, se esperaba %s", c.nombre, ruta, got, quiere)
			}
		}
	}
	// tiempos (orientativo): 403 real frente a 401 y 200
	tokOK, _ := persona(t, e.pool, "ok@ejemplo.test", true, true)
	medir := func(tok string) time.Duration {
		var tot time.Duration
		for range 200 {
			t0 := time.Now()
			e.pedir(tok, "GET", "/api/v1/categorias", "")
			tot += time.Since(t0)
		}
		return tot / 200
	}
	t.Logf("RESULTADO tiempos medios: 403 sin autorizar=%v 401 desconocido=%v 200 autorizada=%v 403 sin verificar=%v", medir(tokSin), medir("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), medir(tokOK), medir(tokNoVer))
	if strings.Contains(e.log.String(), `"level":"ERROR"`) {
		t.Errorf("ERROR: %s", vSoloErrores(e.log.String()))
	}
}

// ---------- Interleavings forzados ----------

func rRegistro(t *testing.T, e *vEnt, nombre string, pares ...string) {
	t.Helper()
	t.Logf("RESULTADO %s: %s", nombre, strings.Join(pares, "; "))
}

// FA: el borrado tiene la persona y espera una repetición (retenida, paso 4b); Decidir del otro dispositivo espera la
// persona (FOR KEY SHARE), no las repeticiones. Al soltar: borrado 200, Decidir 401.
func TestReverForzadoBorradoEnRepeticiones(t *testing.T) {
	e := vArmar(t)
	fs := vFechas()
	for i, ruta := range []string{"decisiones", "omitir", "confirmacion", "omision"} {
		c := e.sembrar(t, fmt.Sprintf("fa%d@ejemplo.test", i), 2, 1234)
		h := e.retener(t, `SELECT 1 FROM movimiento_recurrente WHERE id = $1::uuid FOR UPDATE`, c.recs[1])
		bor := vAsync(func() (int, []byte) { return e.borrar(c) })
		e.esperarBloqueo(t, "SELECT 1 FROM movimiento_recurrente%WHERE persona_id = $1::uuid%")
		var dec chan vResultado
		switch ruta {
		case "decisiones":
			dec = vAsync(func() (int, []byte) {
				return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/decisiones", vDecisiones(c.recs, fs[:2]))
			})
		case "omitir":
			dec = vAsync(func() (int, []byte) {
				return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/decisiones", `{"decisiones":[{"recurrente_id":"`+c.recs[0]+`","fecha":"`+fs[0]+`","omitida":true}]}`)
			})
		case "confirmacion":
			dec = vAsync(func() (int, []byte) {
				return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/"+c.recs[0]+"/confirmacion", `{"fecha":"`+fs[0]+`"}`)
			})
		case "omision":
			dec = vAsync(func() (int, []byte) {
				return e.pedir(c.tokB, "POST", "/api/v1/repeticiones/"+c.recs[0]+"/omision", `{"fecha":"`+fs[0]+`"}`)
			})
		}
		e.esperarBloqueo(t, esperaPersonaCompartida)
		// nadie espera repeticiones fuera del borrado
		var otros int
		_ = e.obs.QueryRow(context.Background(), `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT id::text FROM movimiento_recurrente%'`).Scan(&otros)
		if err := h.Commit(context.Background()); err != nil {
			t.Fatal(err)
		}
		d, b := <-dec, <-bor
		rRegistro(t, e, "FA "+ruta, vRes(d.code, d.body), "borrado "+vRes(b.code, b.body), fmt.Sprintf("esperando repeticiones=%d", otros))
		if d.code != 401 || vCodigo(d.body) != "sin_sesion" || b.code != 200 || otros != 0 {
			t.Errorf("FA %s: decidir %d %s, borrado %d %s, otros=%d", ruta, d.code, d.body, b.code, b.body, otros)
		}
		if f := e.rEstadoCero(t, c); f != nil {
			t.Error(f)
		}
	}
	e.sinInterbloqueos(t, "FA")
}

// FB (C3): B decide sobre su compartida y queda detenida en el INSERT (categoría retenida) con la repetición bloqueada;
// A borra: espera la repetición de B en el paso 4b. El otro dispositivo de A decide sobre la compartida de A. Al soltar,
// todos terminan sin interbloqueo.
func TestReverForzadoCompartidaDeOtraPersona(t *testing.T) {
	e := vArmar(t)
	fs := vFechas()
	ctx := context.Background()
	for i := 0; i < 4; i++ {
		a := e.sembrar(t, fmt.Sprintf("fba%d@ejemplo.test", i), 1, 1234)
		b := e.sembrar(t, fmt.Sprintf("fbb%d@ejemplo.test", i), 0, 1234)
		h := e.rHogar(t, a.id, b.id)
		rA, rB := e.rRec(t, a.id, &h), e.rRec(t, b.id, &h)
		cat := e.retener(t, `SELECT 1 FROM categoria WHERE id = 4 FOR UPDATE`)
		decB := vAsync(func() (int, []byte) {
			return e.pedir(b.tokB, "POST", "/api/v1/repeticiones/decisiones", `{"decisiones":[{"recurrente_id":"`+rB+`","fecha":"`+fs[i]+`","omitida":false}]}`)
		})
		e.esperarBloqueo(t, esperaInsertarMov)
		bor := vAsync(func() (int, []byte) { return e.borrar(a) })
		e.esperarBloqueo(t, "SELECT 1 FROM movimiento_recurrente%")
		decA := vAsync(func() (int, []byte) {
			return e.pedir(a.tokB, "POST", "/api/v1/repeticiones/decisiones", vDecisiones([]string{rA, a.recs[0]}, fs[:1]))
		})
		e.esperarBloqueo(t, esperaPersonaCompartida)
		if err := cat.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		db, ba, da := <-decB, <-bor, <-decA
		var pRA *string
		var movsB int
		_ = e.obs.QueryRow(ctx, `SELECT persona_id::text, (SELECT count(*) FROM movimiento WHERE recurrente_id = $2::uuid) FROM movimiento_recurrente WHERE id = $1::uuid`, rA, rB).Scan(&pRA, &movsB)
		rRegistro(t, e, fmt.Sprintf("FB %d (rA<rB=%v)", i, rA < rB), "B "+vRes(db.code, db.body), "borrado A "+vRes(ba.code, ba.body), "A "+vRes(da.code, da.body), fmt.Sprintf("rA.persona=%v movs de rB=%d", pRA, movsB))
		if db.code != 200 || ba.code != 200 || da.code != 401 || pRA != nil || movsB != 1 {
			t.Errorf("FB %d: resultado inválido", i)
		}
	}
	e.sinInterbloqueos(t, "FB")
}

// FC: el borrado de A ya tomó las repeticiones del hogar y espera en DELETE meta (retenida); B decide sobre su compartida
// y espera al borrado. R2 forzado: B también pide borrar (espera el hogar). Al soltar: los tres 200 y sin interbloqueos.
func TestReverForzadoBorradoPrimeroYR2(t *testing.T) {
	e := vArmar(t)
	fs := vFechas()
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		a := e.sembrar(t, fmt.Sprintf("fca%d@ejemplo.test", i), 1, 1234)
		b := e.sembrar(t, fmt.Sprintf("fcb%d@ejemplo.test", i), 0, 1234)
		h := e.rHogar(t, a.id, b.id)
		e.rRec(t, a.id, &h)
		rB := e.rRec(t, b.id, &h)
		var meta string
		if err := e.pool.QueryRow(ctx, `INSERT INTO meta (persona_id, nombre, monto_objetivo) VALUES ($1::uuid, 'viaje', 1000) RETURNING id::text`, a.id).Scan(&meta); err != nil {
			t.Fatal(err)
		}
		hm := e.retener(t, `SELECT 1 FROM meta WHERE id = $1::uuid FOR UPDATE`, meta)
		bor := vAsync(func() (int, []byte) { return e.borrar(a) })
		e.esperarBloqueo(t, "DELETE FROM meta%")
		decB := vAsync(func() (int, []byte) {
			return e.pedir(b.tokB, "POST", "/api/v1/repeticiones/decisiones", `{"decisiones":[{"recurrente_id":"`+rB+`","fecha":"`+fs[0]+`","omitida":true},{"recurrente_id":"`+rB+`","fecha":"`+fs[1]+`","omitida":false}]}`)
		})
		e.esperarBloqueo(t, esperaRepeticiones)
		var borB chan vResultado
		if i > 0 {
			borB = vAsync(func() (int, []byte) { return e.borrar(b) })
			e.esperarBloqueo(t, "SELECT 1 FROM hogar WHERE id%")
		}
		if err := hm.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		ba, db := <-bor, <-decB
		res := []string{"borrado A " + vRes(ba.code, ba.body), "B decide " + vRes(db.code, db.body)}
		ok := ba.code == 200 && (db.code == 200 || (i > 0 && db.code == 401))
		if borB != nil {
			bb := <-borB
			res = append(res, "borrado B "+vRes(bb.code, bb.body))
			ok = ok && bb.code == 200 && !e.rExiste(t, b.id)
		}
		rRegistro(t, e, fmt.Sprintf("FC %d", i), res...)
		if !ok {
			t.Errorf("FC %d: resultado inválido %v", i, res)
		}
		if n := e.rHuerfanos(t); n != 0 {
			t.Errorf("FC %d: %d huérfanos", i, n)
		}
	}
	e.sinInterbloqueos(t, "FC")
}

// FD (R1 forzado): T1 se detiene en DELETE meta con el menor bloqueado; T2 pide borrar y espera la persona del menor.
// Al soltar: T1 200, T2 409 menores_cambiaron; T2 repite con el menor y borra (200).
func TestReverForzadoR1(t *testing.T) {
	e := vArmar(t)
	ctx := context.Background()
	t1 := e.sembrar(t, "fd1@ejemplo.test", 1, 1234)
	t2 := e.sembrar(t, "fd2@ejemplo.test", 1, 1234)
	m := e.rMenor(t, t1.id, t2.id)
	e.rRec(t, m, nil)
	var meta string
	if err := e.pool.QueryRow(ctx, `INSERT INTO meta (persona_id, nombre, monto_objetivo) VALUES ($1::uuid, 'viaje', 1000) RETURNING id::text`, t1.id).Scan(&meta); err != nil {
		t.Fatal(err)
	}
	hm := e.retener(t, `SELECT 1 FROM meta WHERE id = $1::uuid FOR UPDATE`, meta)
	b1 := vAsync(func() (int, []byte) { return e.borrar(t1) })
	e.esperarBloqueo(t, "DELETE FROM meta%")
	b2 := vAsync(func() (int, []byte) { return e.pedir(t2.tokA, "POST", "/api/v1/cuenta/borrado", rCuerpoBorrado()) })
	e.esperarBloqueo(t, "SELECT 1 FROM persona WHERE id IN%")
	if err := hm.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	r1, r2 := <-b1, <-b2
	code3, body3 := e.pedir(t2.tokA, "POST", "/api/v1/cuenta/borrado", rCuerpoBorrado(m))
	rRegistro(t, e, "FD", "T1 "+vRes(r1.code, r1.body), "T2 "+vRes(r2.code, r2.body), "T2 otra vez "+vRes(code3, body3))
	if r1.code != 200 || r2.code != 409 || vCodigo(r2.body) != "menores_cambiaron" || code3 != 200 || e.rExiste(t, m) {
		t.Errorf("FD: resultado inválido")
	}
	if n := e.rHuerfanos(t); n != 0 {
		t.Errorf("FD: %d huérfanos", n)
	}
	e.sinInterbloqueos(t, "FD")
}
