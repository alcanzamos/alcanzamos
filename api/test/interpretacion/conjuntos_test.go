package interpretacion_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/interpretacion"
)

// Los SHA-256 congelados (medir.py: EXPECTED y EXPECTED_CONFIRMACION; ADR-001).
const (
	shaPrueba       = "297c6fbde186ab19ec82079ed1e90225aa51f156689a2da355aefe1defe72150"
	shaConfirmacion = "6c37977380200f2512055d09fc41126991672fb99aa114dfbdc07fcaf2a78fbc"
)

// conjunto es un conjunto congelado con su referencia del prototipo.
type conjunto struct {
	nombre, archivo, referencia, sha string
}

var conjuntos = []conjunto{
	{"prueba", "conjunto-de-prueba.jsonl", "referencia-prueba.jsonl", shaPrueba},
	{"confirmacion", "conjunto-de-confirmacion.jsonl", "referencia-confirmacion.jsonl", shaConfirmacion},
}

type esperado struct {
	Monto     *int64  `json:"monto"`
	Tipo      *string `json:"tipo"`
	Fecha     *string `json:"fecha"`
	Categoria *string `json:"categoria"`
}

type fila struct {
	ID        string   `json:"id"`
	Texto     string   `json:"texto"`
	Esperado  esperado `json:"esperado"`
	Intencion string   `json:"intencion"`
}

// referencia es la salida del prototipo de Python (motor.py) para un mensaje, en pesos.
type referencia struct {
	ID              string  `json:"id"`
	FechaReferencia string  `json:"fecha_referencia"`
	VersionReglas   string  `json:"version_reglas"`
	Monto           *int64  `json:"monto"`
	Tipo            *string `json:"tipo"`
	Fecha           *string `json:"fecha"`
	Categoria       *string `json:"categoria"`
	Intencion       string  `json:"intencion"`
}

// leerLineas decodifica un archivo .jsonl; falla si algún SHA-256 esperado no coincide antes de leer ningún mensaje.
func leerLineas[T any](t *testing.T, datos []byte) []T {
	t.Helper()
	var filas []T
	lector := bufio.NewScanner(bytes.NewReader(datos))
	lector.Buffer(make([]byte, 0, 1<<16), 1<<20)
	for lector.Scan() {
		if len(bytes.TrimSpace(lector.Bytes())) == 0 {
			continue
		}
		var f T
		if err := json.Unmarshal(lector.Bytes(), &f); err != nil {
			t.Fatal(err)
		}
		filas = append(filas, f)
	}
	if err := lector.Err(); err != nil {
		t.Fatal(err)
	}
	return filas
}

// cargarConjunto verifica el SHA-256 del conjunto congelado (ADR-001, medir.py) y devuelve sus mensajes y la referencia.
func cargarConjunto(t *testing.T, c conjunto) ([]fila, []referencia) {
	t.Helper()
	suma, datos := sha256De(t, filepath.Join(carpetaReglas, "conjuntos", c.archivo))
	if suma != c.sha {
		t.Fatalf("el SHA-256 de %s no coincide: esperado %s, calculado %s; no se midió nada", c.archivo, c.sha, suma)
	}
	_, datosReferencia := sha256De(t, filepath.Join(carpetaReglas, "referencia", c.referencia))
	return leerLineas[fila](t, datos), leerLineas[referencia](t, datosReferencia)
}

func motorReal(t *testing.T) *interpretacion.InterpretadorPorReglas {
	t.Helper()
	reglas, err := interpretacion.ReglasIncluidas()
	if err != nil {
		t.Fatal(err)
	}
	return interpretacion.NuevoPorReglas(reglas)
}
