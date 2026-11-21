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

// sinBaseDeDatos deja sin configurar las dos formas de conectar: la URL y la identidad administrada (D-204 (1)). Sin
// esto, un PGHOST del entorno de quien corre las pruebas cambiaría el resultado.
func sinBaseDeDatos(t *testing.T) {
	t.Helper()
	for _, v := range []string{"BASE_DE_DATOS_URL", "PGHOST", "PGDATABASE", "PGUSER", "PGSSLMODE", "AZURE_CLIENT_ID"} {
		t.Setenv(v, "")
	}
}

// Sin URL ni identidad, migrar falla y el error dice las dos formas de conectar (antes solo faltaba la URL).
func TestMigrarSinURLNiIdentidadFalla(t *testing.T) {
	sinBaseDeDatos(t)
	codigo, salida := ejecutar("migrar")
	if codigo != 1 || !strings.Contains(salida, "BASE_DE_DATOS_URL") || !strings.Contains(salida, "PGHOST") ||
		!strings.Contains(salida, "AZURE_CLIENT_ID") {
		t.Fatalf("código %d, se esperaba 1 y un error que nombre BASE_DE_DATOS_URL y las variables de la identidad: %s", codigo, salida)
	}
}

// migrar usa la misma conexión que el API, con la identidad que le den (la del migrador, D-204 (1)): la configuración
// incompleta o con un PGSSLMODE más débil falla antes de pedir ningún token.
func TestMigrarConIdentidadIncompletaOSinVerifyFullFalla(t *testing.T) {
	sinBaseDeDatos(t)
	t.Setenv("PGHOST", "pg.postgres.database.azure.com")
	t.Setenv("PGDATABASE", "alcanzamos")
	t.Setenv("PGUSER", "id-migrador")
	t.Setenv("PGSSLMODE", "require")
	codigo, salida := ejecutar("migrar")
	if codigo != 1 || !strings.Contains(salida, "AZURE_CLIENT_ID") || strings.Contains(salida, "PGHOST") {
		t.Fatalf("código %d, se esperaba 1 con AZURE_CLIENT_ID como la que falta: %s", codigo, salida)
	}
	t.Setenv("AZURE_CLIENT_ID", "11111111-2222-3333-4444-555555555555")
	codigo, salida = ejecutar("migrar")
	if codigo != 1 || !strings.Contains(salida, "PGSSLMODE") || !strings.Contains(salida, "verify-full") {
		t.Fatalf("código %d, se esperaba 1 por PGSSLMODE distinto de verify-full: %s", codigo, salida)
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

func TestTareasSinURLNiIdentidadFalla(t *testing.T) {
	entornoDeCorreo(t)
	sinBaseDeDatos(t)
	codigo, salida := ejecutar("tareas")
	if codigo != 1 || !strings.Contains(salida, "BASE_DE_DATOS_URL") || strings.Contains(salida, "tareas: fin") {
		t.Fatalf("código %d, se esperaba 1 por la falta de la conexión: %s", codigo, salida)
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

// L24 (a): en Azure ni el API ni los trabajos (`tareas`, `migrar`) aceptan BASE_DE_DATOS_URL. Fallan antes de abrir ninguna
// conexión (el puerto 1 no tiene a nadie) y sin repetir la URL, que lleva la contraseña.
func TestEnAzureNingunSubcomandoAceptaLaURLDeLaBase(t *testing.T) {
	for _, subcomando := range []string{"api", "tareas", "migrar"} {
		t.Run(subcomando, func(t *testing.T) {
			entornoDeCorreo(t)
			sinBaseDeDatos(t)
			t.Setenv("BASE_DE_DATOS_URL", "postgres://alguien:CLAVE-FIJA-DE-PRUEBA@127.0.0.1:1/alcanzamos?sslmode=disable&connect_timeout=1")
			t.Setenv("AZURE_CLIENT_ID", "11111111-2222-3333-4444-555555555555")
			codigo, salida := ejecutar(subcomando)
			if codigo != 1 || !strings.Contains(salida, "BASE_DE_DATOS_URL") || !strings.Contains(salida, "AZURE_CLIENT_ID") {
				t.Fatalf("código %d, se esperaba 1 con un error que nombre BASE_DE_DATOS_URL y AZURE_CLIENT_ID: %s", codigo, salida)
			}
			if strings.Contains(salida, "CLAVE-FIJA-DE-PRUEBA") || strings.Contains(salida, "conectar con PostgreSQL") || strings.Contains(salida, "tareas: fin") {
				t.Fatalf("debía fallar antes de conectar y sin repetir la URL: %s", salida)
			}
		})
	}
}
