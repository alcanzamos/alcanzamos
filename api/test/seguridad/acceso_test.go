package seguridad_test

import (
	"errors"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// sinDeclarar es el valor cero de NivelDeAcceso: una ruta que no declara su nivel.
var sinDeclarar seguridad.NivelDeAcceso

func TestSujetoAlcanzaElNivel(t *testing.T) {
	limitada := seguridad.Sujeto{Persona: "p"}
	verificada := seguridad.Sujeto{Persona: "p", Verificada: true}
	autorizada := seguridad.Sujeto{Persona: "p", Verificada: true, Autorizada: true}
	senuelo := seguridad.Sujeto{Senuelo: true, Verificada: true, Autorizada: true}
	casos := []struct {
		sujeto seguridad.Sujeto
		nivel  seguridad.NivelDeAcceso
		quiere error
	}{
		{limitada, seguridad.Publica, nil}, {limitada, seguridad.SinVerificar, nil},
		{limitada, seguridad.SinAutorizacion, seguridad.ErrVerificacionPendiente}, {limitada, seguridad.RequiereAutorizacion, seguridad.ErrVerificacionPendiente},
		{verificada, seguridad.SinVerificar, nil}, {verificada, seguridad.SinAutorizacion, nil}, {verificada, seguridad.RequiereAutorizacion, seguridad.ErrAutorizacionPendiente},
		{autorizada, seguridad.SinVerificar, nil}, {autorizada, seguridad.SinAutorizacion, nil}, {autorizada, seguridad.RequiereAutorizacion, nil},
		{senuelo, seguridad.SinVerificar, nil}, {senuelo, seguridad.SinAutorizacion, seguridad.ErrVerificacionPendiente}, {senuelo, seguridad.RequiereAutorizacion, seguridad.ErrVerificacionPendiente},
		{seguridad.Sujeto{Persona: "p", Autorizada: true}, seguridad.RequiereAutorizacion, seguridad.ErrVerificacionPendiente},
		{autorizada, sinDeclarar, seguridad.ErrAutorizacionPendiente},
	}
	for _, c := range casos {
		if err := c.sujeto.Alcanza(c.nivel); !errors.Is(err, c.quiere) {
			t.Errorf("%+v alcanza %s: %v, se esperaba %v", c.sujeto, c.nivel, err, c.quiere)
		}
	}
}

func TestNombresDeLosNiveles(t *testing.T) {
	for n, nombre := range map[seguridad.NivelDeAcceso]string{
		seguridad.Publica: "publica", seguridad.SinVerificar: "sin_verificar", seguridad.SinAutorizacion: "sin_autorizacion",
		seguridad.RequiereAutorizacion: "requiere_autorizacion", sinDeclarar: "sin_declarar",
	} {
		if n.String() != nombre {
			t.Errorf("%d se llama %q, se esperaba %q", n, n.String(), nombre)
		}
	}
	if sinDeclarar.Valido() || seguridad.NivelDeAcceso(99).Valido() || !seguridad.RequiereAutorizacion.Valido() {
		t.Error("solo los cuatro niveles son válidos")
	}
}
