package fechas_test

import (
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
)

func d(anio int, mes time.Month, dia int) time.Time { return fechas.Dia(anio, mes, dia) }

func lista(fs []time.Time) []string {
	textos := make([]string, len(fs))
	for i, f := range fs {
		textos[i] = f.Format(time.DateOnly)
	}
	return textos
}

func iguales(t *testing.T, obtenidas []time.Time, esperadas ...string) {
	t.Helper()
	if !slices.Equal(lista(obtenidas), esperadas) {
		t.Errorf("fechas %v, se esperaba %v", lista(obtenidas), esperadas)
	}
}

// Los casos FP-01 a FP-16 de la prueba de escritorio de E15 5.2 (FP-17 a FP-23 son de ConfirmarVarias y de
// FechaDelMovimiento, que no son de esta historia).
func TestFechasProgramadasYPendientesSegunE15(t *testing.T) {
	casos := []struct {
		id          string
		p           fechas.Periodicidad
		inicio      time.Time
		periodo     time.Time
		confirmadas []time.Time
		omitidas    []time.Time
		esperadas   []string
		error       error
	}{
		{id: "FP-01", p: fechas.Quincenal, inicio: d(2026, 10, 1), periodo: d(2026, 11, 1), esperadas: []string{"2026-11-01", "2026-11-16"}},
		{id: "FP-02", p: fechas.Semanal, inicio: d(2026, 10, 5), periodo: d(2026, 11, 1),
			esperadas: []string{"2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"}},
		{id: "FP-03", p: fechas.Mensual, inicio: d(2026, 1, 31), periodo: d(2026, 2, 1), esperadas: []string{"2026-02-28"}},
		{id: "FP-04", p: fechas.Semestral, inicio: d(2026, 6, 30), periodo: d(2026, 12, 1), esperadas: []string{"2026-12-30"}},
		{id: "FP-05", p: fechas.Semestral, inicio: d(2026, 6, 30), periodo: d(2026, 9, 1), esperadas: []string{}},
		{id: "FP-06", p: fechas.Anual, inicio: d(2026, 1, 31), periodo: d(2027, 1, 1), esperadas: []string{"2027-01-31"}},
		{id: "FP-07", p: fechas.Mensual, inicio: d(2026, 12, 10), periodo: d(2026, 11, 1), esperadas: []string{}},
		{id: "FP-08", p: fechas.Quincenal, inicio: d(2026, 10, 16), periodo: d(2026, 11, 1), esperadas: []string{"2026-11-01", "2026-11-16"}},
		{id: "FP-09", p: fechas.Quincenal, inicio: d(2026, 10, 15), periodo: d(2027, 2, 1), esperadas: []string{"2027-02-15", "2027-02-28"}},
		{id: "FP-10", p: fechas.Quincenal, inicio: d(2026, 11, 16), periodo: d(2026, 11, 1), esperadas: []string{"2026-11-16"}},
		{id: "FP-13", p: fechas.Quincenal, inicio: d(2026, 10, 1), periodo: d(2026, 11, 1),
			confirmadas: []time.Time{d(2026, 11, 1)}, omitidas: []time.Time{d(2026, 11, 16)}, esperadas: []string{}},
		{id: "FP-14", p: fechas.Quincenal, inicio: d(2026, 10, 1), periodo: d(2026, 12, 1),
			omitidas: []time.Time{d(2026, 12, 1)}, esperadas: []string{"2026-12-16"}},
		{id: "FP-15", p: fechas.Quincenal, inicio: d(2026, 10, 1), periodo: d(2026, 11, 1),
			omitidas: []time.Time{d(2026, 11, 17)}, esperadas: []string{"2026-11-01", "2026-11-16"}},
		{id: "FP-16", p: fechas.Quincenal, inicio: d(2026, 10, 1), periodo: d(2026, 11, 1),
			confirmadas: []time.Time{d(2026, 11, 16)}, omitidas: []time.Time{d(2026, 11, 16)}, error: fechas.ErrFechaConfirmadaYOmitida},
		{id: "FP-11", p: "diaria", inicio: d(2026, 10, 1), periodo: d(2026, 11, 1), error: fechas.ErrPeriodicidadDesconocida},
		{id: "FP-12", p: fechas.Mensual, inicio: d(2026, 10, 1), periodo: d(2026, 11, 15), error: fechas.ErrPeriodoInvalido},
	}
	for _, c := range casos {
		t.Run(c.id, func(t *testing.T) {
			// Con creadoEl en el inicio, Pendientes aplica solo confirmadas y omitidas; sin ellas es Programadas.
			var obtenidas []time.Time
			var err error
			if c.confirmadas == nil && c.omitidas == nil {
				obtenidas, err = fechas.Programadas(c.p, c.inicio, c.periodo)
			} else {
				obtenidas, err = fechas.Pendientes(c.p, c.inicio, c.periodo, c.confirmadas, c.omitidas, c.inicio, nil)
			}
			if !errors.Is(err, c.error) {
				t.Fatalf("error %v, se esperaba %v", err, c.error)
			}
			if c.error == nil {
				iguales(t, obtenidas, c.esperadas...)
			}
			// Pendientes sin confirmadas ni omitidas y creado desde el inicio da lo mismo que Programadas.
			if c.confirmadas == nil && c.omitidas == nil {
				pendientes, err := fechas.Pendientes(c.p, c.inicio, c.periodo, nil, nil, c.inicio, nil)
				if !errors.Is(err, c.error) || (err == nil && !slices.Equal(lista(pendientes), lista(obtenidas))) {
					t.Errorf("Pendientes %v %v, Programadas %v", lista(pendientes), err, lista(obtenidas))
				}
			}
		})
	}
}

// Las fechas anteriores al día en que se creó el recurrente son historia (E15 5.2, D-164); `detenido_en` corta desde ese día.
func TestPendientesDescartaLaHistoriaYLoDetenido(t *testing.T) {
	// Mensual del 15 de agosto, creado el 26 de octubre: septiembre y octubre son historia.
	for mes, quedan := range map[time.Month][]string{time.September: {}, time.October: {}, time.November: {"2026-11-15"}} {
		pendientes, err := fechas.Pendientes(fechas.Mensual, d(2026, 8, 15), d(2026, 1, 1).AddDate(0, int(mes)-1, 0), nil, nil, d(2026, 10, 26), nil)
		if err != nil {
			t.Fatal(err)
		}
		iguales(t, pendientes, quedan...)
	}
	// El día de creación sí cuenta (f ≥ creadoEl).
	pendientes, _ := fechas.Pendientes(fechas.Mensual, d(2026, 10, 26), d(2026, 10, 1), nil, nil, d(2026, 10, 26), nil)
	iguales(t, pendientes, "2026-10-26")
	// detenidoEn: la fecha del día en que se detuvo ya no se propone, la anterior sí.
	detenido := d(2026, 11, 16)
	pendientes, _ = fechas.Pendientes(fechas.Quincenal, d(2026, 10, 1), d(2026, 11, 1), nil, nil, d(2026, 10, 1), &detenido)
	iguales(t, pendientes, "2026-11-01")
}

func TestProgramadasBordes(t *testing.T) {
	casos := []struct {
		nombre  string
		p       fechas.Periodicidad
		inicio  time.Time
		periodo time.Time
		quiere  []string
	}{
		{"quincenal del 31 en abril", fechas.Quincenal, d(2026, 1, 31), d(2026, 4, 1), []string{"2026-04-16", "2026-04-30"}},
		{"quincenal del 30 en febrero", fechas.Quincenal, d(2026, 1, 30), d(2027, 2, 1), []string{"2027-02-15", "2027-02-28"}},
		{"quincenal bisiesto", fechas.Quincenal, d(2026, 1, 30), d(2028, 2, 1), []string{"2028-02-15", "2028-02-29"}},
		{"mensual del 31 en febrero bisiesto", fechas.Mensual, d(2026, 1, 31), d(2028, 2, 1), []string{"2028-02-29"}},
		{"mensual del 31 en un mes de 31", fechas.Mensual, d(2026, 1, 31), d(2026, 3, 1), []string{"2026-03-31"}},
		{"semestral cruza el año", fechas.Semestral, d(2026, 12, 20), d(2027, 6, 1), []string{"2027-06-20"}},
		{"semestral no cae a los cinco meses", fechas.Semestral, d(2026, 12, 20), d(2027, 5, 1), []string{}},
		{"semestral desde antes: el mes anterior al inicio", fechas.Semestral, d(2026, 12, 20), d(2026, 6, 1), []string{}},
		{"semestral del 31 de agosto cae el 28 de febrero", fechas.Semestral, d(2026, 8, 31), d(2027, 2, 1), []string{"2027-02-28"}},
		{"anual del 29 de febrero cae el 28 en año común", fechas.Anual, d(2028, 2, 29), d(2029, 2, 1), []string{"2029-02-28"}},
		{"anual en otro mes", fechas.Anual, d(2026, 1, 31), d(2027, 2, 1), []string{}},
		{"semanal con inicio dentro del mes", fechas.Semanal, d(2026, 11, 10), d(2026, 11, 1), []string{"2026-11-10", "2026-11-17", "2026-11-24"}},
		{"semanal desde hace años", fechas.Semanal, d(2020, 1, 6), d(2026, 11, 1), []string{"2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"}},
		{"semanal que cae el primer día del mes", fechas.Semanal, d(2026, 10, 4), d(2026, 11, 1), []string{"2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			obtenidas, err := fechas.Programadas(c.p, c.inicio, c.periodo)
			if err != nil {
				t.Fatal(err)
			}
			iguales(t, obtenidas, c.quiere...)
		})
	}
}

func TestProximasDesdeHoy(t *testing.T) {
	casos := []struct {
		nombre string
		p      fechas.Periodicidad
		inicio time.Time
		hoy    time.Time
		n      int
		quiere []string
	}{
		// E14-PRR 2.4: el salario quincenal desde el 1 de octubre, a 2 de noviembre.
		{"salario quincenal de PN-03", fechas.Quincenal, d(2026, 10, 1), d(2026, 11, 2), 3, []string{"2026-11-16", "2026-12-01", "2026-12-16"}},
		{"semanal de PN-03", fechas.Semanal, d(2026, 10, 5), d(2026, 11, 2), 3, []string{"2026-11-09", "2026-11-16", "2026-11-23"}},
		{"la fecha de hoy no es próxima", fechas.Mensual, d(2026, 10, 26), d(2026, 10, 26), 3, []string{"2026-11-26", "2026-12-26", "2027-01-26"}},
		{"un inicio futuro es la primera próxima", fechas.Mensual, d(2026, 11, 1), d(2026, 10, 26), 3, []string{"2026-11-01", "2026-12-01", "2027-01-01"}},
		{"el arriendo del 15 de agosto", fechas.Mensual, d(2026, 8, 15), d(2026, 10, 26), 3, []string{"2026-11-15", "2026-12-15", "2027-01-15"}},
		{"semestral de PN-03", fechas.Semestral, d(2026, 12, 20), d(2026, 11, 2), 3, []string{"2026-12-20", "2027-06-20", "2027-12-20"}},
		{"anual de PN-03", fechas.Anual, d(2027, 1, 31), d(2026, 11, 2), 2, []string{"2027-01-31", "2028-01-31"}},
		{"anual con tres", fechas.Anual, d(2026, 3, 10), d(2026, 10, 26), 3, []string{"2027-03-10", "2028-03-10", "2029-03-10"}},
		{"un 31 mensual cae el último día del mes corto", fechas.Mensual, d(2026, 1, 31), d(2026, 1, 31), 3, []string{"2026-02-28", "2026-03-31", "2026-04-30"}},
		{"sin fechas pedidas", fechas.Mensual, d(2026, 1, 31), d(2026, 1, 31), 0, nil},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			obtenidas, err := fechas.Proximas(c.p, c.inicio, c.hoy, c.n)
			if err != nil {
				t.Fatal(err)
			}
			iguales(t, obtenidas, c.quiere...)
		})
	}
	if _, err := fechas.Proximas("diaria", d(2026, 1, 1), d(2026, 1, 1), 3); !errors.Is(err, fechas.ErrPeriodicidadDesconocida) {
		t.Errorf("periodicidad desconocida: %v", err)
	}
}

// El caso del dueño (S4, D-164) sin base de datos: lo pendiente que ya llegó es solo lo que cae desde el día de creación.
func TestPorConfirmar(t *testing.T) {
	hoy := d(2026, 10, 26)
	casos := []struct {
		nombre      string
		p           fechas.Periodicidad
		inicio      time.Time
		confirmadas []time.Time
		quiere      []string
	}{
		{"el arriendo del 15 de agosto: septiembre y octubre son historia", fechas.Mensual, d(2026, 8, 15), []time.Time{d(2026, 8, 15)}, []string{}},
		{"fecha futura: todavía no llegó", fechas.Mensual, d(2026, 11, 1), nil, []string{}},
		{"fecha de hoy confirmada", fechas.Mensual, d(2026, 10, 26), []time.Time{d(2026, 10, 26)}, []string{}},
		{"fecha de hoy sin confirmar", fechas.Mensual, d(2026, 10, 26), nil, []string{"2026-10-26"}},
		{"semanal desde el lunes pasado: cae hoy otra vez", fechas.Semanal, d(2026, 10, 19), []time.Time{d(2026, 10, 19)}, []string{"2026-10-26"}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			obtenidas, err := fechas.PorConfirmar(c.p, c.inicio, c.confirmadas, nil, hoy, hoy, nil)
			if err != nil {
				t.Fatal(err)
			}
			iguales(t, obtenidas, c.quiere...)
		})
	}
	// Un recurrente creado hace dos meses, sin confirmar nada: llegaron septiembre y octubre (hoy 26: el 15 ya pasó).
	obtenidas, _ := fechas.PorConfirmar(fechas.Mensual, d(2026, 8, 15), []time.Time{d(2026, 8, 15)}, nil, d(2026, 8, 15), hoy, nil)
	iguales(t, obtenidas, "2026-09-15", "2026-10-15")
	// Con la de octubre omitida («No pasó») queda la de septiembre.
	obtenidas, _ = fechas.PorConfirmar(fechas.Mensual, d(2026, 8, 15), []time.Time{d(2026, 8, 15)}, []time.Time{d(2026, 10, 15)}, d(2026, 8, 15), hoy, nil)
	iguales(t, obtenidas, "2026-09-15")
	if _, err := fechas.PorConfirmar(fechas.Mensual, d(2026, 8, 15), []time.Time{d(2026, 8, 15)}, []time.Time{d(2026, 8, 15)}, hoy, hoy, nil); !errors.Is(err, fechas.ErrFechaConfirmadaYOmitida) {
		t.Errorf("confirmada y omitida: %v", err)
	}
}

func TestHoyEnColombiaEsUTCMenosCinco(t *testing.T) {
	casos := map[string]string{
		"2026-10-26T04:59:59Z": "2026-10-25", // 23:59:59 del 25 en Colombia
		"2026-10-26T05:00:00Z": "2026-10-26",
		"2026-10-27T04:59:59Z": "2026-10-26",
		"2026-12-31T23:00:00Z": "2026-12-31",
		"2027-01-01T04:00:00Z": "2026-12-31",
	}
	for utc, quiere := range casos {
		ahora, err := time.Parse(time.RFC3339, utc)
		if err != nil {
			t.Fatal(err)
		}
		if hoy := fechas.HoyEnColombia(ahora); hoy.Format(time.DateOnly) != quiere || hoy.Location() != time.UTC {
			t.Errorf("%s: %v, se esperaba %s", utc, hoy, quiere)
		}
	}
}

func TestPeriodicidadValida(t *testing.T) {
	for _, p := range []fechas.Periodicidad{fechas.Semanal, fechas.Quincenal, fechas.Mensual, fechas.Semestral, fechas.Anual} {
		if !p.Valida() {
			t.Errorf("%s debe ser válida", p)
		}
	}
	for _, p := range []fechas.Periodicidad{"", "diaria", "Mensual", "trimestral"} {
		if p.Valida() {
			t.Errorf("%q no debe ser válida", p)
		}
	}
}

// D-169: VuelveAPendiente y Pendientes comparten la regla: la fecha del mismo día en que se creó la repetición no es
// historia; la anterior sí.
func TestVuelveAPendienteEsLaMismaReglaQuePendientes(t *testing.T) {
	creado := d(2026, 10, 26)
	for _, c := range []struct {
		f      time.Time
		vuelve bool
	}{
		{d(2026, 8, 15), false},
		{d(2026, 10, 25), false},
		{d(2026, 10, 26), true},
		{d(2026, 11, 15), true},
	} {
		if got := fechas.VuelveAPendiente(c.f, creado); got != c.vuelve {
			t.Errorf("%s creada el 2026-10-26: %v, se esperaba %v", c.f.Format(time.DateOnly), got, c.vuelve)
		}
		pend, err := fechas.Pendientes(fechas.Mensual, d(2026, 8, 15), d(c.f.Year(), c.f.Month(), 1), nil, nil, creado, nil)
		if err != nil {
			t.Fatal(err)
		}
		if slices.ContainsFunc(pend, c.f.Equal) && c.f.Day() == 15 && !c.vuelve {
			t.Errorf("Pendientes ofrece la historia %s", c.f.Format(time.DateOnly))
		}
	}
}
