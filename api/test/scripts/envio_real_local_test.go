// Pruebas de api/scripts/envio-real-local.sh y de su procedimiento en el README (US-80): el destino no puede cambiar el
// JSON del pedido y el archivo del token nace con permisos 600. Corren partes del script en bash con dobles, sin red,
// sin Docker y sin token real.
package scripts_test

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func leer(t *testing.T, ruta string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", ruta))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func correrBash(t *testing.T, codigo string, args ...string) ([]byte, error) {
	t.Helper()
	dir := t.TempDir()
	cmd := exec.Command("bash", append([]string{"-c", codigo, "prueba"}, args...)...)
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + dir, "TMPDIR=" + dir}
	return cmd.CombinedOutput()
}

// pedidoDelScript arma, con el texto del script, el cuerpo que mandaría curl para un destino.
func pedidoDelScript(t *testing.T, destino string) ([]byte, error) {
	t.Helper()
	s := leer(t, "api/scripts/envio-real-local.sh")
	a := strings.Index(s, `destino="${1:-}"`)
	b := strings.Index(s, "\nproyecto=")
	c := strings.Index(s, `codigo="$(curl`)
	d := strings.Index(s, "\necho \"POST")
	if a < 0 || b < a || c < 0 || d < c {
		t.Fatal("cambió la forma del script: actualizar la extracción de la prueba")
	}
	codigo := s[a:b] + `
puerto_api=18080
curl() {
  while (( $# )); do
    if [[ "$1" == --data ]]; then printf '%s' "$2"; return; fi
    shift
  done
}
` + s[c:d] + "\nprintf '%s' \"$codigo\"\n"
	return correrBash(t, codigo, destino)
}

func TestElDestinoNoPuedeCambiarElCorreoDelPedido(t *testing.T) {
	for _, destino := range []string{
		`prueba@ejemplo.test","correo":"otro@ejemplo.test`,
		`prueba@ejemplo.test"`,
		`prueba\@ejemplo.test`,
		`prueba@ejemplo.test` + "\n",
	} {
		t.Run(destino, func(t *testing.T) {
			out, err := pedidoDelScript(t, destino)
			var salida *exec.ExitError
			if !errors.As(err, &salida) || salida.ExitCode() != 2 {
				t.Fatalf("se esperaba el rechazo del destino (salida 2) antes de crear nada: %v, %s", err, out)
			}
		})
	}
}

func TestUnDestinoValidoVaTalCualEnElPedido(t *testing.T) {
	destino := "andres+us80@alcanzamos.co"
	out, err := pedidoDelScript(t, destino)
	if err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	var pedido struct {
		Correo      string `json:"correo"`
		MayorDeEdad bool   `json:"mayor_de_edad"`
	}
	if err := json.Unmarshal(out, &pedido); err != nil {
		t.Fatalf("el cuerpo no es JSON válido: %v: %s", err, out)
	}
	if pedido.Correo != destino || !pedido.MayorDeEdad {
		t.Fatalf("pedido %+v, se esperaba el correo %q con mayor_de_edad", pedido, destino)
	}
}

func TestElREADMEGuardaElTokenConPermisos600(t *testing.T) {
	s := leer(t, "api/README.md")
	m := regexp.MustCompile("`([^`\\n]*wl-paste[^`\\n]*)`").FindStringSubmatch(s)
	if m == nil {
		t.Fatal("no se encontró en el README el comando que guarda el token")
	}
	codigo := `
umask 022
wl-paste() { printf '%s' SOLO_TOKEN_FALSO; }
` + m[1] + `
stat -c '%a %s' "$HOME/.config/alcanzamos/correo-uat.token"
stat -c '%a' "$HOME/.config/alcanzamos"
`
	out, err := correrBash(t, codigo)
	if err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	lineas := strings.Fields(string(out))
	if len(lineas) != 3 || lineas[0] != "600" || lineas[1] != "16" || lineas[2] != "700" {
		t.Fatalf("se esperaba el archivo 600 con el token y la carpeta 700; salió %q", out)
	}
}
