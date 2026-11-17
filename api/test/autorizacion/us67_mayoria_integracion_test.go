//go:build integration

package autorizacion_test

import (
	"context"
	"testing"
)

func TestALos18LaTransmisionPropiaReemplazaLaDelTutor(t *testing.T) {
	s := nuevoServidor(t)
	c, titular := s.cuentaDeAntes("adulta@ejemplo.test", false)
	_, tutor := s.nuevaCuentaVerificada("tutor@ejemplo.test", false)

	_, err := s.pool.Exec(context.Background(),
		`INSERT INTO autorizacion
		     (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en)
		 VALUES ($1::uuid, $2::uuid, 'transmision_a_encargados', $3, $4)`,
		titular, tutor, versionNueva, s.reloj.T)
	if err != nil {
		t.Fatal(err)
	}

	r := c.llamar("POST", rutaAutorizar,
		`{"finalidades":["transmision_a_encargados"],"version":"1.1"}`)
	if r.Codigo != 200 || r.Cuerpo != `{"estado":"autorizada"}` {
		t.Fatalf("autorizar: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 200 {
		t.Fatalf("acceso tras aceptación propia: %d %s", r.Codigo, r.Cuerpo)
	}
	if n := s.contar(
		`SELECT count(*) FROM autorizacion
		 WHERE titular_id = $1::uuid AND otorgante_id = $1::uuid
		   AND finalidad = 'transmision_a_encargados'
		   AND retirada_en IS NULL`, titular); n != 1 {
		t.Fatalf("otorgamientos propios vigentes: %d", n)
	}
	if n := s.contar(
		`SELECT count(*) FROM autorizacion
		 WHERE titular_id = $1::uuid AND otorgante_id = $2::uuid
		   AND finalidad = 'transmision_a_encargados'`,
		titular, tutor); n != 1 {
		t.Fatal("se perdió la prueba del otorgamiento del tutor")
	}
}
