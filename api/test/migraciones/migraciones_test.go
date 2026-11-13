package migraciones_test

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/migraciones"
)

func TestEmbebeLasSeisMigraciones(t *testing.T) {
	nombres, err := fs.Glob(migraciones.SQL, "*.sql")
	if err != nil {
		t.Fatal(err)
	}
	esperado := []string{"0001_esquema_inicial.sql", "0002_catalogo.sql", "0003_ingreso_anterior.sql", "0004_presupuesto_en_cero.sql", "0005_transmision_a_encargados.sql", "0006_aviso_de_purga.sql"}
	if len(nombres) != len(esperado) {
		t.Fatalf("migraciones embebidas: %v", nombres)
	}
	for i, n := range esperado {
		if nombres[i] != n {
			t.Fatalf("migración %d: %q, se esperaba %q", i, nombres[i], n)
		}
	}
}

// Cada migración es copia idéntica de la de E13 (D-122): si cambia un byte, cambia su SHA-256 y esta prueba falla.
func TestLasMigracionesSonIgualesALasDeE13(t *testing.T) {
	sha := map[string]string{
		"0001_esquema_inicial.sql":          "1244bc98f8218c202851a2a7cc18ae212b0c5a316d9238220e55ff48f351ab30",
		"0002_catalogo.sql":                 "f95c1a03e3a956cec11b448d913ebb79df5c96c72f1e475b446a35566c36de3b",
		"0003_ingreso_anterior.sql":         "005fb34328e7ab1a2bc2842ffa722b7b2f3fb3382e4adbdc216ed6a7c0ff87c5",
		"0004_presupuesto_en_cero.sql":      "f6dc137db7f1e67d9bcbb1f535d571b9da76b1a1ec8bb0ee4b55b14cf6ca4a24",
		"0005_transmision_a_encargados.sql": "26428c5541ae9d2de12400101280c7e9acb271b73e3529387f1b2682befa3259",
		"0006_aviso_de_purga.sql":           "a0153017ed616991939e4f3b68fe2bf7c41567c53869c8139b471e79d9d49091",
	}
	for nombre, esperado := range sha {
		contenido, err := fs.ReadFile(migraciones.SQL, nombre)
		if err != nil {
			t.Fatal(err)
		}
		h := sha256.Sum256(contenido)
		if obtenido := hex.EncodeToString(h[:]); obtenido != esperado {
			t.Errorf("%s: SHA-256 %s, se esperaba %s", nombre, obtenido, esperado)
		}
	}
}
