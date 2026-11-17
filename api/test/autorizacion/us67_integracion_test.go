//go:build integration

// Pruebas de la US-67 (SC-E21-25) contra PostgreSQL y el enrutador real: la cuenta de antes del cambio, que ya autorizó lo
// que había y le falta `transmision_a_encargados`, y las condiciones (a) y (c) de los avisos con la app cerrada. Solo datos
// sintéticos.
package autorizacion_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
)

const (
	rutaDeLosDatos  = "/api/v1/cuenta/datos"
	rutaDelBorrado  = "/api/v1/cuenta/borrado"
	rutaDelDisp1    = "/api/v1/dispositivos/instalacion-1/token"
	rutaDelDisp2    = "/api/v1/dispositivos/instalacion-2/token"
	rutaDeCategoria = "/api/v1/categorias"
	versionVieja    = "1.0 del 2026-10-30"
	versionNueva    = "1.1 del 2026-11-12"
)

// autorizar inserta una autorización vigente de la persona, dada por ella misma, con la versión de texto dada.
func (s *servidorDePrueba) autorizar(persona, finalidad, version string) {
	s.t.Helper()
	if _, err := s.pool.Exec(context.Background(),
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, $2, $3, $4)`,
		persona, finalidad, version, s.reloj.T.Add(-48*time.Hour)); err != nil {
		s.t.Fatal(err)
	}
}

// cuentaDeAntes es una cuenta verificada con sesión que tenía, antes del cambio, las dos necesarias de entonces y datos:
// un movimiento. Le falta `transmision_a_encargados`.
func (s *servidorDePrueba) cuentaDeAntes(correo string, android bool) (*cliente, string) {
	s.t.Helper()
	c, persona := s.nuevaCuentaVerificada(correo, android)
	s.autorizar(persona, "cuenta_y_acceso", versionVieja)
	s.autorizar(persona, "funciones_financieras", versionVieja)
	if _, err := s.pool.Exec(context.Background(),
		`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, 'gasto', 25000, '2026-11-02', 'efectivo', 'mercado', 1)`, persona); err != nil {
		s.t.Fatal(err)
	}
	return c, persona
}

func (s *servidorDePrueba) tokens(persona string) int {
	s.t.Helper()
	return s.contar(`SELECT count(*) FROM token_dispositivo WHERE persona_id = $1::uuid`, persona)
}

// SC-E21-25, sección 5 y criterios 3 y 6: la cuenta de antes del cambio no está rota. Entra al modo limitado: solo cierra
// sesión y usa PN-63 y PN-64 (y la hoja de «No autorizo», que descarga y borra); todo lo demás es 403. GET /autorizaciones
// le muestra solo lo que le falta. Al aceptar, vuelve a todo con sus datos intactos y lo que ya había autorizado no cambia.
func TestLaCuentaDeAntesDelCambioEntraAlModoLimitadoYAlAceptarRecuperaTodo(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.cuentaDeAntes("laura@ejemplo.test", android)

		// Modo limitado: lo demás es 403 autorizacion_pendiente y nada cambia.
		for _, p := range []struct{ metodo, ruta, cuerpo string }{
			{"GET", rutaDeCategoria, ""}, {"GET", rutaSeguridad, ""}, {"GET", "/api/v1/movimientos", ""}, {"GET", "/api/v1/presupuestos", ""},
			{"POST", "/api/v1/movimientos", `{}`}, {"PUT", rutaDelDisp1, `{"token":"t"}`},
		} {
			if r := c.llamar(p.metodo, p.ruta, p.cuerpo); r.Codigo != 403 || r.Cuerpo != `{"error":"autorizacion_pendiente"}` {
				t.Errorf("%s %s en modo limitado: %d %s", p.metodo, p.ruta, r.Codigo, r.Cuerpo)
			}
		}

		// PN-64 muestra solo la tarjeta que le falta.
		lista := c.llamar("GET", rutaAutorizar, "")
		const soloLaTransmision = `{"finalidades":[{"codigo":"transmision_a_encargados","tipo":"necesaria","otorgada":false}],` +
			`"modo":"falta_una_aceptacion","version":{"numero":"1.1","fecha":"2026-11-12"}}`
		if lista.Codigo != 200 || lista.Cuerpo != soloLaTransmision {
			t.Fatalf("GET /autorizaciones: %d %s", lista.Codigo, lista.Cuerpo)
		}

		// Sin aceptarla, o con la versión de antes, no se guarda nada y sigue en el modo.
		for _, caso := range []struct {
			cuerpo, error string
			codigo        int
		}{
			{`{"finalidades":[],"version":"1.1"}`, "faltan_necesarias", 422},
			{`{"finalidades":["avisos"],"version":"1.1"}`, "faltan_necesarias", 422},
			{`{"finalidades":["transmision_a_encargados"],"version":"1.0"}`, "version_desactualizada", 409},
		} {
			if r := c.llamar("POST", rutaAutorizar, caso.cuerpo); r.Codigo != caso.codigo || r.Cuerpo != `{"error":"`+caso.error+`"}` {
				t.Errorf("%s: %d %s", caso.cuerpo, r.Codigo, r.Cuerpo)
			}
		}
		if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid`, persona); n != 2 {
			t.Fatalf("un error no guarda nada: %d filas", n)
		}

		// Acepta solo lo que le falta: llega a todo, con sus datos.
		s.reloj.T = s.reloj.T.Add(time.Hour)
		if r := c.llamar("POST", rutaAutorizar, `{"finalidades":["transmision_a_encargados"],"version":"1.1"}`); r.Codigo != 200 || r.Cuerpo != `{"estado":"autorizada"}` {
			t.Fatalf("aceptar: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 200 {
			t.Errorf("tras aceptar, la misma sesión llega a PN-71: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("GET", "/api/v1/movimientos", ""); r.Codigo != 200 || !strings.Contains(r.Cuerpo, "mercado") {
			t.Errorf("tras aceptar ve sus datos: %d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid AND descripcion = 'mercado'`, persona); n != 1 {
			t.Errorf("el movimiento de antes sigue: %d", n)
		}
		// Lo de antes no se repite (RF-063): quedan 3 filas, las dos viejas con su versión y la nueva con la 1.1.
		filas := map[string]string{}
		rows, err := s.pool.Query(context.Background(), `SELECT finalidad, version_del_texto || '|' || otorgante_id::text || '|' || COALESCE(retirada_en::text, '')
			FROM autorizacion WHERE titular_id = $1::uuid`, persona)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var f, v string
			if err := rows.Scan(&f, &v); err != nil {
				t.Fatal(err)
			}
			filas[f] = v
		}
		quiere := map[string]string{
			"cuenta_y_acceso": versionVieja + "|" + persona + "|", "funciones_financieras": versionVieja + "|" + persona + "|",
			"transmision_a_encargados": versionNueva + "|" + persona + "|",
		}
		if len(filas) != 3 {
			t.Fatalf("autorizaciones: %v", filas)
		}
		for f, v := range quiere {
			if filas[f] != v {
				t.Errorf("%s: %q, se esperaba %q", f, filas[f], v)
			}
		}
		// Y ya no está en el modo: PN-64 vuelve a ser la lista completa, con todo lo necesario otorgado.
		if r := c.llamar("GET", rutaAutorizar, ""); !strings.Contains(r.Cuerpo, `"modo":"completo"`) || !strings.Contains(r.Cuerpo, `{"codigo":"transmision_a_encargados","tipo":"necesaria","otorgada":true}`) {
			t.Errorf("tras aceptar: %s", r.Cuerpo)
		}
	})
}

// SC-E21-25, sección 5, paso 3: en el modo limitado «No autorizo» no borra (403 cuenta_con_historial) y la persona decide en
// la hoja: descarga sus datos y borra la cuenta con su contraseña, las dos rutas `sin_autorizacion`.
func TestLaCuentaDeAntesDescargaYBorraDesdeLaHojaDeNoAutorizo(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.cuentaDeAntes("laura@ejemplo.test", android)
		otra, otraPersona := s.cuentaDeAntes("otra@ejemplo.test", android) // no debe tocarse

		if r := c.llamar("POST", rutaRechazo, ""); r.Codigo != 403 || r.Cuerpo != `{"error":"cuenta_con_historial"}` {
			t.Fatalf("No autorizo: %d %s", r.Codigo, r.Cuerpo)
		}
		if s.cuantoQueda(persona)["persona"] != 1 {
			t.Fatal("«No autorizo» no borró nada")
		}
		if r := c.llamar("GET", rutaDeLosDatos, ""); r.Codigo != 200 || !strings.HasPrefix(r.Cuerpo, "PK") {
			t.Errorf("descargar los datos sin la aceptación: %d %.40q", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("GET", rutaDelBorrado, ""); r.Codigo != 200 {
			t.Errorf("resumen del borrado sin la aceptación: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("POST", rutaDelBorrado, `{"contrasena":"otra clave distinta"}`); r.Codigo != 400 || r.Cuerpo != `{"error":"contrasena_incorrecta"}` {
			t.Errorf("con otra contraseña: %d %s", r.Codigo, r.Cuerpo)
		}
		if s.cuantoQueda(persona)["persona"] != 1 {
			t.Fatal("con la contraseña equivocada no se borra")
		}
		if r := c.llamar("POST", rutaDelBorrado, `{"contrasena":"`+contrasena+`"}`); r.Codigo != 200 || r.Cuerpo != `{"estado":"cuenta_borrada"}` {
			t.Fatalf("borrar con la contraseña: %d %s", r.Codigo, r.Cuerpo)
		}
		for tabla, n := range s.cuantoQueda(persona) {
			if n != 0 {
				t.Errorf("en %s quedan %d filas de la persona", tabla, n)
			}
		}
		if r := c.llamar("GET", rutaAutorizar, ""); r.Codigo != 401 {
			t.Errorf("la sesión ya no sirve: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := otra.llamar("GET", rutaAutorizar, ""); r.Codigo != 200 || s.cuantoQueda(otraPersona)["persona"] != 1 || s.contar(`SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid`, otraPersona) != 1 {
			t.Errorf("la otra cuenta debe seguir con sus datos: %d %s", r.Codigo, r.Cuerpo)
		}
	})
}

// SC-E21-25, criterio 10 (a): sin la autorización `avisos` vigente el API rechaza registrar el token con 403 y no guarda
// nada (`token_dispositivo` sin filas de esa persona); con ella, lo guarda, lo confirma y lo reemplaza como dice E13.
func TestElTokenSoloSeRegistraConLaAutorizacionDeAvisos(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", android)
		otra, otraPersona := s.nuevaCuentaVerificada("otra@ejemplo.test", android)
		const necesarias = `"cuenta_y_acceso","funciones_financieras","transmision_a_encargados"`
		for _, cc := range []*cliente{c, otra} {
			if r := cc.llamar("POST", rutaAutorizar, `{"finalidades":[`+necesarias+`],"version":"1.1"}`); r.Codigo != 200 {
				t.Fatalf("autorizar sin los avisos: %d %s", r.Codigo, r.Cuerpo)
			}
		}

		// Sin avisos: 403, evento y ninguna fila.
		if r := c.llamar("PUT", rutaDelDisp1, `{"token":"fcm-uno"}`); r.Codigo != 403 || r.Cuerpo != `{"error":"avisos_no_autorizados"}` {
			t.Fatalf("sin avisos: %d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM token_dispositivo`); n != 0 {
			t.Fatalf("sin avisos no se guarda ningún token: %d filas", n)
		}
		if !strings.Contains(s.eventos.String(), `"evento_seguridad":"acceso_denegado","cuenta":"`+persona+`","ruta":"PUT /api/v1/dispositivos/{dispositivo_id}/token","codigo":403`) {
			t.Errorf("falta el evento acceso_denegado: %s", s.eventos)
		}
		if strings.Contains(s.eventos.String(), "fcm-uno") {
			t.Error("el token no va al registro")
		}
		// Con `horas_de_vida` pero sin avisos, tampoco: es otra finalidad.
		if r := c.llamar("POST", rutaAutorizar, `{"finalidades":["horas_de_vida"],"version":"1.1"}`); r.Codigo != 200 {
			t.Fatal(r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("PUT", rutaDelDisp1, `{"token":"fcm-uno"}`); r.Codigo != 403 {
			t.Errorf("horas_de_vida no es avisos: %d %s", r.Codigo, r.Cuerpo)
		}

		// Con avisos: 204 y la fila de su dispositivo.
		if r := c.llamar("POST", rutaAutorizar, `{"finalidades":["avisos"],"version":"1.1"}`); r.Codigo != 200 {
			t.Fatal(r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("PUT", rutaDelDisp1, `{"token":"fcm-uno"}`); r.Codigo != 204 || r.Cuerpo != "" {
			t.Fatalf("con avisos: %d %s", r.Codigo, r.Cuerpo)
		}
		token := func(persona, dispositivo string) string {
			var t string
			_ = s.pool.QueryRow(context.Background(), `SELECT token FROM token_dispositivo WHERE persona_id = $1::uuid AND dispositivo_id = $2`, persona, dispositivo).Scan(&t) //nolint:errcheck // sin fila, t queda vacío
			return t
		}
		if token(persona, "instalacion-1") != "fcm-uno" || s.tokens(persona) != 1 {
			t.Fatalf("token guardado: %q, %d filas", token(persona, "instalacion-1"), s.tokens(persona))
		}
		// Confirmarlo de nuevo no duplica; un token nuevo del mismo dispositivo lo reemplaza; otro dispositivo suma una fila.
		for _, cuerpo := range []string{`{"token":"fcm-uno"}`, `{"token":"fcm-uno-renovado"}`} {
			s.reloj.T = s.reloj.T.Add(time.Hour)
			if r := c.llamar("PUT", rutaDelDisp1, cuerpo); r.Codigo != 204 {
				t.Fatalf("%s: %d %s", cuerpo, r.Codigo, r.Cuerpo)
			}
		}
		if token(persona, "instalacion-1") != "fcm-uno-renovado" || s.tokens(persona) != 1 {
			t.Errorf("reemplazo: %q, %d filas", token(persona, "instalacion-1"), s.tokens(persona))
		}
		if r := c.llamar("PUT", rutaDelDisp2, `{"token":"fcm-dos"}`); r.Codigo != 204 || s.tokens(persona) != 2 {
			t.Errorf("segundo dispositivo: %d, %d filas", r.Codigo, s.tokens(persona))
		}
		// El ultimo_uso_en lo pone el reloj del API y nunca precede al creado_en (ck_token_dispositivo_tiempos).
		if n := s.contar(`SELECT count(*) FROM token_dispositivo WHERE persona_id = $1::uuid AND ultimo_uso_en >= creado_en`, persona); n != 2 {
			t.Errorf("tiempos: %d", n)
		}
		// La otra persona, sin avisos, sigue sin poder: lo de una no vale para la otra.
		if r := otra.llamar("PUT", rutaDelDisp1, `{"token":"fcm-otra"}`); r.Codigo != 403 || s.tokens(otraPersona) != 0 {
			t.Errorf("otra persona sin avisos: %d %s", r.Codigo, r.Cuerpo)
		}
		// El mismo token en el dispositivo de otra persona con avisos reemplaza al anterior (E13: un token, un dispositivo).
		if r := otra.llamar("POST", rutaAutorizar, `{"finalidades":["avisos"],"version":"1.1"}`); r.Codigo != 200 {
			t.Fatal(r.Codigo, r.Cuerpo)
		}
		if r := otra.llamar("PUT", rutaDelDisp1, `{"token":"fcm-dos"}`); r.Codigo != 204 {
			t.Fatalf("mismo token en otro dispositivo: %d %s", r.Codigo, r.Cuerpo)
		}
		if token(otraPersona, "instalacion-1") != "fcm-dos" || token(persona, "instalacion-2") != "" || s.tokens(persona) != 1 {
			t.Errorf("el token pasó a la otra persona: %q; el anterior %q; filas de la primera %d", token(otraPersona, "instalacion-1"), token(persona, "instalacion-2"), s.tokens(persona))
		}
	})
}

// SC-E21-25, criterio 12 (c): al retirar `avisos` se borran todos los tokens de esa persona, de todos sus dispositivos,
// en la misma transacción que guarda el retiro; los de otras personas no se tocan; retirar otra accesoria no borra nada.
// Después no se registra ninguno hasta que vuelva a autorizar, y entonces la app registra el token de nuevo.
func TestRetirarLosAvisosBorraTodosLosTokensDeLaPersona(t *testing.T) {
	s := nuevoServidor(t)
	ctx := context.Background()
	c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", false)
	otra, otraPersona := s.nuevaCuentaVerificada("otra@ejemplo.test", false)
	for _, p := range []string{persona, otraPersona} {
		s.autorizar(p, "cuenta_y_acceso", versionNueva)
		s.autorizar(p, "funciones_financieras", versionNueva)
		s.autorizar(p, "transmision_a_encargados", versionNueva)
		s.autorizar(p, "avisos", versionNueva)
		s.autorizar(p, "horas_de_vida", versionNueva)
	}
	for _, par := range []struct {
		c    *cliente
		ruta string
		tok  string
	}{{c, rutaDelDisp1, "tok-a1"}, {c, rutaDelDisp2, "tok-a2"}, {otra, rutaDelDisp1, "tok-b1"}} {
		if r := par.c.llamar("PUT", par.ruta, `{"token":"`+par.tok+`"}`); r.Codigo != 204 {
			t.Fatalf("registrar %s: %d %s", par.tok, r.Codigo, r.Cuerpo)
		}
	}
	if s.tokens(persona) != 2 || s.tokens(otraPersona) != 1 {
		t.Fatalf("la prueba parte con 2 y 1 tokens: %d y %d", s.tokens(persona), s.tokens(otraPersona))
	}
	servicio := autorizacion.NuevoServicio(pg.NuevoAutorizaciones(s.pool), s.reloj)

	// Retirar otra accesoria no toca los tokens.
	if err := servicio.Retirar(ctx, persona, "horas_de_vida"); err != nil || s.tokens(persona) != 2 {
		t.Fatalf("retirar horas_de_vida: %v, %d tokens", err, s.tokens(persona))
	}
	// Una necesaria no se retira por aquí.
	if err := servicio.Retirar(ctx, persona, "transmision_a_encargados"); err == nil || s.tokens(persona) != 2 {
		t.Fatalf("retirar una necesaria: %v", err)
	}

	s.reloj.T = s.reloj.T.Add(time.Hour)
	if err := servicio.Retirar(ctx, persona, "avisos"); err != nil {
		t.Fatal(err)
	}
	if n := s.tokens(persona); n != 0 {
		t.Fatalf("tras retirar los avisos no queda ninguna fila suya: %d", n)
	}
	if s.tokens(otraPersona) != 1 {
		t.Error("los tokens de otra persona no se tocan")
	}
	var retirada time.Time
	var conservar *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT retirada_en, conservar_hasta FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'avisos'`, persona).Scan(&retirada, &conservar); err != nil ||
		!retirada.Equal(s.reloj.T) || conservar != nil {
		t.Errorf("el retiro queda con su fecha y la fila se conserva (la cuenta existe): %v %v (%v)", retirada, conservar, err)
	}
	// Retirar de nuevo no cambia nada ni falla.
	if err := servicio.Retirar(ctx, persona, "avisos"); err != nil {
		t.Errorf("retirar dos veces: %v", err)
	}

	// Sin la autorización no se registra; al volver a autorizar, la app registra el token de nuevo.
	if r := c.llamar("PUT", rutaDelDisp1, `{"token":"tok-a1"}`); r.Codigo != 403 || s.tokens(persona) != 0 {
		t.Errorf("tras retirar: %d %s, %d tokens", r.Codigo, r.Cuerpo, s.tokens(persona))
	}
	if r := c.llamar("POST", rutaAutorizar, `{"finalidades":["avisos"],"version":"1.1"}`); r.Codigo != 200 {
		t.Fatalf("volver a autorizar: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("PUT", rutaDelDisp1, `{"token":"tok-a1"}`); r.Codigo != 204 || s.tokens(persona) != 1 {
		t.Errorf("tras volver a autorizar: %d %s, %d tokens", r.Codigo, r.Cuerpo, s.tokens(persona))
	}
}

// El retiro y el borrado de los tokens son una sola transacción: si el borrado falla, `avisos` sigue vigente y los tokens
// siguen. Nunca queda una persona sin autorización y con tokens (criterio 12).
func TestElRetiroDeLosAvisosYElBorradoDeLosTokensVanJuntos(t *testing.T) {
	s := nuevoServidor(t)
	ctx := context.Background()
	persona := s.cuentaSinAutorizar(1)
	s.autorizar(persona, "avisos", versionNueva)
	if _, err := s.pool.Exec(ctx, `INSERT INTO token_dispositivo (persona_id, dispositivo_id, token) VALUES ($1::uuid, 'd1', 't1'), ($1::uuid, 'd2', 't2')`, persona); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `CREATE FUNCTION falla() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla de prueba'; END $$;
		CREATE TRIGGER t BEFORE DELETE ON token_dispositivo FOR EACH STATEMENT EXECUTE FUNCTION falla()`); err != nil {
		t.Fatal(err)
	}
	if err := autorizacion.NuevoServicio(pg.NuevoAutorizaciones(s.pool), s.reloj).Retirar(ctx, persona, "avisos"); err == nil {
		t.Fatal("el borrado de los tokens falló: Retirar debía fallar")
	}
	if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'avisos' AND retirada_en IS NULL`, persona); n != 1 || s.tokens(persona) != 2 {
		t.Errorf("la transacción se deshace: %d autorizaciones vigentes de avisos, %d tokens", n, s.tokens(persona))
	}
}

// Registrar un token y retirar `avisos` a la vez nunca dejan un token de una persona sin la autorización: o el registro
// llegó primero y el retiro lo borra, o el retiro llegó primero y el registro se niega.
func TestRegistrarElTokenYRetirarLosAvisosAlMismoTiempoQuedanCoherentes(t *testing.T) {
	s := nuevoServidor(t)
	ctx := context.Background()
	avisosRepo := pg.NuevoTokens(s.pool)
	servicio := autorizacion.NuevoServicio(pg.NuevoAutorizaciones(s.pool), s.reloj)
	for i := range 20 {
		persona := s.cuentaSinAutorizar(i)
		s.autorizar(persona, "avisos", versionNueva)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_ = avisosRepo.Registrar(ctx, persona, "d1", "token-"+persona, s.reloj.T) //nolint:errcheck // se negará si el retiro llegó primero
		}()
		go func() {
			defer wg.Done()
			_ = servicio.Retirar(ctx, persona, "avisos") //nolint:errcheck // la ronda mira el resultado en la base
		}()
		wg.Wait()
		vigentes := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'avisos' AND retirada_en IS NULL`, persona)
		if vigentes != 0 || s.tokens(persona) != 0 {
			t.Fatalf("ronda %d: %d autorizaciones vigentes de avisos y %d tokens; se esperaba ninguna de las dos", i, vigentes, s.tokens(persona))
		}
	}
}
