//go:build ignore

// SPDX-License-Identifier: AGPL-3.0-only

// Genera contrasenas_comunes_es.txt, la lista propia de contraseñas comunes en español y de Colombia (D-142).
//
// Uso, desde api/src/seguridad/datos:
//
//	go run generar_es.go > contrasenas_comunes_es.txt
//
// No usa datos filtrados ni descarga nada: combina palabras y frases comunes escritas a mano con números y años. Solo
// deja las entradas de 15 caracteres o más (las demás ya las frena la longitud mínima), sin repetir y en orden. Falla
// si salen menos de 200 o más de 600. Si cambias las palabras, vuelve a correrlo y confirma el archivo junto con el
// script. El dueño revisa la lista antes de fusionar.
package main

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"unicode/utf8"
)

const longitudMinima = 15

// Frases y palabras de uso común en español, escritas en minúsculas (la lista se compara sin distinguir mayúsculas
// ni tildes).
var frases = []string{
	"contraseña", "micontraseña", "contraseñasegura", "contraseñasecreta", "micontraseñasegura", "mispassword",
	"teamo", "teamomucho", "tequiero", "tequieromucho", "tequieromiamor", "teextraño",
	"miamor", "miamorbonito", "mivida", "mireina", "mirey", "minovia", "minovio", "miprincesa", "mifamilia",
	"familiaunida", "bendecido", "bendecida", "diosesamor", "dioteama", "graciasadios", "dios1234567890",
	"felizcumpleaños", "feliznavidad", "holamundo", "bienvenido", "clavesecreta", "miclave", "miclavesecreta",
	"siemprejuntos", "todoesposible", "quepena", "parcero", "parceros", "chevere",
	"colombia", "vivacolombia", "soycolombiano", "soycolombiana", "amocolombia", "seleccioncolombia", "tricolor",
	"alcanzamos", "alcanzamoscolombia", "alcanzamosjuntos", "misfinanzas", "mipresupuesto",
}

// Ciudades de Colombia.
var ciudades = []string{
	"bogota", "medellin", "cali", "barranquilla", "cartagena", "bucaramanga", "cucuta", "pereira", "manizales",
	"santamarta", "ibague", "villavicencio", "pasto", "monteria", "neiva", "armenia", "popayan", "valledupar",
	"sincelejo", "tunja", "riohacha", "envigado", "soacha", "palmira", "buenaventura",
}

// Equipos y figuras del fútbol.
var futbol = []string{
	"nacional", "atleticonacional", "verdolaga", "millonarios", "embajador", "americadecali", "diablosrojos",
	"juniordebarranquilla", "deportivocali", "santafe", "independientesantafe", "independientemedellin",
	"deportivopereira", "onzecaldas", "deportestolima", "realmadrid", "barcelona", "bocajuniors", "riverplate",
	"cristianoronaldo", "lionelmessi", "messi", "jamesrodriguez", "falcao", "radamelfalcao",
}

// Lo que se pega a cada palabra: secuencias de números y años.
var sufijos = []string{"", "123456", "12345678", "123456789", "1234567890", "2024", "2025", "2026"}

func main() {
	vistas := map[string]bool{}
	var salida []string
	for _, grupo := range [][]string{frases, ciudades, futbol} {
		for _, palabra := range grupo {
			for _, sufijo := range sufijos {
				entrada := palabra + sufijo
				if utf8.RuneCountInString(entrada) >= longitudMinima && !vistas[entrada] {
					vistas[entrada] = true
					salida = append(salida, entrada)
				}
			}
		}
	}
	slices.Sort(salida)
	if len(salida) < 200 || len(salida) > 600 {
		fmt.Fprintf(os.Stderr, "salieron %d entradas; se esperaban entre 200 y 600\n", len(salida))
		os.Exit(1)
	}
	var b strings.Builder
	b.WriteString("# SPDX-License-Identifier: AGPL-3.0-only\n")
	b.WriteString("# Lista propia de contraseñas comunes en español y de Colombia (D-142). Generada por generar_es.go; no se edita a mano.\n")
	b.WriteString("# Solo entradas de 15 caracteres o más. Sin datos filtrados. Las líneas que empiezan con # son comentarios.\n")
	for _, e := range salida {
		b.WriteString(e + "\n")
	}
	fmt.Print(b.String())
}
