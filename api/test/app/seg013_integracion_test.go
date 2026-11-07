//go:build integration

package app_test

import (
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/test/estadistica"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

// Casos de SEG-013: el correo del pedido tiene una cuenta nueva, una sin verificar o una verificada.
const (
	correoNuevo        = "nuevo"
	correoSinVerificar = "sinverificar"
	correoVerificado   = "verificado"
)

var casosDeSEG013 = []string{correoNuevo, correoSinVerificar, correoVerificado}

// repeticionesPorCaso son las de la auditoría (A-16, E18-PPR SEG-013): 360 por caso.
const repeticionesPorCaso = 360

// vistaDeLaRespuesta es todo lo que ve un cliente de la respuesta, menos la fecha.
func vistaDeLaRespuesta(rr *httptest.ResponseRecorder) string {
	var cab []string
	for k, v := range rr.Header() {
		if k != "Date" {
			cab = append(cab, k+": "+strings.Join(v, ","))
		}
	}
	sort.Strings(cab)
	return fmt.Sprintf("%d\n%s\n%s", rr.Code, strings.Join(cab, "\n"), rr.Body)
}

// medirSEG013 hace `repeticiones` pedidos por caso a la ruta, cada uno con una dirección y un origen que no usó ningún otro
// (para que ni el 429 ni la espera corta cambien la respuesta), en orden al azar entre los tres casos, y espera el trabajo en segundo plano de cada pedido antes del siguiente para que no se
// cruce con la medición. Las cuentas de todos los pedidos se siembran antes de medir el primero: sembrarlas entre un
// pedido y otro dejaría a la base y al recolector de basura calientes justo antes de los casos con cuenta, y la prueba
// mediría eso y no el pedido. Devuelve los tiempos en nanosegundos por caso, y falla si alguna respuesta difiere de la primera
// (estado, cabeceras y cuerpo) o trae `Set-Cookie`.
func medirSEG013(t *testing.T, api http.Handler, esperar func(), pool *pgxpool.Pool, ronda int, ruta string, repeticiones int) map[string][]float64 {
	t.Helper()
	// Las direcciones de los tres casos tienen el mismo largo y la misma forma: el pedido las valida, y una más larga
	// costaría unos microsegundos más sin que el caso tenga nada que ver.
	correoDe := func(caso string, rep int) string {
		return fmt.Sprintf("r%d-c%d-%d-%05d@ejemplo.test", indiceDeRuta(ruta), indice(caso), ronda, rep)
	}
	for rep := range repeticiones {
		persona(t, pool, correoDe(correoSinVerificar, rep), false, false)
		persona(t, pool, correoDe(correoVerificado, rep), true, true)
	}
	runtime.GC() // que el recolector no arranque dentro de la medición por la siembra
	tiempos := map[string][]float64{}
	var primera string
	// Un solo orden al azar (con semilla fija) para los 3×N pedidos: si el orden se barajara dentro de cada grupo de tres,
	// el pedido anterior de cada caso tendría una mezcla distinta y el costo de lo que dejó (planificador, recolector, base)
	// se cargaría a un caso más que a otro (B2).
	type pedido struct {
		caso string
		rep  int
	}
	orden := make([]pedido, 0, 3*repeticiones)
	for rep := range repeticiones {
		for _, caso := range casosDeSEG013 {
			orden = append(orden, pedido{caso, rep})
		}
	}
	rand.New(rand.NewPCG(uint64(ronda)+1, 13)).Shuffle(len(orden), func(i, j int) { orden[i], orden[j] = orden[j], orden[i] })
	for n, p := range orden {
		cuerpo := `{"correo":"` + correoDe(p.caso, p.rep) + `"}`
		if ruta == "/api/v1/cuentas" {
			cuerpo = `{"correo":"` + correoDe(p.caso, p.rep) + `","mayor_de_edad":true}`
		}
		r := httptest.NewRequest(http.MethodPost, ruta, strings.NewReader(cuerpo))
		r.RemoteAddr = fmt.Sprintf("10.%d.%d.%d:1", 20+ronda, (n+1)/250, (n+1)%250) // un origen por pedido
		rr := httptest.NewRecorder()
		inicio := time.Now()
		api.ServeHTTP(rr, r)
		tiempos[p.caso] = append(tiempos[p.caso], float64(time.Since(inicio).Nanoseconds()))
		esperar()
		time.Sleep(time.Millisecond) // que lo que dejó el pedido anterior se calme antes del siguiente

		vista := vistaDeLaRespuesta(rr)
		if primera == "" {
			primera = vista
		}
		if vista != primera || len(rr.Header().Values("Set-Cookie")) != 0 {
			t.Fatalf("%s (%s, repetición %d) responde distinto:\n%s\nla primera fue:\n%s", ruta, p.caso, p.rep, vista, primera)
		}
	}
	return tiempos
}

// SEG-013 (D-172 (1) y (4), D-174 (4); A-16): crear una cuenta (PN-58) y «Reenviar» (PN-59) con un correo nuevo, con el de
// una cuenta sin verificar y con el de una verificada dan la misma respuesta (estado, cabeceras y cuerpo, sin cookie) y un
// tiempo que no se distingue. Método de E18-PPR: 360 repeticiones por caso, los límites fuera del camino (una dirección y
// un origen por repetición) y la prueba de Kolmogórov-Smirnov de dos muestras de los tres pares de casos (nuevo/sin verificar, nuevo/verificada y sin verificar/verificada), no los promedios: con
// un nivel de 0,01, si p < 0,01 la prueba distingue los casos y el caso falla.
//
// Con tres pares por ruta y un nivel de 0,01, un equipo ruidoso puede dar un falso positivo cada tantas corridas. Para que
// no tumbe el pipeline sin que algo haya cambiado, un par que sale con p < 0,01 se mide una vez más con muestras nuevas, y
// solo falla si las dos veces lo distingue: una diferencia real (como hacer el trabajo de la base dentro del pedido) sale
// las dos veces.
func TestSEG013LaRespuestaYElTiempoNoDistinguenSiElCorreoTieneCuenta(t *testing.T) {
	api, _, pool, esperar := apiArmadaConEspera(t)
	api = csrftest.ConCabeceras(api)
	repeticiones := repeticionesPorCaso
	if testing.Short() {
		repeticiones = 60
	}
	for _, ruta := range []string{"/api/v1/cuentas", "/api/v1/cuentas/verificacion/reenvio"} {
		t.Run(ruta, func(t *testing.T) {
			var distingue map[string]float64
			for ronda := 0; ronda < 2; ronda++ {
				tiempos := medirSEG013(t, api, esperar, pool, ronda, ruta, repeticiones)
				distingue = map[string]float64{}
				for _, par := range [][2]string{{correoNuevo, correoSinVerificar}, {correoNuevo, correoVerificado}, {correoSinVerificar, correoVerificado}} {
					d, p := estadistica.KolmogorovSmirnov(tiempos[par[0]], tiempos[par[1]])
					t.Logf("%s, ronda %d: %s contra %s: D = %.3f, p = %.4f (mediana %.0f µs contra %.0f µs)", ruta, ronda+1, par[0], par[1], d, p,
						mediana(tiempos[par[0]])/1e3, mediana(tiempos[par[1]])/1e3)
					if p < 0.01 {
						distingue[par[0]+" contra "+par[1]] = p
					}
				}
				if len(distingue) == 0 {
					return
				}
				t.Logf("la ronda %d distingue %v: se mide otra vez con muestras nuevas", ronda+1, distingue)
			}
			t.Errorf("la prueba de Kolmogórov-Smirnov distingue los tiempos en las dos rondas (p < 0,01): %v", distingue)
		})
	}
}

func indiceDeRuta(ruta string) int { return len(ruta) } // distinta por ruta, que es lo que hace falta

func indice(caso string) int {
	for i, c := range casosDeSEG013 {
		if c == caso {
			return i
		}
	}
	return -1
}

func mediana(v []float64) float64 {
	c := append([]float64(nil), v...)
	sort.Float64s(c)
	return c[len(c)/2]
}
