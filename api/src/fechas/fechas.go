// Package fechas calcula las fechas de un movimiento recurrente (E15 5.2, RF-006): las que programa su periodicidad
// dentro de un mes, las que están pendientes de confirmar (D-091) y las próximas desde hoy (PN-03). Es código puro: no
// toca la base ni el reloj. Las fechas son días calendario: un `time.Time` en UTC a medianoche (ver Dia).
package fechas

import (
	"errors"
	"slices"
	"time"
)

// Periodicidad es cada cuánto se repite un movimiento (E12 §6.8, RF-006).
type Periodicidad string

// Las cinco periodicidades de la ERS.
const (
	Semanal   Periodicidad = "semanal"
	Quincenal Periodicidad = "quincenal"
	Mensual   Periodicidad = "mensual"
	Semestral Periodicidad = "semestral"
	Anual     Periodicidad = "anual"
)

// Errores de E15 5.2.
var (
	ErrPeriodicidadDesconocida = errors.New("periodicidad desconocida")
	ErrPeriodoInvalido         = errors.New("el periodo no empieza el día 1")
	ErrFechaConfirmadaYOmitida = errors.New("una fecha no puede estar confirmada y omitida a la vez")
)

// Valida dice si es una de las cinco periodicidades.
func (p Periodicidad) Valida() bool {
	switch p {
	case Semanal, Quincenal, Mensual, Semestral, Anual:
		return true
	}
	return false
}

// colombia es UTC−5 todo el año: Colombia no tiene horario de verano. Una zona fija evita depender de la base de
// zonas horarias del sistema, que la imagen mínima no trae.
var colombia = time.FixedZone("COT", -5*60*60)

// Dia es el día calendario a medianoche UTC.
func Dia(anio int, mes time.Month, dia int) time.Time {
	return time.Date(anio, mes, dia, 0, 0, 0, 0, time.UTC)
}

// HoyEnColombia es el día calendario de `ahora` en hora de Colombia (D-164: «hoy» de la persona).
func HoyEnColombia(ahora time.Time) time.Time {
	a := ahora.In(colombia)
	return Dia(a.Year(), a.Month(), a.Day())
}

func ultimoDelMes(anio int, mes time.Month) int { return Dia(anio, mes+1, 0).Day() }

// ajustar lleva un día que no existe en el mes (el 31 en abril, el 30 en febrero) a su último día.
func ajustar(anio int, mes time.Month, dia int) time.Time {
	return Dia(anio, mes, min(dia, ultimoDelMes(anio, mes)))
}

// Programadas son las fechas de la periodicidad dentro del mes de `periodo` (su primer día), de la más antigua a la
// más reciente y sin las anteriores a `inicio` (E15 5.2 `fechasProgramadas`). No sabe de confirmaciones.
func Programadas(p Periodicidad, inicio, periodo time.Time) ([]time.Time, error) {
	if periodo.Day() != 1 {
		return nil, ErrPeriodoInvalido
	}
	anio, mes := periodo.Year(), periodo.Month()
	var fechas []time.Time
	switch p {
	case Semanal:
		d := inicio
		if inicio.Before(periodo) {
			dias := int(periodo.Sub(inicio) / (24 * time.Hour))
			d = inicio.AddDate(0, 0, (dias+6)/7*7) // la primera inicio + 7k que no es anterior al periodo
		}
		for ; d.Month() == mes && d.Year() == anio; d = d.AddDate(0, 0, 7) {
			fechas = append(fechas, d)
		}
	case Quincenal:
		base := inicio.Day()
		if base > 15 {
			base -= 15
		}
		fechas = append(fechas, ajustar(anio, mes, base), ajustar(anio, mes, base+15))
	case Mensual:
		fechas = append(fechas, ajustar(anio, mes, inicio.Day()))
	case Semestral:
		if (int(mes)-int(inicio.Month())+12)%6 == 0 {
			fechas = append(fechas, ajustar(anio, mes, inicio.Day()))
		}
	case Anual:
		if mes == inicio.Month() {
			fechas = append(fechas, ajustar(anio, mes, inicio.Day()))
		}
	default:
		return nil, ErrPeriodicidadDesconocida
	}
	return slices.DeleteFunc(fechas, func(f time.Time) bool { return f.Before(inicio) }), nil
}

// Pendientes son las fechas del mes que siguen pendientes (E15 5.2 `fechasPendientes`, D-091, D-092): las programadas
// sin las confirmadas, sin las omitidas («No pasó»), sin las anteriores a `creadoEl` (son historia: no quedan
// pendientes) y sin las de `detenidoEn` en adelante. Una fecha confirmada y omitida a la vez es un error.
func Pendientes(p Periodicidad, inicio, periodo time.Time, confirmadas, omitidas []time.Time, creadoEl time.Time, detenidoEn *time.Time) ([]time.Time, error) {
	for _, f := range confirmadas {
		if slices.ContainsFunc(omitidas, f.Equal) {
			return nil, ErrFechaConfirmadaYOmitida
		}
	}
	programadas, err := Programadas(p, inicio, periodo)
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(programadas, func(f time.Time) bool {
		return slices.ContainsFunc(confirmadas, f.Equal) || slices.ContainsFunc(omitidas, f.Equal) ||
			f.Before(creadoEl) || (detenidoEn != nil && !f.Before(*detenidoEn))
	}), nil
}

// PorConfirmar son las fechas pendientes que ya llegaron (f ≤ hoy): las de «Por confirmar» (E14-PRR). Aplica
// Pendientes mes por mes, desde el de max(inicio, creadoEl) hasta el de hoy.
func PorConfirmar(p Periodicidad, inicio time.Time, confirmadas, omitidas []time.Time, creadoEl, hoy time.Time, detenidoEn *time.Time) ([]time.Time, error) {
	desde := inicio
	if creadoEl.After(desde) {
		desde = creadoEl
	}
	var llegadas []time.Time
	for mes := Dia(desde.Year(), desde.Month(), 1); !mes.After(hoy); mes = mes.AddDate(0, 1, 0) {
		del, err := Pendientes(p, inicio, mes, confirmadas, omitidas, creadoEl, detenidoEn)
		if err != nil {
			return nil, err
		}
		llegadas = append(llegadas, slices.DeleteFunc(del, func(f time.Time) bool { return f.After(hoy) })...)
	}
	return llegadas, nil
}

// Proximas son hasta `n` fechas programadas posteriores a `hoy` (no la de hoy ni las anteriores) y no anteriores a
// `inicio`: la tarjeta «Próximas fechas desde Hoy» de PN-03.
func Proximas(p Periodicidad, inicio, hoy time.Time, n int) ([]time.Time, error) {
	desde := hoy
	if inicio.After(desde) {
		desde = inicio
	}
	var proximas []time.Time
	// La periodicidad más espaciada (anual) cae al menos una vez cada 12 meses: n fechas caben en 12·n + 1 meses.
	for i, mes := 0, Dia(desde.Year(), desde.Month(), 1); i <= 12*n && len(proximas) < n; i, mes = i+1, mes.AddDate(0, 1, 0) {
		del, err := Programadas(p, inicio, mes)
		if err != nil {
			return nil, err
		}
		for _, f := range del {
			if f.After(hoy) && len(proximas) < n {
				proximas = append(proximas, f)
			}
		}
	}
	return proximas, nil
}
