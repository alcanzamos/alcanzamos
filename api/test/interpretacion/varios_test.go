package interpretacion_test

import (
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/interpretacion"
)

// La prueba de escritorio de E15 5.15 (DV-01 a DV-22). Es el conjunto de desarrollo: no mide la exactitud, que es de E18.
func TestDetectorDeVariosMovimientosCuentaLosMontosDeE15(t *testing.T) {
	casos := []struct {
		id, texto string
		montos    int
	}{
		{id: "DV-01", texto: "almuerzo 15 mil y taxi 8 mil", montos: 2},
		{id: "DV-02", texto: "almuerzo 15 mil", montos: 1},
		{id: "DV-03", texto: "pagué 50 mil el 15 de marzo", montos: 1},
		{id: "DV-04", texto: "arriendo $800.000 el 5", montos: 1},
		{id: "DV-05", texto: "compré 3 gaseosas a 2 mil", montos: 1},
		{id: "DV-06", texto: "3 almuerzos a 5 mil, total 15 mil", montos: 1},
		{id: "DV-07", texto: "televisor 1.200.000 en 12 cuotas de 100.000", montos: 1},
		{id: "DV-08", texto: "mercado 120.000 y gasolina 80.000 y peluquería 25 mil", montos: 3},
		{id: "DV-09", texto: "almuerzo quince mil y taxi ocho mil", montos: 2},
		{id: "DV-10", texto: "gasté 20k en cine y 10k en dulces", montos: 2},
		{id: "DV-11", texto: "hola", montos: 0},
		{id: "DV-12", texto: "llamé al 3001234567", montos: 0},
		{id: "DV-13", texto: "pagué la factura de 2026", montos: 0},
		{id: "DV-14", texto: "taxi 8.500, almuerzo 14.000", montos: 2},
		{id: "DV-15", texto: "ayer pagué 30 lucas de la luz y 12 lucas de agua", montos: 2},
		{id: "DV-16", texto: "10% de 200 mil", montos: 1},
		{id: "DV-17", texto: "pagué 40000 el 05/11", montos: 1},
		{id: "DV-18", texto: "compré 2 camisas de 50 mil", montos: 1},
		{id: "DV-19", texto: "$25.000 + $10.000", montos: 2},
		{id: "DV-20", texto: "", montos: 0},
		{id: "DV-21", texto: "gasté 15 y 8 mil", montos: 1},              // límite conocido: falso negativo
		{id: "DV-22", texto: "tengo 20 mil pero gasté 5 mil", montos: 2}, // límite conocido: falso positivo
	}
	var d interpretacion.DetectorDeVariosMovimientos
	for _, c := range casos {
		t.Run(c.id, func(t *testing.T) {
			if got := d.ContarMontos(c.texto); got != c.montos {
				t.Errorf("ContarMontos(%q) = %d, se esperaba %d", c.texto, got, c.montos)
			}
			if got := d.HayVarios(c.texto); got != (c.montos >= 2) {
				t.Errorf("HayVarios(%q) = %v", c.texto, got)
			}
		})
	}
}

// Casos fuera de la prueba de escritorio que ejercen cada rama de «qué es un monto» (E15 5.15).
func TestDetectorDeVariosMovimientosCuentaCadaFormaDeMonto(t *testing.T) {
	casos := []struct {
		texto  string
		montos int
	}{
		{"arriendo 1.234,567", 1},       // el número con miles sin los decimales de más
		{"1.2345 y 3.5000", 0},          // ni miles ni enteros de 4 a 7 dígitos
		{"cédula 12345678", 0},          // ocho dígitos: no es un monto
		{"compré a $5 mil y $6 mil", 2}, // con $ y sufijo
		{"son 20 mil", 1},               // total explícito
		{"en total 20 mil y 5 mil", 1},  // con un total, un solo movimiento
		{"12 cuotas de 100.000", 0},
		{"Ñandú 15 MIL y 8 Mil", 2},     // mayúsculas y tildes
		{"gasté 2 millones y medio", 1}, // sufijo de millones
		{"mercado 1.500,50 y gas 2.000", 2},
		{"día 20 pagué 45000 de luz, 12000 de agua", 2},
		{"pagué 3000 € y ¿cuánto? 5 mil", 2}, // un carácter de varios bytes antes del monto
		{"\xff\xfe 5 mil", 1},                // bytes que no son UTF-8
	}
	var d interpretacion.DetectorDeVariosMovimientos
	for _, c := range casos {
		if got := d.ContarMontos(c.texto); got != c.montos {
			t.Errorf("ContarMontos(%q) = %d, se esperaba %d", c.texto, got, c.montos)
		}
	}
}

// El detector no usa el motor ni las reglas (D-077 (4)): no cambia con ellas y no tiene estado.
func TestDetectorDeVariosMovimientosNoTieneEstado(t *testing.T) {
	var d interpretacion.DetectorDeVariosMovimientos
	for i := 0; i < 3; i++ {
		if got := d.ContarMontos("almuerzo 15 mil y taxi 8 mil"); got != 2 {
			t.Fatalf("la llamada %d dio %d", i, got)
		}
	}
}

// D-084 (8), E14-PPN 3.1: un monto como «12.5» se rechaza sin adivinar, con las dos lecturas.
func TestMontoAmbiguoDaLasDosLecturas(t *testing.T) {
	casos := []struct {
		texto, miles, decimal string
	}{
		{"mercado 12.5", "12.500", "12,50"},
		{"pagué 12,50 de pan", "12.500", "12,50"},
		{"Mercado $8,5 hoy", "8.500", "8,50"},
		{"taxi 120.75", "120.750", "120,75"},
	}
	for _, c := range casos {
		l, ok := interpretacion.MontoAmbiguo(c.texto)
		if !ok || l.ConPuntoDeMiles != c.miles || l.ConComaDecimal != c.decimal {
			t.Errorf("MontoAmbiguo(%q) = %+v, %v; se esperaba %s y %s", c.texto, l, ok, c.miles, c.decimal)
		}
	}
}

func TestMontoAmbiguoNoSeMarcaConMontosClaros(t *testing.T) {
	for _, texto := range []string{
		"almuerzo 15 mil", "taxi 8.500", "arriendo $1.200.000", "televisor $1.234,56", "12,5 mil de mercado", "pagué 40000 el 05/11",
		"compré 3 gaseosas a 2 mil", "subió 12.5%", "hola", "", "pagué 1234,50 de internet",
	} {
		if l, ok := interpretacion.MontoAmbiguo(texto); ok {
			t.Errorf("MontoAmbiguo(%q) marcó %+v", texto, l)
		}
	}
}
