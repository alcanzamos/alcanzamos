//go:build integration

// Bug 308 (D-210), de caja negra contra PostgreSQL y el enrutador real: cuando la versión del texto pasa a una nueva, la
// persona que aceptó la anterior vuelve a aceptar lo necesario (GET /autorizaciones en `falta_una_aceptacion` y la sesión en
// `autorizacion_pendiente`), la aceptación de antes queda como prueba (`reemplazada_en`, sin retirarla) y las finalidades
// opcionales no se vuelven obligatorias. Solo datos sintéticos.
package autorizacion_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
)

const (
	cuerpoDeLaVersion11   = `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados","avisos"],"version":"1.1"}`
	soloLasNecesarias12   = `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.2"}`
	version11             = "1.1 del 2026-11-12"
	listaFaltaTodoLoNuevo = `{"finalidades":[{"codigo":"cuenta_y_acceso","tipo":"necesaria","otorgada":false},` +
		`{"codigo":"funciones_financieras","tipo":"necesaria","otorgada":false},` +
		`{"codigo":"transmision_a_encargados","tipo":"necesaria","otorgada":false}],` +
		`"modo":"falta_una_aceptacion","version":{"numero":"1.2","fecha":"2026-11-17"}}`
)

// conLaVersion fija la versión vigente del texto mientras dura la prueba: «pasar de la 1.1 a la 1.2» es cambiar esta variable,
// como lo hace el código cuando sale un texto nuevo.
func conLaVersion(t *testing.T, v autorizacion.Version) {
	t.Helper()
	anterior := autorizacion.VersionActual
	autorizacion.VersionActual = v
	t.Cleanup(func() { autorizacion.VersionActual = anterior })
}

var (
	laVersion11 = autorizacion.Version{Numero: "1.1", Fecha: "2026-11-12"}
	laVersion12 = autorizacion.Version{Numero: "1.2", Fecha: "2026-11-17"}
)

// filasDe lista las autorizaciones de la persona: finalidad, versión, y si están reemplazadas y retiradas, por finalidad y orden de otorgamiento.
func (s *servidorDePrueba) filasDe(persona string) []string {
	s.t.Helper()
	filas, err := s.pool.Query(context.Background(),
		`SELECT finalidad || '|' || version_del_texto || '|reemplazada=' || (reemplazada_en IS NOT NULL) || '|retirada=' || (retirada_en IS NOT NULL)
		   FROM autorizacion WHERE titular_id = $1::uuid ORDER BY finalidad, otorgada_en`, persona)
	if err != nil {
		s.t.Fatal(err)
	}
	defer filas.Close()
	var lista []string
	for filas.Next() {
		var f string
		if err := filas.Scan(&f); err != nil {
			s.t.Fatal(err)
		}
		lista = append(lista, f)
	}
	return lista
}

// cuentaDeLa11 es una cuenta que aceptó la 1.1 por HTTP (con la versión vigente en 1.1) y ya está en la 1.2: queda lista para la prueba.
func (s *servidorDePrueba) cuentaDeLa11(android bool) (*cliente, string) {
	s.t.Helper()
	conLaVersion(s.t, laVersion11)
	c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", android)
	if r := c.llamar("POST", rutaAutorizar, cuerpoDeLaVersion11); r.Codigo != 200 || r.Cuerpo != `{"estado":"autorizada"}` {
		s.t.Fatalf("aceptar la 1.1: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("GET", rutaAutorizar, ""); r.Codigo != 200 || !strings.Contains(r.Cuerpo, `"modo":"completo"`) || !strings.Contains(r.Cuerpo, `"numero":"1.1"`) {
		s.t.Fatalf("con la 1.1 vigente está completa: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 200 {
		s.t.Fatalf("con la 1.1 vigente entra: %d %s", r.Codigo, r.Cuerpo)
	}
	autorizacion.VersionActual = laVersion12 // sale la 1.2; el Cleanup de conLaVersion devuelve la de la compilación
	s.reloj.T = time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC)
	return c, persona
}

// Criterio 1: la versión pasa de la 1.1 a la 1.2 y la cuenta que aceptó la 1.1 recibe `falta_una_aceptacion` con las tres
// necesarias, sin las opcionales; la sesión cae a `sin_autorizacion` y nada se guarda ni se borra.
func TestCuandoLaVersionPasaALa12LaCuentaDeLa11QuedaEnFaltaUnaAceptacion(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.cuentaDeLa11(android)
		antes := s.filasDe(persona)
		if len(antes) != 4 {
			t.Fatalf("la 1.1 dejó 4 filas: %v", antes)
		}

		if r := c.llamar("GET", rutaAutorizar, ""); r.Codigo != 200 || r.Cuerpo != listaFaltaTodoLoNuevo {
			t.Fatalf("GET /autorizaciones con la 1.2: %d %s", r.Codigo, r.Cuerpo)
		}
		// La misma regla en la entrada: lo que exige autorización completa se cierra.
		if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 403 || r.Cuerpo != `{"error":"autorizacion_pendiente"}` {
			t.Errorf("PN-71 con la 1.2 sin aceptar: %d %s", r.Codigo, r.Cuerpo)
		}
		// Con la versión de antes se rechaza, sin las tres no se acepta, y «No autorizo» no borra a quien ya autorizó algo.
		if r := c.llamar("POST", rutaAutorizar, cuerpoDeLaVersion11); r.Codigo != 409 || r.Cuerpo != `{"error":"version_desactualizada"}` {
			t.Errorf("aceptar con la 1.1: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("POST", rutaAutorizar, `{"finalidades":["cuenta_y_acceso","funciones_financieras"],"version":"1.2"}`); r.Codigo != 422 || r.Cuerpo != `{"error":"faltan_necesarias"}` {
			t.Errorf("aceptar solo dos: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("POST", rutaRechazo, ""); r.Codigo != 403 || r.Cuerpo != `{"error":"cuenta_con_historial"}` {
			t.Errorf("No autorizo con la 1.2 sin aceptar: %d %s", r.Codigo, r.Cuerpo)
		}
		if despues := s.filasDe(persona); strings.Join(despues, ",") != strings.Join(antes, ",") {
			t.Errorf("nada debe cambiar sin aceptar:\n%v\n%v", antes, despues)
		}
		if s.contar(`SELECT count(*) FROM persona WHERE id = $1::uuid`, persona) != 1 {
			t.Error("la cuenta no se borra")
		}
	})
}

// Criterio 2: aceptar la 1.2 deja dos filas por cada necesaria, la de la 1.1 (reemplazada, no retirada, con lo demás igual)
// y la de la 1.2 (vigente); el modo vuelve a `completo` y la sesión a todo. Repetir no suma filas. Después, retirar una
// opcional sigue funcionando y no toca las pruebas de las necesarias.
func TestAceptarLa12DejaLaDeLa11ReemplazadaYLaNuevaVigente(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		ctx := context.Background()
		c, persona := s.cuentaDeLa11(android)
		var otorgadaEnLa11 time.Time
		if err := s.pool.QueryRow(ctx, `SELECT otorgada_en FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'cuenta_y_acceso'`, persona).Scan(&otorgadaEnLa11); err != nil {
			t.Fatal(err)
		}

		if r := c.llamar("POST", rutaAutorizar, soloLasNecesarias12); r.Codigo != 200 || r.Cuerpo != `{"estado":"autorizada"}` {
			t.Fatalf("aceptar la 1.2: %d %s", r.Codigo, r.Cuerpo)
		}
		quiere := []string{
			"avisos|" + version11 + "|reemplazada=false|retirada=false",
			"cuenta_y_acceso|" + version11 + "|reemplazada=true|retirada=false",
			"cuenta_y_acceso|1.2 del 2026-11-17|reemplazada=false|retirada=false",
			"funciones_financieras|" + version11 + "|reemplazada=true|retirada=false",
			"funciones_financieras|1.2 del 2026-11-17|reemplazada=false|retirada=false",
			"transmision_a_encargados|" + version11 + "|reemplazada=true|retirada=false",
			"transmision_a_encargados|1.2 del 2026-11-17|reemplazada=false|retirada=false",
		}
		if got := s.filasDe(persona); strings.Join(got, "\n") != strings.Join(quiere, "\n") {
			t.Fatalf("filas tras aceptar la 1.2:\n%s\nse esperaba:\n%s", strings.Join(got, "\n"), strings.Join(quiere, "\n"))
		}
		// La fila de la 1.1 conserva su fecha de otorgamiento y se reemplaza en el instante de la aceptación nueva.
		var otorgada, reemplazada time.Time
		if err := s.pool.QueryRow(ctx,
			`SELECT otorgada_en, reemplazada_en FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'cuenta_y_acceso' AND reemplazada_en IS NOT NULL`, persona).Scan(&otorgada, &reemplazada); err != nil ||
			!otorgada.Equal(otorgadaEnLa11) || !reemplazada.Equal(s.reloj.T) {
			t.Errorf("la 1.1 conserva su fecha y se reemplaza ahora: %v %v (%v)", otorgada, reemplazada, err)
		}
		if r := c.llamar("GET", rutaAutorizar, ""); r.Codigo != 200 || !strings.Contains(r.Cuerpo, `"modo":"completo"`) ||
			!strings.Contains(r.Cuerpo, `{"codigo":"cuenta_y_acceso","tipo":"necesaria","otorgada":true}`) || !strings.Contains(r.Cuerpo, `{"codigo":"avisos","tipo":"accesoria","otorgada":true}`) {
			t.Errorf("tras aceptar la 1.2: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 200 {
			t.Errorf("PN-71 tras aceptar la 1.2: %d %s", r.Codigo, r.Cuerpo)
		}

		// Repetir la aceptación no cambia nada.
		if r := c.llamar("POST", rutaAutorizar, soloLasNecesarias12); r.Codigo != 200 {
			t.Fatalf("repetir: %d %s", r.Codigo, r.Cuerpo)
		}
		if got := s.filasDe(persona); strings.Join(got, "\n") != strings.Join(quiere, "\n") {
			t.Errorf("repetir no debe sumar filas:\n%s", strings.Join(got, "\n"))
		}

		// Retirar una opcional después de reaceptar funciona y no toca las pruebas de las necesarias.
		servicio := autorizacion.NuevoServicio(pg.NuevoAutorizaciones(s.pool), s.reloj)
		s.reloj.T = s.reloj.T.Add(time.Hour)
		if err := servicio.Retirar(ctx, persona, "avisos"); err != nil {
			t.Fatal(err)
		}
		quiere[0] = "avisos|" + version11 + "|reemplazada=false|retirada=true"
		if got := s.filasDe(persona); strings.Join(got, "\n") != strings.Join(quiere, "\n") {
			t.Errorf("tras retirar los avisos:\n%s", strings.Join(got, "\n"))
		}
		if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 200 {
			t.Errorf("retirar una opcional no cierra la sesión: %d %s", r.Codigo, r.Cuerpo)
		}
		// Aceptar de nuevo los avisos, ahora con la 1.2, deja la fila retirada y la nueva.
		if r := c.llamar("POST", rutaAutorizar, `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados","avisos"],"version":"1.2"}`); r.Codigo != 200 {
			t.Fatalf("aceptar los avisos otra vez: %d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'avisos'`, persona); n != 2 {
			t.Errorf("los avisos tienen la retirada y la nueva: %d", n)
		}
	})
}

// Solo se vuelve a pedir lo que cambió: una necesaria que ya tiene la 1.2 no se reemplaza, y la de la 1.1 sí.
func TestSoloSeReemplazaLaNecesariaConVersionAnterior(t *testing.T) {
	s := nuevoServidor(t)
	c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", false)
	s.autorizar(persona, "cuenta_y_acceso", versionNueva)
	s.autorizar(persona, "funciones_financieras", version11)
	s.autorizar(persona, "transmision_a_encargados", versionNueva)
	const soloLasFunciones = `{"finalidades":[{"codigo":"funciones_financieras","tipo":"necesaria","otorgada":false}],"modo":"falta_una_aceptacion","version":{"numero":"1.2","fecha":"2026-11-17"}}`
	if r := c.llamar("GET", rutaAutorizar, ""); r.Codigo != 200 || r.Cuerpo != soloLasFunciones {
		t.Fatalf("GET: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("POST", rutaAutorizar, `{"finalidades":["funciones_financieras"],"version":"1.2"}`); r.Codigo != 200 {
		t.Fatalf("aceptar lo que cambió: %d %s", r.Codigo, r.Cuerpo)
	}
	quiere := []string{
		"cuenta_y_acceso|" + versionNueva + "|reemplazada=false|retirada=false",
		"funciones_financieras|" + version11 + "|reemplazada=true|retirada=false",
		"funciones_financieras|" + versionNueva + "|reemplazada=false|retirada=false",
		"transmision_a_encargados|" + versionNueva + "|reemplazada=false|retirada=false",
	}
	if got := s.filasDe(persona); strings.Join(got, "\n") != strings.Join(quiere, "\n") {
		t.Errorf("filas:\n%s\nse esperaba:\n%s", strings.Join(got, "\n"), strings.Join(quiere, "\n"))
	}
	if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 200 {
		t.Errorf("PN-71: %d %s", r.Codigo, r.Cuerpo)
	}
}

// Criterio 3: las opcionales no se vuelven obligatorias. Con la 1.1 solo en las necesarias, `falta_una_aceptacion` pide
// solo las necesarias, bastan para volver a `completo` y no se crea ninguna fila de las opcionales; una opcional aceptada con
// la 1.1 sigue vigente cuando las necesarias están al día, sin cerrar la sesión ni pedirse de nuevo.
func TestLasOpcionalesNoSeVuelvenObligatoriasConLaVersionNueva(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		t.Run("sin opcionales", func(t *testing.T) {
			s := nuevoServidor(t)
			c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", android)
			for _, f := range []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"} {
				s.autorizar(persona, f, version11)
			}
			if r := c.llamar("GET", rutaAutorizar, ""); r.Codigo != 200 || r.Cuerpo != listaFaltaTodoLoNuevo || strings.Contains(r.Cuerpo, "avisos") || strings.Contains(r.Cuerpo, "horas_de_vida") {
				t.Fatalf("GET: %d %s", r.Codigo, r.Cuerpo)
			}
			if r := c.llamar("POST", rutaAutorizar, soloLasNecesarias12); r.Codigo != 200 {
				t.Fatalf("aceptar solo las necesarias: %d %s", r.Codigo, r.Cuerpo)
			}
			if r := c.llamar("GET", rutaAutorizar, ""); r.Codigo != 200 || !strings.Contains(r.Cuerpo, `"modo":"completo"`) || strings.Contains(r.Cuerpo, `"otorgada":true,"codigo":"avisos"`) ||
				!strings.Contains(r.Cuerpo, `{"codigo":"avisos","tipo":"accesoria","otorgada":false}`) {
				t.Errorf("tras aceptar las necesarias: %d %s", r.Codigo, r.Cuerpo)
			}
			if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND finalidad IN ('avisos', 'horas_de_vida')`, persona); n != 0 {
				t.Errorf("no se crean filas de las opcionales: %d", n)
			}
		})
		t.Run("con una opcional de la 1.1", func(t *testing.T) {
			s := nuevoServidor(t)
			c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", android)
			for _, f := range []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"} {
				s.autorizar(persona, f, versionNueva)
			}
			s.autorizar(persona, "avisos", version11)
			antes := s.filasDe(persona)
			if r := c.llamar("GET", rutaAutorizar, ""); r.Codigo != 200 || !strings.Contains(r.Cuerpo, `"modo":"completo"`) || !strings.Contains(r.Cuerpo, `{"codigo":"avisos","tipo":"accesoria","otorgada":true}`) {
				t.Fatalf("GET: %d %s", r.Codigo, r.Cuerpo)
			}
			if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 200 {
				t.Errorf("PN-71: %d %s", r.Codigo, r.Cuerpo)
			}
			if r := c.llamar("PUT", rutaDelDisp1, `{"token":"tok-a1"}`); r.Codigo != 204 {
				t.Errorf("los avisos de la 1.1 siguen vigentes: %d %s", r.Codigo, r.Cuerpo)
			}
			if r := c.llamar("POST", rutaAutorizar, soloLasNecesarias12); r.Codigo != 200 {
				t.Fatalf("repetir las necesarias: %d %s", r.Codigo, r.Cuerpo)
			}
			if despues := s.filasDe(persona); strings.Join(despues, ",") != strings.Join(antes, ",") {
				t.Errorf("nada cambia:\n%v\n%v", antes, despues)
			}
		})
	})
}
