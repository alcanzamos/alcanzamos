package cuenta_test

import (
	"context"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
)

type purgaLentaI294 struct {
	*repoFalso
	avanzar func()
}

func (r *purgaLentaI294) BorrarSinConfirmar(ctx context.Context, p cuenta.PlazosDeLaPurga) (cuenta.ResultadoDeLaPurga, error) {
	r.avanzar()
	return r.repoFalso.BorrarSinConfirmar(ctx, p)
}

// S1/S2/S5: a slow purge cannot shorten the 48 hours following the notice.
func TestI294AvisoDespuesDeUnaPurgaLenta(t *testing.T) {
	e := nuevoEntorno()
	e.repo.porAvisar = []cuenta.CuentaPorAvisar{{ID: "p1", Correo: "laura@ejemplo.test", CreadaEn: ahoraDePrueba.Add(-6 * 24 * time.Hour)}}
	envioEn := ahoraDePrueba.Add(15 * time.Minute)
	repo := &purgaLentaI294{repoFalso: e.repo, avanzar: func() { e.reloj.T = envioEn }}
	d := dependenciasCompletas()
	d.Repo, d.Correo, d.Reloj, d.Log = repo, e.correo, e.reloj, e.log()
	s, err := cuenta.NuevoServicio(d)
	if err != nil {
		t.Fatal(err)
	}
	// Las dos tareas de la corrida, en el orden del ejecutor: la purga (lenta) y después los avisos, con la misma `ahora`.
	if _, err := s.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AvisarAntesDeLaPurga(context.Background(), ahoraDePrueba); err != nil {
		t.Fatal(err)
	}
	if en := e.repo.avisadas["p1"]; en.Before(envioEn) {
		t.Errorf("aviso registrado %v antes del envio %v", en, envioEn)
	}
	enviados := e.correo.Enviados()
	if len(enviados) != 1 {
		t.Fatalf("avisos: %v", enviados)
	}
	if enviados[0].BorradoEn.Before(envioEn.Add(48 * time.Hour)) {
		t.Errorf("borrado %v no respeta 48 h desde el aviso %v", enviados[0].BorradoEn, envioEn)
	}
}
