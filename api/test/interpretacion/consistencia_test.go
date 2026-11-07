package interpretacion_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/interpretacion"
)

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// IAR-004 (E18-PPR, ADR-005 §5.3): el motor en Go da la misma salida que el prototipo de Python, mensaje por mensaje
// y campo por campo (monto, tipo, fecha, categoría e intención), en los dos conjuntos congelados. El monto del
// prototipo es en pesos; el del motor, en centavos (D-082).
func TestIAR004MismaSalidaQueElPrototipoMensajePorMensaje(t *testing.T) {
	motor := motorReal(t)
	total := 0
	for _, c := range conjuntos {
		filas, referencias := cargarConjunto(t, c)
		if len(filas) != len(referencias) {
			t.Fatalf("%s: %d mensajes y %d salidas de referencia", c.nombre, len(filas), len(referencias))
		}
		diferencias := 0
		for i, f := range filas {
			ref := referencias[i]
			if ref.ID != f.ID || ref.FechaReferencia != "2026-11-02" || ref.VersionReglas != "D-1.0" {
				t.Fatalf("%s: la referencia %d es %+v y el mensaje es %s", c.nombre, i, ref, f.ID)
			}
			obtenida, err := motor.Interpretar(context.Background(), interpretacion.Entrada{Texto: f.Texto, FechaReferencia: fechaReferencia})
			if err != nil {
				t.Fatalf("%s %s: %v", c.nombre, f.ID, err)
			}
			if !iguales(obtenida, ref) {
				diferencias++
				// Sin el texto del mensaje: solo el id y los campos (el texto está en el conjunto).
				t.Errorf("%s %s: el motor dio %s, el prototipo %s", c.nombre, f.ID, descripcion(obtenida), descripcionReferencia(ref))
			}
		}
		total += len(filas)
		t.Logf("IAR-004 %s: %d mensajes comparados, %d diferencias", c.nombre, len(filas), diferencias)
	}
	if total != 345 {
		t.Errorf("se compararon %d mensajes, se esperaban 345 (245 + 100)", total)
	}
}

func iguales(o interpretacion.Interpretacion, r referencia) bool {
	if o.ReglasVersion != r.VersionReglas || string(o.Intencion) != r.Intencion {
		return false
	}
	if (o.Monto == nil) != (r.Monto == nil) || (o.Monto != nil && *o.Monto != *r.Monto*100) {
		return false
	}
	if (o.Fecha == nil) != (r.Fecha == nil) || (o.Fecha != nil && o.Fecha.Format(time.DateOnly) != *r.Fecha) {
		return false
	}
	return string(o.Tipo) == texto(r.Tipo) && o.Categoria == texto(r.Categoria)
}

func descripcion(o interpretacion.Interpretacion) string {
	monto, fecha := "null", "null"
	if o.Monto != nil {
		monto = formatear(*o.Monto)
	}
	if o.Fecha != nil {
		fecha = o.Fecha.Format(time.DateOnly)
	}
	return "{monto:" + monto + " tipo:" + string(o.Tipo) + " fecha:" + fecha + " categoria:" + o.Categoria + " intencion:" + string(o.Intencion) + "}"
}

func descripcionReferencia(r referencia) string {
	monto, fecha := "null", "null"
	if r.Monto != nil {
		monto = formatear(*r.Monto * 100)
	}
	if r.Fecha != nil {
		fecha = *r.Fecha
	}
	return "{monto:" + monto + " tipo:" + texto(r.Tipo) + " fecha:" + fecha + " categoria:" + texto(r.Categoria) + " intencion:" + r.Intencion + "}"
}

// IAR-001 (RNF-006): la exactitud sobre el código real, calculada como medir.py: solo los mensajes de intención
// «registro»; un campo que falta cuenta como fallo; la categoría solo acierta si el tipo también.
func TestIAR001ExactitudDelCodigoRealCumpleRNF006(t *testing.T) {
	motor := motorReal(t)
	for _, c := range conjuntos {
		filas, _ := cargarConjunto(t, c)
		registros, montoOK, tipoOK, fechaOK, mtfOK, categoriaOK := 0, 0, 0, 0, 0, 0
		for _, f := range filas {
			res, err := motor.Interpretar(context.Background(), interpretacion.Entrada{Texto: f.Texto, FechaReferencia: fechaReferencia})
			if err != nil {
				t.Fatalf("%s %s: %v", c.nombre, f.ID, err)
			}
			if f.Intencion != "registro" {
				continue
			}
			registros++
			monto := (res.Monto == nil && f.Esperado.Monto == nil) || (res.Monto != nil && f.Esperado.Monto != nil && *res.Monto == *f.Esperado.Monto*100)
			tipo := string(res.Tipo) == texto(f.Esperado.Tipo)
			fecha := res.Fecha != nil && f.Esperado.Fecha != nil && res.Fecha.Format(time.DateOnly) == *f.Esperado.Fecha
			categoria := res.Categoria == texto(f.Esperado.Categoria) && tipo
			montoOK += b(monto)
			tipoOK += b(tipo)
			fechaOK += b(fecha)
			mtfOK += b(monto && tipo && fecha)
			categoriaOK += b(categoria)
		}
		pct := func(n int) float64 { return 100 * float64(n) / float64(registros) }
		t.Logf("IAR-001 %s (%d registros): monto %.1f %%, tipo %.1f %%, fecha %.1f %%, monto+tipo+fecha %.1f %%, categoría %.1f %%",
			c.nombre, registros, pct(montoOK), pct(tipoOK), pct(fechaOK), pct(mtfOK), pct(categoriaOK))
		// RNF-006: ≥ 90 % en monto, tipo y fecha (juntos) y ≥ 80 % en categoría. Por campo también ≥ 90 %.
		for nombre, aciertos := range map[string]int{"monto": montoOK, "tipo": tipoOK, "fecha": fechaOK, "monto+tipo+fecha": mtfOK} {
			if aciertos*100 < 90*registros {
				t.Errorf("%s: %s %d/%d no llega al 90 %%", c.nombre, nombre, aciertos, registros)
			}
		}
		if categoriaOK*100 < 80*registros {
			t.Errorf("%s: categoría %d/%d no llega al 80 %%", c.nombre, categoriaOK, registros)
		}
	}
}

func b(ok bool) int {
	if ok {
		return 1
	}
	return 0
}

func formatear(n int64) string { return strconv.FormatInt(n, 10) }
