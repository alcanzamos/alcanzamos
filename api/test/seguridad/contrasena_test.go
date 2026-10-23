package seguridad_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// lista lee una de las listas de contraseñas comunes que el paquete embebe (datos/).
func lista(t testing.TB, nombre string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "src", "seguridad", "datos", nombre))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

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
	p := seguridad.NuevaPoliticaDeContrasena()
	deSecLists := primeraDe(lista(t, "contrasenas_comunes.txt"))
	propia := primeraDe(lista(t, "contrasenas_comunes_es.txt"))
	casos := []struct {
		nombre     string
		contrasena string
		correo     string
		usuario    string
		esperado   error
	}{
		// Largo
		{"vacía", "", "", "", seguridad.ErrContrasenaVacia},
		{"14 caracteres", "abcdefghijklmn", "", "", seguridad.ErrContrasenaCorta},
		{"14 caracteres de más de un byte", "ñññññññññññññá", "", "", seguridad.ErrContrasenaCorta},
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
		{"lista de SecLists, tal como está", deSecLists, "", "", seguridad.ErrContrasenaComun},
		{"lista de SecLists, en mayúsculas", strings.ToUpper(deSecLists), "", "", seguridad.ErrContrasenaComun},
		{"lista de SecLists, en minúsculas", strings.ToLower(deSecLists), "", "", seguridad.ErrContrasenaComun},
		{"lista de SecLists, conocida", "123456789987654321", "", "", seguridad.ErrContrasenaComun},
		{"lista de SecLists con un espacio al final ya no es la misma", "123456789987654321 ", "", "", nil},
		// Lista propia en español
		{"lista propia, la primera", propia, "", "", seguridad.ErrContrasenaComun},
		{"lista propia: contraseña con números", "contraseña1234567890", "", "", seguridad.ErrContrasenaComun},
		{"lista propia, sin tilde ni eñe", "CONTRASENA1234567890", "", "", seguridad.ErrContrasenaComun},
		{"lista propia: frase de amor con año", "tequieromucho2026", "", "", seguridad.ErrContrasenaComun},
		{"lista propia: ciudad con números", "barranquilla123456", "", "", seguridad.ErrContrasenaComun},
		{"lista propia: equipo con números", "atleticonacional2025", "", "", seguridad.ErrContrasenaComun},

		// Reglas de NIST: repetidas
		{"repetida: un solo carácter", "aaaaaaaaaaaaaaa", "", "", seguridad.ErrContrasenaComun},
		{"repetida: un solo dígito", "777777777777777", "", "", seguridad.ErrContrasenaComun},
		{"repetida: un bloque de dos", "abababababababab", "", "", seguridad.ErrContrasenaComun},
		{"repetida: un bloque de tres", "123123123123123", "", "", seguridad.ErrContrasenaComun},
		{"un solo carácter distinto no la salva de ser casi repetida, pero no es repetida de punta a punta", "aaaaaaaaaaaaaaz", "", "", nil},
		// En secuencia
		{"secuencia de dígitos", "123456789012345", "", "", seguridad.ErrContrasenaComun},
		{"secuencia de dígitos descendente", "987654321098765", "", "", seguridad.ErrContrasenaComun},
		{"secuencia de letras", "abcdefghijklmno", "", "", seguridad.ErrContrasenaComun},
		{"secuencia de letras descendente", "ponmlkjihgfedcb", "", "", seguridad.ErrContrasenaComun},
		{"una secuencia con un salto ya no es secuencia", "abcdefghijklmnp", "", "", nil},
		// Teclado
		{"teclado: fila de arriba y siguiente", "qwertyuiopasdfg", "", "", seguridad.ErrContrasenaComun},
		{"teclado: fila del medio con la eñe", "asdfghjklñzxcvb", "", "", seguridad.ErrContrasenaComun},
		{"teclado: en mayúsculas", "QWERTYUIOPASDFG", "", "", seguridad.ErrContrasenaComun},
		{"teclado: al revés", "gfdsapoiuytrewq", "", "", seguridad.ErrContrasenaComun},
		{"teclado: fila de números y de arriba", "7890qwertyuiopa", "", "", seguridad.ErrContrasenaComun},
		{"teclado: un tramo que no es seguido no cuenta", "qwertyuiopasdfh", "", "", nil},

		// Lo personal
		{"contiene la parte local del correo", "mi-laurita-gomez-rocks", "laurita-gomez@ejemplo.test", "", seguridad.ErrContrasenaPersonal},
		{"contiene la parte local del correo, sin mayúsculas ni tildes", "MI-LAURITA-GÓMEZ-ROCKS", "laurita-gomez@ejemplo.test", "", seguridad.ErrContrasenaPersonal},
		{"la parte local del correo de 4 caracteres ya cuenta", "tengo mucha sed de laur", "laur@ejemplo.test", "", seguridad.ErrContrasenaPersonal},
		{"contiene el nombre de usuario", "el-mejor-lalo_2010-de-todos", "", "lalo_2010", seguridad.ErrContrasenaPersonal},
		{"contiene alcanzamos", "uso alcanzamos todos los dias", "", "", seguridad.ErrContrasenaPersonal},
		{"contiene ALCANZAMOS en mayúsculas y con otra letra pegada", "xxALCANZAMOSxxxxxxxxx", "", "", seguridad.ErrContrasenaPersonal},
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
		"SecLists":     {lista(t, "contrasenas_comunes.txt"), 10000, 20000, false, ""},
		"propia en es": {lista(t, "contrasenas_comunes_es.txt"), 200, 600, true, "# SPDX-License-Identifier: AGPL-3.0-only"},
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
				if len([]rune(l)) < seguridad.LongitudMinimaDeContrasena {
					t.Fatalf("la línea %d (%q) tiene menos de %d caracteres", i+1, l, seguridad.LongitudMinimaDeContrasena)
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

// Las líneas con # de la lista propia (la cabecera de licencia) son comentarios, no entradas.
func TestUnComentarioDeLaListaNoEsUnaEntrada(t *testing.T) {
	cabecera := strings.SplitN(lista(t, "contrasenas_comunes_es.txt"), "\n", 2)[0]
	if !strings.HasPrefix(cabecera, "#") {
		t.Fatalf("se esperaba un comentario en la primera línea: %q", cabecera)
	}
	if err := seguridad.NuevaPoliticaDeContrasena().Validar(cabecera, "", ""); err != nil {
		t.Fatalf("un comentario no es una entrada: %v", err)
	}
}

// Lo personal se busca sin distinguir mayúsculas ni tildes: el pliegue cubre las cinco vocales con sus tildes y
// diéresis, la eñe y las mayúsculas, y deja igual lo demás.
func TestLoPersonalSeBuscaSinMayusculasNiTildes(t *testing.T) {
	p := seguridad.NuevaPoliticaDeContrasena()
	casos := []struct{ nombre, contrasena, usuario string }{
		{"tildes y eñe del usuario contra letras llanas", "aeiouun aeiouun ae zz xyzw", "ÁÉÍÓÚÜÑ áéíóúüñ ÀÈ Zz"},
		{"letras llanas del usuario contra tildes", "ÁÉÍÓÚÜÑ ÀÈÌÒÙ ÄËÏÖ ÂÊÎÔÛ", "aeiouun aeiou aeio aeiou"},
		{"mayúsculas", "la clave de MUÑOZ es otra", "muñoz"},
	}
	for _, c := range casos {
		if err := p.Validar(c.contrasena, "", c.usuario); !errors.Is(err, seguridad.ErrContrasenaPersonal) {
			t.Errorf("%s: %v, se esperaba ErrContrasenaPersonal", c.nombre, err)
		}
	}
}
