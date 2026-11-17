package fechas_test

import (
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
)

// D-090: la fecha de un correo va en palabras y en hora de Colombia (UTC−5 todo el año), con la misma forma que
// `fechaEnPalabras` de la app móvil, sin el «el» del comienzo: «18 de noviembre de 2026, a las 9:30 a. m.».
func TestEnPalabrasEsLaHoraDeColombiaEnPalabras(t *testing.T) {
	utc := func(anio int, mes time.Month, dia, hora, minuto int) time.Time {
		return time.Date(anio, mes, dia, hora, minuto, 0, 0, time.UTC)
	}
	casos := []struct {
		nombre   string
		instante time.Time
		esperado string
	}{
		{"mañana en Colombia", utc(2026, time.November, 18, 14, 30), "18 de noviembre de 2026, a las 9:30 a. m."},
		{"mediodía", utc(2026, time.November, 12, 17, 0), "12 de noviembre de 2026, a las 12:00 p. m."},
		{"medianoche", utc(2026, time.November, 12, 5, 0), "12 de noviembre de 2026, a las 12:00 a. m."},
		{"la una de la madrugada va con «a la»", utc(2026, time.November, 12, 6, 5), "12 de noviembre de 2026, a la 1:05 a. m."},
		{"la una de la tarde va con «a la»", utc(2026, time.November, 12, 18, 7), "12 de noviembre de 2026, a la 1:07 p. m."},
		{"las diez de la noche", utc(2026, time.November, 13, 3, 0), "12 de noviembre de 2026, a las 10:00 p. m."},
		{"el día de Colombia, no el de UTC", utc(2027, time.January, 1, 3, 0), "31 de diciembre de 2026, a las 10:00 p. m."},
		{"minutos con cero a la izquierda", utc(2026, time.March, 5, 15, 9), "5 de marzo de 2026, a las 10:09 a. m."},
		{"una hora con otra zona vale lo mismo", time.Date(2026, time.November, 18, 9, 30, 0, 0, time.FixedZone("COT", -5*3600)), "18 de noviembre de 2026, a las 9:30 a. m."},
		{"segundos y nanosegundos no cuentan", time.Date(2026, time.November, 18, 14, 30, 59, 999, time.UTC), "18 de noviembre de 2026, a las 9:30 a. m."},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			if obtenido := fechas.EnPalabras(c.instante); obtenido != c.esperado {
				t.Errorf("%q, se esperaba %q", obtenido, c.esperado)
			}
		})
	}
}

// Los doce meses, con sus nombres propios en español (no dependen de la zona ni del idioma del sistema).
func TestEnPalabrasTieneLosDoceMeses(t *testing.T) {
	meses := []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}
	for i, mes := range meses {
		instante := time.Date(2026, time.Month(i+1), 15, 17, 0, 0, 0, time.UTC)
		if obtenido, esperado := fechas.EnPalabras(instante), "15 de "+mes+" de 2026, a las 12:00 p. m."; obtenido != esperado {
			t.Errorf("%q, se esperaba %q", obtenido, esperado)
		}
	}
}
