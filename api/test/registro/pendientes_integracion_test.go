//go:build integration

// Pruebas de punta a punta de la US-60 «Por confirmar» (API) contra PostgreSQL y el enrutador real, de caja negra: se
// entra por HTTP, en web con cookie y en Android con Bearer. Solo datos sintéticos. Las repeticiones se crean con el POST de
// movimientos el 26 de octubre de 2026 y el reloj avanza al 14 de diciembre, el día de PN-72 (E14 2.8).
package registro_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	catSalario     = "17" // Salario (ingreso)
	catArriendo    = "4"
	catSalarioNum  = 17
	hoyDeLaLista   = "2026-12-14T15:00:00Z" // 10:00 en Colombia
	rutaRepeticion = "/api/v1/repeticiones/"
)

func confirmacionDe(id string) string { return rutaRepeticion + id + "/confirmacion" }
func omisionDe(id string) string      { return rutaRepeticion + id + "/omision" }

type porConfirmarVisto struct {
	RecurrenteID          string `json:"recurrente_id"`
	Fecha                 string `json:"fecha"`
	Tipo                  string `json:"tipo"`
	CategoriaID           int    `json:"categoria_id"`
	Medio                 string `json:"medio"`
	MontoHabitualCentavos int64  `json:"monto_habitual_centavos"`
	Periodicidad          string `json:"periodicidad"`
}

type listaPorConfirmarVista struct {
	Pendientes []porConfirmarVisto `json:"pendientes"`
	Resumen    struct {
		Total    int `json:"total"`
		Ingresos int `json:"ingresos"`
		Gastos   int `json:"gastos"`
	} `json:"resumen"`
}

type decididasVistas struct {
	Movimientos []movimientoVisto `json:"movimientos"`
	Omitidas    []struct {
		RecurrenteID string `json:"recurrente_id"`
		Fecha        string `json:"fecha"`
	} `json:"omitidas"`
	SiguenPendientes int `json:"siguen_pendientes"`
	Resumen          struct {
		Guardados        int         `json:"guardados"`
		Omitidas         int         `json:"omitidas"`
		IngresosCentavos json.Number `json:"ingresos_centavos"`
		GastosCentavos   json.Number `json:"gastos_centavos"`
	} `json:"resumen"`
}

func (s *servidorDePrueba) porConfirmar(c *cliente) listaPorConfirmarVista {
	s.t.Helper()
	r := c.llamar("GET", rutaPendientes, "")
	if r.Codigo != 200 || r.Cache != "no-store" {
		s.t.Fatalf("pendientes: %d %s", r.Codigo, r.Cuerpo)
	}
	var l listaPorConfirmarVista
	if err := json.Unmarshal([]byte(r.Cuerpo), &l); err != nil {
		s.t.Fatal(err)
	}
	return l
}

func claves(l listaPorConfirmarVista) string {
	var textos []string
	for _, p := range l.Pendientes {
		textos = append(textos, p.Fecha+":"+p.Tipo[:1])
	}
	return strings.Join(textos, " ")
}

// escenario: el 26 de octubre Laura registra su salario quincenal (hoy, ya confirmado) y su arriendo mensual (desde
// mañana); después el reloj salta al 14 de diciembre. Por confirmar quedan: ingresos 11-11, 11-26 y 12-11 del salario; gastos
// 10-27 y 11-27 del arriendo (12-27 todavía no llega).
func (s *servidorDePrueba) escenario(c *cliente) (salario, arriendo string) {
	s.t.Helper()
	salario = *s.crear(c, cuerpoDe("ingreso", "120000000", "2026-10-26", catSalario, `,"repeticion":{"periodicidad":"quincenal"}`)).RecurrenteID
	arriendo = *s.crear(c, cuerpoDe("gasto", "65000000", "2026-10-27", catArriendo, `,"repeticion":{"periodicidad":"mensual"}`)).RecurrenteID
	s.reloj.T = time.Date(2026, 12, 14, 15, 0, 0, 0, time.UTC)
	// Siete semanas sin entrar vencerían la sesión (30 días de inactividad): la persona de PN-72 sigue dentro.
	if _, err := s.pool.Exec(context.Background(), `UPDATE sesion SET ultimo_uso_en = $1::timestamptz, vence_en = $1::timestamptz + interval '30 days'`, s.reloj.T); err != nil {
		s.t.Fatal(err)
	}
	return salario, arriendo
}

func TestUS60ListaLasFechasQueYaLlegaronYSuResumen(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		salario, arriendo := s.escenario(c)
		l := s.porConfirmar(c)
		if got := claves(l); got != "2026-10-27:g 2026-11-11:i 2026-11-26:i 2026-11-27:g 2026-12-11:i" {
			t.Errorf("fechas: %s", got)
		}
		if l.Resumen.Total != 5 || l.Resumen.Ingresos != 3 || l.Resumen.Gastos != 2 {
			t.Errorf("resumen: %+v", l.Resumen)
		}
		if p := l.Pendientes[0]; p.RecurrenteID != arriendo || p.CategoriaID != 4 || p.Medio != "transferencia" || p.MontoHabitualCentavos != 65000000 || p.Periodicidad != "mensual" {
			t.Errorf("fila: %+v", p)
		}
		if p := l.Pendientes[1]; p.RecurrenteID != salario || p.CategoriaID != catSalarioNum || p.MontoHabitualCentavos != 120000000 || p.Periodicidad != "quincenal" {
			t.Errorf("fila: %+v", p)
		}
	})
}

// D-094: confirmada con atraso, la fecha del movimiento es la programada y cuenta en su mes, no en el de la confirmación.
func TestUS60ConfirmarGuardaLaFechaProgramadaYSaleDeLaLista(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)
		salario, _ := s.escenario(c)

		r := c.llamar("POST", confirmacionDe(salario), `{"fecha":"2026-11-26"}`)
		if r.Codigo != 201 || r.Cache != "no-store" {
			t.Fatalf("confirmar: %d %s", r.Codigo, r.Cuerpo)
		}
		var m movimientoVisto
		if err := json.Unmarshal([]byte(r.Cuerpo), &m); err != nil {
			t.Fatal(err)
		}
		if m.Tipo != "ingreso" || m.MontoCentavos != 120000000 || m.Fecha != "2026-11-26" || m.Medio != "transferencia" || m.Compartido ||
			m.CategoriaID == nil || *m.CategoriaID != catSalarioNum || m.Recurrente == nil || m.Recurrente.FechaProgramada != "2026-11-26" ||
			m.Recurrente.VuelveAPendiente == nil || !*m.Recurrente.VuelveAPendiente {
			t.Errorf("movimiento: %+v", m)
		}
		var creadoEn time.Time
		var fecha, programada time.Time
		if err := s.pool.QueryRow(context.Background(), `SELECT fecha, fecha_programada, creado_en FROM movimiento WHERE id = $1::uuid AND persona_id = $2::uuid`, m.ID, persona).
			Scan(&fecha, &programada, &creadoEn); err != nil {
			t.Fatal(err)
		}
		if fecha.Format(time.DateOnly) != "2026-11-26" || programada.Format(time.DateOnly) != "2026-11-26" || !creadoEn.Equal(s.reloj.T) {
			t.Errorf("fila: fecha %v, programada %v, creado %v", fecha, programada, creadoEn)
		}
		if l := s.lista(c, "?periodo=2026-11"); !strings.Contains(ids(l), m.ID) {
			t.Errorf("cuenta en noviembre: %s", ids(l))
		}
		if l := s.lista(c, "?periodo=2026-12"); strings.Contains(ids(l), m.ID) {
			t.Errorf("no cuenta en diciembre, el mes de la confirmación: %s", ids(l))
		}
		if got := s.detalle(c, m.ID); got.Recurrente == nil || got.Recurrente.RecurrenteID != salario {
			t.Errorf("detalle: %+v", got)
		}
		if got := claves(s.porConfirmar(c)); got != "2026-10-27:g 2026-11-11:i 2026-11-27:g 2026-12-11:i" {
			t.Errorf("la fecha confirmada sale de la lista: %s", got)
		}
		// Confirmarla otra vez es un 409 claro y no crea otro movimiento.
		if r := c.llamar("POST", confirmacionDe(salario), `{"fecha":"2026-11-26"}`); r.Codigo != 409 || r.Cuerpo != `{"error":"fecha_no_pendiente"}` {
			t.Errorf("otra vez: %d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE fecha_programada = '2026-11-26'`); n != 1 {
			t.Errorf("movimientos de esa fecha: %d", n)
		}
	})
}

func TestUS60ConfirmarConOtroMontoEsSoloParaEsaFecha(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		salario, _ := s.escenario(c)
		r := c.llamar("POST", confirmacionDe(salario), `{"fecha":"2026-12-11","monto_centavos":110000000}`)
		if r.Codigo != 201 || !strings.Contains(r.Cuerpo, `"monto_centavos":110000000`) {
			t.Fatalf("%d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento_recurrente WHERE id = $1::uuid AND monto_habitual = 120000000`, salario); n != 1 {
			t.Errorf("el monto habitual no cambia: %d", n)
		}
		for _, p := range s.porConfirmar(c).Pendientes {
			if p.RecurrenteID == salario && p.MontoHabitualCentavos != 120000000 {
				t.Errorf("las demás siguen igual: %+v", p)
			}
		}
	})
}

// D-092: «No pasó» guarda la fecha omitida, no crea ningún movimiento, y una fecha omitida y una confirmada son exclusivas.
func TestUS60OmitirNoCreaMovimientoYEsExclusivaConConfirmar(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		salario, arriendo := s.escenario(c)
		antes := s.contar(`SELECT count(*) FROM movimiento`)

		if r := c.llamar("POST", omisionDe(arriendo), `{"fecha":"2026-10-27"}`); r.Codigo != 204 || r.Cuerpo != "" {
			t.Fatalf("omitir: %d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento`); n != antes {
			t.Errorf("«No pasó» no crea movimientos: %d → %d", antes, n)
		}
		if n := s.contar(`SELECT count(*) FROM ocurrencia_omitida WHERE recurrente_id = $1::uuid AND fecha_programada = '2026-10-27'`, arriendo); n != 1 {
			t.Errorf("fecha omitida: %d", n)
		}
		if got := claves(s.porConfirmar(c)); got != "2026-11-11:i 2026-11-26:i 2026-11-27:g 2026-12-11:i" {
			t.Errorf("no se ofrece otra vez y las demás siguen: %s", got)
		}
		for nombre, r := range map[string]respuesta{
			"confirmar la omitida": c.llamar("POST", confirmacionDe(arriendo), `{"fecha":"2026-10-27"}`),
			"omitir otra vez":      c.llamar("POST", omisionDe(arriendo), `{"fecha":"2026-10-27"}`),
			"omitir la confirmada": c.llamar("POST", omisionDe(salario), `{"fecha":"2026-10-26"}`),
			"fecha futura":         c.llamar("POST", omisionDe(arriendo), `{"fecha":"2026-12-27"}`),
		} {
			if r.Codigo != 409 || r.Cuerpo != `{"error":"fecha_no_pendiente"}` {
				t.Errorf("%s: %d %s", nombre, r.Codigo, r.Cuerpo)
			}
		}
		if n := s.contar(`SELECT count(*) FROM movimiento`); n != antes {
			t.Errorf("nada más se guardó: %d", n)
		}
	})
}

// El FP-17 con lo que hay: una «No pasó», un monto cambiado y el resto marcado; una fecha sin marcar sigue pendiente (FP-18).
func TestUS60ConfirmarVariasGuardaLoMarcadoOmiteYCuenta(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		salario, arriendo := s.escenario(c)
		cuerpo := fmt.Sprintf(`{"decisiones":[
			{"recurrente_id":%q,"fecha":"2026-10-27","omitida":true},
			{"recurrente_id":%q,"fecha":"2026-11-27"},
			{"recurrente_id":%q,"fecha":"2026-11-11"},
			{"recurrente_id":%q,"fecha":"2026-12-11","monto_centavos":110000000}]}`, arriendo, arriendo, salario, salario)
		r := c.llamar("POST", rutaDecisiones, cuerpo)
		if r.Codigo != 200 || r.Cache != "no-store" {
			t.Fatalf("%d %s", r.Codigo, r.Cuerpo)
		}
		var res decididasVistas
		if err := json.Unmarshal([]byte(r.Cuerpo), &res); err != nil {
			t.Fatal(err)
		}
		if len(res.Movimientos) != 3 || len(res.Omitidas) != 1 || res.SiguenPendientes != 1 || res.Resumen.Guardados != 3 || res.Resumen.Omitidas != 1 ||
			res.Resumen.IngresosCentavos.String() != "230000000" || res.Resumen.GastosCentavos.String() != "65000000" {
			t.Fatalf("resultado: %s", r.Cuerpo)
		}
		if res.Omitidas[0].RecurrenteID != arriendo || res.Omitidas[0].Fecha != "2026-10-27" {
			t.Errorf("omitida: %+v", res.Omitidas)
		}
		if m := res.Movimientos[0]; m.Fecha != "2026-11-27" || m.MontoCentavos != 65000000 || m.Tipo != "gasto" {
			t.Errorf("el primero: %+v", m)
		}
		if m := res.Movimientos[2]; m.Fecha != "2026-12-11" || m.MontoCentavos != 110000000 {
			t.Errorf("el cambiado: %+v", m)
		}
		for _, m := range res.Movimientos {
			if got := s.detalle(c, m.ID); got.Recurrente == nil || got.Fecha != got.Recurrente.FechaProgramada {
				t.Errorf("cada una con su fecha programada: %+v", got)
			}
		}
		if got := claves(s.porConfirmar(c)); got != "2026-11-26:i" {
			t.Errorf("lo desmarcado sigue pendiente: %s", got)
		}
		if n := s.contar(`SELECT count(*) FROM ocurrencia_omitida`); n != 1 {
			t.Errorf("fechas omitidas: %d", n)
		}
	})
}

// «No se guardó ninguno» (E14 4.8, FP-19 a FP-21): una decisión inválida no deja guardada ni la válida, ni una «No pasó».
func TestUS60ConfirmarVariasEsTodoONadaEnLaBase(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		salario, arriendo := s.escenario(c)
		antes := s.contar(`SELECT count(*) FROM movimiento`)
		valida := fmt.Sprintf(`{"recurrente_id":%q,"fecha":"2026-11-11"}`, salario)
		omitida := fmt.Sprintf(`{"recurrente_id":%q,"fecha":"2026-10-27","omitida":true}`, arriendo)
		casos := map[string]struct {
			decisiones []string
			codigo     int
		}{
			"FP-19 ya confirmada":  {[]string{valida, omitida, fmt.Sprintf(`{"recurrente_id":%q,"fecha":"2026-10-26"}`, salario)}, 409},
			"FP-20 dos decisiones": {[]string{valida, omitida, fmt.Sprintf(`{"recurrente_id":%q,"fecha":"2026-11-11","omitida":true}`, salario)}, 409},
			"FP-21 monto en cero":  {[]string{valida, omitida, fmt.Sprintf(`{"recurrente_id":%q,"fecha":"2026-11-27","monto_centavos":0}`, arriendo)}, 422},
			"futura":               {[]string{valida, omitida, fmt.Sprintf(`{"recurrente_id":%q,"fecha":"2026-12-27"}`, arriendo)}, 409},
		}
		for nombre, caso := range casos {
			r := c.llamar("POST", rutaDecisiones, `{"decisiones":[`+strings.Join(caso.decisiones, ",")+`]}`)
			if r.Codigo != caso.codigo {
				t.Errorf("%s: %d %s", nombre, r.Codigo, r.Cuerpo)
			}
			if n := s.contar(`SELECT count(*) FROM movimiento`); n != antes {
				t.Errorf("%s: se guardó algo: %d → %d", nombre, antes, n)
			}
			if n := s.contar(`SELECT count(*) FROM ocurrencia_omitida`); n != 0 {
				t.Errorf("%s: se omitió algo: %d", nombre, n)
			}
		}
		if got := claves(s.porConfirmar(c)); !strings.HasPrefix(got, "2026-10-27:g") {
			t.Errorf("todo sigue pendiente: %s", got)
		}
	})
}

// Si la base rechaza una fecha a mitad de la operación (aquí, una fecha que otra petición ya omitió después de que
// el servicio leyó), el repositorio deshace todo y responde el mismo 409: nada queda a medias.
func TestUS60UnaFechaQueCambiaDeEstadoAMitadDeLaOperacionDeshaceTodo(t *testing.T) {
	s := nuevoServidor(t)
	c, _ := s.nuevaCuenta("laura@ejemplo.test", false, true)
	salario, arriendo := s.escenario(c)
	antes := s.contar(`SELECT count(*) FROM movimiento`)
	// Un disparador de prueba omite la fecha del arriendo justo después de insertar la primera confirmación: simula
	// la otra petición que ganó la carrera.
	if _, err := s.pool.Exec(context.Background(), fmt.Sprintf(`
		CREATE FUNCTION fn_prueba_carrera() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			INSERT INTO ocurrencia_omitida (recurrente_id, fecha_programada) VALUES ('%s'::uuid, '2026-11-27') ON CONFLICT DO NOTHING;
			RETURN NEW;
		END $$;
		CREATE TRIGGER tr_prueba_carrera AFTER INSERT ON movimiento FOR EACH ROW WHEN (NEW.fecha_programada = '2026-11-11')
			EXECUTE FUNCTION fn_prueba_carrera();`, arriendo)); err != nil {
		t.Fatal(err)
	}
	cuerpo := fmt.Sprintf(`{"decisiones":[{"recurrente_id":%q,"fecha":"2026-11-11"},{"recurrente_id":%q,"fecha":"2026-11-27"}]}`, salario, arriendo)
	if r := c.llamar("POST", rutaDecisiones, cuerpo); r.Codigo != 409 || r.Cuerpo != `{"error":"fecha_no_pendiente"}` {
		t.Fatalf("%d %s", r.Codigo, r.Cuerpo)
	}
	if n := s.contar(`SELECT count(*) FROM movimiento`); n != antes {
		t.Errorf("la primera confirmación se deshizo: %d → %d", antes, n)
	}
	if n := s.contar(`SELECT count(*) FROM ocurrencia_omitida`); n != 0 {
		t.Errorf("y la omisión de la carrera también (misma transacción): %d", n)
	}
}

// pedirALaVez lanza `n` pedidos al mismo tiempo, sin tocar el contador de direcciones (no es seguro entre goroutines), y
// devuelve los códigos.
func (s *servidorDePrueba) pedirALaVez(c *cliente, pedidos []func() (string, string, string)) []string {
	var espera sync.WaitGroup
	comenzar := make(chan struct{})
	codigos := make([]string, len(pedidos))
	for i, p := range pedidos {
		espera.Add(1)
		go func() {
			defer espera.Done()
			<-comenzar
			metodo, ruta, cuerpo := p()
			r := c.enviar(metodo, ruta, cuerpo, "10.9.9.9:1", true)
			codigos[i] = fmt.Sprintf("%d %s", r.Codigo, r.Cuerpo)
		}()
	}
	close(comenzar)
	espera.Wait()
	return codigos
}

// Confirmar la misma fecha dos veces a la vez (dos pedidos): un solo movimiento y un 409 claro, nunca un 500.
func TestUS60ConfirmarLaMismaFechaALaVezCreaUnSoloMovimiento(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		salario, _ := s.escenario(c)
		for ronda, fecha := range []string{"2026-11-11", "2026-11-26", "2026-12-11"} {
			pedidos := make([]func() (string, string, string), 8)
			for i := range pedidos {
				pedidos[i] = func() (string, string, string) { return "POST", confirmacionDe(salario), `{"fecha":"` + fecha + `"}` }
			}
			creados, conflictos := 0, 0
			for _, codigo := range s.pedirALaVez(c, pedidos) {
				switch {
				case strings.HasPrefix(codigo, "201 "):
					creados++
				case codigo == `409 {"error":"fecha_no_pendiente"}`:
					conflictos++
				default:
					t.Errorf("ronda %d: %s", ronda, codigo)
				}
			}
			if creados != 1 || conflictos != 7 {
				t.Errorf("ronda %d: %d creados y %d conflictos", ronda, creados, conflictos)
			}
			if n := s.contar(`SELECT count(*) FROM movimiento WHERE recurrente_id = $1::uuid AND fecha_programada = $2`, salario, fecha); n != 1 {
				t.Errorf("ronda %d: movimientos de %s: %d", ronda, fecha, n)
			}
		}
	})
}

// Confirmar y omitir la misma fecha a la vez: gana uno solo y la fecha no queda confirmada y omitida (los disparadores de E13
// serializan por la fila de la repetición).
func TestUS60ConfirmarYOmitirALaVezEsExclusivo(t *testing.T) {
	s := nuevoServidor(t)
	c, _ := s.nuevaCuenta("laura@ejemplo.test", true, true)
	salario, _ := s.escenario(c)
	for _, fecha := range []string{"2026-11-11", "2026-11-26", "2026-12-11"} {
		pedidos := make([]func() (string, string, string), 8)
		for i := range pedidos {
			if i%2 == 0 {
				pedidos[i] = func() (string, string, string) { return "POST", confirmacionDe(salario), `{"fecha":"` + fecha + `"}` }
			} else {
				pedidos[i] = func() (string, string, string) { return "POST", omisionDe(salario), `{"fecha":"` + fecha + `"}` }
			}
		}
		exitos := 0
		for _, codigo := range s.pedirALaVez(c, pedidos) {
			switch {
			case strings.HasPrefix(codigo, "201 "), codigo == "204 ":
				exitos++
			case codigo == `409 {"error":"fecha_no_pendiente"}`:
			default:
				t.Errorf("%s: %s", fecha, codigo)
			}
		}
		confirmadas := s.contar(`SELECT count(*) FROM movimiento WHERE recurrente_id = $1::uuid AND fecha_programada = $2`, salario, fecha)
		omitidas := s.contar(`SELECT count(*) FROM ocurrencia_omitida WHERE recurrente_id = $1::uuid AND fecha_programada = $2`, salario, fecha)
		if exitos != 1 || confirmadas+omitidas != 1 {
			t.Errorf("%s: %d éxitos, %d confirmadas y %d omitidas", fecha, exitos, confirmadas, omitidas)
		}
	}
}

// Dos «Confirmar todos» a la vez con las mismas fechas: uno guarda todo y el otro no guarda nada.
func TestUS60DosConfirmarTodosALaVezGuardanUnoSolo(t *testing.T) {
	s := nuevoServidor(t)
	c, _ := s.nuevaCuenta("laura@ejemplo.test", false, true)
	salario, arriendo := s.escenario(c)
	cuerpo := fmt.Sprintf(`{"decisiones":[{"recurrente_id":%q,"fecha":"2026-11-11"},{"recurrente_id":%q,"fecha":"2026-11-27"},{"recurrente_id":%q,"fecha":"2026-10-27","omitida":true}]}`, salario, arriendo, arriendo)
	pedidos := make([]func() (string, string, string), 6)
	for i := range pedidos {
		pedidos[i] = func() (string, string, string) { return "POST", rutaDecisiones, cuerpo }
	}
	exitos := 0
	for _, codigo := range s.pedirALaVez(c, pedidos) {
		switch {
		case strings.HasPrefix(codigo, "200 "):
			exitos++
		case codigo == `409 {"error":"fecha_no_pendiente"}`:
		default:
			t.Error(codigo)
		}
	}
	if exitos != 1 || s.contar(`SELECT count(*) FROM movimiento WHERE fecha_programada IN ('2026-11-11', '2026-11-27')`) != 2 ||
		s.contar(`SELECT count(*) FROM ocurrencia_omitida`) != 1 {
		t.Errorf("%d éxitos", exitos)
	}
}

// Autorización de datos: la repetición de otra persona es un 404 (igual que una que no existe), no se lista y no cambia.
func TestUS60LaRepeticionDeOtraPersonaEsUn404YNoSeLista(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		laura, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		salario, arriendo := s.escenario(laura)
		otra, _ := s.nuevaCuenta("otra@ejemplo.test", android, true)

		if l := s.porConfirmar(otra); l.Resumen.Total != 0 || len(l.Pendientes) != 0 {
			t.Errorf("la otra persona no ve nada: %+v", l)
		}
		inexistente := "0192f3c4-0000-7000-8000-0000000000ee"
		antes := s.contar(`SELECT count(*) FROM movimiento`)
		for nombre, id := range map[string]string{"de Laura": salario, "inexistente": inexistente, "mal formado": "x"} {
			for ruta, cuerpo := range map[string]string{confirmacionDe(id): `{"fecha":"2026-11-11"}`, omisionDe(id): `{"fecha":"2026-11-11"}`} {
				if r := otra.llamar("POST", ruta, cuerpo); r.Codigo != 404 || r.Cuerpo != `{"error":"no_encontrado"}` {
					t.Errorf("%s %s: %d %s", nombre, ruta, r.Codigo, r.Cuerpo)
				}
			}
		}
		mezcla := fmt.Sprintf(`{"decisiones":[{"recurrente_id":%q,"fecha":"2026-11-11"},{"recurrente_id":%q,"fecha":"2026-11-27"}]}`, arriendo, salario)
		if r := otra.llamar("POST", rutaDecisiones, mezcla); r.Codigo != 404 || r.Cuerpo != `{"error":"no_encontrado"}` {
			t.Errorf("decisiones: %d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento`); n != antes || s.contar(`SELECT count(*) FROM ocurrencia_omitida`) != 0 {
			t.Errorf("nada cambió: %d → %d", antes, n)
		}
		if l := s.porConfirmar(laura); l.Resumen.Total != 5 {
			t.Errorf("las de Laura siguen: %+v", l.Resumen)
		}
	})
}

// Una repetición del hogar (sin dueña) no es de nadie para confirmar: E14 4.8, «Puede confirmar quien registró el recurrente».
func TestUS60LaRepeticionDeUnHogarNoSeOfrece(t *testing.T) {
	s := nuevoServidor(t)
	c, persona := s.nuevaCuenta("laura@ejemplo.test", false, true)
	hogar := s.sembrarHogar(persona)
	var id string
	if err := s.pool.QueryRow(context.Background(), `INSERT INTO movimiento_recurrente (hogar_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio, creado_en)
		VALUES ($1::uuid, 'gasto', 4, 'mensual', 100, 'efectivo', '2026-10-01', '2026-10-01') RETURNING id::text`, hogar).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if l := s.porConfirmar(c); l.Resumen.Total != 0 {
		t.Errorf("no se ofrece: %+v", l)
	}
	if r := c.llamar("POST", confirmacionDe(id), `{"fecha":"2026-11-01"}`); r.Codigo != 404 {
		t.Errorf("%d %s", r.Codigo, r.Cuerpo)
	}
}

// `detenido_en` corta las fechas desde ese día (E15 5.2): la fecha detenida ya no se ofrece ni se confirma.
func TestUS60LaRepeticionDetenidaNoOfreceFechasDesdeElDiaQueSeDetuvo(t *testing.T) {
	s := nuevoServidor(t)
	c, _ := s.nuevaCuenta("laura@ejemplo.test", false, true)
	salario, _ := s.escenario(c)
	if _, err := s.pool.Exec(context.Background(), `UPDATE movimiento_recurrente SET detenido_en = '2026-11-26' WHERE id = $1::uuid`, salario); err != nil {
		t.Fatal(err)
	}
	if got := claves(s.porConfirmar(c)); got != "2026-10-27:g 2026-11-11:i 2026-11-27:g" {
		t.Errorf("fechas: %s", got)
	}
	if r := c.llamar("POST", confirmacionDe(salario), `{"fecha":"2026-11-26"}`); r.Codigo != 409 {
		t.Errorf("%d %s", r.Codigo, r.Cuerpo)
	}
}

// Una categoría que la persona ocultó después no impide confirmar: el movimiento conserva su categoría (RN-011).
func TestUS60ConfirmarConLaCategoriaOcultaGuardaIgual(t *testing.T) {
	s := nuevoServidor(t)
	c, persona := s.nuevaCuenta("laura@ejemplo.test", false, true)
	_, arriendo := s.escenario(c)
	if _, err := s.pool.Exec(context.Background(), `INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, 4)`, persona); err != nil {
		t.Fatal(err)
	}
	if r := c.llamar("POST", confirmacionDe(arriendo), `{"fecha":"2026-11-27"}`); r.Codigo != 201 {
		t.Errorf("%d %s", r.Codigo, r.Cuerpo)
	}
}

func TestUS60LasRutasNuevasExigenAutorizacion(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		id := "0192f3c4-0000-7000-8000-0000000000ee"
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, false)
		for _, p := range [][3]string{
			{"GET", rutaPendientes, ""}, {"POST", confirmacionDe(id), `{"fecha":"2026-11-11"}`},
			{"POST", omisionDe(id), `{"fecha":"2026-11-11"}`}, {"POST", rutaDecisiones, `{"decisiones":[]}`},
		} {
			if r := c.llamar(p[0], p[1], p[2]); r.Codigo != 403 || r.Cuerpo != `{"error":"autorizacion_pendiente"}` {
				t.Errorf("%s %s sin autorizar: %d %s", p[0], p[1], r.Codigo, r.Cuerpo)
			}
			if r := (&cliente{s: s, android: android}).llamar(p[0], p[1], p[2]); r.Codigo != 401 || r.Cuerpo != `{"error":"sin_sesion"}` {
				t.Errorf("%s %s sin sesión: %d %s", p[0], p[1], r.Codigo, r.Cuerpo)
			}
		}
	})
}

// E17 3.15, paso 52: cada POST de la US-60, de punta a punta, con cada caso de la defensa contra CSRF. Un rechazo no cambia nada.
func TestUS60CadaPOSTCumpleLaDefensaContraCSRF(t *testing.T) {
	s := nuevoServidor(t)
	web, _ := s.nuevaCuenta("laura@ejemplo.test", false, true)
	salario, arriendo := s.escenario(web)
	rutas := []struct{ ruta, cuerpo string }{
		{confirmacionDe(salario), `{"fecha":"2026-11-11"}`},
		{omisionDe(arriendo), `{"fecha":"2026-10-27"}`},
		{rutaDecisiones, fmt.Sprintf(`{"decisiones":[{"recurrente_id":%q,"fecha":"2026-11-26"}]}`, salario)},
	}
	con := func(k ...string) func(*http.Request) {
		return func(r *http.Request) {
			for i := 0; i < len(k); i += 2 {
				r.Header.Set(k[i], k[i+1])
			}
		}
	}
	sinCabeceras := func(r *http.Request) {
		r.Header.Del("Authorization")
		r.Header.Del("X-Alcanzamos-Cliente")
		r.Header.Del("Sec-Fetch-Site")
	}
	rechazos := []struct {
		nombre string
		codigo int
		ajuste []func(*http.Request)
	}{
		{"cross-site", 403, []func(*http.Request){con("Sec-Fetch-Site", "cross-site", "Content-Type", "application/json")}},
		{"same-site", 403, []func(*http.Request){con("Sec-Fetch-Site", "same-site", "Content-Type", "application/json")}},
		{"Origin ajeno", 403, []func(*http.Request){sinCabeceras, con("Origin", "https://otro.test", "Content-Type", "application/json")}},
		{"sin Sec-Fetch-Site, Origin ni cliente", 403, []func(*http.Request){sinCabeceras, con("Content-Type", "application/json")}},
		{"text/plain", 415, []func(*http.Request){con("Sec-Fetch-Site", "same-origin", "Content-Type", "text/plain")}},
		{"sin Content-Type", 415, []func(*http.Request){func(r *http.Request) { r.Header.Del("Content-Type") }}},
	}
	for _, p := range rutas {
		for _, c := range rechazos {
			antes := s.contar(`SELECT (SELECT count(*) FROM movimiento) + (SELECT count(*) FROM ocurrencia_omitida)`)
			if r := web.enviar("POST", p.ruta, p.cuerpo, "10.8.8.8:1", true, c.ajuste...); r.Codigo != c.codigo {
				t.Errorf("%s %s: %d %s", p.ruta, c.nombre, r.Codigo, r.Cuerpo)
			}
			if n := s.contar(`SELECT (SELECT count(*) FROM movimiento) + (SELECT count(*) FROM ocurrencia_omitida)`); n != antes {
				t.Errorf("%s %s: el rechazo cambió datos", p.ruta, c.nombre)
			}
		}
	}
	// Los casos válidos de cada cliente: la web con `same-origin`, la web con `Origin` igual a URL_PUBLICA y Android.
	android, _ := s.nuevaCuenta("android@ejemplo.test", true, true)
	_, arriendoA := s.escenarioDeOtra(android)
	validos := []struct {
		nombre string
		c      *cliente
		ruta   string
		cuerpo string
		ajuste []func(*http.Request)
	}{
		{"web same-origin", web, confirmacionDe(salario), `{"fecha":"2026-11-11"}`, nil},
		{"web Origin de URL_PUBLICA", web, omisionDe(arriendo), `{"fecha":"2026-10-27"}`,
			[]func(*http.Request){func(r *http.Request) { r.Header.Del("Sec-Fetch-Site"); r.Header.Set("Origin", "https://app.ej.test") }}},
		{"Android", android, omisionDe(arriendoA), `{"fecha":"2026-12-14"}`, nil},
	}
	for _, v := range validos {
		r := v.c.enviar("POST", v.ruta, v.cuerpo, "10.8.8.9:1", true, v.ajuste...)
		if r.Codigo != 201 && r.Codigo != 204 {
			t.Errorf("%s: %d %s", v.nombre, r.Codigo, r.Cuerpo)
		}
	}
	// y por decisiones con Android
	if r := android.enviar("POST", rutaDecisiones, `{"decisiones":[]}`, "10.8.8.10:1", true); r.Codigo != 422 {
		t.Errorf("Android pasa la defensa y llega a la validación: %d %s", r.Codigo, r.Cuerpo)
	}
}

// escenarioDeOtra crea, con el reloj ya en diciembre, dos repeticiones con fecha de hoy y deja pendiente la de hoy de la
// segunda (borra su movimiento: D-168 la devuelve a pendiente), para que una persona de Android pueda omitirla.
func (s *servidorDePrueba) escenarioDeOtra(c *cliente) (salario, arriendo string) {
	s.t.Helper()
	salario = *s.crear(c, cuerpoDe("ingreso", "120000000", "2026-12-14", catSalario, `,"repeticion":{"periodicidad":"mensual"}`)).RecurrenteID
	arriendo = *s.crear(c, cuerpoDe("gasto", "65000000", "2026-12-14", catArriendo, `,"repeticion":{"periodicidad":"semanal"}`)).RecurrenteID
	if _, err := s.pool.Exec(context.Background(), `DELETE FROM movimiento WHERE recurrente_id = $1::uuid`, arriendo); err != nil {
		s.t.Fatal(err)
	}
	return salario, arriendo
}
