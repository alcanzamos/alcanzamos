//go:build integration

package presupuesto_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/presupuesto"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
)

// fotoDeEnCero es todo lo guardado en `presupuesto_en_cero` (persona y periodo), ordenado.
func (s *servidorDePrueba) fotoDeEnCero() string {
	s.t.Helper()
	var foto string
	if err := s.pool.QueryRow(context.Background(),
		`SELECT coalesce(string_agg(persona_id || '|' || periodo, ' ' ORDER BY persona_id, periodo), '') FROM presupuesto_en_cero`).Scan(&foto); err != nil {
		s.t.Fatal(err)
	}
	return foto
}

// «Dejar el presupuesto en cero» de punta a punta (PN-07, E14-PPA 4.2, CU-10 2a; L6 (5) de la US-77). Laura no tiene
// ingresos en noviembre y nada asignado (un gasto no cuenta): deja el mes en cero (`204`) y al recargar `en_cero` es true,
// así que el botón no vuelve. Otra vez es `204` y la marca sigue siendo una. La marca de Laura no es de Ana. Cuando llega un
// ingreso, la marca queda guardada pero `en_cero` es false (modo normal: «Cuando llegue un ingreso, puedes repartirlo.») y
// dejarlo en cero otra vez es `409 periodo_con_ingreso_o_presupuesto`.
func TestIntegracionDejarEnCero(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		ana := s.nuevaPersona("ana@ejemplo.test", android, true)
		c := s.nuevaPersona("laura@ejemplo.test", android, true)
		c.registrar(registro.Gasto, 1500000, "2026-11-02", transporte, "")
		c.registrar(registro.Ingreso, 9900, "2026-10-30", ventas, "") // octubre no cuenta en noviembre
		ana.registrar(registro.Ingreso, 9900, "2026-11-01", ventas, "")

		if v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", "")); v.Resumen.EnCero || v.Resumen.Modo != presupuesto.ModoIngresoNulo {
			t.Fatalf("antes: %+v", v.Resumen)
		}
		for i := range 2 {
			if r := c.llamar("POST", "/api/v1/presupuestos/en-cero", `{"periodo":"2026-11"}`); r.Codigo != 204 || r.Cuerpo != "" || r.Cache != "no-store" {
				t.Fatalf("vez %d: %d %s", i+1, r.Codigo, r.Cuerpo)
			}
		}
		if got := s.fotoDeEnCero(); got != c.persona+"|2026-11-01" {
			t.Errorf("guardado: %q", got)
		}
		v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos?periodo=2026-11", ""))
		if !v.Resumen.EnCero || v.Resumen.Modo != presupuesto.ModoIngresoNulo || v.Resumen.IngresoRegistrado != "0" || v.Resumen.Asignado != "0" {
			t.Errorf("tras dejarlo en cero: %+v", v.Resumen)
		}
		if v := leerJSON[vistaLeida](t, ana.llamar("GET", "/api/v1/presupuestos", "")); v.Resumen.EnCero {
			t.Errorf("la marca de Laura llegó a Ana: %+v", v.Resumen)
		}
		if v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos?periodo=2026-10", "")); v.Resumen.EnCero {
			t.Errorf("la marca de noviembre llegó a octubre: %+v", v.Resumen)
		}

		c.registrar(registro.Ingreso, 20000000, "2026-11-02", ventas, "")
		v = leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", ""))
		if v.Resumen.EnCero || v.Resumen.Modo != presupuesto.ModoNormal {
			t.Errorf("con un ingreso: %+v", v.Resumen)
		}
		if r := c.llamar("POST", "/api/v1/presupuestos/en-cero", `{"periodo":"2026-11"}`); r.Codigo != 409 || r.Cuerpo != `{"error":"periodo_con_ingreso_o_presupuesto"}` {
			t.Errorf("con un ingreso: %d %s", r.Codigo, r.Cuerpo)
		}
		if got := s.fotoDeEnCero(); got != c.persona+"|2026-11-01" {
			t.Errorf("la marca es historia y sigue: %q", got)
		}
	})
}

// Con algo asignado no se deja en cero (`409`, sin guardar nada); al quitarlo, sí. Si después se pone un presupuesto, la
// marca sigue y `en_cero` es false; al quitarlo de nuevo, el mes vuelve a estar en cero y `en_cero` es true. Otro mes es
// `409 periodo_no_editable`, como poner un presupuesto.
func TestIntegracionDejarEnCeroConAlgoAsignadoYEnOtroMes(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", true, true)
	p := presupuestoDe(t, c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":100}`))
	if r := c.llamar("POST", "/api/v1/presupuestos/en-cero", `{"periodo":"2026-11"}`); r.Codigo != 409 || r.Cuerpo != `{"error":"periodo_con_ingreso_o_presupuesto"}` {
		t.Errorf("con algo asignado: %d %s", r.Codigo, r.Cuerpo)
	}
	if got := s.fotoDeEnCero(); got != "" {
		t.Errorf("guardado con algo asignado: %q", got)
	}
	for _, periodo := range []string{"2026-10", "2026-12"} {
		if r := c.llamar("POST", "/api/v1/presupuestos/en-cero", `{"periodo":"`+periodo+`"}`); r.Codigo != 409 || r.Cuerpo != `{"error":"periodo_no_editable"}` {
			t.Errorf("%s: %d %s", periodo, r.Codigo, r.Cuerpo)
		}
	}
	if r := c.llamar("DELETE", "/api/v1/presupuestos/"+p.ID, ""); r.Codigo != 204 {
		t.Fatalf("quitar: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("POST", "/api/v1/presupuestos/en-cero", `{"periodo":"2026-11"}`); r.Codigo != 204 {
		t.Fatalf("sin nada asignado: %d %s", r.Codigo, r.Cuerpo)
	}
	p = presupuestoDe(t, c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":100}`))
	if v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", "")); v.Resumen.EnCero || v.Resumen.Asignado != "100" {
		t.Errorf("con un presupuesto: %+v", v.Resumen)
	}
	if r := c.llamar("DELETE", "/api/v1/presupuestos/"+p.ID, ""); r.Codigo != 204 {
		t.Fatalf("quitar: %d %s", r.Codigo, r.Cuerpo)
	}
	if v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", "")); !v.Resumen.EnCero {
		t.Errorf("otra vez en cero: %+v", v.Resumen)
	}
	if got := s.fotoDeEnCero(); got != c.persona+"|2026-11-01" {
		t.Errorf("guardado: %q", got)
	}
}

// Solo una persona adulta deja su presupuesto en cero (la llave de 0004 apunta a `perfil_adulto`): el repositorio da
// ErrSoloAdultos con una menor y ErrSinCuenta con una cuenta borrada, sin guardar nada. Va contra el repositorio porque un
// menor todavía no inicia sesión (I11).
func TestIntegracionUnaMenorYUnaCuentaBorradaNoDejanEnCero(t *testing.T) {
	s := nuevoServidor(t)
	repo := pg.NuevoPresupuestos(s.pool)
	noviembre := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	if err := repo.DejarEnCero(context.Background(), s.nuevoMenor(), noviembre); !errors.Is(err, presupuesto.ErrSoloAdultos) {
		t.Errorf("menor: %v", err)
	}
	if err := repo.DejarEnCero(context.Background(), "0192f3c4-0000-7000-8000-0000000000ff", noviembre); !errors.Is(err, registro.ErrSinCuenta) {
		t.Errorf("cuenta borrada: %v", err)
	}
	if got := s.fotoDeEnCero(); got != "" {
		t.Errorf("guardado: %q", got)
	}
}
