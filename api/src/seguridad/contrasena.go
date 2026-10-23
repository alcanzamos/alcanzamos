package seguridad

import (
	_ "embed"
	"errors"
	"strings"
	"unicode/utf8"
)

// Errores de PoliticaDeContrasena. Cada uno tiene su código para el cliente: el texto de E14 (PN-58) lo pone el cliente.
var (
	ErrContrasenaVacia    = errors.New("contraseña vacía")                                           // «Falta la contraseña.»
	ErrContrasenaCorta    = errors.New("contraseña de menos de 15 caracteres")                       // «Falta que la contraseña tenga al menos 15 caracteres.»
	ErrContrasenaComun    = errors.New("contraseña común, repetida, en secuencia o de teclado")      // «Falta una contraseña que no sea tan común…»
	ErrContrasenaPersonal = errors.New("contraseña con el correo, el usuario o el nombre de la app") // «Falta una contraseña que no incluya tu correo ni el nombre de la app.»
)

// LongitudMinimaDeContrasena cuenta caracteres Unicode, no bytes (RF-035, D-089).
const LongitudMinimaDeContrasena = 15

// longitudMinimaDeLoPersonal es lo más corto que se busca dentro de la contraseña: la parte local del correo o el
// usuario de menos de 4 caracteres («ana») aparecería en demasiadas contraseñas buenas.
const longitudMinimaDeLoPersonal = 4

// nombreDeLaApp se busca en toda contraseña sin distinguir mayúsculas ni tildes (D-142).
const nombreDeLaApp = "alcanzamos"

// comunes es la lista de SecLists (MIT) filtrada a 15 o más caracteres. Origen, commit y licencia: datos/README.md.
//
//go:embed datos/contrasenas_comunes.txt
var comunes string

// comunesEnEspanol es la lista propia (AGPL-3.0-only) de frases y patrones de Colombia, de 15 o más caracteres.
// Cómo se genera y qué contiene: datos/README.md.
//
//go:embed datos/contrasenas_comunes_es.txt
var comunesEnEspanol string

// PoliticaDeContrasena valida una contraseña nueva (RF-035, D-089, D-142; NIST SP 800-63B-4, sección 3.1.1.2):
// 15 caracteres o más, sin reglas de composición, y rechaza las que están en una de las dos listas embebidas
// (SecLists y la propia en español), las repetidas o en secuencia, las secuencias del teclado y las que contienen
// la parte local del correo, el usuario o «alcanzamos». No recorta espacios: acepta una contraseña pegada tal como
// viene. No consulta ningún servicio externo (E11-EIP). No tiene estado: se puede usar desde varias goroutines.
type PoliticaDeContrasena struct {
	comunes map[string]struct{}
}

// NuevaPoliticaDeContrasena carga las dos listas embebidas.
func NuevaPoliticaDeContrasena() *PoliticaDeContrasena {
	return politicaConListas(comunes, comunesEnEspanol)
}

// politicaConListas carga listas de una entrada por línea. Una línea que empieza con # es un comentario (la
// cabecera de licencia de la lista propia). Las entradas se comparan sin distinguir mayúsculas ni tildes.
func politicaConListas(listas ...string) *PoliticaDeContrasena {
	n := 0
	for _, l := range listas {
		n += strings.Count(l, "\n") + 1
	}
	p := &PoliticaDeContrasena{comunes: make(map[string]struct{}, n)}
	for _, lista := range listas {
		for _, linea := range strings.Split(lista, "\n") {
			if linea = strings.TrimRight(linea, "\r"); linea != "" && !strings.HasPrefix(linea, "#") {
				p.comunes[plegar(linea)] = struct{}{}
			}
		}
	}
	return p
}

// Validar devuelve nil si la contraseña cumple la política. Si no, devuelve el primero de ErrContrasenaVacia,
// ErrContrasenaCorta, ErrContrasenaPersonal o ErrContrasenaComun, en ese orden. correo y usuario son los de la
// cuenta que se crea o cambia; pueden ir vacíos. La parte local es lo que va antes de la @.
func (p *PoliticaDeContrasena) Validar(contrasena, correo, usuario string) error {
	n := utf8.RuneCountInString(contrasena)
	switch {
	case n == 0:
		return ErrContrasenaVacia
	case n < LongitudMinimaDeContrasena:
		return ErrContrasenaCorta
	}
	f := plegar(contrasena)
	if contieneLoPersonal(f, correo, usuario) {
		return ErrContrasenaPersonal
	}
	if _, ok := p.comunes[f]; ok || esRepetida(f) || esSecuencia(f) || esDeTeclado(f) {
		return ErrContrasenaComun
	}
	return nil
}

// contieneLoPersonal busca en la contraseña ya plegada la parte local del correo, el usuario y «alcanzamos».
func contieneLoPersonal(f, correo, usuario string) bool {
	buscados := []string{nombreDeLaApp}
	if local, _, ok := strings.Cut(correo, "@"); ok {
		buscados = append(buscados, local)
	}
	if usuario != "" {
		buscados = append(buscados, usuario)
	}
	for i, b := range buscados {
		b = plegar(strings.TrimSpace(b))
		if i > 0 && utf8.RuneCountInString(b) < longitudMinimaDeLoPersonal {
			continue
		}
		if strings.Contains(f, b) {
			return true
		}
	}
	return false
}

// plegar pasa a minúsculas y quita las tildes y la diéresis de las vocales y la eñe, para comparar «Contraseña»
// con «contrasena». Solo cubre el español: no es una normalización Unicode general.
func plegar(s string) string {
	return strings.Map(func(r rune) rune {
		switch r {
		case 'á', 'à', 'ä', 'â', 'Á', 'À', 'Ä', 'Â':
			return 'a'
		case 'é', 'è', 'ë', 'ê', 'É', 'È', 'Ë', 'Ê':
			return 'e'
		case 'í', 'ì', 'ï', 'î', 'Í', 'Ì', 'Ï', 'Î':
			return 'i'
		case 'ó', 'ò', 'ö', 'ô', 'Ó', 'Ò', 'Ö', 'Ô':
			return 'o'
		case 'ú', 'ù', 'ü', 'û', 'Ú', 'Ù', 'Ü', 'Û':
			return 'u'
		case 'ñ', 'Ñ':
			return 'n'
		}
		if r >= 'A' && r <= 'Z' {
			return r + ('a' - 'A')
		}
		if r < 0x80 {
			return r
		}
		return []rune(strings.ToLower(string(r)))[0]
	}, s)
}

// esRepetida: todos los caracteres son el mismo («aaaaaaaaaaaaaaa») o la contraseña es un bloque de hasta 4
// caracteres repetido de punta a punta («abababababababab», «123123123123123»).
func esRepetida(f string) bool {
	r := []rune(f)
	for largo := 1; largo <= 4 && largo < len(r); largo++ {
		repetida := true
		for i := largo; i < len(r); i++ {
			if r[i] != r[i-largo] {
				repetida = false
				break
			}
		}
		if repetida {
			return true
		}
	}
	return false
}

// esSecuencia: cada carácter es el siguiente (o el anterior) del anterior, de punta a punta: «abcdefghijklmno»,
// «123456789012345» (el 0 sigue al 9) y «987654321098765».
func esSecuencia(f string) bool {
	r := []rune(f)
	for _, paso := range []rune{1, -1} {
		sigue := true
		for i := 1; i < len(r) && sigue; i++ {
			sigue = r[i] == r[i-1]+paso || (esDigito(r[i]) && esDigito(r[i-1]) && (r[i-1]-'0'+paso+10)%10 == r[i]-'0')
		}
		if sigue {
			return true
		}
	}
	return false
}

func esDigito(r rune) bool { return r >= '0' && r <= '9' }

// Filas de un teclado en español, ya plegadas (la eñe es «n»). La fila de las vocales y los signos no se usa.
// Una secuencia de teclado es un tramo seguido, en cualquier sentido, de las filas leídas una tras otra:
// «qwertyuiopasdfg» pasa de la fila de arriba a la del medio.
var filasDeTeclado = []string{"1234567890", "qwertyuiop", "asdfghjkln", "zxcvbnm"}

var teclado = strings.Join(filasDeTeclado, "")

func esDeTeclado(f string) bool {
	if strings.Contains(teclado, f) {
		return true
	}
	alReves := []rune(teclado)
	for i, j := 0, len(alReves)-1; i < j; i, j = i+1, j-1 {
		alReves[i], alReves[j] = alReves[j], alReves[i]
	}
	return strings.Contains(string(alReves), f)
}
