package interpretacion

import (
	"regexp"
	"strings"
)

// Lecturas son las dos formas de leer un monto ambiguo, ya escritas como las muestra la pregunta de E14-PPN 3.1
// «¿Quisiste decir {con punto de miles} o {con coma decimal}?». El API las arma para que el cliente solo las muestre.
type Lecturas struct {
	ConPuntoDeMiles string // «12.500»
	ConComaDecimal  string // «12,50»
}

var (
	decimalCorto = regexp.MustCompile(`^(\d{1,3})([.,])(\d{1,2})`)
	// Lo que vuelve claro un monto que sigue a un decimal: un sufijo («12,5 mil») o un porcentaje.
	sufijoOPorcentaje = regexp.MustCompile(`^\s*(?:(?:` + sufijos + `)\b|%)`)
)

// MontoAmbiguo busca un monto que no se puede leer sin adivinar (D-084 (8), E12 §11.4): un número de uno a tres dígitos
// con un solo punto o una sola coma y uno o dos dígitos después, como «12.5», «12,50» o «$8,5». Puede ser «12.500» con
// punto de miles o «12,50» con coma decimal, y el motor entrega pesos enteros: elegir una lectura es adivinar. No cuentan
// los montos con separador de miles («8.500», «1.234,56»), con sufijo («12,5 mil»), los porcentajes ni las fechas. Devuelve
// las dos lecturas del primero que encuentra. No usa el motor ni las reglas.
func MontoAmbiguo(texto string) (Lecturas, bool) {
	t := taparCon(sinTildes(texto), fechasYDias)
	for i := 0; i < len(t); i++ {
		if !esDigito(t, i) || (i > 0 && strings.ContainsRune(digitosY, rune(t[i-1]))) {
			continue
		}
		m := decimalCorto.FindStringSubmatch(t[i:])
		if m == nil || sigueNumero(t, i+len(m[0])) || sufijoOPorcentaje.MatchString(t[i+len(m[0]):]) {
			continue
		}
		entero, decimales := m[1], m[3]
		return Lecturas{
			ConPuntoDeMiles: entero + "." + decimales + strings.Repeat("0", 3-len(decimales)),
			ConComaDecimal:  entero + "," + decimales + strings.Repeat("0", 2-len(decimales)),
		}, true
	}
	return Lecturas{}, false
}
