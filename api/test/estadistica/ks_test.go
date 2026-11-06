package estadistica_test

import (
	"math"
	"math/rand/v2"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/test/estadistica"
)

func muestra(r *rand.Rand, n int, media, desvio float64) []float64 {
	m := make([]float64, n)
	for i := range m {
		m[i] = media + desvio*r.NormFloat64()
	}
	return m
}

// La prueba no distingue dos muestras de la misma distribución, y sí distingue una desviación pequeña del promedio con
// 360 repeticiones por caso (las de la auditoría): es lo que SEG-013 necesita para tener dientes.
func TestKolmogorovSmirnovDistingueLoQueDebeYNoLoDemas(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	if _, p := estadistica.KolmogorovSmirnov(muestra(r, 360, 100, 10), muestra(r, 360, 100, 10)); p < 0.01 {
		t.Errorf("misma distribución: p = %v", p)
	}
	if _, p := estadistica.KolmogorovSmirnov(muestra(r, 360, 100, 10), muestra(r, 360, 106, 10)); p >= 0.01 {
		t.Errorf("promedio 0,6 desvíos más alto: p = %v, debe distinguirse", p)
	}
	if _, p := estadistica.KolmogorovSmirnov(muestra(r, 360, 100, 10), muestra(r, 360, 100, 20)); p >= 0.01 {
		t.Errorf("mismo promedio y el doble de dispersión: p = %v, debe distinguirse (no se comparan promedios)", p)
	}
}

func TestKolmogorovSmirnovCasosLimite(t *testing.T) {
	if d, p := estadistica.KolmogorovSmirnov(nil, []float64{1}); d != 0 || p != 1 {
		t.Errorf("muestra vacía: %v %v", d, p)
	}
	d, p := estadistica.KolmogorovSmirnov([]float64{1, 2, 3, 4}, []float64{1, 2, 3, 4})
	if d != 0 || p != 1 {
		t.Errorf("muestras idénticas: %v %v", d, p)
	}
	// Muestras separadas del todo: D = 1.
	d, p = estadistica.KolmogorovSmirnov([]float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}, []float64{11, 12, 13, 14, 15, 16, 17, 18, 19, 20})
	if d != 1 || p >= 0.001 {
		t.Errorf("muestras separadas: D = %v, p = %v", d, p)
	}
	// Valor de referencia, calculado aparte con la misma fórmula asintótica (Numerical Recipes 14.3): 100 y 100 valores
	// consecutivos, la segunda corrida 20 lugares, dan D = 0,2 y p = 0,03138.
	x, y := make([]float64, 100), make([]float64, 100)
	for i := range x {
		x[i], y[i] = float64(i), float64(i+20)
	}
	d, p = estadistica.KolmogorovSmirnov(x, y)
	if math.Abs(d-0.2) > 1e-9 || math.Abs(p-0.03138) > 1e-4 {
		t.Errorf("D = %v, p = %v, se esperaba D = 0,2 y p = 0,03138", d, p)
	}
}
