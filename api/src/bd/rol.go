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

// Rol de PostgreSQL de la identidad del API (E11-INF 2.3 bis). El migrador, que es administrador de Entra del servidor, crea el rol del
// API y le da lo justo; la identidad del API no es administradora, así que con su rol no puede hacer DDL ni administrar nada.
//
// Lo justo es leer y escribir las tablas del API (SELECT, INSERT, UPDATE y DELETE), leer el catálogo (categoria y finalidad, que solo
// cambian por migración) y nada más: ni la tabla de control de goose, ni TRUNCATE, REFERENCES ni TRIGGER, ni CREATE en el esquema, ni
// roles, bases ni membresías. El API no usa secuencias (las claves son uuid): si una migración las trae, hay que darle USAGE aquí.
const (
	VariableRolAPI         = "ROL_API"           // nombre del rol del API en PostgreSQL: el de su identidad (es su PGUSER)
	VariableRolAPIObjectID = "ROL_API_OBJECT_ID" // object id de Entra de la identidad del API (su principal_id); solo en Azure
)

var (
	nombreDeRol = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9._-]{0,62}$`)
	guid        = regexp.MustCompile(`^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`)

	// Nombres que PostgreSQL trata aparte: usarlos como rol del API daría permisos a otra cosa o rompería la sentencia.
	nombresReservados  = []string{"postgres", "public", "current_user", "current_role", "session_user", "user", "none"}
	prefijosReservados = []string{"pg_", "azure"}

	// Tablas que el API solo lee: los catálogos cerrados que siembra una migración (E13).
	tablasDeSoloLectura = []string{"categoria", "finalidad"}
	// Tabla de control de las migraciones: el API no la ve.
	tablaDeControl = "goose_db_version"
)

// RolDeLaAplicacion es el rol que el migrador asegura para el API.
type RolDeLaAplicacion struct {
	Nombre   string
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

// LeerRolDeLaAplicacion lee el rol del API del entorno del migrador. Devuelve nil si no hay nada que configurar (fuera de Azure y sin
// ROL_API). En Azure falla cerrado: sin el nombre y el object id, el API no tendría con qué conectarse y se vería en el primer pedido.
func LeerRolDeLaAplicacion(entorno func(string) string) (*RolDeLaAplicacion, error) {
	valor := func(nombre string) string { return strings.TrimSpace(entorno(nombre)) }
	nombre, objectID := valor(VariableRolAPI), valor(VariableRolAPIObjectID)
	azure := len(enAzure(entorno)) > 0
	if nombre == "" && objectID == "" && !azure {
		return nil, nil
	}
	if nombre == "" {
		return nil, errors.New(VariableRolAPI + " falta: el migrador crea el rol del API con ese nombre (el de su identidad)")
	}
	if err := validarNombreDeRol(nombre, valor(VariableUsuario)); err != nil {
		return nil, fmt.Errorf("%s: %w", VariableRolAPI, err)
	}
	if objectID == "" && azure {
		return nil, errors.New(VariableRolAPIObjectID + " falta: en Azure el rol se crea con el object id de Entra de la identidad del API")
	}
	if objectID != "" && !guid.MatchString(objectID) {
		return nil, errors.New(VariableRolAPIObjectID + " debe ser un GUID, el object id de Entra de la identidad del API")
	}
	return &RolDeLaAplicacion{Nombre: nombre, ObjectID: objectID, EnAzure: azure}, nil
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
		return errors.New("el rol del API no puede ser el del migrador")
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
	crear := CrearRolLocal
	if r.EnAzure {
		crear = CrearRolDeEntra
	}
	return r.AsegurarCon(ctx, pool, crear)
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
		return fmt.Errorf("rol del API: %w", err)
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
		return fmt.Errorf("el rol %q tiene privilegios de administración (por %s): el API no puede tenerlos", nombre, strings.Join(roles, ", "))
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
