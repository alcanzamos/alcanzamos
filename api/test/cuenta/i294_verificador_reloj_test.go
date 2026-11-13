package cuenta_test

import (
	"context"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
)

type correoQueAvanzaI294 struct {
	*correotest.Falso
	avanzar func()
}

func (c *correoQueAvanzaI294) EnviarAvisoDePurga(ctx context.Context, destino string, borrado time.Time) error {
	err := c.Falso.EnviarAvisoDePurga(ctx, destino, borrado)
	c.avanzar()
	return err
}

// S1, S2, S5 y L9: se lee la hora por cuenta, no una vez al comenzar los avisos.
func TestI294VerificadorHoraPorCadaEnvio(t *testing.T) {
	e := nuevoEntorno()
	e.repo.porAvisar = []cuenta.CuentaPorAvisar{
		{ID: "p1", Correo: "uno@ejemplo.test", CreadaEn: ahoraDePrueba.Add(-6 * dia)},
		{ID: "p2", Correo: "dos@ejemplo.test", CreadaEn: ahoraDePrueba.Add(-6 * dia)},
	}
	d := dependenciasCompletas()
	d.Repo, d.Reloj, d.Log = e.repo, e.reloj, e.log()
	d.Correo = &correoQueAvanzaI294{Falso: e.correo, avanzar: func() { e.reloj.T = e.reloj.T.Add(19 * time.Minute) }}
	s, err := cuenta.NuevoServicio(d)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AvisarAntesDeLaPurga(context.Background(), ahoraDePrueba); err != nil {
		t.Fatal(err)
	}
	enviados := e.correo.Enviados()
	if len(enviados) != 2 {
		t.Fatalf("envios: %+v", enviados)
	}
	for i, id := range []string{"p1", "p2"} {
		esperado := ahoraDePrueba.Add(time.Duration(i) * 19 * time.Minute)
		if !e.repo.avisadas[id].Equal(esperado) || !enviados[i].BorradoEn.Equal(esperado.Add(48*time.Hour)) {
			t.Errorf("%s: aviso=%v borrado=%v; envio esperado=%v", id, e.repo.avisadas[id], enviados[i].BorradoEn, esperado)
		}
	}
}
