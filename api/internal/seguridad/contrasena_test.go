package seguridad

import (
	"errors"
	"strings"
	"testing"
)

// primeraDe es la primera entrada de la lista que no es comentario ni lleva «alcanzamos» (esas las rechaza antes la
// regla de lo personal).
func primeraDe(lista string) string {
	for _, l := range strings.Split(lista, "\n") {
		if l != "" && !strings.HasPrefix(l, "#") && !strings.Contains(l, "alcanzamos") {
			return l
		}
	}
	return ""
}

// Una prueba por regla (SEG-015): cada caso es una contraseña que solo rompe esa regla.
func TestPoliticaDeContrasena(t *testing.T) {
	p := NuevaPoliticaDeContrasena()
	deSecLists := primeraDe(comunes)
	propia := primeraDe(comunesEnEspanol)
	casos := []struct {
		nombre     string
		contrasena string
		correo     string
		usuario    string
		esperado   error
	}{
		// Largo
		{"vacía", "", "", "", ErrContrasenaVacia},
		{"14 caracteres", "abcdefghijklmn", "", "", ErrContrasenaCorta},
		{"14 caracteres de más de un byte", "ñññññññññññññá", "", "", ErrContrasenaCorta},
		{"15 caracteres justos", "cafedelamañana1", "", "", nil},
		{"15 caracteres de más de un byte (cuenta caracteres, no bytes)", "ñlluviaélamaral", "", "", nil},
		// Aceptadas
		{"frase de cuatro palabras", "lluvia café tren azul", "laura@ejemplo.test", "", nil},
		{"frase larga distinta, con espacios", "el tren pasa por la montaña a las seis", "laura@ejemplo.test", "", nil},
		{"sin reglas de composición: solo minúsculas", "casaverdeatardecer", "", "", nil},
		{"espacios no se recortan: con espacios al final es otra", "casaverdeatardecer  ", "", "", nil},
		{"un correo corto no se busca dentro de la contraseña", "ana nunca olvida el paraguas", "ana@ejemplo.test", "", nil},
		{"un usuario corto tampoco", "ana nunca olvida el paraguas", "", "ana", nil},

		// Lista de SecLists (xato)
		{"lista de SecLists, tal como está", deSecLists, "", "", ErrContrasenaComun},
		{"lista de SecLists, en mayúsculas", strings.ToUpper(deSecLists), "", "", ErrContrasenaComun},
		{"lista de SecLists, en minúsculas", strings.ToLower(deSecLists), "", "", ErrContrasenaComun},
		{"lista de SecLists, conocida", "123456789987654321", "", "", ErrContrasenaComun},
		{"lista de SecLists con un espacio al final ya no es la misma", "123456789987654321 ", "", "", nil},
		// Lista propia en español
		{"lista propia, la primera", propia, "", "", ErrContrasenaComun},
		{"lista propia: contraseña con números", "contraseña1234567890", "", "", ErrContrasenaComun},
		{"lista propia, sin tilde ni eñe", "CONTRASENA1234567890", "", "", ErrContrasenaComun},
		{"lista propia: frase de amor con año", "tequieromucho2026", "", "", ErrContrasenaComun},
		{"lista propia: ciudad con números", "barranquilla123456", "", "", ErrContrasenaComun},
		{"lista propia: equipo con números", "atleticonacional2025", "", "", ErrContrasenaComun},

		// Reglas de NIST: repetidas
		{"repetida: un solo carácter", "aaaaaaaaaaaaaaa", "", "", ErrContrasenaComun},
		{"repetida: un solo dígito", "777777777777777", "", "", ErrContrasenaComun},
		{"repetida: un bloque de dos", "abababababababab", "", "", ErrContrasenaComun},
		{"repetida: un bloque de tres", "123123123123123", "", "", ErrContrasenaComun},
		{"un solo carácter distinto no la salva de ser casi repetida, pero no es repetida de punta a punta", "aaaaaaaaaaaaaaz", "", "", nil},
		// En secuencia
		{"secuencia de dígitos", "123456789012345", "", "", ErrContrasenaComun},
		{"secuencia de dígitos descendente", "987654321098765", "", "", ErrContrasenaComun},
		{"secuencia de letras", "abcdefghijklmno", "", "", ErrContrasenaComun},
		{"secuencia de letras descendente", "ponmlkjihgfedcb", "", "", ErrContrasenaComun},
		{"una secuencia con un salto ya no es secuencia", "abcdefghijklmnp", "", "", nil},
		// Teclado
		{"teclado: fila de arriba y siguiente", "qwertyuiopasdfg", "", "", ErrContrasenaComun},
		{"teclado: fila del medio con la eñe", "asdfghjklñzxcvb", "", "", ErrContrasenaComun},
		{"teclado: en mayúsculas", "QWERTYUIOPASDFG", "", "", ErrContrasenaComun},
		{"teclado: al revés", "gfdsapoiuytrewq", "", "", ErrContrasenaComun},
		{"teclado: fila de números y de arriba", "7890qwertyuiopa", "", "", ErrContrasenaComun},
		{"teclado: un tramo que no es seguido no cuenta", "qwertyuiopasdfh", "", "", nil},

		// Lo personal
		{"contiene la parte local del correo", "mi-laurita-gomez-rocks", "laurita-gomez@ejemplo.test", "", ErrContrasenaPersonal},
		{"contiene la parte local del correo, sin mayúsculas ni tildes", "MI-LAURITA-GÓMEZ-ROCKS", "laurita-gomez@ejemplo.test", "", ErrContrasenaPersonal},
		{"la parte local del correo de 4 caracteres ya cuenta", "tengo mucha sed de laur", "laur@ejemplo.test", "", ErrContrasenaPersonal},
		{"contiene el nombre de usuario", "el-mejor-lalo_2010-de-todos", "", "lalo_2010", ErrContrasenaPersonal},
		{"contiene alcanzamos", "uso alcanzamos todos los dias", "", "", ErrContrasenaPersonal},
		{"contiene ALCANZAMOS en mayúsculas y con otra letra pegada", "xxALCANZAMOSxxxxxxxxx", "", "", ErrContrasenaPersonal},
		{"el dominio del correo no cuenta, solo la parte local", "ejemplo test de paraguas", "laura@ejemplo.test", "", nil},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			if err := p.Validar(c.contrasena, c.correo, c.usuario); !errors.Is(err, c.esperado) {
				t.Fatalf("Validar(%q) = %v, se esperaba %v", c.contrasena, err, c.esperado)
			}
		})
	}
}

func TestListasEmbebidasSoloTienenEntradasDeLaLongitudMinima(t *testing.T) {
	for nombre, c := range map[string]struct {
		lista    string
		minimas  int
		maximas  int
		comenta  bool
		licencia string
	}{
		"SecLists":     {comunes, 10000, 20000, false, ""},
		"propia en es": {comunesEnEspanol, 200, 600, true, "# SPDX-License-Identifier: AGPL-3.0-only"},
	} {
		t.Run(nombre, func(t *testing.T) {
			n := 0
			vistas := map[string]bool{}
			lineas := strings.Split(strings.TrimSpace(c.lista), "\n")
			if c.licencia != "" && lineas[0] != c.licencia {
				t.Fatalf("la primera línea debe ser %q, es %q", c.licencia, lineas[0])
			}
			for i, l := range lineas {
				if c.comenta && strings.HasPrefix(l, "#") {
					continue
				}
				n++
				if len([]rune(l)) < LongitudMinimaDeContrasena {
					t.Fatalf("la línea %d (%q) tiene menos de %d caracteres", i+1, l, LongitudMinimaDeContrasena)
				}
				if c.comenta && vistas[l] {
					t.Fatalf("la línea %d (%q) está repetida", i+1, l)
				}
				vistas[l] = true
			}
			if n < c.minimas || n > c.maximas {
				t.Fatalf("la lista tiene %d entradas: se esperaban entre %d y %d", n, c.minimas, c.maximas)
			}
		})
	}
}

func TestPoliticaConListasPropias(t *testing.T) {
	p := politicaConListas("Una Contraseña Larga\r\n\n# un comentario largo de verdad\nOtra contraseña larga\n")
	for _, c := range []string{"una contraseña larga", "OTRA CONTRASEÑA LARGA", "una contrasena larga"} {
		if err := p.Validar(c, "", ""); !errors.Is(err, ErrContrasenaComun) {
			t.Fatalf("%q: se esperaba ErrContrasenaComun: %v", c, err)
		}
	}
	if err := p.Validar("# un comentario largo de verdad", "", ""); err != nil {
		t.Fatalf("un comentario no es una entrada: %v", err)
	}
}

func TestPlegar(t *testing.T) {
	if g := plegar("ÁÉÍÓÚÜÑ áéíóúüñ ÀÈ Zz"); g != "aeiouun aeiouun ae zz" {
		t.Fatalf("plegar = %q", g)
	}
}
