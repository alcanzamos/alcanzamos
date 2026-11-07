package interpretacion_test

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// La raíz de reglas/ del monorepo, vista desde api/test/interpretacion.
var carpetaReglas = filepath.Join("..", "..", "..", "reglas")

// La fecha de referencia de medir.py para todos los mensajes de los dos conjuntos (README del conjunto, sección 4).
var fechaReferencia = time.Date(2026, time.November, 2, 0, 0, 0, 0, time.UTC)

// El SHA-256 de reglas.json, versión D-1.0 (adso, commit d073baf).
const shaReglas = "5d130dbc945679c3f8ad52f17c8cdabda89fb64f074fb6abde637d0ec5f3153c"

func sha256De(t *testing.T, ruta string) (string, []byte) {
	t.Helper()
	datos, err := os.ReadFile(ruta)
	if err != nil {
		t.Fatal(err)
	}
	suma := sha256.Sum256(datos)
	return hex.EncodeToString(suma[:]), datos
}

func centavos(n int64) *int64 { return &n }

func dia(anio int, mes time.Month, d int) *time.Time {
	f := time.Date(anio, mes, d, 0, 0, 0, 0, time.UTC)
	return &f
}
