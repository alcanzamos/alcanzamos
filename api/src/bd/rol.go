package bd

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Roles de PostgreSQL de las aplicaciones (E11-INF 2.3 bis y 2.4). El migrador, que es administrador de Entra del servidor, crea un rol
// por identidad de aplicación (la del API, la de las tareas) y a cada uno le da lo justo; ninguna de esas identidades es administradora,
// así que con su rol no puede hacer DDL ni administrar nada.
//
// Un rol por identidad, con el nombre exacto de su identidad de Entra (es su PGUSER): nunca un rol compartido entre el API y las
// tareas, para poder revocar o rotar una sin tocar la otra. Todos los roles de la lista reciben exactamente los mismos permisos mínimos.
//
// Lo justo es leer y escribir las tablas de la aplicación (SELECT, INSERT, UPDATE y DELETE), leer el catálogo (categoria y finalidad,
// que solo cambian por migración) y nada más: ni la tabla de control de goose, ni TRUNCATE, REFERENCES ni TRIGGER, ni CREATE en el
// esquema, ni roles, bases ni membresías. Las aplicaciones no usan secuencias (las claves son uuid): si una migración las trae, hay que
// darles USAGE aquí.
const (
	// VariableRolesDeAplicacion lista los roles que crea el migrador: pares `<nombre de la identidad de Entra>=<object id>` separados por
	// comas, por ejemplo `id-alcanzamos-api-uat-eus2=<guid>,id-alcanzamos-tareas-uat-eus2=<guid>`. En Azure es obligatoria y cada par
	// lleva su object id (el principal_id de la identidad); fuera de Azure el object id puede faltar (el rol se crea con CREATE ROLE).
	VariableRolesDeAplicacion = "ROLES_DE_APLICACION"

	// Variables del contrato anterior (un solo rol, el del API): ya no se leen, y si están se rechazan en vez de ignorarse.
	variableRolAPIAnterior         = "ROL_API"
	variableRolAPIObjectIDAnterior = "ROL_API_OBJECT_ID"
)

var (
	nombreDeRol = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9._-]{0,62}$`)
	guid        = regexp.MustCompile(`^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`)

	// Nombres que PostgreSQL trata aparte: usarlos como rol de una aplicación daría permisos a otra cosa o rompería la sentencia.
	nombresReservados  = []string{"postgres", "public", "current_user", "current_role", "session_user", "user", "none"}
	prefijosReservados = []string{"pg_", "azure"}

	// Tablas que las aplicaciones solo leen: los catálogos cerrados que siembra una migración (E13).
	tablasDeSoloLectura = []string{"categoria", "finalidad"}
	// Tabla de control de las migraciones: las aplicaciones no la ven.
	tablaDeControl = "goose_db_version"
)

// RolDeLaAplicacion es el rol que el migrador asegura para una identidad de aplicación.
type RolDeLaAplicacion struct {
	Nombre   string // el de la identidad de Entra de la aplicación (su PGUSER)
	ObjectID string // object id de Entra: solo hace falta en Azure
	EnAzure  bool   // en Azure el rol se crea con la función de Entra; fuera, con CREATE ROLE (local y pruebas)
}

// CrearRol crea el rol de PostgreSQL si falta. No da permisos: eso lo hace AsegurarCon.
type CrearRol func(ctx context.Context, pool *pgxpool.Pool, nombre, objectID string) error

// CrearRolDeEntra crea un rol de Entra como servicio (identidad administrada), sin administración y sin MFA, con la función
// pgaadauth_create_principal_with_oid de Azure Database for PostgreSQL. Quien la llama tiene que ser administrador de Entra.
func CrearRolDeEntra(ctx context.Context, pool *pgxpool.Pool, nombre, objectID string) error {
	if !guid.MatchString(objectID) {
		return errors.New("el object id de Entra no es un GUID")
	}
	_, err := pool.Exec(ctx, "SELECT pgaadauth_create_principal_with_oid($1, $2, 'service', false, false)", nombre, objectID)
	return err
}

// CrearRolLocal crea un rol con login y sin contraseña, sin atributos. Solo para PostgreSQL local y pruebas, donde no hay Entra.
func CrearRolLocal(ctx context.Context, pool *pgxpool.Pool, nombre, _ string) error {
	_, err := pool.Exec(ctx, "CREATE ROLE "+pgx.Identifier{nombre}.Sanitize()+" LOGIN")
	return err
}

// LeerRolesDeLaAplicacion lee los roles de las aplicaciones del entorno del migrador (ROLES_DE_APLICACION). Devuelve una lista vacía si
// no hay nada que configurar (fuera de Azure y sin lista). En Azure falla cerrado: sin la lista, o sin el object id de cada rol, las
// aplicaciones no tendrían con qué conectarse y se vería en el primer pedido. Valida toda la lista (nombres, GUID, un rol por identidad)
// y rechaza la lista entera si una entrada falla.
func LeerRolesDeLaAplicacion(entorno func(string) string) ([]RolDeLaAplicacion, error) {
	valor := func(nombre string) string { return strings.TrimSpace(entorno(nombre)) }
	for _, vieja := range []string{variableRolAPIAnterior, variableRolAPIObjectIDAnterior} {
		if valor(vieja) != "" {
			return nil, fmt.Errorf("%s ya no se lee: usa %s con pares <nombre de la identidad>=<object id> separados por comas", vieja, VariableRolesDeAplicacion)
		}
	}
	azure := len(enAzure(entorno)) > 0
	lista := valor(VariableRolesDeAplicacion)
	if lista == "" {
		if azure {
			return nil, errors.New(VariableRolesDeAplicacion + " falta: en Azure el migrador crea un rol por identidad de aplicación, con el nombre de su identidad y su object id de Entra")
		}
		return nil, nil
	}
	var roles []RolDeLaAplicacion
	for i, entrada := range strings.Split(lista, ",") {
		nombre, objectID, _ := strings.Cut(entrada, "=")
		nombre, objectID = strings.TrimSpace(nombre), strings.TrimSpace(objectID)
		if nombre == "" {
			return nil, fmt.Errorf("%s: la entrada %d no tiene nombre de identidad (el formato es <nombre>=<object id>, separadas por comas)", VariableRolesDeAplicacion, i+1)
		}
		if strings.Contains(objectID, "=") {
			return nil, fmt.Errorf("%s: la entrada %d (%q) tiene más de un «=»", VariableRolesDeAplicacion, i+1, nombre)
		}
		if objectID == "" && azure {
			return nil, fmt.Errorf("%s: en Azure el rol %q necesita el object id de Entra de su identidad", VariableRolesDeAplicacion, nombre)
		}
		if objectID != "" && !guid.MatchString(objectID) {
			return nil, fmt.Errorf("%s: el object id de %q debe ser un GUID, el object id de Entra de su identidad", VariableRolesDeAplicacion, nombre)
		}
		roles = append(roles, RolDeLaAplicacion{Nombre: nombre, ObjectID: objectID, EnAzure: azure})
	}
	if err := validarRoles(roles, valor(VariableUsuario)); err != nil {
		return nil, fmt.Errorf("%s: %w", VariableRolesDeAplicacion, err)
	}
	return roles, nil
}

// validarRoles valida la lista entera: cada nombre (validarNombreDeRol) y que ninguna identidad comparta rol (E11-INF 2.4): ni el mismo
// nombre dos veces (sin distinguir mayúsculas) ni el mismo object id con dos nombres.
func validarRoles(roles []RolDeLaAplicacion, usuario string) error {
	nombres, ids := map[string]bool{}, map[string]bool{}
	for _, r := range roles {
		if err := validarNombreDeRol(r.Nombre, usuario); err != nil {
			return fmt.Errorf("rol %q: %w", r.Nombre, err)
		}
		if nombres[strings.ToLower(r.Nombre)] {
			return fmt.Errorf("el rol %q está repetido: cada identidad tiene su propio rol y ninguno se comparte", r.Nombre)
		}
		nombres[strings.ToLower(r.Nombre)] = true
		if r.ObjectID == "" {
			continue
		}
		if ids[strings.ToLower(r.ObjectID)] {
			return fmt.Errorf("el object id %s está repetido (en el rol %q): cada identidad tiene un solo rol", r.ObjectID, r.Nombre)
		}
		ids[strings.ToLower(r.ObjectID)] = true
	}
	return nil
}

// validarNombreDeRol rechaza lo que no sea un nombre simple, uno reservado o el del propio migrador (usuario).
func validarNombreDeRol(nombre, usuario string) error {
	minuscula := strings.ToLower(nombre)
	switch {
	case !nombreDeRol.MatchString(nombre):
		return errors.New("el nombre del rol empieza con una letra y lleva solo letras, números, punto, guion y guion bajo (hasta 63)")
	case slicesContiene(nombresReservados, minuscula) || tienePrefijo(minuscula, prefijosReservados):
		return errors.New("el nombre del rol está reservado en PostgreSQL")
	case usuario != "" && strings.EqualFold(nombre, usuario):
		return errors.New("el rol de una aplicación no puede ser el del migrador")
	}
	return nil
}

func slicesContiene(lista []string, s string) bool {
	for _, e := range lista {
		if e == s {
			return true
		}
	}
	return false
}

func tienePrefijo(s string, prefijos []string) bool {
	for _, p := range prefijos {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}

// Asegurar crea el rol si falta y lo deja con lo justo, con la función de creación que corresponde a donde corre.
func (r RolDeLaAplicacion) Asegurar(ctx context.Context, pool *pgxpool.Pool) error {
	return r.AsegurarCon(ctx, pool, crearSegunElLugar(r.EnAzure))
}

func crearSegunElLugar(enAzure bool) CrearRol {
	if enAzure {
		return CrearRolDeEntra
	}
	return CrearRolLocal
}

// AsegurarRoles asegura todos los roles de la lista, cada uno con la función de creación que corresponde a donde corre (EnAzure).
func AsegurarRoles(ctx context.Context, pool *pgxpool.Pool, roles []RolDeLaAplicacion) error {
	return asegurarRoles(ctx, pool, roles, func(r RolDeLaAplicacion) CrearRol { return crearSegunElLugar(r.EnAzure) })
}

// AsegurarRolesCon es AsegurarRoles con la función de creación dada.
func AsegurarRolesCon(ctx context.Context, pool *pgxpool.Pool, roles []RolDeLaAplicacion, crear CrearRol) error {
	return asegurarRoles(ctx, pool, roles, func(RolDeLaAplicacion) CrearRol { return crear })
}

// asegurarRoles valida la lista entera antes de tocar nada (un rol compartido o un nombre malo no dejan ni el primero creado) y después
// asegura cada rol en orden, con exactamente los mismos permisos mínimos. Cada rol es idempotente: si uno falla, volver a correr
// termina los demás.
func asegurarRoles(ctx context.Context, pool *pgxpool.Pool, roles []RolDeLaAplicacion, crear func(RolDeLaAplicacion) CrearRol) error {
	var yo string
	if err := pool.QueryRow(ctx, "SELECT current_user").Scan(&yo); err != nil {
		return fmt.Errorf("leer el usuario del migrador: %w", err)
	}
	if err := validarRoles(roles, yo); err != nil {
		return fmt.Errorf("roles de la aplicación: %w", err)
	}
	for _, r := range roles {
		if err := r.AsegurarCon(ctx, pool, crear(r)); err != nil {
			return err
		}
	}
	return nil
}

// AsegurarCon es Asegurar con la función de creación dada. Se puede correr cuantas veces haga falta: cada `migrar` lo corre, y deja los
// permisos exactamente como se definen aunque alguien haya dado de más o de menos. Un rol que ya existe con administración (atributos
// de administración o membresía de un rol que los tiene) se rechaza sin tocar nada.
func (r RolDeLaAplicacion) AsegurarCon(ctx context.Context, pool *pgxpool.Pool, crear CrearRol) error {
	var yo string
	if err := pool.QueryRow(ctx, "SELECT current_user").Scan(&yo); err != nil {
		return fmt.Errorf("leer el usuario del migrador: %w", err)
	}
	if err := validarNombreDeRol(r.Nombre, yo); err != nil {
		return fmt.Errorf("rol de la aplicación: %w", err)
	}
	var existe bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)", r.Nombre).Scan(&existe); err != nil {
		return fmt.Errorf("buscar el rol %q: %w", r.Nombre, err)
	}
	if !existe {
		if err := crear(ctx, pool, r.Nombre, r.ObjectID); err != nil {
			return fmt.Errorf("crear el rol %q: %w", r.Nombre, err)
		}
	}
	if err := sinAdministracion(ctx, pool, r.Nombre); err != nil {
		return err
	}
	return darLoJusto(ctx, pool, r.Nombre)
}

// sinAdministracion falla si el rol, o un rol del que es miembro, es superusuario o puede crear roles o bases, replicar, saltarse la
// seguridad de filas o es el administrador de Azure.
func sinAdministracion(ctx context.Context, pool *pgxpool.Pool, nombre string) error {
	filas, err := pool.Query(ctx, `
		SELECT r.rolname FROM pg_roles r
		WHERE pg_has_role($1::name, r.oid, 'MEMBER')
		  AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolname = 'azure_pg_admin')
		ORDER BY r.rolname`, nombre)
	if err != nil {
		return fmt.Errorf("revisar los privilegios del rol %q: %w", nombre, err)
	}
	roles, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("revisar los privilegios del rol %q: %w", nombre, err)
	}
	if len(roles) > 0 {
		return fmt.Errorf("el rol %q tiene privilegios de administración (por %s): una aplicación no puede tenerlos", nombre, strings.Join(roles, ", "))
	}
	return nil
}

// darLoJusto deja los permisos del rol sobre el esquema public exactamente como se definen, en una transacción: quita todo lo que
// tenga sobre cada tabla y le da solo lo suyo, así una tabla nueva queda cubierta y un permiso de más se va.
func darLoJusto(ctx context.Context, pool *pgxpool.Pool, nombre string) (err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("dar permisos al rol %q: %w", nombre, err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	rol := pgx.Identifier{nombre}.Sanitize()
	filas, err := tx.Query(ctx, `
		SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`)
	if err != nil {
		return fmt.Errorf("listar las tablas: %w", err)
	}
	tablas, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("listar las tablas: %w", err)
	}
	sentencias := []string{
		"REVOKE ALL ON SCHEMA public FROM " + rol,
		"GRANT USAGE ON SCHEMA public TO " + rol,
		"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM " + rol,
	}
	for _, tabla := range tablas {
		t := pgx.Identifier{"public", tabla}.Sanitize()
		sentencias = append(sentencias, "REVOKE ALL ON TABLE "+t+" FROM "+rol)
		switch {
		case tabla == tablaDeControl:
		case slicesContiene(tablasDeSoloLectura, tabla):
			sentencias = append(sentencias, "GRANT SELECT ON TABLE "+t+" TO "+rol)
		default:
			sentencias = append(sentencias, "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "+t+" TO "+rol)
		}
	}
	for _, s := range sentencias {
		if _, err = tx.Exec(ctx, s); err != nil {
			return fmt.Errorf("dar permisos al rol %q: %w", nombre, err)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("dar permisos al rol %q: %w", nombre, err)
	}
	return nil
}
