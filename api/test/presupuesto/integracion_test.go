//go:build integration

// Pruebas de punta a punta de la US-77 (API) contra PostgreSQL y el enrutador real, de caja negra: se entra por HTTP, en
// web con cookie y en Android con Bearer, con las rutas del registro (para guardar y confirmar movimientos) y las del
// presupuesto. Solo datos sintéticos. La hora es la de E14-PPA 2.1: el 2 de noviembre de 2026 a las 10:00 en Colombia.
package presupuesto_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/presupuesto"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

// servidorDePrueba es el API del registro y del presupuesto sobre una base propia y migrada, con la hora fija.
type servidorDePrueba struct {
	t     *testing.T
	pool  *pgxpool.Pool
	h     http.Handler
	reloj *relojtest.Fijo
	log   *bytes.Buffer
}

func nuevoServidor(t *testing.T) *servidorDePrueba {
	t.Helper()
	pool := pgtest.Nueva(t)
	registroDelLog := &bytes.Buffer{}
	log := slog.New(slog.NewJSONHandler(registroDelLog, nil))
	reloj := &relojtest.Fijo{T: time.Date(2026, 11, 2, 15, 0, 0, 0, time.UTC)}
	enr := servidor.NuevoEnrutador(sesion.NuevoResolutor(pg.NuevoSesiones(pool), reloj), seguridad.NuevoRegistro(log), log).ConURLPublica(urlPublica)
	registro.NuevoHandler(registro.NuevoServicio(pg.NuevoMovimientos(pool), reloj), log).Registrar(enr)
	presupuesto.NuevoHandler(presupuesto.NuevoServicio(pg.NuevoPresupuestos(pool), reloj), log).Registrar(enr)
	api, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return &servidorDePrueba{t: t, pool: pool, h: servidor.ManejadorConAPI(api), reloj: reloj, log: registroDelLog}
}

func (s *servidorDePrueba) ejecutar(sql string, args ...any) {
	s.t.Helper()
	if _, err := s.pool.Exec(context.Background(), sql, args...); err != nil {
		s.t.Fatalf("%s: %v", sql, err)
	}
}

// cliente es quien llama: la web con la cookie o Android con Bearer.
type cliente struct {
	s       *servidorDePrueba
	android bool
	token   string
	persona string
}

// nuevaPersona siembra una persona adulta con el correo verificado, autorizada o no, y su sesión.
func (s *servidorDePrueba) nuevaPersona(correo string, android, autorizada bool) *cliente {
	s.t.Helper()
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		s.t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa) VALUES ('Laura', 'adulta') RETURNING id::text`).Scan(&id); err != nil {
		s.t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, $2, true)`, id, correo); err != nil {
		s.t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		s.t.Fatal(err)
	}
	if autorizada {
		for _, f := range []string{"cuenta_y_acceso", "funciones_financieras"} {
			s.ejecutar(`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, $2, '1.0', $3)`, id, f, s.reloj.T)
		}
	}
	token, huella := seguridad.NuevoTokenOpaco()
	s.ejecutar(`INSERT INTO sesion (hash_token, persona_id, creada_en, ultimo_uso_en, vence_en) VALUES ($1, $2::uuid, $3, $3, $3::timestamptz + interval '30 days')`, huella, id, s.reloj.T)
	return &cliente{s: s, android: android, token: token, persona: id}
}

// nuevoMenor crea una persona menor por SQL (las cuentas de menores llegan en I11), con su perfil y su nacimiento.
func (s *servidorDePrueba) nuevoMenor() string {
	s.t.Helper()
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		s.t.Fatal(err)
	}
	defer tx.Rollback(ctx)
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

type respuesta struct {
	Codigo int
	Cuerpo string
	Cache  string
}

// llamar manda la petición como la web (cookie, `Sec-Fetch-Site: same-origin`) o como Android (Bearer); todo cuerpo va
// como JSON (E17 3.15).
func (c *cliente) llamar(metodo, ruta, cuerpo string) respuesta {
	c.s.t.Helper()
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	r.RemoteAddr = "10.2.0.1:1"
	if c.android {
		r.Header.Set(sesion.EncabezadoDeCliente, sesion.ClienteAndroid)
		r.Header.Set("Authorization", "Bearer "+c.token)
	} else {
		r.AddCookie(sesion.Cookie(c.token))
		r.Header.Set("Sec-Fetch-Site", "same-origin")
	}
	if metodo != http.MethodGet {
		r.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	c.s.h.ServeHTTP(rr, r)
	return respuesta{rr.Code, strings.TrimSpace(rr.Body.String()), rr.Header().Get("Cache-Control")}
}

// registrar guarda un movimiento con el POST del registro y devuelve su id y el de su repetición.
func (c *cliente) registrar(tipo string, monto int64, fecha string, categoria int, extra string) (movimiento, recurrente string) {
	c.s.t.Helper()
	medio := "efectivo"
	if tipo == registro.Ingreso && categoria == salario {
		medio = "transferencia"
	}
	r := c.llamar("POST", "/api/v1/movimientos", fmt.Sprintf(`{"tipo":%q,"monto_centavos":%d,"fecha":%q,"categoria_id":%d,"medio":%q%s}`, tipo, monto, fecha, categoria, medio, extra))
	if r.Codigo != 201 {
		c.s.t.Fatalf("registrar: %d %s", r.Codigo, r.Cuerpo)
	}
	var creado struct {
		MovimientoID *string `json:"movimiento_id"`
		RecurrenteID *string `json:"recurrente_id"`
	}
	if err := json.Unmarshal([]byte(r.Cuerpo), &creado); err != nil {
		c.s.t.Fatal(err)
	}
	if creado.MovimientoID != nil {
		movimiento = *creado.MovimientoID
	}
	if creado.RecurrenteID != nil {
		recurrente = *creado.RecurrenteID
	}
	return movimiento, recurrente
}

// vistaLeida es la `Vista` con los montos como texto, para compararlos exactos.
type vistaLeida struct {
	PeriodoActual string `json:"periodo_actual"`
	Periodo       string `json:"periodo"`
	Editable      bool   `json:"editable"`
	Resumen       struct {
		Modo              string       `json:"modo"`
		IngresoRegistrado json.Number  `json:"ingreso_registrado_centavos"`
		Asignado          json.Number  `json:"asignado_centavos"`
		SinAsignar        *json.Number `json:"sin_asignar_centavos"`
		SuperaPor         *json.Number `json:"asignado_supera_por_centavos"`
		LlegaDespues      json.Number  `json:"llega_despues_centavos"`
	} `json:"resumen"`
	LlegaDespues []presupuesto.IngresoPendiente `json:"llega_despues"`
	Categorias   []struct {
		CategoriaID int    `json:"categoria_id"`
		Nombre      string `json:"nombre"`
		Oculta      bool   `json:"oculta"`
		Presupuesto *struct {
			ID            string `json:"id"`
			MontoCentavos int64  `json:"monto_centavos"`
		} `json:"presupuesto"`
		Gastado json.Number  `json:"gastado_centavos"`
		Estado  *string      `json:"estado"`
		Quedan  *json.Number `json:"quedan_centavos"`
	} `json:"categorias"`
}

func leerJSON[T any](t *testing.T, r respuesta) T {
	t.Helper()
	if r.Codigo != 200 || r.Cache != "no-store" {
		t.Fatalf("%d %s (Cache-Control %q)", r.Codigo, r.Cuerpo, r.Cache)
	}
	var v T
	d := json.NewDecoder(strings.NewReader(r.Cuerpo))
	d.UseNumber()
	if err := d.Decode(&v); err != nil {
		t.Fatalf("%v: %s", err, r.Cuerpo)
	}
	return v
}

// filasDeLaVista resume «Por categoría» como «id:gastado:presupuesto:estado[:oculta]».
func filasDeLaVista(v vistaLeida) string {
	var partes []string
	for _, f := range v.Categorias {
		p, e := "-", "-"
		if f.Presupuesto != nil {
			p = fmt.Sprint(f.Presupuesto.MontoCentavos)
		}
		if f.Estado != nil {
			e = *f.Estado
		}
		parte := fmt.Sprintf("%d:%s:%s:%s", f.CategoriaID, f.Gastado, p, e)
		if f.Oculta {
			parte += ":oculta"
		}
		partes = append(partes, parte)
	}
	return strings.Join(partes, " ")
}

// formas corre la prueba en la web y en Android.
func formas(t *testing.T, prueba func(t *testing.T, android bool)) {
	for _, android := range []bool{false, true} {
		nombre := "web"
		if android {
			nombre = "android"
		}
		t.Run(nombre, func(t *testing.T) { prueba(t, android) })
	}
}

// noviembre siembra el escenario de E14-PPA 2.2 por HTTP: el salario quincenal de $1.200.000 desde el 1 de noviembre (el
// 1 registrado, el 16 esperado), el arriendo mensual y los gastos de E14-PPN 9.2, más el presupuesto de Transporte de
// $40.000 (por SQL: guardarlo es de la otra parte de esta historia). Devuelve la repetición del salario.
func (c *cliente) noviembre() string {
	c.s.t.Helper()
	_, salarioRec := c.registrar(registro.Ingreso, 120000000, "2026-11-01", salario, `,"repeticion":{"periodicidad":"quincenal"}`)
	c.registrar(registro.Gasto, 65000000, "2026-11-01", arriendo, `,"repeticion":{"periodicidad":"mensual"}`)
	c.registrar(registro.Gasto, 4500000, "2026-11-01", alimentacion, "")
	c.registrar(registro.Gasto, 7500000, "2026-11-02", alimentacion, "")
	c.registrar(registro.Gasto, 2500000, "2026-11-01", transporte, "")
	c.registrar(registro.Gasto, 1500000, "2026-11-02", transporte, "")
	c.registrar(registro.Gasto, 2500000, "2026-11-01", restaurantes, "")
	c.registrar(registro.Gasto, 1500000, "2026-11-02", recreacion, "")
	c.s.ejecutar(`INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, $2, '2026-11-01', 4000000)`, c.persona, transporte)
	return salarioRec
}

// E14-PPA 2.2 de punta a punta: «Ingreso registrado $1.200.000», «Asignado $40.000», «Sin asignar $1.160.000» y «Llega
// después: $1.200.000 (esperado)»; Transporte primero y las demás de mayor a menor gasto. Lo de otra persona no cuenta.
func TestIntegracionPN06NoviembreDeLaura(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		otra := s.nuevaPersona("otra@ejemplo.test", android, true)
		otra.registrar(registro.Ingreso, 99900, "2026-11-01", salario, "")
		otra.registrar(registro.Gasto, 99900, "2026-11-01", transporte, "")
		c := s.nuevaPersona("laura@ejemplo.test", android, true)
		salarioRec := c.noviembre()

		v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", ""))
		if v.PeriodoActual != "2026-11" || v.Periodo != "2026-11" || !v.Editable || v.Resumen.Modo != presupuesto.ModoNormal ||
			v.Resumen.IngresoRegistrado != "120000000" || v.Resumen.Asignado != "4000000" || v.Resumen.SinAsignar == nil ||
			*v.Resumen.SinAsignar != "116000000" || v.Resumen.SuperaPor != nil || v.Resumen.LlegaDespues != "120000000" {
			t.Errorf("resumen: %+v", v)
		}
		if len(v.LlegaDespues) != 1 || v.LlegaDespues[0] != (presupuesto.IngresoPendiente{RecurrenteID: salarioRec, Fecha: "2026-11-16",
			CategoriaID: salario, MontoCentavos: 120000000, Marca: presupuesto.MarcaEsperado}) {
			t.Errorf("llega después: %+v", v.LlegaDespues)
		}
		if got := filasDeLaVista(v); got != "8:4000000:4000000:usado_todo 4:65000000:-:- 1:12000000:-:- 13:2500000:-:- 11:1500000:-:-" {
			t.Errorf("por categoría: %s", got)
		}
		if v.Categorias[0].Nombre != "Transporte" || v.Categorias[0].Presupuesto.ID == "" {
			t.Errorf("fila de Transporte: %+v", v.Categorias[0])
		}
	})
}

// RNF-002 con la base: lo gastado es la suma exacta al centavo de la base, también por encima de int64; los ingresos,
// también. Una persona menor no tiene presupuesto (ErrSoloAdultos) y una cuenta borrada es ErrSinCuenta.
func TestIntegracionSumasExactasMenorYCuentaBorrada(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", false, true)
	c.registrar(registro.Gasto, 1234567, "2026-11-01", alimentacion, "")
	c.registrar(registro.Gasto, 1, "2026-11-02", alimentacion, "")
	c.registrar(registro.Ingreso, 3, "2026-11-02", ventas, "")
	c.registrar(registro.Ingreso, 9999999997, "2026-11-02", ventas, "")
	// Dos gastos del máximo de int64 en Transporte: la suma no cabe en int64.
	for range 2 {
		s.ejecutar(`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id) VALUES ($1::uuid, 'gasto', 9223372036854775807, '2026-11-02', 'efectivo', $2)`, c.persona, transporte)
	}
	v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", ""))
	if got := filasDeLaVista(v); got != "8:18446744073709551614:-:- 1:1234568:-:-" {
		t.Errorf("por categoría: %s", got)
	}
	if v.Resumen.IngresoRegistrado != "10000000000" || *v.Resumen.SinAsignar != "10000000000" {
		t.Errorf("resumen: %+v", v.Resumen)
	}

	repo := pg.NuevoPresupuestos(s.pool)
	servicio := presupuesto.NuevoServicio(repo, s.reloj)
	if _, err := servicio.Ver(context.Background(), s.nuevoMenor(), ""); err != presupuesto.ErrSoloAdultos {
		t.Errorf("menor: %v", err)
	}
	const nadie = "0192f3c4-0000-7000-8000-0000000000ff"
	if _, err := repo.Presupuesto(context.Background(), nadie, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)); err != registro.ErrSinCuenta {
		t.Errorf("cuenta borrada, presupuesto: %v", err)
	}
	if _, err := repo.Ingresos(context.Background(), nadie, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)); err != registro.ErrSinCuenta {
		t.Errorf("cuenta borrada, ingresos: %v", err)
	}
}

// RN-013: un aporte y un retiro de una meta no son gasto ni ingreso: no aparecen en «Por categoría» ni suman al ingreso.
// RN-011: una categoría oculta con presupuesto sigue, marcada; una oculta sin presupuesto, aunque tenga gasto, no. Un
// presupuesto de otro mes no cuenta en este.
func TestIntegracionAportesFueraYCategoriasOcultas(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", true, true)
	c.registrar(registro.Ingreso, 50000000, "2026-11-01", salario, "")
	c.registrar(registro.Gasto, 1500000, "2026-11-02", recreacion, "")
	c.registrar(registro.Gasto, 1000000, "2026-11-02", transporte, "")
	var meta string
	if err := s.pool.QueryRow(context.Background(), `INSERT INTO meta (persona_id, nombre, monto_objetivo) VALUES ($1::uuid, 'Viaje', 100000000) RETURNING id::text`, c.persona).Scan(&meta); err != nil {
		t.Fatal(err)
	}
	for _, sentido := range []string{"entrada", "salida"} {
		s.ejecutar(`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, meta_id, sentido) VALUES ($1::uuid, 'aporte', 7000000, '2026-11-02', 'efectivo', $2::uuid, $3)`, c.persona, meta, sentido)
	}
	s.ejecutar(`INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, $2, '2026-11-01', 3000000), ($1::uuid, $3, '2026-10-01', 9900)`, c.persona, transporte, alimentacion)
	s.ejecutar(`INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, $2), ($1::uuid, $3)`, c.persona, transporte, recreacion)

	v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos?periodo=2026-11", ""))
	if got := filasDeLaVista(v); got != "8:1000000:3000000:quedan:oculta" {
		t.Errorf("por categoría: %s", got)
	}
	if v.Resumen.IngresoRegistrado != "50000000" || v.Resumen.Asignado != "3000000" || *v.Categorias[0].Quedan != "2000000" {
		t.Errorf("resumen: %+v", v.Resumen)
	}
	octubre := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos?periodo=2026-10", ""))
	if octubre.Editable || octubre.Resumen.Modo != presupuesto.ModoIngresoNulo || octubre.Resumen.Asignado != "9900" || filasDeLaVista(octubre) != "1:0:9900:quedan" {
		t.Errorf("octubre: %+v", octubre)
	}
}

// L12 (2) de la US-77: PN-06 lee solo los presupuestos propios (`hogar_id` nulo), como la escritura y la descarga. Los
// compartidos con el hogar, aunque los haya puesto la misma persona, no son filas ni suman en lo asignado: Alimentación
// sale sin presupuesto (con su gasto) y Educación, sin gasto, no sale.
func TestIntegracionPN06SoloLosPresupuestosPropios(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", false, true)
	c.registrar(registro.Ingreso, 10000000, "2026-11-01", salario, "")
	c.registrar(registro.Gasto, 1000000, "2026-11-02", alimentacion, "")
	c.registrar(registro.Gasto, 500000, "2026-11-02", transporte, "")
	// El hogar y su administradora van en una transacción: `fk_hogar_administrador_miembro` es diferida.
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var hogarID string
	if err := tx.QueryRow(ctx, `INSERT INTO hogar (nombre, creado_en, administrador_id) VALUES ('Casa', '2026-11-01', $1::uuid) RETURNING id::text`, c.persona).Scan(&hogarID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO miembro_hogar (persona_id, hogar_id) VALUES ($1::uuid, $2::uuid)`, c.persona, hogarID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	s.ejecutar(`INSERT INTO presupuesto (persona_id, hogar_id, categoria_id, periodo, monto_asignado) VALUES
		($1::uuid, NULL, $3, '2026-11-01', 3000000), ($1::uuid, $2::uuid, $4, '2026-11-01', 5000000), ($1::uuid, $2::uuid, $5, '2026-11-01', 7000000)`,
		c.persona, hogarID, transporte, alimentacion, educacion)

	v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", ""))
	if got := filasDeLaVista(v); got != "8:500000:3000000:quedan 1:1000000:-:-" {
		t.Errorf("por categoría: %s", got)
	}
	if v.Resumen.Modo != presupuesto.ModoNormal || v.Resumen.IngresoRegistrado != "10000000" || v.Resumen.Asignado != "3000000" ||
		v.Resumen.SinAsignar == nil || *v.Resumen.SinAsignar != "7000000" || v.Resumen.SuperaPor != nil {
		t.Errorf("resumen: %+v", v.Resumen)
	}
}

// E14-PPA 4.1, PN-06 fila 4 (L6 (6) de la US-77), con los nombres del catálogo de la base: con el mismo gasto, por nombre
// y no por id. Educación (12) antes que Transporte (8), con presupuesto y sin gasto; Hogar y mantenimiento (6) antes que
// Servicios públicos (5), sin presupuesto y con el mismo gasto.
func TestIntegracionConElMismoGastoPorNombre(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", false, true)
	c.registrar(registro.Gasto, 500000, "2026-11-02", servicios, "")
	c.registrar(registro.Gasto, 500000, "2026-11-02", hogar, "")
	s.ejecutar(`INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, $2, '2026-11-01', 100), ($1::uuid, $3, '2026-11-01', 100)`,
		c.persona, transporte, educacion)
	v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", ""))
	if got := filasDeLaVista(v); got != "12:0:100:quedan 8:0:100:quedan 6:500000:-:- 5:500000:-:-" {
		t.Errorf("por categoría: %s", got)
	}
}

// ingresosLeidos es `Ingresos` con los montos como texto.
type ingresosLeidos struct {
	PeriodoActual string   `json:"periodo_actual"`
	Periodo       string   `json:"periodo"`
	Meses         []string `json:"meses"`
	Total         struct {
		Entran       json.Number `json:"entran_centavos"`
		Registrado   json.Number `json:"registrado_centavos"`
		Esperado     json.Number `json:"esperado_centavos"`
		PorConfirmar int         `json:"por_confirmar"`
	} `json:"total"`
	Fuentes []struct {
		CategoriaID int                         `json:"categoria_id"`
		Total       json.Number                 `json:"total_centavos"`
		Ingresos    []presupuesto.FilaDeIngreso `json:"ingresos"`
	} `json:"fuentes"`
}

// fuentesLeidas resume las fuentes como «id=total[fecha:marca:monto,…]».
func fuentesLeidas(l ingresosLeidos) string {
	var partes []string
	for _, f := range l.Fuentes {
		var filas []string
		for _, i := range f.Ingresos {
			filas = append(filas, fmt.Sprintf("%s:%s:%d", i.Fecha, i.Marca, i.MontoCentavos))
		}
		partes = append(partes, fmt.Sprintf("%d=%s[%s]", f.CategoriaID, f.Total, strings.Join(filas, ",")))
	}
	return strings.Join(partes, " ")
}

// PN-08 con la US-60: Laura en noviembre (el 1 registrado y el 16 esperado). El 17 el 16 está por confirmar, con el id de
// su repetición; al confirmarlo con la ruta de la US-60 pasa a registrado, el total no cambia y «Sin asignar» de PN-06 sube.
func TestIntegracionPN08ConLasFechasDeLaUS60(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c := s.nuevaPersona("laura@ejemplo.test", android, true)
		salarioRec := c.noviembre()
		c.registrar(registro.Ingreso, 9000000, "2026-10-28", ventas, `,"descripcion":"Venta de artesanías"`)

		l := leerJSON[ingresosLeidos](t, c.llamar("GET", "/api/v1/ingresos", ""))
		if l.Periodo != "2026-11" || strings.Join(l.Meses, ",") != "2026-11,2026-10" || l.Total.Entran != "240000000" ||
			l.Total.Registrado != "120000000" || l.Total.Esperado != "120000000" || l.Total.PorConfirmar != 0 {
			t.Errorf("total: %+v", l)
		}
		if got := fuentesLeidas(l); got != "17=240000000[2026-11-01:registrado:120000000,2026-11-16:esperado:120000000]" {
			t.Errorf("fuentes: %s", got)
		}
		if f := l.Fuentes[0].Ingresos; f[0].MovimientoID == nil || f[0].RecurrenteID != nil || f[0].Medio != "transferencia" ||
			f[1].RecurrenteID == nil || *f[1].RecurrenteID != salarioRec || f[1].MovimientoID != nil || f[1].Medio != "transferencia" {
			t.Errorf("filas: %+v", f)
		}

		s.reloj.T = time.Date(2026, 11, 17, 15, 0, 0, 0, time.UTC)
		l = leerJSON[ingresosLeidos](t, c.llamar("GET", "/api/v1/ingresos?periodo=2026-11", ""))
		if got := fuentesLeidas(l); got != "17=240000000[2026-11-01:registrado:120000000,2026-11-16:por_confirmar:120000000]" || l.Total.PorConfirmar != 1 {
			t.Errorf("el 17: %s %+v", got, l.Total)
		}
		if r := c.llamar("POST", "/api/v1/repeticiones/"+salarioRec+"/confirmacion", `{"fecha":"2026-11-16"}`); r.Codigo != 201 {
			t.Fatalf("confirmar: %d %s", r.Codigo, r.Cuerpo)
		}
		l = leerJSON[ingresosLeidos](t, c.llamar("GET", "/api/v1/ingresos", ""))
		if got := fuentesLeidas(l); got != "17=240000000[2026-11-01:registrado:120000000,2026-11-16:registrado:120000000]" ||
			l.Total.Registrado != "240000000" || l.Total.Esperado != "0" || l.Total.PorConfirmar != 0 {
			t.Errorf("confirmado: %s %+v", got, l.Total)
		}
		v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", ""))
		if *v.Resumen.SinAsignar != "236000000" || v.Resumen.LlegaDespues != "0" || len(v.LlegaDespues) != 0 {
			t.Errorf("PN-06 tras confirmar: %+v", v.Resumen)
		}

		octubre := leerJSON[ingresosLeidos](t, c.llamar("GET", "/api/v1/ingresos?periodo=2026-10", ""))
		if got := fuentesLeidas(octubre); got != "18=9000000[2026-10-28:registrado:9000000]" || *octubre.Fuentes[0].Ingresos[0].Descripcion != "Venta de artesanías" {
			t.Errorf("octubre: %s", got)
		}
	})
}

// Las dos lecturas son `requiere_autorizacion`: sin sesión 401, sin autorizar 403 `autorizacion_pendiente`, sin leer nada.
func TestIntegracionLecturasSinSesionYSinAutorizar(t *testing.T) {
	s := nuevoServidor(t)
	sin := s.nuevaPersona("sin@ejemplo.test", false, false)
	for _, ruta := range []string{"/api/v1/presupuestos", "/api/v1/ingresos"} {
		if r := sin.llamar("GET", ruta, ""); r.Codigo != 403 || r.Cuerpo != `{"error":"autorizacion_pendiente"}` {
			t.Errorf("%s sin autorizar: %d %s", ruta, r.Codigo, r.Cuerpo)
		}
		rr := httptest.NewRecorder()
		s.h.ServeHTTP(rr, httptest.NewRequest("GET", ruta, nil))
		if rr.Code != 401 || strings.TrimSpace(rr.Body.String()) != `{"error":"sin_sesion"}` {
			t.Errorf("%s sin sesión: %d %s", ruta, rr.Code, rr.Body)
		}
	}
}
