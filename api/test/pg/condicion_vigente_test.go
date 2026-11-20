package pg_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Bug 308 (D-210): «vigente» (ni retirada ni reemplazada) se escribe una sola vez en src/pg, en la constante
// `condicionVigente`, y se usa en todas las consultas, también en el ON CONFLICT que debe coincidir con el índice único.
// Ninguna otra copia de la condición (en ese orden ni en el contrario, con o sin alias, en una línea o en varias).
func TestLaCondicionDeVigenteSoloExisteEnSuConstante(t *testing.T) {
	archivos, err := filepath.Glob("../../src/pg/*.go")
	if err != nil || len(archivos) == 0 {
		t.Fatalf("sin fuentes de src/pg: %v (%v)", archivos, err)
	}
	copia := regexp.MustCompile(`(?i)(\w+\.)?retirada_en\s+IS\s+NULL\s+AND\s+(\w+\.)?reemplazada_en\s+IS\s+NULL|(\w+\.)?reemplazada_en\s+IS\s+NULL\s+AND\s+(\w+\.)?retirada_en\s+IS\s+NULL`)
	definiciones, usos := 0, 0
	for _, a := range archivos {
		if strings.HasSuffix(a, "_test.go") {
			continue
		}
		b, err := os.ReadFile(a)
		if err != nil {
			t.Fatal(err)
		}
		texto := string(b)
		definiciones += len(copia.FindAllString(texto, -1))
		usos += strings.Count(texto, "condicionVigente") - strings.Count(texto, "const condicionVigente")
	}
	if definiciones != 1 {
		t.Errorf("la condición escrita a mano aparece %d veces en src/pg; debe estar solo en la constante (1)", definiciones)
	}
	if usos < 7 {
		t.Errorf("condicionVigente se usa %d veces; las consultas de vigentes, el ON CONFLICT, Retirar, la sesión y los tokens son al menos 7", usos)
	}
}
