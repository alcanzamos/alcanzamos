//go:build integration

// Pruebas de punta a punta de la US-51 contra PostgreSQL (infra/local) y el enrutador real, de caja negra: se entra por
// HTTP, como lo hacen la web (cookie) y Android (token en el cuerpo y Bearer). Solo datos sintéticos.
package registro_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

const (
	contrasena = "lluvia café tren azul"
	// Las dos necesarias de la persona adulta, para llegar a `requiere_autorizacion`.
	cuerpoAutorizar = `{"finalidades":["cuenta_y_acceso","funciones_financieras"],"version":"1.0"}`
	rutaMovimientos = "/api/v1/movimientos"
	rutaCategorias  = "/api/v1/categorias"
)

// hasheadorRapido «hashea» sin Argon2id: estas pruebas no miden contraseñas.
type hasheadorRapido struct{}

const prefijoDeHash = "$argon2id$v=19$m=8,t=1,p=1$prueba$"

func (hasheadorRapido) Hashear(_ context.Context, c string) (string, error) {
	return prefijoDeHash + c, nil
}
func (hasheadorRapido) Verificar(_ context.Context, c, hash string) (bool, error) {
	return hash == prefijoDeHash+c, nil
}
func (hasheadorRapido) NecesitaMejora(string) (bool, error) { return false, nil }

// servidorDePrueba es la API completa (cuenta, entrar, autorización y registro) sobre una base propia y migrada, con
// la hora fija del 26 de octubre de 2026 a las 10:00 en Colombia.
type servidorDePrueba struct {
	t       *testing.T
	pool    *pgxpool.Pool
	h       http.Handler
	reloj   *relojtest.Fijo
	correo  *correotest.Falso
	cuentas *cuenta.Servicio
	pedidos int
}

func nuevoServidor(t *testing.T) *servidorDePrueba {
	t.Helper()
	pool := pgtest.Nueva(t)
	log := slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))
	reloj := &relojtest.Fijo{T: time.Date(2026, 10, 26, 15, 0, 0, 0, time.UTC)}
	senuelos, err := sesion.NuevosSenuelos(bytes.Repeat([]byte{5}, 32), reloj)
	if err != nil {
		t.Fatal(err)
	}
	limitador := seguridad.NuevoLimitadorDeIntentos(reloj)
	politica := seguridad.NuevaPoliticaDeContrasena()
	correo := &correotest.Falso{}
	cuentas := cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: pg.NuevoCuentas(pool), Correo: correo, Politica: politica, Hasher: hasheadorRapido{}, Reloj: reloj,
		Limitador: limitador, Senuelos: senuelos, Log: log,
	})
	entrar, err := autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: pg.NuevoAutenticacion(pool), Hasher: hasheadorRapido{}, Limitador: limitador, Reloj: reloj, Correo: correo,
		Politica: politica, Log: log,
	})
	if err != nil {
		t.Fatal(err)
	}
	resolutor := sesion.NuevoResolutor(pg.NuevoSesiones(pool), senuelos, reloj)
	enr := servidor.NuevoEnrutador(resolutor, seguridad.NuevoRegistro(log), log)
	cuenta.NuevoHandler(cuentas, resolutor, log).Registrar(enr)
	autenticacion.NuevoHandler(entrar, seguridad.NuevoRegistro(log), log).Registrar(enr)
	autorizacion.NuevoHandler(autorizacion.NuevoServicio(pg.NuevoAutorizaciones(pool), reloj), seguridad.NuevoRegistro(log), log).Registrar(enr)
	registro.NuevoHandler(registro.NuevoServicio(pg.NuevoMovimientos(pool), reloj), log).Registrar(enr)
	api, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return &servidorDePrueba{t: t, pool: pool, h: servidor.ManejadorConAPI(api), reloj: reloj, correo: correo, cuentas: cuentas}
}

// cliente es quien llama: la web con la cookie, o Android con el token en el cuerpo y Bearer.
type cliente struct {
	s       *servidorDePrueba
	android bool
	token   string
}

type respuesta struct {
	Codigo  int
	Cuerpo  string
	Cookies []*http.Cookie
}

// llamar manda una petición con un origen distinto cada vez, para que los límites de intentos no estorben.
func (c *cliente) llamar(metodo, ruta, cuerpo string) respuesta {
	c.s.t.Helper()
	c.s.pedidos++
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	r.RemoteAddr = fmt.Sprintf("10.0.%d.%d:1", c.s.pedidos/250, c.s.pedidos%250)
	if c.android {
		r.Header.Set(sesion.EncabezadoDeCliente, sesion.ClienteAndroid)
		if c.token != "" {
			r.Header.Set("Authorization", "Bearer "+c.token)
		}
	} else if c.token != "" {
		r.AddCookie(sesion.Cookie(c.token))
	}
	rr := httptest.NewRecorder()
	c.s.h.ServeHTTP(rr, r)
	return respuesta{rr.Code, strings.TrimSpace(rr.Body.String()), rr.Result().Cookies()}
}

func (c *cliente) tokenDe(r respuesta) string {
	c.s.t.Helper()
	if c.android {
		_, resto, ok := strings.Cut(r.Cuerpo, `"token":"`)
		if !ok {
			c.s.t.Fatalf("Android recibe el token en el cuerpo: %s", r.Cuerpo)
		}
		token, _, _ := strings.Cut(resto, `"`)
		return token
	}
	if len(r.Cookies) != 1 {
		c.s.t.Fatalf("la web recibe el token en la cookie: %v", r.Cookies)
	}
	return r.Cookies[0].Value
}

// nuevaCuenta crea la cuenta, confirma el correo con el enlace y entra; con `autorizar` también autoriza lo necesario.
func (s *servidorDePrueba) nuevaCuenta(correo string, android, autorizar bool) (*cliente, string) {
	s.t.Helper()
	c := &cliente{s: s, android: android}
	if r := c.llamar("POST", "/api/v1/cuentas", `{"correo":"`+correo+`","contrasena":"`+contrasena+`","nombre":"Laura","mayor_de_edad":true}`); r.Codigo != 202 {
		s.t.Fatalf("crear la cuenta: %d %s", r.Codigo, r.Cuerpo)
	}
	s.cuentas.Esperar()
	enlaces := s.correo.Enviados()
	if v := (&cliente{s: s}).llamar("POST", "/api/v1/cuentas/verificacion", `{"token":"`+enlaces[len(enlaces)-1].Token+`"}`); v.Codigo != 200 {
		s.t.Fatalf("verificar: %d %s", v.Codigo, v.Cuerpo)
	}
	r := c.llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+contrasena+`"}`)
	if r.Codigo != 200 {
		s.t.Fatalf("entrar: %d %s", r.Codigo, r.Cuerpo)
	}
	c.token = c.tokenDe(r)
	if autorizar {
		if r := c.llamar("POST", "/api/v1/autorizaciones", cuerpoAutorizar); r.Codigo != 200 {
			s.t.Fatalf("autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
	}
	var id string
	if err := s.pool.QueryRow(context.Background(), `SELECT persona_id::text FROM perfil_adulto WHERE correo = $1`, correo).Scan(&id); err != nil {
		s.t.Fatal(err)
	}
	return c, id
}

func (s *servidorDePrueba) contar(sql string, args ...any) int {
	s.t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		s.t.Fatal(err)
	}
	return n
}

func formas(t *testing.T, f func(t *testing.T, android bool)) {
	t.Run("web con cookie", func(t *testing.T) { f(t, false) })
	t.Run("Android con token en el cuerpo", func(t *testing.T) { f(t, true) })
}

type creado struct {
	MovimientoID *string  `json:"movimiento_id"`
	RecurrenteID *string  `json:"recurrente_id"`
	Proximas     []string `json:"proximas"`
	Pendientes   []string `json:"pendientes"`
}

func (s *servidorDePrueba) crear(c *cliente, cuerpo string) creado {
	s.t.Helper()
	r := c.llamar("POST", rutaMovimientos, cuerpo)
	if r.Codigo != 201 {
		s.t.Fatalf("crear: %d %s", r.Codigo, r.Cuerpo)
	}
	var res creado
	if err := json.Unmarshal([]byte(r.Cuerpo), &res); err != nil {
		s.t.Fatal(err)
	}
	return res
}

func cuerpoDe(tipo, monto, fecha, categoria, extra string) string {
	return fmt.Sprintf(`{"tipo":"%s","monto_centavos":%s,"fecha":"%s","categoria_id":%s,"medio":"transferencia"%s}`, tipo, monto, fecha, categoria, extra)
}

const arriendo = `,"descripcion":"Arriendo","repeticion":{"periodicidad":"mensual"}`

// S4 (dueño, D-164, «E15 como está»): hoy es el 26 de octubre de 2026 y la persona escribe el arriendo del 15 de agosto, mensual.
// Se registra el 15 de agosto, enlazado a la repetición; el 15 de septiembre y el 15 de octubre son historia y no quedan
// pendientes; las próximas son noviembre, diciembre y enero.
func TestS4ElArriendoDelQuinceDeAgosto(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)
		res := s.crear(c, cuerpoDe("gasto", "65000000", "2026-08-15", "4", arriendo))
		if res.MovimientoID == nil || res.RecurrenteID == nil {
			t.Fatalf("ids: %+v", res)
		}
		if strings.Join(res.Pendientes, ",") != "" || res.Pendientes == nil {
			t.Errorf("pendientes debe ser []: %v", res.Pendientes)
		}
		if strings.Join(res.Proximas, ",") != "2026-11-15,2026-12-15,2027-01-15" {
			t.Errorf("próximas: %v", res.Proximas)
		}

		var tipo, medio, descripcion, recurrente, categoriaTipo string
		var monto int64
		var fecha, programada time.Time
		var hogar *string
		var creadoEn time.Time
		if err := s.pool.QueryRow(context.Background(),
			`SELECT tipo, medio, descripcion, monto, fecha, recurrente_id::text, fecha_programada, hogar_id::text, creado_en,
			        (SELECT tipo FROM categoria WHERE id = categoria_id)
			 FROM movimiento WHERE id = $1::uuid AND persona_id = $2::uuid`, *res.MovimientoID, persona).
			Scan(&tipo, &medio, &descripcion, &monto, &fecha, &recurrente, &programada, &hogar, &creadoEn, &categoriaTipo); err != nil {
			t.Fatal(err)
		}
		if tipo != "gasto" || medio != "transferencia" || descripcion != "Arriendo" || monto != 65000000 || fecha.Format(time.DateOnly) != "2026-08-15" ||
			recurrente != *res.RecurrenteID || programada.Format(time.DateOnly) != "2026-08-15" || hogar != nil || categoriaTipo != "gasto" || !creadoEn.Equal(s.reloj.T) {
			t.Errorf("movimiento: %s %s %q %d %v %s %v %v", tipo, medio, descripcion, monto, fecha, recurrente, programada, hogar)
		}

		var periodicidad string
		var habitual int64
		var inicio time.Time
		var detenido *time.Time
		var recurrenteCreado time.Time
		if err := s.pool.QueryRow(context.Background(),
			`SELECT periodicidad, monto_habitual, inicio, detenido_en, creado_en FROM movimiento_recurrente WHERE id = $1::uuid AND persona_id = $2::uuid AND hogar_id IS NULL`,
			*res.RecurrenteID, persona).Scan(&periodicidad, &habitual, &inicio, &detenido, &recurrenteCreado); err != nil {
			t.Fatal(err)
		}
		if periodicidad != "mensual" || habitual != 65000000 || inicio.Format(time.DateOnly) != "2026-08-15" || detenido != nil || !recurrenteCreado.Equal(s.reloj.T) {
			t.Errorf("recurrente: %s %d %v %v %v", periodicidad, habitual, inicio, detenido, recurrenteCreado)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento`); n != 1 {
			t.Errorf("solo el de agosto: %d movimientos (septiembre y octubre son historia)", n)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento_recurrente`); n != 1 {
			t.Errorf("recurrentes: %d", n)
		}
		if n := s.contar(`SELECT count(*) FROM ocurrencia_omitida`); n != 0 {
			t.Errorf("nada se omite: %d", n)
		}
	})
}

// Una fecha futura con repetición guarda solo la repetición (D-091): nunca un movimiento futuro.
func TestUnaFechaFuturaConRepeticionSoloGuardaLaRepeticion(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)
		res := s.crear(c, cuerpoDe("gasto", "65000000", "2026-11-01", "4", arriendo))
		if res.MovimientoID != nil || res.RecurrenteID == nil || len(res.Pendientes) != 0 ||
			strings.Join(res.Proximas, ",") != "2026-11-01,2026-12-01,2027-01-01" {
			t.Fatalf("respuesta: %+v", res)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento`); n != 0 {
			t.Errorf("no se guarda ningún movimiento futuro: %d", n)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento_recurrente WHERE persona_id = $1::uuid AND inicio = '2026-11-01'`, persona); n != 1 {
			t.Errorf("la repetición empieza el 1 de noviembre: %d", n)
		}
	})
}

func TestConRepeticionDeHoyGuardaEnLaBaseElMovimientoDeHoy(t *testing.T) {
	s := nuevoServidor(t)
	c, _ := s.nuevaCuenta("laura@ejemplo.test", false, true)
	res := s.crear(c, cuerpoDe("ingreso", "120000000", "2026-10-26", "17", `,"repeticion":{"periodicidad":"quincenal"}`))
	if res.MovimientoID == nil || res.RecurrenteID == nil || len(res.Pendientes) != 0 ||
		strings.Join(res.Proximas, ",") != "2026-11-11,2026-11-26,2026-12-11" {
		t.Fatalf("respuesta: %+v", res)
	}
	if n := s.contar(`SELECT count(*) FROM movimiento WHERE fecha = '2026-10-26' AND fecha_programada = '2026-10-26' AND recurrente_id = $1::uuid`, *res.RecurrenteID); n != 1 {
		t.Errorf("el movimiento de hoy es la fecha confirmada: %d", n)
	}
}

// E15 5.2: la fecha programada de hoy que no es la escrita sí queda pendiente. El lunes 19 de octubre, semanal, escrito el 26.
func TestUnaFechaProgramadaDeHoyQueNoEsLaEscritaQuedaPendienteEnLaBase(t *testing.T) {
	s := nuevoServidor(t)
	c, _ := s.nuevaCuenta("laura@ejemplo.test", false, true)
	res := s.crear(c, cuerpoDe("ingreso", "5000000", "2026-10-19", "18", `,"repeticion":{"periodicidad":"semanal"}`))
	if strings.Join(res.Pendientes, ",") != "2026-10-26" || strings.Join(res.Proximas, ",") != "2026-11-02,2026-11-09,2026-11-16" {
		t.Errorf("respuesta: %+v", res)
	}
	if n := s.contar(`SELECT count(*) FROM movimiento`); n != 1 {
		t.Errorf("la pendiente no es un movimiento hasta que se confirme: %d", n)
	}
}

// RF-057 y E14-PPN 9: un gasto que no se repite se registra con una fecha que todavía no llegó («Regalos de Navidad»,
// 20 de diciembre, registrado el 2 de noviembre). Se guarda con su fecha y no queda nada pendiente: D-091 es solo de los
// recurrentes.
func TestUnGastoSinRepeticionDeUnaFechaFuturaSeGuardaConSuFecha(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		s.reloj.T = time.Date(2026, 11, 2, 15, 0, 0, 0, time.UTC) // 10:00 del 2 de noviembre en Colombia
		c, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)
		res := s.crear(c, cuerpoDe("gasto", "50000000", "2026-12-20", "16", `,"descripcion":"Regalos de Navidad"`))
		if res.MovimientoID == nil || res.RecurrenteID != nil || len(res.Proximas) != 0 || len(res.Pendientes) != 0 {
			t.Fatalf("respuesta: %+v", res)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid AND fecha = '2026-12-20' AND monto = 50000000
			AND categoria_id = 16 AND recurrente_id IS NULL AND fecha_programada IS NULL`, persona); n != 1 {
			t.Errorf("se guarda el gasto del 20 de diciembre con su fecha: %d", n)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento_recurrente`); n != 0 {
			t.Errorf("no se crea ninguna repetición: %d", n)
		}
	})
}

func TestSinRepeticionGuardaUnSoloMovimiento(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)
		res := s.crear(c, cuerpoDe("gasto", "4500000", "2026-10-25", "1", `,"descripcion":"mercado"`))
		if res.MovimientoID == nil || res.RecurrenteID != nil || len(res.Proximas) != 0 || len(res.Pendientes) != 0 {
			t.Fatalf("respuesta: %+v", res)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid AND recurrente_id IS NULL AND fecha_programada IS NULL AND monto = 4500000`, persona); n != 1 {
			t.Errorf("movimiento: %d", n)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento_recurrente`); n != 0 {
			t.Errorf("sin repetición no hay recurrente: %d", n)
		}
	})
}

// EXA-001, D-082: los centavos son enteros de punta a punta, sin punto flotante.
func TestLosCentavosSeGuardanYSeSumanExactos(t *testing.T) {
	s := nuevoServidor(t)
	c, persona := s.nuevaCuenta("laura@ejemplo.test", false, true)
	// 12.345.678.901 centavos ($123.456.789,01) y los extremos que un float64 no representa: 2^53+1 y el máximo de int64.
	for _, monto := range []int64{12345678901, 9007199254740993, 9223372036854775807} {
		res := s.crear(c, cuerpoDe("gasto", fmt.Sprint(monto), "2026-10-26", "1", ""))
		var guardado int64
		if err := s.pool.QueryRow(context.Background(), `SELECT monto FROM movimiento WHERE id = $1::uuid`, *res.MovimientoID).Scan(&guardado); err != nil {
			t.Fatal(err)
		}
		if guardado != monto {
			t.Errorf("%d volvió como %d", monto, guardado)
		}
	}
	// La suma de muchos movimientos no tiene error: 0,10 pesos (10 centavos) y 0,01 pesos (1) mil veces cada uno.
	if _, err := s.pool.Exec(context.Background(), `DELETE FROM movimiento`); err != nil {
		t.Fatal(err)
	}
	for i := range 300 {
		monto := []int64{10, 1, 7}[i%3]
		s.crear(c, cuerpoDe("ingreso", fmt.Sprint(monto), "2026-10-26", "17", ""))
	}
	var suma int64
	if err := s.pool.QueryRow(context.Background(), `SELECT sum(monto)::bigint FROM movimiento WHERE persona_id = $1::uuid`, persona).Scan(&suma); err != nil {
		t.Fatal(err)
	}
	if suma != 100*(10+1+7) {
		t.Errorf("suma %d, se esperaba %d", suma, 100*18)
	}
}

// La dueña de la fila es la persona de la sesión: ni el cuerpo ni nada más puede poner otra.
func TestSoloLaPersonaDeLaSesionEscribeLoSuyo(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		a, personaA := s.nuevaCuenta("laura@ejemplo.test", android, true)
		_, personaB := s.nuevaCuenta("otra@ejemplo.test", android, true)
		for _, extra := range []string{`,"persona_id":"` + personaB + `"`, `,"hogar_id":"` + personaB + `"`} {
			if r := a.llamar("POST", rutaMovimientos, cuerpoDe("gasto", "100", "2026-10-26", "1", extra)); r.Codigo != 400 || r.Cuerpo != `{"error":"solicitud_invalida"}` {
				t.Errorf("%s: %d %s", extra, r.Codigo, r.Cuerpo)
			}
		}
		if n := s.contar(`SELECT count(*) FROM movimiento`); n != 0 {
			t.Fatalf("no se guardó nada: %d", n)
		}
		s.crear(a, cuerpoDe("gasto", "100", "2026-10-26", "1", `,"repeticion":{"periodicidad":"anual"}`))
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid`, personaA); n != 1 {
			t.Errorf("el movimiento es de quien tiene la sesión: %d", n)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid`, personaB) +
			s.contar(`SELECT count(*) FROM movimiento_recurrente WHERE persona_id = $1::uuid`, personaB); n != 0 {
			t.Errorf("la otra persona no recibe nada: %d", n)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento_recurrente WHERE persona_id = $1::uuid AND hogar_id IS NULL`, personaA); n != 1 {
			t.Errorf("la repetición también es suya: %d", n)
		}
	})
}

// Sin autorizar, las dos rutas dan 403 `autorizacion_pendiente` y no se guarda nada; sin sesión, 401.
func TestSinAutorizarLasRutasDan403YSinSesion401(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, false)
		for _, p := range [][3]string{{"POST", rutaMovimientos, cuerpoDe("gasto", "100", "2026-10-26", "1", "")}, {"GET", rutaCategorias, ""}} {
			if r := c.llamar(p[0], p[1], p[2]); r.Codigo != 403 || r.Cuerpo != `{"error":"autorizacion_pendiente"}` {
				t.Errorf("%s %s sin autorizar: %d %s", p[0], p[1], r.Codigo, r.Cuerpo)
			}
			if r := (&cliente{s: s, android: android}).llamar(p[0], p[1], p[2]); r.Codigo != 401 || r.Cuerpo != `{"error":"sin_sesion"}` {
				t.Errorf("%s %s sin sesión: %d %s", p[0], p[1], r.Codigo, r.Cuerpo)
			}
		}
		if n := s.contar(`SELECT count(*) FROM movimiento`); n != 0 {
			t.Errorf("nada se guarda antes de autorizar: %d", n)
		}
		// Al autorizar, en la misma sesión, pasa.
		if r := c.llamar("POST", "/api/v1/autorizaciones", cuerpoAutorizar); r.Codigo != 200 {
			t.Fatal(r.Cuerpo)
		}
		if r := c.llamar("POST", rutaMovimientos, cuerpoDe("gasto", "100", "2026-10-26", "1", "")); r.Codigo != 201 {
			t.Errorf("tras autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
	})
}

type catalogo struct {
	Gasto, Ingreso []struct {
		ID      int    `json:"id"`
		Nombre  string `json:"nombre"`
		General bool   `json:"general"`
	}
}

func TestCategoriasVisiblesParaUnaPersonaAdulta(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)
		leer := func() catalogo {
			r := c.llamar("GET", rutaCategorias, "")
			var cat catalogo
			if r.Codigo != 200 || json.Unmarshal([]byte(r.Cuerpo), &cat) != nil {
				t.Fatalf("categorías: %d %s", r.Codigo, r.Cuerpo)
			}
			return cat
		}
		cat := leer()
		// E09: 17 de gasto (ids 1 a 16 y 26) y 9 de ingreso (17 a 25). Una persona adulta ve también «Bebidas alcohólicas y tabaco».
		if len(cat.Gasto) != 17 || len(cat.Ingreso) != 9 {
			t.Fatalf("gasto %d, ingreso %d", len(cat.Gasto), len(cat.Ingreso))
		}
		if cat.Gasto[0].ID != 1 || cat.Gasto[0].Nombre != "Alimentación" || cat.Gasto[1].ID != 2 || cat.Gasto[16].ID != 26 || cat.Ingreso[0].ID != 17 || cat.Ingreso[8].ID != 25 {
			t.Errorf("orden por id: %+v %+v", cat.Gasto, cat.Ingreso)
		}
		if !cat.Gasto[15].General || cat.Gasto[15].Nombre != "Otros gastos" || !cat.Ingreso[8].General || cat.Gasto[0].General {
			t.Errorf("las generales son «Otros gastos» y «Otros ingresos»: %+v", cat)
		}

		// Lo que la persona ocultó no aparece (E14-PPN 3.1), y la oculta de otra persona sí.
		if _, err := s.pool.Exec(context.Background(), `INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, 3), ($1::uuid, 21)`, persona); err != nil {
			t.Fatal(err)
		}
		cat = leer()
		if len(cat.Gasto) != 16 || len(cat.Ingreso) != 8 || cat.Gasto[2].ID == 3 {
			t.Errorf("sin las ocultas: gasto %d, ingreso %d", len(cat.Gasto), len(cat.Ingreso))
		}
		otra, _ := s.nuevaCuenta("otra@ejemplo.test", android, true)
		if r := otra.llamar("GET", rutaCategorias, ""); !strings.Contains(r.Cuerpo, `"nombre":"Ropa y calzado"`) {
			t.Errorf("lo que oculta una persona no se oculta a otra: %s", r.Cuerpo)
		}
	})
}

// Para una persona menor solo van las categorías aptas para menores (`apta_para_menores`).
func TestUnaPersonaMenorNoVeLasCategoriasNoAptas(t *testing.T) {
	s := nuevoServidor(t)
	repo := pg.NuevoMovimientos(s.pool)
	menor := s.nuevoMenor()
	categorias, err := repo.Categorias(context.Background(), menor)
	if err != nil {
		t.Fatal(err)
	}
	if len(categorias) != 25 {
		t.Errorf("un menor ve 25 de las 26: %d", len(categorias))
	}
	for _, c := range categorias {
		if c.ID == 2 {
			t.Errorf("«Bebidas alcohólicas y tabaco» no es apta para menores: %+v", c)
		}
	}
}

// La categoría del tipo equivocado o inexistente es un 422 y no deja nada guardado, tampoco la repetición.
func TestUnaCategoriaInvalidaNoGuardaNada(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		for nombre, cuerpo := range map[string]string{
			"gasto con categoría de ingreso":                              cuerpoDe("gasto", "100", "2026-10-26", "17", ""),
			"ingreso con categoría de gasto":                              cuerpoDe("ingreso", "100", "2026-10-26", "1", ""),
			"categoría que no existe":                                     cuerpoDe("gasto", "100", "2026-10-26", "999", ""),
			"con repetición, el movimiento falla y la repetición también": cuerpoDe("gasto", "100", "2026-10-26", "17", `,"repeticion":{"periodicidad":"mensual"}`),
			"con repetición futura":                                       cuerpoDe("gasto", "100", "2026-11-26", "17", `,"repeticion":{"periodicidad":"mensual"}`),
		} {
			if r := c.llamar("POST", rutaMovimientos, cuerpo); r.Codigo != 422 || r.Cuerpo != `{"campos":{"categoria_id":"categoria_invalida"},"error":"datos_invalidos"}` {
				t.Errorf("%s: %d %s", nombre, r.Codigo, r.Cuerpo)
			}
		}
		if n := s.contar(`SELECT count(*) FROM movimiento`) + s.contar(`SELECT count(*) FROM movimiento_recurrente`); n != 0 {
			t.Errorf("no queda nada guardado: %d filas", n)
		}
	})
}

// Cada error de validación llega por HTTP real, sin tocar la base; «tarjeta» no se acepta (D-164).
func TestLaValidacionLlegaPorHTTPYNoGuardaNada(t *testing.T) {
	s := nuevoServidor(t)
	c, _ := s.nuevaCuenta("laura@ejemplo.test", false, true)
	casos := map[string]string{
		`{"campos":{"medio":"medio_invalido"},"error":"datos_invalidos"}`:             strings.Replace(cuerpoDe("gasto", "100", "2026-10-26", "1", ""), "transferencia", "tarjeta", 1),
		`{"campos":{"monto_centavos":"monto_no_positivo"},"error":"datos_invalidos"}`: cuerpoDe("gasto", "0", "2026-10-26", "1", ""),
		`{"campos":{"monto_centavos":"monto_invalido"},"error":"datos_invalidos"}`:    cuerpoDe("gasto", "12.5", "2026-10-26", "1", ""),
		`{"campos":{"descripcion":"descripcion_larga"},"error":"datos_invalidos"}`:    cuerpoDe("gasto", "100", "2026-10-26", "1", `,"descripcion":"`+strings.Repeat("a", 281)+`"`),
		`{"campos":{"repeticion":"periodicidad_invalida"},"error":"datos_invalidos"}`: cuerpoDe("gasto", "100", "2026-10-26", "1", `,"repeticion":{"periodicidad":"diaria"}`),
	}
	for quiere, cuerpo := range casos {
		if r := c.llamar("POST", rutaMovimientos, cuerpo); r.Codigo != 422 || r.Cuerpo != quiere {
			t.Errorf("%d %s, se esperaba %s", r.Codigo, r.Cuerpo, quiere)
		}
	}
	if n := s.contar(`SELECT count(*) FROM movimiento`) + s.contar(`SELECT count(*) FROM movimiento_recurrente`); n != 0 {
		t.Errorf("no se guarda nada: %d", n)
	}
}

// Un ingreso en efectivo y una descripción de 280 caracteres pasan las restricciones de E13.
func TestUnIngresoEnEfectivoYUnaDescripcionLargaSeGuardan(t *testing.T) {
	s := nuevoServidor(t)
	c, _ := s.nuevaCuenta("laura@ejemplo.test", false, true)
	descripcion := strings.Repeat("ñ", 280)
	res := s.crear(c, strings.Replace(cuerpoDe("ingreso", "100", "2026-10-26", "17", `,"descripcion":"`+descripcion+`"`), "transferencia", "efectivo", 1))
	var guardada string
	if err := s.pool.QueryRow(context.Background(), `SELECT descripcion FROM movimiento WHERE id = $1::uuid`, *res.MovimientoID).Scan(&guardada); err != nil || guardada != descripcion {
		t.Errorf("descripción: %v (%d caracteres)", err, len([]rune(guardada)))
	}
}

// nuevoMenor crea una persona menor por SQL (las cuentas de menores llegan en I11): la base exige el perfil y el
// nacimiento en la misma transacción que la persona.
func (s *servidorDePrueba) nuevoMenor() string {
	s.t.Helper()
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		s.t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	var menor string
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa) VALUES ('Mateo', 'menor') RETURNING id::text`).Scan(&menor); err != nil {
		s.t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO perfil_menor (persona_id, nombre_de_usuario) VALUES ($1::uuid, 'mateo.prueba')`,
		`INSERT INTO nacimiento_menor (persona_id, valor_cifrado, version_clave) VALUES ($1::uuid, decode(repeat('ab', 38), 'hex'), 1)`,
	} {
		if _, err := tx.Exec(ctx, sql, menor); err != nil {
			s.t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		s.t.Fatal(err)
	}
	return menor
}

// E09: «Bebidas alcohólicas y tabaco» (2) queda oculta siempre para un menor. Guardar aplica la misma regla que el
// catálogo: con ella, sin repetición y con repetición (pasada y futura), da ErrCategoriaInvalida y no guarda nada. Va
// contra el repositorio porque un menor todavía no puede iniciar sesión (I11); el servicio traduce el error a 422
// categoria_invalida (lo prueba TestUnaCategoriaOcultaPorLaPersonaEsUn422YNoGuardaNada por HTTP).
func TestUnMenorNoGuardaEnUnaCategoriaQueNoPuedeVer(t *testing.T) {
	s := nuevoServidor(t)
	repo := pg.NuevoMovimientos(s.pool)
	menor := s.nuevoMenor()
	base := registro.Guardado{Persona: menor, Tipo: "gasto", Monto: 1500000, CategoriaID: 2, Medio: "efectivo"}
	casos := map[string]registro.Guardado{}
	sin := base
	sin.Fecha, sin.ConMovimiento = time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC), true
	casos["sin repetición"] = sin
	con := sin
	con.Periodicidad = "mensual"
	casos["con repetición"] = con
	futura := base
	futura.Fecha, futura.Periodicidad = time.Date(2026, 11, 25, 0, 0, 0, 0, time.UTC), "mensual"
	casos["con repetición futura"] = futura
	for nombre, g := range casos {
		if _, err := repo.Guardar(context.Background(), g, s.reloj.T); !errors.Is(err, registro.ErrCategoriaInvalida) {
			t.Errorf("%s: se esperaba ErrCategoriaInvalida, llegó %v", nombre, err)
		}
	}
	if n := s.contar(`SELECT count(*) FROM movimiento`) + s.contar(`SELECT count(*) FROM movimiento_recurrente`); n != 0 {
		t.Errorf("no queda nada guardado: %d filas", n)
	}
	// Una categoría apta (Alimentación) sí se guarda: la regla no rechaza todo lo del menor.
	apta := sin
	apta.CategoriaID = 1
	if _, err := repo.Guardar(context.Background(), apta, s.reloj.T); err != nil {
		t.Errorf("Alimentación es apta para un menor: %v", err)
	}
}

// Una categoría que la persona ocultó no se puede usar para guardar: 422 categoria_invalida, sin nada guardado, sin
// repetición y con repetición. La misma categoría la sigue usando otra persona que no la ocultó.
func TestUnaCategoriaOcultaPorLaPersonaEsUn422YNoGuardaNada(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)
		if _, err := s.pool.Exec(context.Background(), `INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, 3)`, persona); err != nil {
			t.Fatal(err)
		}
		for nombre, cuerpo := range map[string]string{
			"sin repetición":        cuerpoDe("gasto", "100", "2026-10-25", "3", ""),
			"con repetición":        cuerpoDe("gasto", "100", "2026-10-25", "3", `,"repeticion":{"periodicidad":"mensual"}`),
			"con repetición futura": cuerpoDe("gasto", "100", "2026-11-25", "3", `,"repeticion":{"periodicidad":"mensual"}`),
		} {
			if r := c.llamar("POST", rutaMovimientos, cuerpo); r.Codigo != 422 || r.Cuerpo != `{"campos":{"categoria_id":"categoria_invalida"},"error":"datos_invalidos"}` {
				t.Errorf("%s: %d %s", nombre, r.Codigo, r.Cuerpo)
			}
		}
		if n := s.contar(`SELECT count(*) FROM movimiento`) + s.contar(`SELECT count(*) FROM movimiento_recurrente`); n != 0 {
			t.Errorf("no queda nada guardado: %d filas", n)
		}
		otra, _ := s.nuevaCuenta("otra@ejemplo.test", android, true)
		s.crear(otra, cuerpoDe("gasto", "100", "2026-10-25", "3", ""))
	})
}
