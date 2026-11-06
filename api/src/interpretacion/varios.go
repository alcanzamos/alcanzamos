package interpretacion

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// DetectorDeVariosMovimientos es la heurística aparte de D-077 (4), diseñada en E12 §6.3 y E15 5.15: cuenta los montos
// del texto para avisar que hay más de un movimiento, porque el motor devuelve solo el primero y no dice cuántos vio. No
// usa el motor ni lee `reglas.json`: cambiar las reglas no la cambia, y al revés. Sin estado, sin efectos y sin acceso a
// datos. Solo informa: nunca decide qué se guarda (RN-001).
type DetectorDeVariosMovimientos struct{}

// ContarMontos cuenta los montos del texto, sin contar fechas ni días, la cantidad de una compra por precio, el valor de
// las cuotas ni el total explícito (con un total, el texto es un solo movimiento). Un texto cualquiera nunca es inválido.
func (DetectorDeVariosMovimientos) ContarMontos(texto string) int {
	t := taparCon(sinTildes(texto), fechasYDias)
	cuenta, hayTotal := 0, false
	for _, m := range montosDe(t) {
		antes := ultimosCaracteres(t[:m[0]], 16)
		switch {
		case antesDeCuota.MatchString(antes):
		case antesDeTotal.MatchString(antes):
			hayTotal = true
		default:
			cuenta++
		}
	}
	if hayTotal {
		return 1
	}
	return cuenta
}

// HayVarios dice si el texto trae dos o más montos.
func (d DetectorDeVariosMovimientos) HayVarios(texto string) bool { return d.ContarMontos(texto) >= 2 }

const (
	meses    = `enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre`
	sufijos  = `mil|k|lucas?|millones|millon|palos?`
	numeros  = `un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|veinticinco|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|medio`
	digitosY = `0123456789.,`
)

var (
	fechasYDias = regexp.MustCompile(`\b\d{1,2}\s+de\s+(?:` + meses + `)(?:\s+(?:de|del)\s+\d{4})?\b` +
		`|\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b` +
		`|\b(?:el|dia)\s+\d{1,2}\b` +
		`|\b(?:de|del|en)\s+(?:` + meses + `)\s+(?:de|del)?\s*\d{4}\b` +
		`|\b(?:de|del)\s+(?:19|20)\d{2}\b`)
	antesDeCuota = regexp.MustCompile(`cuotas?\s+(?:mensuales\s+)?de\s*$`)
	antesDeTotal = regexp.MustCompile(`(?:\btotal|\ben total|\bson|\bserian|\bfueron)\s*(?:de|:)?\s*$`)

	// Los cinco patrones de «qué es un monto» (E15 5.15), en ese orden. Van anclados al inicio: RE2 no tiene mirar
	// atrás ni adelante, así que `montosDe` revisa lo que el prototipo expresa con `(?<!…)` y `(?!…)`.
	montoConSigno  = regexp.MustCompile(`^\$\s*\d[\d.,]*(?:\s*(?:` + sufijos + `)\b)?`)
	montoConMiles  = regexp.MustCompile(`^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?`)
	montoConSufijo = regexp.MustCompile(`^\d+(?:[.,]\d+)?\s*(?:` + sufijos + `)\b`)
	montoEnLetras  = regexp.MustCompile(`^(?:` + numeros + `)\s+(?:mil|lucas?|millones|millon)\b`)
	montoEntero    = regexp.MustCompile(`^\d{4,7}`)
)

// sinTildes pasa a minúsculas y quita las tildes (NFKD sin las marcas), como normalizar_texto del prototipo.
func sinTildes(texto string) string {
	return strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, norm.NFKD.String(strings.ToLower(strings.ToValidUTF8(texto, "\uFFFD"))))
}

// taparCon cambia por espacios cada coincidencia de `patron`, para que no cuente como monto.
func taparCon(t string, patron *regexp.Regexp) string {
	return patron.ReplaceAllStringFunc(t, func(m string) string { return strings.Repeat(" ", len(m)) })
}

// ultimosCaracteres devuelve hasta n caracteres del final de t.
func ultimosCaracteres(t string, n int) string {
	inicio := len(t)
	for ; n > 0 && inicio > 0; n-- {
		_, ancho := utf8.DecodeLastRuneInString(t[:inicio])
		inicio -= ancho
	}
	return t[inicio:]
}

func esPalabra(b byte) bool {
	return b == '_' || b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
}

// montosDe devuelve los tramos [ini, fin) de los montos de t, de izquierda a derecha y sin solaparse: en cada posición
// gana el primer patrón que coincide (la alternancia del prototipo).
func montosDe(t string) [][2]int {
	var tramos [][2]int
	for i := 0; i < len(t); {
		fin := montoEn(t, i)
		if fin < 0 {
			i++
			continue
		}
		tramos = append(tramos, [2]int{i, fin})
		i = fin
	}
	return tramos
}

// montoEn devuelve dónde termina el monto que empieza en i, o -1 si en i no empieza ninguno.
func montoEn(t string, i int) int {
	resto := t[i:]
	sinDigitoAntes := i == 0 || !strings.ContainsRune(digitosY, rune(t[i-1]))
	if m := montoConSigno.FindString(resto); m != "" {
		return i + len(m)
	}
	if sinDigitoAntes {
		if fin := montoConMilesEn(t, i); fin >= 0 {
			return fin
		}
		if m := montoConSufijo.FindString(resto); m != "" {
			return i + len(m)
		}
	}
	if (i == 0 || !esPalabra(t[i-1])) && montoEnLetras.MatchString(resto) {
		return i + len(montoEnLetras.FindString(resto))
	}
	if sinDigitoAntes {
		if m := montoEntero.FindString(resto); m != "" && !sigueNumero(t, i+len(m)) {
			return i + len(m)
		}
	}
	return -1
}

// montoConMilesEn revisa `(?!\d|\.\d)` después del número con separador de miles; con decimales, si lo que sigue falla,
// el prototipo lo reintenta sin los decimales (el siguiente carácter sería la coma, que sí vale).
func montoConMilesEn(t string, i int) int {
	m := montoConMiles.FindString(t[i:])
	if m == "" {
		return -1
	}
	fin := i + len(m)
	if !sigueDigitoOPuntoYDigito(t, fin) {
		return fin
	}
	if c := strings.IndexByte(m, ','); c >= 0 && !sigueDigitoOPuntoYDigito(t, i+c) {
		return i + c
	}
	return -1
}

func esDigito(t string, i int) bool { return i < len(t) && t[i] >= '0' && t[i] <= '9' }

func sigueDigitoOPuntoYDigito(t string, i int) bool {
	return esDigito(t, i) || (i < len(t) && t[i] == '.' && esDigito(t, i+1))
}

// sigueNumero es `(?=\d|[.,]\d)`: lo que sigue continúa el número.
func sigueNumero(t string, i int) bool {
	return esDigito(t, i) || (i < len(t) && (t[i] == '.' || t[i] == ',') && esDigito(t, i+1))
}
