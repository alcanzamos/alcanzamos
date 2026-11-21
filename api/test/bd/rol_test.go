package bd_test

import (
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/bd"
)

// Roles de PostgreSQL de las aplicaciones (E11-INF 2.3 bis y 2.4): el migrador crea un rol por identidad, con el nombre de su identidad
// de Entra y con lo justo. Estas pruebas cubren la lectura de ROLES_DE_APLICACION; las que tocan PostgreSQL están en
// rol_integracion_test.go.

const (
	objectIDDelAPI     = "99999999-8888-7777-6666-555555555555"
	objectIDDeTareas   = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	identidadDeLaPieza = "id-alcanzamos-api-uat-eus2"
	identidadDeTareas  = "id-alcanzamos-tareas-uat-eus2"
	migradorDePrueba   = "id-alcanzamos-migrador-uat-eus2"
)

// Nombres de rol de ejemplo, en constantes: así ninguna línea junta la palabra «api» con un texto largo entre comillas.
const (
	nombreCorto           = "api"
	identidadDeProduccion = "id-alcanzamos-api-prod-eus2"
	nombreConPunto        = "api_alcanzamos.v2"
)

func enAzure(extra map[string]string) map[string]string {
	env := map[string]string{"AZURE_CLIENT_ID": clienteID, "PGUSER": migradorDePrueba}
	for k, v := range extra {
		env[k] = v
	}
	return env
}

func TestSinRolesDeAplicacionEnElEntornoNoHayNadaQueHacer(t *testing.T) {
	for _, valor := range []string{"", "   "} {
		roles, err := bd.LeerRolesDeLaAplicacion(entorno(map[string]string{"ROLES_DE_APLICACION": valor}))
		if err != nil || len(roles) != 0 {
			t.Fatalf("%q: sin lista y fuera de Azure no se configura ningún rol: %v, %v", valor, roles, err)
		}
	}
	roles, err := bd.LeerRolesDeLaAplicacion(entorno(nil))
	if err != nil || len(roles) != 0 {
		t.Fatalf("sin variables: %v, %v", roles, err)
	}
}

func TestFueraDeAzureBastanLosNombresYElObjectIDEsOpcional(t *testing.T) {
	roles, err := bd.LeerRolesDeLaAplicacion(entorno(map[string]string{"ROLES_DE_APLICACION": identidadDeLaPieza}))
	if err != nil || len(roles) != 1 || roles[0].Nombre != identidadDeLaPieza || roles[0].EnAzure || roles[0].ObjectID != "" {
		t.Fatalf("se esperaba un rol sin object id fuera de Azure: %+v, %v", roles, err)
	}
	// Con espacios alrededor, con «=» sin object id y con object id: las tres formas valen, y el orden se conserva.
	lista := " " + identidadDeLaPieza + " = " + objectIDDelAPI + " , " + identidadDeTareas + "="
	roles, err = bd.LeerRolesDeLaAplicacion(entorno(map[string]string{"ROLES_DE_APLICACION": lista}))
	if err != nil || len(roles) != 2 {
		t.Fatalf("se esperaban dos roles: %+v, %v", roles, err)
	}
	if roles[0] != (bd.RolDeLaAplicacion{Nombre: identidadDeLaPieza, ObjectID: objectIDDelAPI}) || roles[1] != (bd.RolDeLaAplicacion{Nombre: identidadDeTareas}) {
		t.Errorf("roles mal leídos: %+v", roles)
	}
}

func TestEnAzureLaListaYCadaObjectIDSonObligatorios(t *testing.T) {
	// Falla cerrado: un migrador en Azure sin roles dejaría al API y a las tareas sin poder conectar, y se vería hasta el primer pedido.
	for _, valor := range []string{"", "   "} {
		roles, err := bd.LeerRolesDeLaAplicacion(entorno(enAzure(map[string]string{"ROLES_DE_APLICACION": valor})))
		if err == nil || roles != nil || !strings.Contains(err.Error(), "ROLES_DE_APLICACION") {
			t.Fatalf("en Azure con la lista %q debía fallar nombrando ROLES_DE_APLICACION: %v, %v", valor, roles, err)
		}
	}
	for _, lista := range []string{identidadDeLaPieza, identidadDeLaPieza + "=", identidadDeLaPieza + "=" + objectIDDelAPI + "," + identidadDeTareas} {
		_, err := bd.LeerRolesDeLaAplicacion(entorno(enAzure(map[string]string{"ROLES_DE_APLICACION": lista})))
		if err == nil || !strings.Contains(err.Error(), "ROLES_DE_APLICACION") || !strings.Contains(err.Error(), "object id") {
			t.Errorf("en Azure sin object id la lista %q debía fallar nombrando la variable y el object id: %v", lista, err)
		}
	}
	lista := identidadDeLaPieza + "=" + objectIDDelAPI + "," + identidadDeTareas + "=" + strings.ToUpper(objectIDDeTareas)
	roles, err := bd.LeerRolesDeLaAplicacion(entorno(enAzure(map[string]string{"ROLES_DE_APLICACION": lista})))
	if err != nil || len(roles) != 2 {
		t.Fatalf("se esperaban los dos roles de Azure: %+v, %v", roles, err)
	}
	if roles[0] != (bd.RolDeLaAplicacion{Nombre: identidadDeLaPieza, ObjectID: objectIDDelAPI, EnAzure: true}) ||
		roles[1] != (bd.RolDeLaAplicacion{Nombre: identidadDeTareas, ObjectID: strings.ToUpper(objectIDDeTareas), EnAzure: true}) {
		t.Errorf("roles de Azure mal leídos: %+v", roles)
	}
}

func TestElObjectIDDeCadaRolDebeSerUnGUID(t *testing.T) {
	for _, malo := range []string{"no-es-un-guid", "99999999-8888-7777-6666-55555555555", "99999999888877776666555555555555", "'; DROP TABLE persona; --"} {
		for _, extra := range []map[string]string{{"AZURE_CLIENT_ID": clienteID}, {}} { // en Azure y fuera: si hay object id, tiene que ser un GUID
			env := map[string]string{"ROLES_DE_APLICACION": identidadDeTareas + "=" + objectIDDeTareas + "," + identidadDeLaPieza + "=" + malo}
			for k, v := range extra {
				env[k] = v
			}
			if _, err := bd.LeerRolesDeLaAplicacion(entorno(env)); err == nil || !strings.Contains(err.Error(), "ROLES_DE_APLICACION") || !strings.Contains(err.Error(), "GUID") {
				t.Errorf("el object id %q debía rechazarse nombrando ROLES_DE_APLICACION y el GUID: %v", malo, err)
			}
		}
	}
}

// Una entrada mal formada rechaza toda la lista: nada de saltarse una entrada y seguir con las demás.
func TestLasEntradasMalFormadasRechazanLaLista(t *testing.T) {
	g := objectIDDelAPI
	for _, lista := range []string{
		identidadDeLaPieza + "," + ",", ",", identidadDeLaPieza + ",", "," + identidadDeLaPieza, identidadDeLaPieza + ",,otro",
		"=" + g, " =" + g, identidadDeLaPieza + "=" + g + "=" + g, identidadDeLaPieza + "==" + g, identidadDeLaPieza + ";" + identidadDeTareas,
	} {
		roles, err := bd.LeerRolesDeLaAplicacion(entorno(map[string]string{"ROLES_DE_APLICACION": lista}))
		if err == nil || roles != nil || !strings.Contains(err.Error(), "ROLES_DE_APLICACION") {
			t.Errorf("la lista %q debía rechazarse nombrando ROLES_DE_APLICACION: %v, %v", lista, roles, err)
		}
	}
}

// Un rol por identidad (E11-INF 2.4): ni el mismo nombre dos veces (un rol compartido entre el API y las tareas) ni la misma
// identidad con dos nombres.
func TestNingunRolSeComparteEntreIdentidades(t *testing.T) {
	otroID := "12345678-1234-1234-1234-123456789abc"
	casos := map[string]string{
		"mismo nombre":                      identidadDeLaPieza + "=" + objectIDDelAPI + "," + identidadDeLaPieza + "=" + objectIDDeTareas,
		"mismo nombre, otra capitalización": identidadDeLaPieza + "=" + objectIDDelAPI + "," + strings.ToUpper(identidadDeLaPieza) + "=" + objectIDDeTareas,
		"mismo nombre sin object id":        identidadDeLaPieza + "," + identidadDeLaPieza,
		"mismo object id":                   identidadDeLaPieza + "=" + objectIDDelAPI + "," + identidadDeTareas + "=" + objectIDDelAPI,
		"mismo object id en mayúsculas":     identidadDeLaPieza + "=" + objectIDDelAPI + "," + identidadDeTareas + "=" + strings.ToUpper(objectIDDelAPI),
		"tres con el primero repetido":      identidadDeLaPieza + "=" + objectIDDelAPI + "," + identidadDeTareas + "=" + objectIDDeTareas + "," + identidadDeLaPieza + "=" + otroID,
	}
	for nombre, lista := range casos {
		for _, env := range []map[string]string{{}, {"AZURE_CLIENT_ID": clienteID}} {
			if len(env) > 0 && !strings.Contains(lista, "=") {
				continue // en Azure una lista sin object id falla antes, por faltar el object id (otra prueba)
			}
			env["ROLES_DE_APLICACION"] = lista
			roles, err := bd.LeerRolesDeLaAplicacion(entorno(env))
			if err == nil || roles != nil || !strings.Contains(err.Error(), "ROLES_DE_APLICACION") || !strings.Contains(err.Error(), "repet") {
				t.Errorf("%s (%q): debía rechazarse como repetido: %v, %v", nombre, lista, roles, err)
			}
		}
	}
}

// ROL_API y ROL_API_OBJECT_ID ya no se leen: ignorarlas en silencio dejaría sin rol a quien todavía las use. Se rechazan nombrando la
// variable nueva, también en Azure con la lista bien puesta.
func TestLasVariablesViejasSeRechazan(t *testing.T) {
	for _, vieja := range []string{"ROL_API", "ROL_API_OBJECT_ID"} {
		for _, env := range []map[string]string{{vieja: "algo"}, enAzure(map[string]string{vieja: "algo", "ROLES_DE_APLICACION": identidadDeLaPieza + "=" + objectIDDelAPI})} {
			roles, err := bd.LeerRolesDeLaAplicacion(entorno(env))
			if err == nil || roles != nil || !strings.Contains(err.Error(), vieja) || !strings.Contains(err.Error(), "ROLES_DE_APLICACION") {
				t.Errorf("%s debía rechazarse indicando ROLES_DE_APLICACION: %v, %v", vieja, roles, err)
			}
		}
	}
	// En blanco no cuenta: es lo mismo que no estar.
	if roles, err := bd.LeerRolesDeLaAplicacion(entorno(map[string]string{"ROL_API": " ", "ROL_API_OBJECT_ID": ""})); err != nil || len(roles) != 0 {
		t.Errorf("las variables viejas en blanco no se rechazan: %v, %v", roles, err)
	}
}

// El nombre llega a SQL como identificador: solo letras, números, punto, guion y guion bajo; nunca uno reservado ni el del migrador.
func TestNombresDeRolQueSeRechazan(t *testing.T) {
	malos := []string{
		"postgres", "azure_pg_admin", "azure_superuser", "pg_monitor", "PG_READ_ALL_DATA", "public", "PUBLIC", "current_user", "session_user",
		`api"; DROP TABLE persona; --`, "api uno", "api;", "1api", "-api", strings.Repeat("a", 64), migradorDePrueba, // este es el PGUSER
	}
	for _, malo := range malos {
		// El malo va en segundo lugar, junto a uno bueno: una lista con un solo nombre malo se rechaza entera.
		lista := identidadDeLaPieza + "=" + objectIDDelAPI + "," + malo + "=" + objectIDDeTareas
		roles, err := bd.LeerRolesDeLaAplicacion(entorno(enAzure(map[string]string{"ROLES_DE_APLICACION": lista})))
		if err == nil || roles != nil || !strings.Contains(err.Error(), "ROLES_DE_APLICACION") {
			t.Errorf("el nombre %q debía rechazarse nombrando ROLES_DE_APLICACION: %v, %v", malo, roles, err)
		}
	}
	for _, bueno := range []string{nombreCorto, identidadDeLaPieza, identidadDeProduccion, nombreConPunto, strings.Repeat("a", 63)} {
		roles, err := bd.LeerRolesDeLaAplicacion(entorno(map[string]string{"ROLES_DE_APLICACION": bueno}))
		if err != nil || len(roles) != 1 || roles[0].Nombre != bueno {
			t.Errorf("el nombre %q debía aceptarse: %v, %v", bueno, roles, err)
		}
	}
}
