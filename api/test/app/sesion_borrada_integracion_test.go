//go:build integration

package app_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// Un dispositivo con la sesión quieta tiene la sesión quieta hace más de 5 minutos: Sujeto la desliza (UPDATE sesion) y ese UPDATE
// espera al borrado, que ya borró la sesión en cascada. Al confirmar el borrado, Sujeto ya leyó la sesión y lee las
// autorizaciones retiradas: ¿401 o 403?
func TestSesionQuietaQueSeBorraConLaCuentaEsUn401(t *testing.T) {
	e := vArmar(t)
	fs := vFechas()
	ctx := context.Background()
	for i, p := range [][3]string{{"GET", "/api/v1/repeticiones/pendientes", ""}, {"POST", "/api/v1/repeticiones/decisiones", ""}, {"POST", "/confirmacion", ""}, {"GET", "/api/v1/cuenta/datos", ""}} {
		c := e.sembrar(t, fmt.Sprintf("f5-%d@ejemplo.test", i), 1, 1234)
		ruta, cuerpo := p[1], p[2]
		switch p[1] {
		case "/api/v1/repeticiones/decisiones":
			cuerpo = vDecisiones(c.recs, fs[:1])
		case "/confirmacion":
			ruta, cuerpo = "/api/v1/repeticiones/"+c.recs[0]+"/confirmacion", fmt.Sprintf(`{"fecha":%q}`, fs[0])
		}
		huellaB, err := seguridad.HuellaDeToken(c.tokB)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := e.pool.Exec(ctx, `UPDATE sesion SET creada_en = now() - interval '10 minutes', ultimo_uso_en = now() - interval '10 minutes' WHERE hash_token = $1`, huellaB); err != nil {
			t.Fatal(err)
		}
		h := e.retener(t, `SELECT 1 FROM sesion WHERE hash_token = $1 FOR UPDATE`, huellaB)
		bor := vAsync(func() (int, []byte) { return e.borrar(c) })
		e.esperarBloqueo(t, "DELETE FROM persona WHERE id = ANY%")
		dec := vAsync(func() (int, []byte) { return e.pedir(c.tokB, p[0], ruta, cuerpo) })
		e.esperarBloqueo(t, "UPDATE sesion SET ultimo_uso_en%")
		if err := h.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		d, b := <-dec, <-bor
		t.Logf("F5 %s %s: US-60 %d %s; borrado %d %s; estado %+v", p[0], ruta, d.code, vCodigo(d.body), b.code, vCodigo(b.body), e.estado(t, c))
		if d.code != 401 || vCodigo(d.body) != "sin_sesion" || b.code != 200 {
			t.Errorf("F5 %s %s: la sesión se borró con el borrado y se esperaba 401 sin_sesion; salió %d %s (borrado %d)", p[0], ruta, d.code, d.body, b.code)
		}
	}
}
