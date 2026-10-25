//go:build integration

package pg_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// Con la base caída o el pool cerrado, cada operación de los repositorios devuelve un error y no un resultado
// «vacío»: una caída nunca se confunde con «no existe», «sin sesión» o «enlace inválido», que son respuestas de negocio
// distintas (la sesión que no se puede leer no debe tratarse como sesión de otra persona, ni un fallo de la base como
// «el correo no tiene cuenta»).
func TestConLaBaseCaidaCadaOperacionFallaConUnErrorDeInfraestructura(t *testing.T) {
	pool := pgtest.Nueva(t)
	pool.Close()
	ctx := context.Background()
	huella := []byte("huella-de-prueba-de-32-bytes....")
	vence := ahora.Add(time.Hour)
	const persona = "0192f3c4-0000-7000-8000-0000000000aa"

	cuentas, autenticaciones := pg.NuevoCuentas(pool), pg.NuevoAutenticacion(pool)
	sesiones, limpieza := pg.NuevoSesiones(pool), pg.NuevoLimpieza(pool)
	autorizaciones := pg.NuevoAutorizaciones(pool)

	casos := []struct {
		nombre    string
		operacion func() error
	}{
		{"cuentas.Crear", func() error {
			_, err := cuentas.Crear(ctx, cuenta.NuevaCuenta{Correo: "a@ejemplo.test", Nombre: "A", HashContrasena: "h",
				HuellaDelEnlace: huella, HuellaDeSesion: []byte("otra"), Ahora: ahora, VenceElEnlaceEn: vence})
			return err
		}},
		{"cuentas.VerificarCorreo", func() error { _, err := cuentas.VerificarCorreo(ctx, huella, ahora); return err }},
		{"cuentas.NuevoEnlaceDeVerificacion", func() error {
			_, err := cuentas.NuevoEnlaceDeVerificacion(ctx, persona, huella, ahora, vence)
			return err
		}},
		{"cuentas.CambiarCorreoSinVerificar", func() error {
			return cuentas.CambiarCorreoSinVerificar(ctx, persona, "b@ejemplo.test", huella, ahora, vence)
		}},
		{"cuentas.BorrarSinConfirmar", func() error {
			_, err := cuentas.BorrarSinConfirmar(ctx, ahora, ahora, ahora, []string{"cuenta_y_acceso"})
			return err
		}},
		{"autenticacion.CredencialPorCorreo", func() error { _, err := autenticaciones.CredencialPorCorreo(ctx, "a@ejemplo.test"); return err }},
		{"autenticacion.CredencialDe", func() error { _, err := autenticaciones.CredencialDe(ctx, persona); return err }},
		{"autenticacion.IniciarSesion", func() error { return autenticaciones.IniciarSesion(ctx, persona, huella, ahora, nil) }},
		{"autenticacion.IniciarSesion con mejora", func() error {
			return autenticaciones.IniciarSesion(ctx, persona, huella, ahora, &autenticacion.MejoraDeHash{Viejo: "v", Nuevo: "n"})
		}},
		{"autenticacion.CerrarSesion", func() error { return autenticaciones.CerrarSesion(ctx, huella) }},
		{"autenticacion.IngresoAnterior", func() error { _, err := autenticaciones.IngresoAnterior(ctx, persona); return err }},
		{"autenticacion.NuevoEnlaceDeRecuperacion", func() error {
			_, err := autenticaciones.NuevoEnlaceDeRecuperacion(ctx, "a@ejemplo.test", huella, ahora, vence)
			return err
		}},
		{"autenticacion.CorreoDelEnlaceDeRecuperacion", func() error {
			_, err := autenticaciones.CorreoDelEnlaceDeRecuperacion(ctx, huella, ahora)
			return err
		}},
		{"autenticacion.FijarContrasenaConEnlace", func() error { return autenticaciones.FijarContrasenaConEnlace(ctx, huella, "h", ahora) }},
		{"autenticacion.CambiarContrasena", func() error { return autenticaciones.CambiarContrasena(ctx, persona, "h", huella) }},
		{"sesiones.Crear", func() error { return sesiones.Crear(ctx, persona, huella, ahora) }},
		{"sesiones.Sujeto", func() error { _, err := sesiones.Sujeto(ctx, huella, ahora); return err }},
		{"autorizaciones.Vigentes", func() error { _, err := autorizaciones.Vigentes(ctx, persona); return err }},
		{"autorizaciones.Otorgar", func() error {
			return autorizaciones.Otorgar(ctx, persona, []string{"cuenta_y_acceso"}, "1.0 del 2026-10-30", ahora)
		}},
		{"autorizaciones.Rechazar", func() error {
			return autorizaciones.Rechazar(ctx, persona, []string{"cuenta_y_acceso"}, ahora, ahora)
		}},
		{"limpieza.LimpiarSesionesYEnlaces", func() error { _, _, err := limpieza.LimpiarSesionesYEnlaces(ctx, ahora); return err }},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			err := c.operacion()
			if err == nil {
				t.Fatal("se esperaba un error")
			}
			for _, deNegocio := range []error{autenticacion.ErrNoExiste, seguridad.ErrSinSesion, cuenta.ErrEnlaceInvalido, cuenta.ErrCorreoYaRegistrado, autorizacion.ErrSinCuenta, autorizacion.ErrYaAutorizada} {
				if errors.Is(err, deNegocio) {
					t.Fatalf("una base caída se confundió con una respuesta de negocio (%v): %v", deNegocio, err)
				}
			}
			if strings.Contains(err.Error(), "huella-de-prueba") || strings.Contains(err.Error(), "ejemplo.test") {
				t.Errorf("el error lleva datos de la petición: %v", err)
			}
		})
	}
}

// Una creación que falla a la mitad no deja nada: la persona y el perfil se insertaron antes de la sesión, y si la
// sesión choca con otra existente (misma huella) toda la transacción se deshace.
func TestCrearCuentaQueFallaALaMitadNoDejaNada(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	dueno := e.sembrar(t, "dueno@ejemplo.test")
	huellaOcupada := []byte("huella-de-sesion-ya-usada-32-by.")
	if err := e.sesiones.Crear(ctx, dueno, huellaOcupada, ahora); err != nil {
		t.Fatal(err)
	}
	var antes int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM persona`).Scan(&antes); err != nil {
		t.Fatal(err)
	}

	_, err := pg.NuevoCuentas(e.pool).Crear(ctx, cuenta.NuevaCuenta{
		Correo: "nueva@ejemplo.test", Nombre: "Nueva", HashContrasena: "hash",
		HuellaDelEnlace: []byte("huella-de-enlace-nueva-32-bytes."), HuellaDeSesion: huellaOcupada,
		Ahora: ahora, VenceElEnlaceEn: ahora.Add(24 * time.Hour),
	})
	if err == nil {
		t.Fatal("se esperaba un error por la sesión repetida")
	}
	var despues, enlaces int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM persona`).Scan(&despues); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM enlace_un_uso`).Scan(&enlaces); err != nil {
		t.Fatal(err)
	}
	if despues != antes {
		t.Errorf("personas: %d, había %d: la transacción no se deshizo", despues, antes)
	}
	if enlaces != 0 {
		t.Errorf("quedaron %d enlaces de una creación fallida", enlaces)
	}
	if _, err := pg.NuevoAutenticacion(e.pool).CredencialPorCorreo(ctx, "nueva@ejemplo.test"); !errors.Is(err, autenticacion.ErrNoExiste) {
		t.Errorf("la cuenta fallida existe: %v", err)
	}
}

// Iniciar sesión con una huella que ya es de otra sesión falla sin dejar el hash mejorado: la mejora del hash y la
// sesión van en la misma transacción.
func TestIniciarSesionQueFallaNoMejoraElHash(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	persona := e.sembrar(t, "laura@ejemplo.test")
	huella := []byte("huella-de-sesion-ya-usada-32-by.")
	if err := e.sesiones.Crear(ctx, persona, huella, ahora); err != nil {
		t.Fatal(err)
	}
	a := pg.NuevoAutenticacion(e.pool)
	antes, err := a.CredencialDe(ctx, persona)
	if err != nil {
		t.Fatal(err)
	}
	err = a.IniciarSesion(ctx, persona, huella, ahora, &autenticacion.MejoraDeHash{Viejo: antes.Hash, Nuevo: "$argon2id$nuevo"})
	if err == nil {
		t.Fatal("se esperaba un error por la huella repetida")
	}
	despues, err := a.CredencialDe(ctx, persona)
	if err != nil {
		t.Fatal(err)
	}
	if despues.Hash != antes.Hash {
		t.Errorf("el hash cambió pese al fallo: %q", despues.Hash)
	}
}

// Si una sentencia falla a mitad de «No autorizo» o de «Autorizar», la transacción se deshace: la cuenta sigue y no queda
// ninguna autorización a medias.
func TestAutorizacionesQueFallanALaMitadNoCambianNada(t *testing.T) {
	ctx := context.Background()
	necesarias := []string{"cuenta_y_acceso", "funciones_financieras"}
	for _, c := range []struct{ nombre, preparar string }{
		{"falla el borrado de la persona", `CREATE FUNCTION falla() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla de prueba'; END $$;
			CREATE TRIGGER t BEFORE DELETE ON persona FOR EACH STATEMENT EXECUTE FUNCTION falla()`},
		{"falla el retiro de las autorizaciones", `CREATE FUNCTION falla() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla de prueba'; END $$;
			CREATE TRIGGER t BEFORE UPDATE ON autorizacion FOR EACH STATEMENT EXECUTE FUNCTION falla()`},
		{"falla la consulta de las vigentes", `DROP TABLE autorizacion`},
	} {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno(t)
			persona := e.sembrar(t, "laura@ejemplo.test")
			verificar(t, e.pool, persona)
			if _, err := e.pool.Exec(ctx, c.preparar); err != nil {
				t.Fatal(err)
			}
			repo := pg.NuevoAutorizaciones(e.pool)
			if err := repo.Rechazar(ctx, persona, necesarias, ahora, ahora); err == nil || errors.Is(err, autorizacion.ErrSinCuenta) {
				t.Fatalf("Rechazar = %v, se esperaba un fallo de la base", err)
			}
			if contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, persona) != 1 {
				t.Error("la cuenta debe seguir: la transacción se deshace")
			}
		})
	}
	t.Run("falla el guardado de las autorizaciones", func(t *testing.T) {
		e := nuevoEntorno(t)
		persona := e.sembrar(t, "laura@ejemplo.test")
		if _, err := e.pool.Exec(ctx, `DROP TABLE autorizacion`); err != nil {
			t.Fatal(err)
		}
		repo := pg.NuevoAutorizaciones(e.pool)
		if _, err := repo.Vigentes(ctx, persona); err == nil {
			t.Error("Vigentes debe fallar sin la tabla")
		}
		if err := repo.Otorgar(ctx, persona, necesarias, "1.0 del 2026-10-30", ahora); err == nil {
			t.Error("Otorgar debe fallar sin la tabla")
		}
	})
}
