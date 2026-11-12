//go:build integration

package autorizacion_test

import (
	"context"
	"testing"
	"time"
)

// A los 18 años lo del tutor no se borra ni se cambia: queda retirado, con su fecha, su versión y su otorgante, y sin plazo de
// conservación (la cuenta existe). Antes de aceptar, PN-64 le muestra a la persona solo la aceptación que le falta, aunque
// la del tutor siga vigente; lo que el tutor dio de otra finalidad que la persona no otorga no se toca.
func TestALos18LoDelTutorQuedaComoHistoria(t *testing.T) {
	s := nuevoServidor(t)
	ctx := context.Background()
	c, titular := s.cuentaDeAntes("adulta@ejemplo.test", false)
	_, tutor := s.nuevaCuentaVerificada("tutor@ejemplo.test", false)
	otorgadaPorElTutor := s.reloj.T.Add(-24 * time.Hour)
	for _, f := range []string{"transmision_a_encargados", "cuenta_del_menor"} {
		if _, err := s.pool.Exec(ctx,
			`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
			titular, tutor, f, versionVieja, otorgadaPorElTutor); err != nil {
			t.Fatal(err)
		}
	}

	const soloLaTransmision = `{"finalidades":[{"codigo":"transmision_a_encargados","tipo":"necesaria","otorgada":false}],` +
		`"modo":"falta_una_aceptacion","version":{"numero":"1.1","fecha":"2026-11-12"}}`
	if r := c.llamar("GET", rutaAutorizar, ""); r.Codigo != 200 || r.Cuerpo != soloLaTransmision {
		t.Fatalf("GET /autorizaciones: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("POST", rutaAutorizar, `{"finalidades":["transmision_a_encargados"],"version":"1.1"}`); r.Codigo != 200 {
		t.Fatalf("autorizar: %d %s", r.Codigo, r.Cuerpo)
	}

	var version string
	var otorgada, retirada time.Time
	var conservar *time.Time
	if err := s.pool.QueryRow(ctx,
		`SELECT version_del_texto, otorgada_en, retirada_en, conservar_hasta FROM autorizacion
		 WHERE titular_id = $1::uuid AND otorgante_id = $2::uuid AND finalidad = 'transmision_a_encargados'`, titular, tutor).
		Scan(&version, &otorgada, &retirada, &conservar); err != nil {
		t.Fatal(err)
	}
	if version != versionVieja || !otorgada.Equal(otorgadaPorElTutor) || !retirada.Equal(s.reloj.T) || conservar != nil {
		t.Errorf("lo del tutor: versión %q, otorgada %v, retirada %v, conservar %v", version, otorgada, retirada, conservar)
	}
	// Lo que el tutor dio de otra finalidad sigue vigente: la persona no la otorgó.
	if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND otorgante_id = $2::uuid AND finalidad = 'cuenta_del_menor' AND retirada_en IS NULL`, titular, tutor); n != 1 {
		t.Errorf("cuenta_del_menor del tutor debía seguir igual: %d", n)
	}
	// Repetir la aceptación no cambia nada.
	if r := c.llamar("POST", rutaAutorizar, `{"finalidades":["transmision_a_encargados"],"version":"1.1"}`); r.Codigo != 200 {
		t.Fatalf("repetir: %d %s", r.Codigo, r.Cuerpo)
	}
	if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'transmision_a_encargados'`, titular); n != 2 {
		t.Errorf("tras repetir hay %d filas de transmision_a_encargados, se esperaban 2 (la del tutor y la propia)", n)
	}
}
