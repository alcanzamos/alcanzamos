package fechas_test

import (
	"errors"
	"math"
	"slices"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
)

func pesos(n int64) int64 { return n * 100 }

func por(recurrente string, f time.Time, monto int64, ingreso bool) fechas.FechaPorConfirmar {
	return fechas.FechaPorConfirmar{Recurrente: recurrente, Fecha: f, Monto: monto, EsIngreso: ingreso}
}

func monto(n int64) *int64 { return &n }

func decide(recurrente string, f time.Time, m *int64, omitida bool) fechas.DecisionDeFecha {
	return fechas.DecisionDeFecha{Recurrente: recurrente, Fecha: f, Monto: m, Omitida: omitida}
}

// Las trece fechas de PN-72 (E15 5.2, FP-17): 2 ingresos y 11 gastos.
func lasTrece() []fechas.FechaPorConfirmar {
	return []fechas.FechaPorConfirmar{
		por("Energía", d(2026, 11, 5), pesos(120000), false), por("Agua", d(2026, 11, 8), pesos(60000), false),
		por("Internet", d(2026, 11, 10), pesos(90000), false), por("Celular", d(2026, 11, 12), pesos(60000), false),
		por("Cuota del crédito", d(2026, 11, 15), pesos(600000), false), por("Salario", d(2026, 11, 16), pesos(1200000), true),
		por("Cuota de la compra a cuotas", d(2026, 11, 20), pesos(400000), false), por("Salario", d(2026, 12, 1), pesos(1200000), true),
		por("Arriendo", d(2026, 12, 1), pesos(650000), false), por("Energía", d(2026, 12, 5), pesos(120000), false),
		por("Agua", d(2026, 12, 8), pesos(60000), false), por("Internet", d(2026, 12, 10), pesos(90000), false),
		por("Celular", d(2026, 12, 12), pesos(60000), false),
	}
}

func tres() []fechas.FechaPorConfirmar {
	return lasTrece()[:3]
}

func claves(lista []fechas.FechaPorConfirmar) []string {
	textos := make([]string, len(lista))
	for i, f := range lista {
		textos[i] = f.Recurrente + " " + f.Fecha.Format(time.DateOnly)
	}
	return textos
}

func fp17(t *testing.T) {
	var decisiones []fechas.DecisionDeFecha
	for _, p := range lasTrece() {
		var m *int64
		omitida := p.Recurrente == "Celular" && p.Fecha.Equal(d(2026, 11, 12))
		if p.Recurrente == "Salario" && p.Fecha.Equal(d(2026, 12, 1)) {
			m = monto(pesos(1100000))
		}
		decisiones = append(decisiones, decide(p.Recurrente, p.Fecha, m, omitida))
	}
	r, err := fechas.ConfirmarVarias(lasTrece(), decisiones)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Confirmadas) != 12 || len(r.Omitidas) != 1 || len(r.Pendientes) != 0 {
		t.Fatalf("confirmadas %d, omitidas %d, pendientes %d", len(r.Confirmadas), len(r.Omitidas), len(r.Pendientes))
	}
	if got := claves(r.Omitidas); !slices.Equal(got, []string{"Celular 2026-11-12"}) || r.Omitidas[0].Monto != pesos(60000) {
		t.Errorf("omitidas %v %+v", got, r.Omitidas)
	}
	if salario := r.Confirmadas[6]; salario.Recurrente != "Salario" || salario.Monto != pesos(1100000) || !salario.EsIngreso {
		t.Errorf("el salario de diciembre llega con lo que llegó: %+v", salario)
	}
	if r.Ingresos.Int64() != pesos(2300000) || r.Gastos.Int64() != pesos(2250000) {
		t.Errorf("ingresos %v, gastos %v", r.Ingresos, r.Gastos)
	}
}

func fp18(t *testing.T) {
	r, err := fechas.ConfirmarVarias(tres(), []fechas.DecisionDeFecha{decide("Agua", d(2026, 11, 8), nil, false)})
	if err != nil {
		t.Fatal(err)
	}
	if got := claves(r.Confirmadas); !slices.Equal(got, []string{"Agua 2026-11-08"}) || r.Confirmadas[0].Monto != pesos(60000) {
		t.Errorf("confirmadas %v", r.Confirmadas)
	}
	if len(r.Omitidas) != 0 || !slices.Equal(claves(r.Pendientes), []string{"Energía 2026-11-05", "Internet 2026-11-10"}) {
		t.Errorf("omitidas %v, siguen pendientes %v", r.Omitidas, claves(r.Pendientes))
	}
	if r.Ingresos.Sign() != 0 || r.Gastos.Int64() != pesos(60000) {
		t.Errorf("ingresos %v, gastos %v", r.Ingresos, r.Gastos)
	}
}

func fp19(t *testing.T) {
	_, err := fechas.ConfirmarVarias(tres(), []fechas.DecisionDeFecha{decide("Salario", d(2026, 11, 1), nil, false)})
	if !errors.Is(err, fechas.ErrFechaNoPendiente) {
		t.Errorf("error %v", err)
	}
}

func fp20(t *testing.T) {
	_, err := fechas.ConfirmarVarias(tres(), []fechas.DecisionDeFecha{
		decide("Energía", d(2026, 11, 5), nil, false), decide("Energía", d(2026, 11, 5), nil, true)})
	if !errors.Is(err, fechas.ErrFechaNoPendiente) {
		t.Errorf("error %v", err)
	}
}

func fp21(t *testing.T) {
	r, err := fechas.ConfirmarVarias(tres(), []fechas.DecisionDeFecha{
		decide("Energía", d(2026, 11, 5), nil, false), decide("Agua", d(2026, 11, 8), monto(0), false)})
	if !errors.Is(err, fechas.ErrMontoInvalido) {
		t.Errorf("error %v", err)
	}
	if len(r.Confirmadas) != 0 || len(r.Omitidas) != 0 {
		t.Errorf("con error no queda nada: %+v", r)
	}
}

// D-094: el movimiento se guarda con su fecha programada, nunca con la de hoy.
func fp22(t *testing.T) {
	p := por("Salario", d(2026, 11, 16), pesos(1200000), true)
	hoy := d(2026, 12, 14)
	if got := fechas.FechaDelMovimiento(p, hoy); !got.Equal(d(2026, 11, 16)) {
		t.Errorf("fecha %v", got)
	}
	r, err := fechas.ConfirmarVarias([]fechas.FechaPorConfirmar{p}, []fechas.DecisionDeFecha{decide("Salario", d(2026, 11, 16), nil, false)})
	if err != nil {
		t.Fatal(err)
	}
	if f := fechas.FechaDelMovimiento(r.Confirmadas[0], hoy); f.Format("2006-01") != "2026-11" {
		t.Errorf("periodo %v", f)
	}
}

func fp23(t *testing.T) {
	p := por("Cuota del crédito", d(2026, 12, 15), pesos(600000), false)
	r, err := fechas.ConfirmarVarias([]fechas.FechaPorConfirmar{p}, []fechas.DecisionDeFecha{decide("Cuota del crédito", d(2026, 12, 15), monto(pesos(550000)), false)})
	if err != nil {
		t.Fatal(err)
	}
	if got := fechas.FechaDelMovimiento(r.Confirmadas[0], d(2027, 1, 3)); !got.Equal(d(2026, 12, 15)) || r.Confirmadas[0].Monto != pesos(550000) {
		t.Errorf("fecha %v, monto %d", got, r.Confirmadas[0].Monto)
	}
}

func TestConfirmarVariasRechazaUnMontoNegativoYUnaOmisionConMonto(t *testing.T) {
	for nombre, d := range map[string]fechas.DecisionDeFecha{
		"negativo":          decide("Agua", d(2026, 11, 8), monto(-1), false),
		"omitida con monto": decide("Agua", d(2026, 11, 8), monto(pesos(1)), true),
	} {
		if _, err := fechas.ConfirmarVarias(tres(), []fechas.DecisionDeFecha{d}); !errors.Is(err, fechas.ErrMontoInvalido) {
			t.Errorf("%s: %v", nombre, err)
		}
	}
}

func TestConfirmarVariasSumaSinDesbordar(t *testing.T) {
	grande := []fechas.FechaPorConfirmar{por("A", d(2026, 11, 1), math.MaxInt64, true), por("B", d(2026, 11, 2), math.MaxInt64, true)}
	r, err := fechas.ConfirmarVarias(grande, []fechas.DecisionDeFecha{decide("A", d(2026, 11, 1), nil, false), decide("B", d(2026, 11, 2), nil, false)})
	if err != nil {
		t.Fatal(err)
	}
	if r.Ingresos.String() != "18446744073709551614" {
		t.Errorf("ingresos %v", r.Ingresos)
	}
}

func TestConfirmarVariasSinDecisionesNoCambiaNada(t *testing.T) {
	r, err := fechas.ConfirmarVarias(tres(), nil)
	if err != nil || len(r.Confirmadas) != 0 || len(r.Pendientes) != 3 {
		t.Errorf("%+v %v", r, err)
	}
}
