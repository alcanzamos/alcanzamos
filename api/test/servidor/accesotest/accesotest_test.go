package accesotest_test

import (
	"net/http"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/accesotest"
)

// El ayudante prueba las rutas de cada nivel contra la tabla de Esperado: el propio guard debe cumplirla.
func TestProbarRutasConUnaRutaPorNivel(t *testing.T) {
	accesotest.ProbarRutas(t, []servidor.Ruta{
		{Patron: "POST /api/v1/prueba/publica", Nivel: seguridad.Publica},
		{Patron: "POST /api/v1/prueba/sin-autorizacion", Nivel: seguridad.SinAutorizacion},
		{Patron: "GET /api/v1/prueba/{id}/datos", Nivel: seguridad.RequiereAutorizacion},
	})
}

func TestEsperadoCubreTodosLosNivelesYClases(t *testing.T) {
	for _, n := range []seguridad.NivelDeAcceso{seguridad.Publica, seguridad.SinAutorizacion, seguridad.RequiereAutorizacion} {
		for _, c := range accesotest.Clases {
			if accesotest.Esperado(n, c).Estado < http.StatusOK {
				t.Errorf("sin resultado esperado para %s y %s", n, c)
			}
		}
	}
}
