package seguridad

import (
	"errors"
	"testing"
)

func TestSujetoAlcanzaElNivel(t *testing.T) {
	limitada := Sujeto{Persona: "p"}
	verificada := Sujeto{Persona: "p", Verificada: true}
	autorizada := Sujeto{Persona: "p", Verificada: true, Autorizada: true}
	senuelo := Sujeto{Senuelo: true, Verificada: true, Autorizada: true}
	casos := []struct {
		sujeto Sujeto
		nivel  NivelDeAcceso
		quiere error
	}{
		{limitada, Publica, nil}, {limitada, SinVerificar, nil},
		{limitada, SinAutorizacion, ErrVerificacionPendiente}, {limitada, RequiereAutorizacion, ErrVerificacionPendiente},
		{verificada, SinVerificar, nil}, {verificada, SinAutorizacion, nil}, {verificada, RequiereAutorizacion, ErrAutorizacionPendiente},
		{autorizada, SinVerificar, nil}, {autorizada, SinAutorizacion, nil}, {autorizada, RequiereAutorizacion, nil},
		{senuelo, SinVerificar, nil}, {senuelo, SinAutorizacion, ErrVerificacionPendiente}, {senuelo, RequiereAutorizacion, ErrVerificacionPendiente},
		{Sujeto{Persona: "p", Autorizada: true}, RequiereAutorizacion, ErrVerificacionPendiente},
		{autorizada, nivelSinDeclarar, ErrAutorizacionPendiente},
	}
	for _, c := range casos {
		if err := c.sujeto.Alcanza(c.nivel); !errors.Is(err, c.quiere) {
			t.Errorf("%+v alcanza %s: %v, se esperaba %v", c.sujeto, c.nivel, err, c.quiere)
		}
	}
}

func TestNombresDeLosNiveles(t *testing.T) {
	for n, nombre := range map[NivelDeAcceso]string{
		Publica: "publica", SinVerificar: "sin_verificar", SinAutorizacion: "sin_autorizacion",
		RequiereAutorizacion: "requiere_autorizacion", nivelSinDeclarar: "sin_declarar",
	} {
		if n.String() != nombre {
			t.Errorf("%d se llama %q, se esperaba %q", n, n.String(), nombre)
		}
	}
	if nivelSinDeclarar.Valido() || NivelDeAcceso(99).Valido() || !RequiereAutorizacion.Valido() {
		t.Error("solo los cuatro niveles son válidos")
	}
}
