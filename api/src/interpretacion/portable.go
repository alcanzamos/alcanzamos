package interpretacion

import (
	"errors"
	"strconv"
)

// EsPortable dice si un patrón ya expandido está en el subconjunto portable de expresiones regulares (README de la
// opción D, §3), que da el mismo resultado en Python, JavaScript, Java y Go (RE2):
//
//   - solo caracteres ASCII; el punto y los signos especiales se escapan con `\` y ninguna letra o dígito va escapado
//     (nada de `\b`, `\w`, `\d`, `\s`, `\p{…}` ni referencias hacia atrás);
//   - el comodín `.` sin escapar está prohibido;
//   - las clases solo llevan caracteres y rangos explícitos, sin escapes ni clases anidadas o POSIX;
//   - cuantificadores `*` `+` `?` `{m}` `{m,}` `{m,n}`, nunca perezosos ni posesivos;
//   - los únicos grupos especiales son `(?:…)`: nada de nombres, anticipaciones, retrocesos, atómicos ni banderas.
func EsPortable(patron string) error {
	enClase, cuantificador, abiertos := false, false, 0
	for i := 0; i < len(patron); i++ {
		c := patron[i]
		if c >= 0x80 {
			return errors.New("lleva un carácter que no es ASCII")
		}
		if enClase {
			switch c {
			case '\\':
				return errors.New("lleva un escape dentro de una clase")
			case '[':
				return errors.New("lleva una clase anidada o POSIX")
			case ']':
				enClase = false
			}
			continue
		}
		esCuantificador := false
		switch c {
		case '\\':
			if i+1 >= len(patron) {
				return errors.New("termina en un escape")
			}
			i++
			if n := patron[i]; n >= '0' && n <= '9' || n >= 'a' && n <= 'z' || n >= 'A' && n <= 'Z' {
				return errors.New("lleva un escape con letra o dígito: " + string(patron[i-1:i+1]))
			}
		case '.':
			return errors.New("lleva el comodín «.» sin escapar")
		case '[':
			enClase = true
			if i+1 < len(patron) && patron[i+1] == '^' {
				i++
			}
			if i+1 < len(patron) && patron[i+1] == ']' {
				return errors.New("lleva una clase vacía")
			}
		case '(':
			abiertos++
			if i+1 < len(patron) && patron[i+1] == '?' {
				if i+2 >= len(patron) || patron[i+2] != ':' {
					return errors.New("lleva un grupo especial que no es (?:…)")
				}
				i += 2
			}
		case ')':
			if abiertos--; abiertos < 0 {
				return errors.New("cierra un paréntesis que no abrió")
			}
		case '*', '+', '?':
			if cuantificador {
				return errors.New("lleva un cuantificador perezoso o posesivo")
			}
			esCuantificador = true
		case '{':
			fin := i + 1
			for fin < len(patron) && (patron[fin] >= '0' && patron[fin] <= '9' || patron[fin] == ',') {
				fin++
			}
			if fin >= len(patron) || patron[fin] != '}' || !cuantificadorDeLlaves(patron[i+1:fin]) {
				return errors.New("lleva una llave que no es un cuantificador {m,n}")
			}
			if cuantificador {
				return errors.New("lleva un cuantificador perezoso o posesivo")
			}
			i = fin
			esCuantificador = true
		}
		cuantificador = esCuantificador
	}
	if enClase {
		return errors.New("lleva una clase sin cerrar")
	}
	if abiertos != 0 {
		return errors.New("lleva un paréntesis sin cerrar")
	}
	return nil
}

// cuantificadorDeLlaves valida el interior de {m}, {m,} y {m,n}.
func cuantificadorDeLlaves(interior string) bool {
	coma := -1
	for i := 0; i < len(interior); i++ {
		if interior[i] == ',' {
			if coma >= 0 {
				return false
			}
			coma = i
		}
	}
	if coma < 0 {
		return interior != ""
	}
	if coma == 0 {
		return false
	}
	if _, err := strconv.Atoi(interior[:coma]); err != nil {
		return false
	}
	resto := interior[coma+1:]
	if resto == "" {
		return true
	}
	_, err := strconv.Atoi(resto)
	return err == nil
}
