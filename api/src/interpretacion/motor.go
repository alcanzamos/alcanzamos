package interpretacion

import (
	"context"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// InterpretadorPorReglas implementa el puerto con las reglas D-1.0 y expresiones regulares RE2 (E12 §5.2). Es el port a
// Go de motor.py (E11-PDC-D): normaliza el texto y aplica las reglas en orden de prioridad (intención, fecha, monto,
// tipo y categoría), sin vocabulario del dominio en el código. Reproduce D-1.0 sin tocar ninguna regla (D-075 (4)): lo
// comprueba IAR-004 contra la salida congelada del prototipo.
//
// No tiene estado que cambie entre llamadas, así que se puede usar desde varias goroutines.
type InterpretadorPorReglas struct {
	reglas      *ConjuntoDeReglas
	presupuesto time.Duration
}

// Opcion cambia un ajuste de InterpretadorPorReglas.
type Opcion func(*InterpretadorPorReglas)

// ConPresupuesto cambia el tiempo máximo por texto (200 ms por omisión, D-084 (2)). Sirve para probar el límite.
func ConPresupuesto(d time.Duration) Opcion {
	return func(m *InterpretadorPorReglas) { m.presupuesto = d }
}

// NuevoPorReglas arma el interpretador con unas reglas ya cargadas.
func NuevoPorReglas(reglas *ConjuntoDeReglas, opciones ...Opcion) *InterpretadorPorReglas {
	m := &InterpretadorPorReglas{reglas: reglas, presupuesto: PresupuestoDeTiempo}
	for _, o := range opciones {
		o(m)
	}
	return m
}

// Interpretar convierte el texto en una interpretación. Falla con ErrTextoVacio, ErrTextoLargo (más de 280 caracteres)
// o ErrTiempoAgotado (200 ms, contados con el contexto). No registra ni guarda el texto.
func (m *InterpretadorPorReglas) Interpretar(ctx context.Context, entrada Entrada) (Interpretacion, error) {
	if strings.TrimSpace(entrada.Texto) == "" {
		return Interpretacion{}, ErrTextoVacio
	}
	if utf8.RuneCountInString(entrada.Texto) > MaxCaracteres {
		return Interpretacion{}, ErrTextoLargo
	}
	// RE2 corre en tiempo lineal y no se puede interrumpir: el plazo (el presupuesto o el del contexto, el que llegue
	// primero) se revisa entre una etapa y la siguiente.
	limite := time.Now().Add(m.presupuesto)
	vencido := func() bool { return ctx.Err() != nil || !time.Now().Before(limite) }

	r := m.reglas
	if vencido() {
		return Interpretacion{}, ErrTiempoAgotado
	}
	t := r.normalizar(entrada.Texto)
	res := Interpretacion{ReglasVersion: r.version, Intencion: r.intencion(t)}
	if res.Intencion != Registro {
		return res, nil
	}
	if vencido() {
		return Interpretacion{}, ErrTiempoAgotado
	}
	ref := time.Date(entrada.FechaReferencia.Year(), entrada.FechaReferencia.Month(), entrada.FechaReferencia.Day(), 0, 0, 0, 0, time.UTC)
	fecha, ini, fin := r.fecha(t, ref)
	res.Fecha = &fecha
	if vencido() {
		return Interpretacion{}, ErrTiempoAgotado
	}
	if valor, ok := r.monto(tapar(t, [][2]int{{ini, fin}})); ok {
		res.Monto = pesosACentavos(valor)
	}
	if vencido() {
		return Interpretacion{}, ErrTiempoAgotado
	}
	res.Tipo = r.tipo(t)
	res.Categoria = r.categoria(t, res.Tipo)
	return res, nil
}

// maxPesos es el mayor monto que se representa sin perder pesos en coma flotante (2^53). Un importe mayor (o infinito)
// no es un monto: se devuelve sin monto y la persona lo escribe en el formulario. El prototipo (Python) no tiene tope.
const maxPesos = 1 << 53

// pesosACentavos pasa los pesos enteros de las reglas a centavos (D-082 (5)); nil si no cabe.
func pesosACentavos(pesos float64) *int64 {
	if math.IsInf(pesos, 0) || math.IsNaN(pesos) || pesos > maxPesos {
		return nil
	}
	centavos := int64(pesos) * 100
	return &centavos
}

// --- normalización ------------------------------------------------------------------------------------------------

// esEspacio es str.isspace de Python: además de unicode.IsSpace cuenta los separadores \x1c a \x1f.
func esEspacio(r rune) bool { return unicode.IsSpace(r) || (r >= 0x1c && r <= 0x1f) }

// normalizar pasa a minúsculas, aplica las equivalencias, quita las tildes (NFD sin las marcas Mn; la ñ queda n),
// aplica las sustituciones en orden y colapsa los espacios.
func (c *ConjuntoDeReglas) normalizar(texto string) string {
	t := strings.ToLower(strings.ToValidUTF8(texto, "\uFFFD"))
	for _, par := range c.equivalencias {
		t = strings.ReplaceAll(t, par[0], par[1])
	}
	t = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, norm.NFD.String(t))
	for _, s := range c.sustituciones {
		for {
			nuevo := s.re.ReplaceAllString(t, s.reemplazo)
			if nuevo == t || !s.repetir {
				t = nuevo
				break
			}
			t = nuevo
		}
	}
	return strings.Join(strings.FieldsFunc(t, esEspacio), " ")
}

// tapar cambia por espacios (uno por carácter) cada tramo [ini, fin) en bytes. Los tramos vienen en orden y sin
// solaparse; se tapan del último al primero para que los cambios de largo no muevan los anteriores.
func tapar(t string, tramos [][2]int) string {
	for i := len(tramos) - 1; i >= 0; i-- {
		ini, fin := tramos[i][0], tramos[i][1]
		if ini < 0 || fin <= ini {
			continue
		}
		t = t[:ini] + strings.Repeat(" ", utf8.RuneCountInString(t[ini:fin])) + t[fin:]
	}
	return t
}

// --- números ------------------------------------------------------------------------------------------------------

// acumulador es el estado de valores(): el importe que se va armando con dígitos, palabras y escalas.
type acumulador struct {
	total            float64
	grupo, ultima    float64
	hayGrupo, hayUlt bool
	previo           string // "", "digito", "palabra", "escala" o "mitad"
	valido, usado    bool
}

// valores devuelve los importes que contiene una cadena de palabras y dígitos («37 mil 500», «dos millones y medio»).
// Con exigirValido solo cuentan los que tienen un dígito o una escala. Cada importe es un entero (redondeo al par
// más cercano, como round de Python).
func (c *ConjuntoDeReglas) valores(texto string, exigirValido bool) []float64 {
	fichas := c.tokenizador.FindAllString(texto, -1)
	var montos []float64
	var e acumulador
	cerrar := func() {
		if e.usado && (e.valido || !exigirValido) {
			grupo := 0.0
			if e.hayGrupo {
				grupo = e.grupo
			}
			montos = append(montos, math.RoundToEven(e.total+grupo))
		}
		e = acumulador{}
	}
	for i, ficha := range fichas {
		if c.conectores[ficha] {
			continue
		}
		var siguiente string
		if i+1 < len(fichas) {
			siguiente = fichas[i+1]
		}
		if ficha[0] >= '0' && ficha[0] <= '9' {
			// El patrón solo deja dígitos y un punto, y 280 caracteres no desbordan un float64: no hay error que tratar.
			v, _ := strconv.ParseFloat(ficha, 64) //nolint:errcheck
			switch e.previo {
			case "digito", "palabra":
				cerrar()
			case "escala":
				sigueEscalaMenor := false
				if esc, ok := c.escalas[siguiente]; ok && i+1 < len(fichas) {
					sigueEscalaMenor = esc < e.ultima
				}
				if v >= e.ultima || (v < c.minimoResto && !sigueEscalaMenor) {
					cerrar()
				}
			}
			e.grupo, e.hayGrupo, e.previo, e.valido, e.usado = v, true, "digito", true, true
		} else if v, ok := c.palabras[ficha]; ok {
			if e.previo == "digito" {
				cerrar()
			}
			if e.previo == "palabra" {
				e.grupo += v
			} else {
				e.grupo, e.hayGrupo = v, true
			}
			e.previo, e.usado = "palabra", true
		} else if s, ok := c.escalas[ficha]; ok {
			if e.hayUlt && s >= e.ultima {
				cerrar()
			}
			base := 1.0
			if e.hayGrupo {
				base = e.grupo
			}
			e.total += base * s
			e.grupo, e.hayGrupo, e.ultima, e.hayUlt, e.previo, e.valido, e.usado = 0, false, s, true, "escala", true, true
		} else if c.mitades[ficha] {
			if _, esEscala := c.escalas[siguiente]; esEscala && i+1 < len(fichas) {
				e.grupo, e.hayGrupo, e.previo, e.usado = 0.5, true, "mitad", true
			} else if e.hayUlt {
				e.total += 0.5 * e.ultima
			}
		} else {
			cerrar()
		}
	}
	cerrar()
	return montos
}

// valor es el primer importe de la cadena.
func (c *ConjuntoDeReglas) valor(texto string, exigirValido bool) (float64, bool) {
	lista := c.valores(texto, exigirValido)
	if len(lista) == 0 {
		return 0, false
	}
	return lista[0], true
}

// --- campos -------------------------------------------------------------------------------------------------------

func algunPatron(patrones []*regexp.Regexp, t string) bool {
	for _, p := range patrones {
		if p.MatchString(t) {
			return true
		}
	}
	return false
}

// grupo devuelve el texto del grupo n de una coincidencia de FindStringSubmatchIndex, o "" si no participó.
func grupo(t string, idx []int, n int) string {
	if idx[2*n] < 0 {
		return ""
	}
	return t[idx[2*n]:idx[2*n+1]]
}

func (c *ConjuntoDeReglas) intencion(t string) Intencion {
	for _, r := range c.intenciones {
		if algunPatron(r.patrones, t) {
			return r.intencion
		}
	}
	return c.intencionPorDef
}

func (c *ConjuntoDeReglas) tipo(t string) Tipo {
	if algunPatron(c.tipoIngreso, t) {
		return Ingreso
	}
	return c.tipoPorDefecto
}

func (c *ConjuntoDeReglas) categoria(t string, tipo Tipo) string {
	for _, e := range c.categorias[tipo] {
		if algunPatron(e.patrones, t) {
			return e.nombre
		}
	}
	return c.categoriaPor[tipo]
}

// fecha devuelve la fecha del texto y el tramo (en bytes) que la dice, para taparlo antes de leer el monto. Sin fecha,
// la de referencia y un tramo vacío.
func (c *ConjuntoDeReglas) fecha(t string, ref time.Time) (time.Time, int, int) {
	for _, r := range c.fechaReglas {
		idx := r.re.FindStringSubmatchIndex(t)
		if idx == nil {
			continue
		}
		if d, ok := c.aplicarFecha(r, t, idx, ref); ok {
			return d, idx[0], idx[1]
		}
	}
	return ref, 0, 0
}

// fechaValida dice si es un día del calendario que Python (date) acepta: años 1 a 9999.
func fechaValida(anio, mes, dia int) bool {
	if anio < 1 || anio > 9999 || mes < 1 || mes > 12 || dia < 1 {
		return false
	}
	return dia <= time.Date(anio, time.Month(mes)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func dia(anio, mes, d int) (time.Time, bool) {
	if !fechaValida(anio, mes, d) {
		return time.Time{}, false
	}
	return time.Date(anio, time.Month(mes), d, 0, 0, 0, 0, time.UTC), true
}

// atras resta días a la referencia; falla si la fecha sale del calendario (el prototipo lanza una excepción).
func atras(ref time.Time, dias float64) (time.Time, bool) {
	if dias < 0 || dias > 4_000_000 {
		return time.Time{}, false
	}
	d := ref.AddDate(0, 0, -int(dias))
	return d, d.Year() >= 1
}

// entero lee un grupo que el patrón ya limitó a dígitos (de uno a cuatro).
func entero(digitos string) int {
	n := 0
	for _, d := range digitos {
		n = n*10 + int(d-'0')
	}
	return n
}

func (c *ConjuntoDeReglas) aplicarFecha(r reglaDeFecha, t string, idx []int, ref time.Time) (time.Time, bool) {
	numero := func(n int) int { return entero(grupo(t, idx, n)) }
	switch r.clase {
	case "desplazamiento":
		return atras(ref, float64(r.dias))
	case "desplazamiento_n":
		n, ok := c.valor(grupo(t, idx, 1), false)
		unidad, hay := c.unidadesDias[grupo(t, idx, 2)]
		if !ok || !hay {
			return time.Time{}, false
		}
		return atras(ref, n*float64(unidad))
	case "dia_semana":
		objetivo, ok := c.diasSemana[grupo(t, idx, 1)]
		if !ok {
			return time.Time{}, false
		}
		semana := (int(ref.Weekday()) + 6) % 7 // lunes = 0, como weekday() de Python
		dias := ((semana-objetivo)%7 + 7) % 7
		if dias == 0 {
			dias = 7
		}
		return atras(ref, float64(dias))
	case "dia_mes":
		d, anio, mes := numero(1), ref.Year(), int(ref.Month())
		if d > ref.Day() {
			mes--
		}
		for range 12 {
			if mes < 1 {
				mes, anio = 12, anio-1
			}
			if f, ok := dia(anio, mes, d); ok {
				return f, true
			}
			mes--
		}
		return time.Time{}, false
	case "dia_y_mes":
		mes, ok := c.meses[grupo(t, idx, 2)]
		if !ok {
			return time.Time{}, false
		}
		return dia(ref.Year(), mes, numero(1))
	case "dia_mes_anio":
		mes, ok := c.meses[grupo(t, idx, 2)]
		if !ok {
			return time.Time{}, false
		}
		return dia(numero(3), mes, numero(1))
	default: // dd_mm
		anio := ref.Year()
		if grupo(t, idx, 3) != "" {
			if anio = numero(3); anio < 100 {
				anio += 2000
			}
		}
		return dia(anio, numero(2), numero(1))
	}
}

// monto aplica, en orden: las reglas de corrección, total explícito, cuotas y cantidad por precio; y si ninguna da un
// monto, el primer importe del texto (el de 100 o más pesos antes que los menores), sin contar los números con unidad.
func (c *ConjuntoDeReglas) monto(t string) (float64, bool) {
	for _, r := range c.montoReglas {
		idx := r.re.FindStringSubmatchIndex(t)
		if idx == nil {
			continue
		}
		if r.clase == claseUltimo {
			if v, ok := c.valor(grupo(t, idx, 1), true); ok {
				return v, true
			}
			continue
		}
		factor, hayFactor := c.valor(grupo(t, idx, 1), false)
		valor, hayValor := c.valor(grupo(t, idx, 2), true)
		if hayFactor && hayValor && valor >= r.minimo {
			return factor * valor, true
		}
	}
	for _, p := range c.montoIgnorar {
		var tramos [][2]int
		for _, m := range p.FindAllStringIndex(t, -1) {
			tramos = append(tramos, [2]int{m[0], m[1]})
		}
		t = tapar(t, tramos)
	}
	var candidatos []float64
	for _, idx := range c.montoCandidas.FindAllStringSubmatchIndex(t, -1) {
		candidatos = append(candidatos, c.valores(grupo(t, idx, 1), true)...)
	}
	for _, v := range candidatos {
		if v >= c.minimoFuerte {
			return v, true
		}
	}
	if len(candidatos) > 0 {
		return candidatos[0], true
	}
	return 0, false
}
