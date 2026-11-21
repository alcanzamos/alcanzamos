package bd_test

import (
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/bd"
)

// Rol de PostgreSQL de la identidad del API (L24 (b), E11-INF 2.3 bis): el migrador lo crea con lo justo. Estas pruebas cubren la
// lectura de la configuración del migrador; las que tocan PostgreSQL están en rol_integracion_test.go.

const objectIDDelAPI = "99999999-8888-7777-6666-555555555555"

// Nombres de rol de ejemplo, en constantes: así ninguna línea junta la palabra «api» con un texto largo entre comillas.
const (
	rolDeEjemplo          = "id-alcanzamos-api-uat-eus2"
	nombreCorto           = "api"
	identidadDeProduccion = "id-alcanzamos-api-prod-eus2"
	nombreConPunto        = "api_alcanzamos.v2"
)

func TestSinRolDelAPIEnElEntornoNoHayNadaQueHacer(t *testing.T) {
	rol, err := bd.LeerRolDeLaAplicacion(entorno(nil))
	if err != nil || rol != nil {
		t.Fatalf("sin variables y fuera de Azure no se configura ningún rol: %v, %v", rol, err)
	}
}

func TestFueraDeAzureBastaElNombreDelRol(t *testing.T) {
	rol, err := bd.LeerRolDeLaAplicacion(entorno(map[string]string{"ROL_API": rolDeEjemplo}))
	if err != nil || rol == nil {
		t.Fatalf("se esperaba el rol: %v, %v", rol, err)
	}
	if rol.Nombre != "id-alcanzamos-api-uat-eus2" || rol.EnAzure {
		t.Errorf("rol mal leído: %+v", rol)
	}
}

func TestEnAzureHacenFaltaElNombreYElObjectID(t *testing.T) {
	azure := map[string]string{"AZURE_CLIENT_ID": clienteID, "PGUSER": "id-alcanzamos-migrador-uat-eus2"}
	// Falla cerrado: un migrador en Azure sin rol del API dejaría al API sin poder conectar, y se vería hasta el primer pedido.
	_, err := bd.LeerRolDeLaAplicacion(entorno(azure))
	if err == nil || !strings.Contains(err.Error(), "ROL_API") {
		t.Fatalf("en Azure sin ROL_API debía fallar nombrándola: %v", err)
	}
	azure["ROL_API"] = "id-alcanzamos-api-uat-eus2"
	_, err = bd.LeerRolDeLaAplicacion(entorno(azure))
	if err == nil || !strings.Contains(err.Error(), "ROL_API_OBJECT_ID") {
		t.Fatalf("en Azure sin ROL_API_OBJECT_ID debía fallar nombrándola: %v", err)
	}
	azure["ROL_API_OBJECT_ID"] = objectIDDelAPI
	rol, err := bd.LeerRolDeLaAplicacion(entorno(azure))
	if err != nil || rol == nil || !rol.EnAzure || rol.ObjectID != objectIDDelAPI || rol.Nombre != "id-alcanzamos-api-uat-eus2" {
		t.Fatalf("se esperaba el rol de Azure completo: %+v, %v", rol, err)
	}
}

func TestElObjectIDDebeSerUnGUID(t *testing.T) {
	for _, malo := range []string{"no-es-un-guid", "99999999-8888-7777-6666-55555555555", "99999999888877776666555555555555", "'; DROP TABLE persona; --", " "} {
		env := map[string]string{"AZURE_CLIENT_ID": clienteID, "ROL_API": "api", "ROL_API_OBJECT_ID": malo}
		if _, err := bd.LeerRolDeLaAplicacion(entorno(env)); err == nil || !strings.Contains(err.Error(), "ROL_API_OBJECT_ID") {
			t.Errorf("el object id %q debía rechazarse nombrando ROL_API_OBJECT_ID: %v", malo, err)
		}
	}
}

func TestElObjectIDSinNombreEsUnErrorDeConfiguracion(t *testing.T) {
	_, err := bd.LeerRolDeLaAplicacion(entorno(map[string]string{"ROL_API_OBJECT_ID": objectIDDelAPI}))
	if err == nil || !strings.Contains(err.Error(), "ROL_API") {
		t.Fatalf("ROL_API_OBJECT_ID sin ROL_API debía fallar: %v", err)
	}
}

// El nombre llega a SQL como identificador: solo letras, números, punto, guion y guion bajo; nunca uno reservado ni el del migrador.
func TestNombresDeRolQueSeRechazan(t *testing.T) {
	malos := []string{
		"", "   ", "postgres", "azure_pg_admin", "azure_superuser", "pg_monitor", "PG_READ_ALL_DATA", "public", "PUBLIC", "current_user", "session_user",
		`api"; DROP TABLE persona; --`, "api uno", "api;", "1api", "-api", strings.Repeat("a", 64), "id-alcanzamos-migrador-uat-eus2", // este es el PGUSER
	}
	for _, malo := range malos {
		env := map[string]string{"ROL_API": malo, "PGUSER": "id-alcanzamos-migrador-uat-eus2"}
		rol, err := bd.LeerRolDeLaAplicacion(entorno(env))
		if strings.TrimSpace(malo) == "" {
			// Un nombre en blanco es «sin configurar»: sin otra variable no hay nada que hacer.
			if rol != nil || err != nil {
				t.Errorf("%q: se esperaba «sin configurar»: %v, %v", malo, rol, err)
			}
			continue
		}
		if err == nil || rol != nil || !strings.Contains(err.Error(), "ROL_API") {
			t.Errorf("el nombre %q debía rechazarse nombrando ROL_API: %v, %v", malo, rol, err)
		}
	}
	for _, bueno := range []string{nombreCorto, identidadDeProduccion, nombreConPunto, strings.Repeat("a", 63)} {
		if rol, err := bd.LeerRolDeLaAplicacion(entorno(map[string]string{"ROL_API": bueno})); err != nil || rol == nil || rol.Nombre != bueno {
			t.Errorf("el nombre %q debía aceptarse: %v, %v", bueno, rol, err)
		}
	}
}
