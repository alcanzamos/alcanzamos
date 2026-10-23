package accesotest

import (
	"net/http"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
)

// El ayudante prueba las rutas de cada nivel contra la tabla de Esperado: el propio guard debe cumplirla.
func TestProbarRutasConUnaRutaPorNivel(t *testing.T) {
	ProbarRutas(t, []servidor.Ruta{
		{Patron: "POST /api/v1/prueba/publica", Nivel: seguridad.Publica},
		{Patron: "GET /api/v1/prueba/sin-verificar", Nivel: seguridad.SinVerificar},
		{Patron: "POST /api/v1/prueba/sin-autorizacion", Nivel: seguridad.SinAutorizacion},
		{Patron: "GET /api/v1/prueba/{id}/datos", Nivel: seguridad.RequiereAutorizacion},
	})
}

func TestEsperadoCubreTodosLosNivelesYClases(t *testing.T) {
	for _, n := range []seguridad.NivelDeAcceso{seguridad.Publica, seguridad.SinVerificar, seguridad.SinAutorizacion, seguridad.RequiereAutorizacion} {
		for _, c := range Clases {
			if Esperado(n, c).Estado < http.StatusOK {
				t.Errorf("sin resultado esperado para %s y %s", n, c)
			}
		}
	}
	// La sesión de mentira recibe siempre lo mismo que la limitada real (D-141).
	for _, n := range []seguridad.NivelDeAcceso{seguridad.Publica, seguridad.SinVerificar, seguridad.SinAutorizacion, seguridad.RequiereAutorizacion} {
		if Esperado(n, Senuelo) != Esperado(n, Limitada) {
			t.Errorf("en %s la sesión de mentira debe recibir lo mismo que la limitada", n)
		}
	}
}
