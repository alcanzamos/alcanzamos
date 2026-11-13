package app_test

import (
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/app"
)

// ejecutar corre el API con los argumentos dados y devuelve su código de salida y lo que escribió en el registro.
func ejecutar(args ...string) (int, string) {
	var salida strings.Builder
	codigo := app.Main(args, &salida)
	return codigo, salida.String()
}

func TestSubcomandoDesconocidoFalla(t *testing.T) {
	codigo, salida := ejecutar("nada")
	if codigo != 1 || !strings.Contains(salida, "subcomando desconocido") {
		t.Fatalf("código %d, registro %s", codigo, salida)
	}
}

func TestMigrarSinURLFalla(t *testing.T) {
	t.Setenv("BASE_DE_DATOS_URL", "")
	if codigo, _ := ejecutar("migrar"); codigo != 1 {
		t.Fatalf("código %d, se esperaba 1 por la falta de la URL", codigo)
	}
}

// entornoDeCorreo da la configuración del correo que `tareas` exige, igual que el API (ítem 294, D-203).
func entornoDeCorreo(t *testing.T) {
	t.Helper()
	t.Setenv("CORREO_SMTP", "127.0.0.1:1")
	t.Setenv("CORREO_REMITENTE", "a@b.test")
	t.Setenv("CORREO_PRIVACIDAD", "p@b.test")
	t.Setenv("URL_PUBLICA", "https://app.b.test")
}

func TestTareasSinURLFalla(t *testing.T) {
	entornoDeCorreo(t)
	t.Setenv("BASE_DE_DATOS_URL", "")
	if codigo, _ := ejecutar("tareas"); codigo != 1 {
		t.Fatalf("código %d, se esperaba 1 por la falta de la URL", codigo)
	}
}

// El registro escribe la hora en UTC (E17-VTE 2.1) aunque la zona del equipo no lo sea.
func TestElRegistroEscribeLaHoraEnUTC(t *testing.T) {
	zona := time.Local
	time.Local = time.FixedZone("Bogota", -5*3600)
	t.Cleanup(func() { time.Local = zona })

	_, salida := ejecutar("nada")
	if !strings.Contains(salida, `"time":"`) || !strings.Contains(salida, `Z","level":"ERROR"`) {
		t.Fatalf("la hora debe salir en UTC: %s", salida)
	}
}

func TestServirSinConfiguracionFallaAntesDeConectar(t *testing.T) {
	for _, v := range []string{"CORREO_SMTP", "CORREO_REMITENTE", "CORREO_PRIVACIDAD", "URL_PUBLICA"} {
		t.Setenv(v, "")
	}
	t.Setenv("BASE_DE_DATOS_URL", "postgres://nadie@127.0.0.1:1/nada")
	codigo, salida := ejecutar("api")
	if codigo != 1 || !strings.Contains(salida, "CORREO_SMTP falta") || !strings.Contains(salida, "URL_PUBLICA falta") {
		t.Fatalf("se esperaba un error que nombre las variables que faltan: %d %s", codigo, salida)
	}
}

// La tarea envía el aviso de la purga: sin la configuración del correo no corre nada y el error nombra las variables
// (antes armaba el servicio sin correo y el primer aviso terminaba en un nil pointer).
func TestTareasSinConfiguracionDeCorreoFalla(t *testing.T) {
	for _, v := range []string{"CORREO_SMTP", "CORREO_REMITENTE", "CORREO_PRIVACIDAD", "URL_PUBLICA"} {
		t.Setenv(v, "")
	}
	t.Setenv("BASE_DE_DATOS_URL", "postgres://nadie@127.0.0.1:1/nada")
	codigo, salida := ejecutar("tareas")
	if codigo != 1 || !strings.Contains(salida, "CORREO_SMTP falta") || !strings.Contains(salida, "URL_PUBLICA falta") ||
		strings.Contains(salida, "tareas: fin") {
		t.Fatalf("se esperaba un error que nombre las variables que faltan, sin correr tareas: %d %s", codigo, salida)
	}
}
