// Package estadistica es el ayudante de las pruebas que comparan tiempos de respuesta: la prueba de Kolmogórov-Smirnov
// de dos muestras (E18-PPR SEG-013, D-174 (4)).
package estadistica

import (
	"math"
	"sort"
)

// KolmogorovSmirnov compara las distribuciones de dos muestras: devuelve la distancia máxima D entre sus funciones de
// distribución empíricas y el valor p de la prueba de dos muestras, con la aproximación asintótica de Kolmogórov (la
// de Numerical Recipes, con la corrección de tamaño finito). Un p chico dice que las distribuciones se distinguen.
// Compara las distribuciones, no los promedios. Con una muestra vacía devuelve D = 0 y p = 1.
func KolmogorovSmirnov(a, b []float64) (d, p float64) {
	if len(a) == 0 || len(b) == 0 {
		return 0, 1
	}
	x := append([]float64(nil), a...)
	y := append([]float64(nil), b...)
	sort.Float64s(x)
	sort.Float64s(y)
	n, m := float64(len(x)), float64(len(y))
	i, j := 0, 0
	for i < len(x) && j < len(y) {
		v := math.Min(x[i], y[j])
		for i < len(x) && x[i] <= v {
			i++
		}
		for j < len(y) && y[j] <= v {
			j++
		}
		d = math.Max(d, math.Abs(float64(i)/n-float64(j)/m))
	}
	ne := n * m / (n + m)
	lambda := (math.Sqrt(ne) + 0.12 + 0.11/math.Sqrt(ne)) * d
	return d, serieDeKolmogorov(lambda)
}

// serieDeKolmogorov es Q(λ) = 2 Σ (-1)^(k-1) exp(-2 k² λ²), la cola de la distribución de Kolmogórov.
func serieDeKolmogorov(lambda float64) float64 {
	if lambda < 0.18 {
		return 1 // la serie no converge de prisa y el valor p es prácticamente 1
	}
	suma, signo := 0.0, 1.0
	for k := 1; k <= 100; k++ {
		termino := signo * math.Exp(-2*float64(k*k)*lambda*lambda)
		suma += termino
		if math.Abs(termino) < 1e-12 {
			break
		}
		signo = -signo
	}
	return math.Min(1, math.Max(0, 2*suma))
}
