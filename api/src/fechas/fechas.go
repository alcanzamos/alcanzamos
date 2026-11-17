// Package fechas calcula las fechas de un movimiento recurrente (E15 5.2, RF-006): las que programa su periodicidad
// dentro de un mes, las que están pendientes de confirmar (D-091) y las próximas desde hoy (PN-03). Es código puro: no
// toca la base ni el reloj. Las fechas son días calendario: un `time.Time` en UTC a medianoche (ver Dia).
package fechas

import (
	"errors"
	"fmt"
	"math/big"
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
	ErrFechaNoPendiente        = errors.New("la fecha no está pendiente, o tiene dos decisiones")
	ErrMontoInvalido           = errors.New("el monto debe ser mayor que cero, y una fecha «No pasó» no lleva monto")
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

// meses son los nombres propios de los meses: no dependen del idioma ni de la zona del sistema (D-090).
var meses = [...]string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}

// EnPalabras es el instante en palabras y en hora de Colombia (D-090): «18 de noviembre de 2026, a las 9:30 a. m.».
// Es la forma de `fechaEnPalabras` de la app móvil sin el «el» del comienzo, para que la frase lo ponga («la borramos el
// …»). La una va con «a la» («a la 1:05 p. m.»). Se ignoran los segundos.
func EnPalabras(instante time.Time) string {
	a := instante.In(colombia)
	hora12 := a.Hour() % 12
	if hora12 == 0 {
		hora12 = 12
	}
	articulo, jornada := "a las", "a. m."
	if hora12 == 1 {
		articulo = "a la"
	}
	if a.Hour() >= 12 {
		jornada = "p. m."
	}
	return fmt.Sprintf("%d de %s de %d, %s %d:%02d %s", a.Day(), meses[a.Month()-1], a.Year(), articulo, hora12, a.Minute(), jornada)
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
			EsHistoria(f, creadoEl) || (detenidoEn != nil && !f.Before(*detenidoEn))
	}), nil
}

// EsHistoria dice si la fecha programada `f` es anterior al día en que se creó la repetición (`creadoEl`, en hora de
// Colombia): E15 5.2 no la deja pendiente. Es la regla única de Pendientes y de VuelveAPendiente (D-169).
func EsHistoria(f, creadoEl time.Time) bool { return f.Before(creadoEl) }

// VuelveAPendiente dice si, al borrar el movimiento que confirmó la fecha programada `f`, E15 5.2 la vuelve a dejar
// pendiente: sí si no es historia (D-169). Usa EsHistoria, la misma condición de Pendientes y de PorConfirmar, para que
// no se separen.
func VuelveAPendiente(f, creadoEl time.Time) bool { return !EsHistoria(f, creadoEl) }

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

// FechaPorConfirmar es una fecha pendiente que ya llegó, con el monto habitual de su recurrente (E15 5.2).
type FechaPorConfirmar struct {
	Recurrente string // identificador del recurrente
	Fecha      time.Time
	Monto      int64 // centavos: el habitual
	EsIngreso  bool
}

// DecisionDeFecha es lo que la persona decide de una fecha pendiente en «Confirmar todos» (D-093).
type DecisionDeFecha struct {
	Recurrente string
	Fecha      time.Time
	Monto      *int64 // centavos; nil: el monto habitual
	Omitida    bool   // «No pasó» (D-092)
}

// ConfirmacionEnBloque es el resultado de ConfirmarVarias. Ingresos y Gastos suman las confirmadas con el monto que
// quedó registrado; son big.Int porque la suma de montos válidos de int64 puede no caber en un int64.
type ConfirmacionEnBloque struct {
	Confirmadas []FechaPorConfirmar // con el monto que quedó registrado, en el orden de las decisiones
	Omitidas    []FechaPorConfirmar
	Pendientes  []FechaPorConfirmar // sin decisión: siguen pendientes
	Ingresos    *big.Int
	Gastos      *big.Int
}

// FechaDelMovimiento es la fecha con la que se guarda la ocurrencia confirmada: su fecha programada, nunca `hoy`
// (E15 5.2, D-094): así un movimiento confirmado con atraso no pasa de un mes a otro.
func FechaDelMovimiento(p FechaPorConfirmar, _ time.Time) time.Time { return p.Fecha }

// claveDeFecha identifica una ocurrencia; la fecha va como texto para no depender de la zona ni del reloj de `time`.
type claveDeFecha struct{ recurrente, fecha string }

func claveDe(recurrente string, f time.Time) claveDeFecha {
	return claveDeFecha{recurrente, f.Format(time.DateOnly)}
}

// ConfirmarVarias aplica las decisiones de «Confirmar todos» a las fechas pendientes (E15 5.2 `confirmarVarias`,
// D-093). Es todo o nada: si una decisión no vale devuelve el error y ningún resultado. ErrFechaNoPendiente si una
// decisión es de una fecha que no está en `pendientes` o si una fecha trae dos decisiones; ErrMontoInvalido si un monto
// no es mayor que cero o si una fecha «No pasó» lleva monto. Lo que no tiene decisión sigue pendiente.
func ConfirmarVarias(pendientes []FechaPorConfirmar, decisiones []DecisionDeFecha) (ConfirmacionEnBloque, error) {
	porClave := make(map[claveDeFecha]FechaPorConfirmar, len(pendientes))
	for _, p := range pendientes {
		porClave[claveDe(p.Recurrente, p.Fecha)] = p
	}
	vistas := make(map[claveDeFecha]bool, len(decisiones))
	r := ConfirmacionEnBloque{Ingresos: new(big.Int), Gastos: new(big.Int)}
	for _, d := range decisiones {
		clave := claveDe(d.Recurrente, d.Fecha)
		p, esta := porClave[clave]
		if !esta || vistas[clave] {
			return ConfirmacionEnBloque{}, ErrFechaNoPendiente
		}
		vistas[clave] = true
		if d.Omitida {
			if d.Monto != nil {
				return ConfirmacionEnBloque{}, ErrMontoInvalido
			}
			r.Omitidas = append(r.Omitidas, p)
			continue
		}
		if d.Monto != nil {
			if *d.Monto <= 0 {
				return ConfirmacionEnBloque{}, ErrMontoInvalido
			}
			p.Monto = *d.Monto
		}
		r.Confirmadas = append(r.Confirmadas, p)
		if p.EsIngreso {
			r.Ingresos.Add(r.Ingresos, big.NewInt(p.Monto))
		} else {
			r.Gastos.Add(r.Gastos, big.NewInt(p.Monto))
		}
	}
	for _, p := range pendientes {
		if !vistas[claveDe(p.Recurrente, p.Fecha)] {
			r.Pendientes = append(r.Pendientes, p)
		}
	}
	return r, nil
}
