//go:build integration

// Pruebas de punta a punta de la US-50 contra PostgreSQL (infra/local) y el enrutador real, de caja negra: se entra por
// HTTP, como lo hacen la web (cookie) y Android (token en el cuerpo y Bearer). Solo datos sintéticos.
package autorizacion_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

const (
	contrasena      = "lluvia café tren azul"
	cuerpoAutorizar = `{"finalidades":["cuenta_y_acceso","funciones_financieras","avisos"],"version":"1.0"}`
	primerIngreso   = "2026-11-10T12:00:00Z"
	rutaAutorizar   = "/api/v1/autorizaciones"
	rutaRechazo     = "/api/v1/autorizaciones/rechazo"
	rutaSeguridad   = "/api/v1/cuenta/seguridad"
)

// hasheadorRapido «hashea» sin Argon2id: estas pruebas no miden contraseñas.
type hasheadorRapido struct{}

const prefijoDeHash = "$argon2id$v=19$m=8,t=1,p=1$prueba$"

func (hasheadorRapido) Hashear(_ context.Context, c string) (string, error) {
	return prefijoDeHash + c, nil
}
func (hasheadorRapido) Verificar(_ context.Context, c, hash string) (bool, error) {
	return hash == prefijoDeHash+c, nil
}
func (hasheadorRapido) NecesitaMejora(string) (bool, error) { return false, nil }

// servidorDePrueba es la API completa (cuenta, entrar y autorización) sobre una base propia y migrada.
type servidorDePrueba struct {
	t       *testing.T
	pool    *pgxpool.Pool
	h       http.Handler
	reloj   *relojtest.Fijo
	correo  *correotest.Falso
	cuentas *cuenta.Servicio
	eventos *bytes.Buffer
	pedidos int
}

func nuevoServidor(t *testing.T) *servidorDePrueba {
	t.Helper()
	pool := pgtest.Nueva(t)
	eventos := &bytes.Buffer{}
	log := slog.New(slog.NewJSONHandler(eventos, nil))
	reloj := &relojtest.Fijo{T: time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)}
	senuelos, err := sesion.NuevosSenuelos(bytes.Repeat([]byte{5}, 32), reloj)
	if err != nil {
		t.Fatal(err)
	}
	limitador := seguridad.NuevoLimitadorDeIntentos(reloj)
	politica := seguridad.NuevaPoliticaDeContrasena()
	correo := &correotest.Falso{}
	cuentas := cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: pg.NuevoCuentas(pool), Correo: correo, Politica: politica, Hasher: hasheadorRapido{}, Reloj: reloj,
		Limitador: limitador, Senuelos: senuelos, Log: log,
	})
	entrar, err := autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: pg.NuevoAutenticacion(pool), Hasher: hasheadorRapido{}, Limitador: limitador, Reloj: reloj, Correo: correo,
		Politica: politica, Log: log,
	})
	if err != nil {
		t.Fatal(err)
	}
	resolutor := sesion.NuevoResolutor(pg.NuevoSesiones(pool), senuelos, reloj)
	registro := seguridad.NuevoRegistro(log)
	enr := servidor.NuevoEnrutador(resolutor, registro, log)
	cuenta.NuevoHandler(cuentas, resolutor, log).Registrar(enr)
	autenticacion.NuevoHandler(entrar, registro, log).Registrar(enr)
	autorizacion.NuevoHandler(autorizacion.NuevoServicio(pg.NuevoAutorizaciones(pool), reloj), registro, log).Registrar(enr)
	api, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return &servidorDePrueba{t: t, pool: pool, h: servidor.ManejadorConAPI(api), reloj: reloj, correo: correo, cuentas: cuentas, eventos: eventos}
}

// cliente es quien llama: la web con la cookie, o Android con el token en el cuerpo y Bearer. Android no manda `Origin`
// ni `Sec-Fetch-Site` (D-143 (3)).
type cliente struct {
	s       *servidorDePrueba
	android bool
	token   string
}

type respuesta struct {
	Codigo  int
	Cuerpo  string
	Cookies []*http.Cookie
}

// llamar manda una petición con un origen distinto cada vez, para que los límites de intentos no estorben.
func (c *cliente) llamar(metodo, ruta, cuerpo string) respuesta {
	c.s.t.Helper()
	c.s.pedidos++
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	r.RemoteAddr = fmt.Sprintf("10.0.%d.%d:1", c.s.pedidos/250, c.s.pedidos%250)
	if c.android {
		r.Header.Set(sesion.EncabezadoDeCliente, sesion.ClienteAndroid)
		if c.token != "" {
			r.Header.Set("Authorization", "Bearer "+c.token)
		}
	} else if c.token != "" {
		r.AddCookie(sesion.Cookie(c.token))
	}
	rr := httptest.NewRecorder()
	c.s.h.ServeHTTP(rr, r)
	return respuesta{rr.Code, strings.TrimSpace(rr.Body.String()), rr.Result().Cookies()}
}

// tokenDe saca el token de la respuesta de crear la cuenta o de iniciar sesión: de la cookie (web) o del cuerpo (Android).
func (c *cliente) tokenDe(r respuesta) string {
	c.s.t.Helper()
	if c.android {
		_, resto, ok := strings.Cut(r.Cuerpo, `"token":"`)
		if !ok || len(r.Cookies) != 0 {
			c.s.t.Fatalf("Android recibe el token en el cuerpo y sin cookie: %s %v", r.Cuerpo, r.Cookies)
		}
		token, _, _ := strings.Cut(resto, `"`)
		return token
	}
	if len(r.Cookies) != 1 || strings.Contains(r.Cuerpo, "token") {
		c.s.t.Fatalf("la web recibe el token solo en la cookie: %s %v", r.Cuerpo, r.Cookies)
	}
	return r.Cookies[0].Value
}

// nuevaCuentaVerificada crea la cuenta, confirma el correo con el enlace y entra: deja una sesión `sin_autorizacion`.
func (s *servidorDePrueba) nuevaCuentaVerificada(correo string, android bool) (*cliente, string) {
	s.t.Helper()
	c := &cliente{s: s, android: android}
	r := c.llamar("POST", "/api/v1/cuentas", `{"correo":"`+correo+`","contrasena":"`+contrasena+`","nombre":"Laura","mayor_de_edad":true}`)
	if r.Codigo != 202 {
		s.t.Fatalf("crear la cuenta: %d %s", r.Codigo, r.Cuerpo)
	}
	s.cuentas.Esperar()
	enlaces := s.correo.Enviados()
	enlace := enlaces[len(enlaces)-1]
	if enlace.Destino != correo {
		s.t.Fatalf("el correo de verificación fue a %s", enlace.Destino)
	}
	if v := (&cliente{s: s}).llamar("POST", "/api/v1/cuentas/verificacion", `{"token":"`+enlace.Token+`"}`); v.Codigo != 200 {
		s.t.Fatalf("verificar: %d %s", v.Codigo, v.Cuerpo)
	}
	r = c.llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+contrasena+`"}`)
	if r.Codigo != 200 || !strings.Contains(r.Cuerpo, `"estado":"activa"`) {
		s.t.Fatalf("entrar: %d %s", r.Codigo, r.Cuerpo)
	}
	c.token = c.tokenDe(r)
	return c, s.persona(correo)
}

func (s *servidorDePrueba) persona(correo string) string {
	s.t.Helper()
	var id string
	if err := s.pool.QueryRow(context.Background(), `SELECT persona_id::text FROM perfil_adulto WHERE correo = $1`, correo).Scan(&id); err != nil {
		s.t.Fatal(err)
	}
	return id
}

func (s *servidorDePrueba) contar(sql string, args ...any) int {
	s.t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		s.t.Fatal(err)
	}
	return n
}

func formas(t *testing.T, f func(t *testing.T, android bool)) {
	t.Run("web con cookie", func(t *testing.T) { f(t, false) })
	t.Run("Android con token en el cuerpo", func(t *testing.T) { f(t, true) })
}

// S2 (dueño, 2026-10-24): una persona nueva que entra, autoriza en PN-64 y llega a PN-71 en la misma sesión ve «Este es
// tu primer ingreso.»: `ingreso_anterior` es null. Autorizar no reautentica, no rota el token y no toca la credencial.
func TestS2LaPersonaNuevaAutorizaYVeSuPrimerIngresoEnLaMismaSesion(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", android)

		// Sin autorizar, PN-71 está cerrado (S1).
		if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 403 || r.Cuerpo != `{"error":"autorizacion_pendiente"}` {
			t.Fatalf("PN-71 sin autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
		sesionesAntes := s.contar(`SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, persona)
		var creadaAntes time.Time
		if err := s.pool.QueryRow(context.Background(), `SELECT creada_en FROM sesion WHERE persona_id = $1::uuid ORDER BY creada_en DESC LIMIT 1`, persona).Scan(&creadaAntes); err != nil {
			t.Fatal(err)
		}

		s.reloj.T = s.reloj.T.Add(time.Minute)
		if r := c.llamar("POST", rutaAutorizar, cuerpoAutorizar); r.Codigo != 200 || r.Cuerpo != `{"estado":"autorizada"}` || len(r.Cookies) != 0 {
			t.Fatalf("autorizar: %d %s %v", r.Codigo, r.Cuerpo, r.Cookies)
		}

		// La misma sesión (mismo token, sin cookie nueva ni sesión nueva) llega a PN-71 con «primer ingreso».
		if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 200 || r.Cuerpo != `{"ingreso_anterior":null}` {
			t.Fatalf("PN-71 tras autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, persona); n != sesionesAntes {
			t.Errorf("autorizar no abre sesiones: había %d y hay %d", sesionesAntes, n)
		}
		var ultimo, anterior *time.Time
		var creada time.Time
		if err := s.pool.QueryRow(context.Background(), `SELECT ultimo_ingreso, ingreso_anterior FROM credencial WHERE persona_id = $1::uuid`, persona).Scan(&ultimo, &anterior); err != nil {
			t.Fatal(err)
		}
		if ultimo == nil || ultimo.UTC().Format(time.RFC3339) != primerIngreso || anterior != nil {
			t.Errorf("la credencial no debe cambiar al autorizar: ultimo_ingreso %v, ingreso_anterior %v", ultimo, anterior)
		}
		if err := s.pool.QueryRow(context.Background(), `SELECT creada_en FROM sesion WHERE persona_id = $1::uuid ORDER BY creada_en DESC LIMIT 1`, persona).Scan(&creada); err != nil || !creada.Equal(creadaAntes) {
			t.Errorf("la sesión no se renueva: %v → %v (%v)", creadaAntes, creada, err)
		}

		// Un segundo inicio de sesión (comportamiento de siempre): PN-71 muestra el primero.
		s.reloj.T = s.reloj.T.Add(2 * time.Hour)
		r := c.llamar("POST", "/api/v1/sesiones", `{"identificador":"laura@ejemplo.test","contrasena":"`+contrasena+`"}`)
		segunda := &cliente{s: s, android: android, token: c.tokenDe(r)}
		if r := segunda.llamar("GET", rutaSeguridad, ""); r.Codigo != 200 || r.Cuerpo != `{"ingreso_anterior":"`+primerIngreso+`"}` {
			t.Fatalf("PN-71 tras el segundo ingreso: %d %s", r.Codigo, r.Cuerpo)
		}
	})
}

// S1 («nada se guarda antes de autorizar»): la sesión sin autorizar recibe 403 autorizacion_pendiente en las rutas
// protegidas y, al autorizar en la misma sesión, pasa.
func TestSinAutorizarLasRutasProtegidasDan403YAutorizandoPasan(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuentaVerificada("laura@ejemplo.test", android)
		protegidas := []struct{ metodo, ruta, cuerpo string }{
			{"GET", rutaSeguridad, ""},
			{"POST", "/api/v1/cuenta/contrasena", `{"contrasena_actual":"incorrecta","contrasena_nueva":"` + contrasena + ` nueva"}`},
		}
		for _, p := range protegidas {
			if r := c.llamar(p.metodo, p.ruta, p.cuerpo); r.Codigo != 403 || r.Cuerpo != `{"error":"autorizacion_pendiente"}` {
				t.Errorf("%s %s sin autorizar: %d %s", p.metodo, p.ruta, r.Codigo, r.Cuerpo)
			}
		}
		if r := c.llamar("POST", rutaAutorizar, cuerpoAutorizar); r.Codigo != 200 {
			t.Fatalf("autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 200 {
			t.Errorf("PN-71 tras autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
		// Pasa el guard: la contraseña de ahora es incorrecta y llega a decirlo (400), no a 403.
		if r := c.llamar("POST", "/api/v1/cuenta/contrasena", protegidas[1].cuerpo); r.Codigo != 400 || r.Cuerpo != `{"error":"contrasena_actual_incorrecta"}` {
			t.Errorf("PN-73 tras autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
	})
}

func TestListarYOtorgarGuardanLoQueDiceE13(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", android)
		if r := c.llamar("GET", rutaAutorizar, ""); r.Codigo != 200 || strings.Contains(r.Cuerpo, `"otorgada":true`) || !strings.Contains(r.Cuerpo, `"version":{"numero":"1.0","fecha":"2026-10-30"}`) {
			t.Fatalf("lista al llegar: %d %s", r.Codigo, r.Cuerpo)
		}
		s.reloj.T = s.reloj.T.Add(time.Minute)
		if r := c.llamar("POST", rutaAutorizar, cuerpoAutorizar); r.Codigo != 200 {
			t.Fatalf("autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
		filas, err := s.pool.Query(context.Background(),
			`SELECT finalidad, titular_id::text, otorgante_id::text, version_del_texto, otorgada_en, retirada_en, conservar_hasta
			 FROM autorizacion ORDER BY finalidad`)
		if err != nil {
			t.Fatal(err)
		}
		defer filas.Close()
		var codigos []string
		for filas.Next() {
			var f, titular, otorgante, version string
			var otorgada time.Time
			var retirada, conservar any
			if err := filas.Scan(&f, &titular, &otorgante, &version, &otorgada, &retirada, &conservar); err != nil {
				t.Fatal(err)
			}
			if titular != persona || otorgante != persona || version != "1.0 del 2026-10-30" || !otorgada.Equal(s.reloj.T) || retirada != nil || conservar != nil {
				t.Errorf("%s: titular %s, otorgante %s, versión %q, otorgada %v, retirada %v, conservar %v", f, titular, otorgante, version, otorgada, retirada, conservar)
			}
			codigos = append(codigos, f)
		}
		if strings.Join(codigos, ",") != "avisos,cuenta_y_acceso,funciones_financieras" {
			t.Errorf("filas guardadas: %v (horas_de_vida no se autorizó)", codigos)
		}
		r := c.llamar("GET", rutaAutorizar, "")
		for _, quiere := range []string{`{"codigo":"avisos","tipo":"accesoria","otorgada":true}`, `{"codigo":"horas_de_vida","tipo":"accesoria","otorgada":false}`,
			`{"codigo":"cuenta_y_acceso","tipo":"necesaria","otorgada":true}`} {
			if !strings.Contains(r.Cuerpo, quiere) {
				t.Errorf("la lista no dice %s: %s", quiere, r.Cuerpo)
			}
		}
	})
}

// Repetir la autorización no duplica nada ni mueve la fecha; si se suma una accesoria, solo entra esa.
func TestOtorgarEsIdempotente(t *testing.T) {
	s := nuevoServidor(t)
	c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", false)
	for range 2 {
		if r := c.llamar("POST", rutaAutorizar, cuerpoAutorizar); r.Codigo != 200 {
			t.Fatalf("autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
	}
	if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid`, persona); n != 3 {
		t.Fatalf("después de repetir hay %d filas, se esperaban 3", n)
	}
	primera := s.contar(`SELECT count(*) FROM autorizacion WHERE otorgada_en = $1`, s.reloj.T)
	s.reloj.T = s.reloj.T.Add(time.Hour)
	if r := c.llamar("POST", rutaAutorizar, `{"finalidades":["horas_de_vida","cuenta_y_acceso","funciones_financieras","avisos"],"version":"1.0"}`); r.Codigo != 200 {
		t.Fatalf("sumar una accesoria: %d %s", r.Codigo, r.Cuerpo)
	}
	if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NULL`, persona); n != 4 {
		t.Errorf("hay %d vigentes, se esperaban 4", n)
	}
	if n := s.contar(`SELECT count(*) FROM autorizacion WHERE otorgada_en = $1`, s.reloj.T.Add(-time.Hour)); n != primera || primera != 3 {
		t.Errorf("las tres primeras conservan su fecha: %d de %d", n, primera)
	}
}

func TestOtorgarConErroresNoGuardaNada(t *testing.T) {
	s := nuevoServidor(t)
	c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", false)
	for _, caso := range []struct {
		cuerpo, error string
		codigo        int
	}{
		{`{"finalidades":["cuenta_y_acceso"],"version":"1.0"}`, "faltan_necesarias", 422},
		{`{"finalidades":["cuenta_y_acceso","funciones_financieras","cuenta_del_menor"],"version":"1.0"}`, "finalidad_invalida", 422},
		{`{"finalidades":["cuenta_y_acceso","funciones_financieras","transferencia"],"version":"1.0"}`, "finalidad_invalida", 422},
		{`{"finalidades":["cuenta_y_acceso","funciones_financieras"],"version":"2.0"}`, "version_desactualizada", 409},
	} {
		if r := c.llamar("POST", rutaAutorizar, caso.cuerpo); r.Codigo != caso.codigo || r.Cuerpo != `{"error":"`+caso.error+`"}` {
			t.Errorf("%s: %d %s, se esperaba %d %s", caso.cuerpo, r.Codigo, r.Cuerpo, caso.codigo, caso.error)
		}
	}
	if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid`, persona); n != 0 {
		t.Errorf("un error no guarda nada: %d filas", n)
	}
}

// referencias son todas las columnas que apuntan a persona, perfil_adulto o perfil_menor (E13 §7): la consulta que
// pide E13 para verificar el borrado, así una tabla nueva con llave a la persona entra sola a la prueba.
func (s *servidorDePrueba) referencias() [][2]string {
	s.t.Helper()
	filas, err := s.pool.Query(context.Background(),
		`SELECT c.conrelid::regclass::text, a.attname
		 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
		 WHERE c.contype = 'f' AND c.confrelid IN ('persona'::regclass, 'perfil_adulto'::regclass, 'perfil_menor'::regclass)
		   AND c.conrelid <> 'perfil_adulto'::regclass AND a.atttypid = 'uuid'::regtype`)
	if err != nil {
		s.t.Fatal(err)
	}
	defer filas.Close()
	var refs [][2]string
	for filas.Next() {
		var tabla, columna string
		if err := filas.Scan(&tabla, &columna); err != nil {
			s.t.Fatal(err)
		}
		refs = append(refs, [2]string{tabla, columna})
	}
	return refs
}

// cuantoQueda cuenta lo que la persona tiene guardado en cada tabla que apunta a ella, más persona y perfil_adulto.
func (s *servidorDePrueba) cuantoQueda(persona string) map[string]int {
	s.t.Helper()
	queda := map[string]int{
		"persona":       s.contar(`SELECT count(*) FROM persona WHERE id = $1::uuid`, persona),
		"perfil_adulto": s.contar(`SELECT count(*) FROM perfil_adulto WHERE persona_id = $1::uuid`, persona),
	}
	for _, r := range s.referencias() {
		queda[r[0]] += s.contar(`SELECT count(*) FROM `+r[0]+` WHERE `+r[1]+` = $1::uuid`, persona) // nombres de pg_catalog, no de la entrada
	}
	return queda
}

// siembraLoQueTieneUnaCuentaNueva deja filas de la persona en tablas más allá de las que crea la cuenta, para que la
// prueba de borrado no pase por haber borrado solo lo de siempre.
func (s *servidorDePrueba) siembraLoQueTieneUnaCuentaNueva(persona string) {
	s.t.Helper()
	for _, sql := range []string{
		`INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, creado_en, vence_en) VALUES (decode(repeat('ab', 32), 'hex'), $1::uuid, 'recuperacion', now(), now() + interval '1 hour')`,
		`INSERT INTO token_dispositivo (persona_id, dispositivo_id, token) VALUES ($1::uuid, 'telefono', 'token-de-prueba')`,
		`INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, 1)`,
		`INSERT INTO aviso (persona_id, tipo, texto, fecha) VALUES ($1::uuid, 'resumen', 'texto', '2026-11-10')`,
	} {
		if _, err := s.pool.Exec(context.Background(), sql, persona); err != nil {
			s.t.Fatalf("sembrar %q: %v", sql, err)
		}
	}
}

func TestRechazarBorraTodoLoDeLaCuentaYCierraLaSesion(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", android)
		otra, otraPersona := s.nuevaCuentaVerificada("otra@ejemplo.test", android) // no debe tocarse
		// Una segunda sesión de la misma persona (otro dispositivo) y una autorización parcial.
		(&cliente{s: s, android: android}).llamar("POST", "/api/v1/sesiones", `{"identificador":"laura@ejemplo.test","contrasena":"`+contrasena+`"}`)
		s.siembraLoQueTieneUnaCuentaNueva(persona)
		if _, err := s.pool.Exec(context.Background(),
			`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, 'avisos', '1.0 del 2026-10-30', now())`, persona); err != nil {
			t.Fatal(err)
		}
		antes := s.cuantoQueda(persona)
		for _, tabla := range []string{"persona", "perfil_adulto", "credencial", "sesion", "enlace_un_uso", "token_dispositivo", "ocultamiento_categoria", "aviso"} {
			if antes[tabla] == 0 {
				t.Fatalf("la prueba debe partir con filas en %s: %v", tabla, antes)
			}
		}
		if antes["sesion"] < 2 {
			t.Fatalf("la prueba debe partir con dos sesiones: %v", antes)
		}

		r := c.llamar("POST", rutaRechazo, "")
		if r.Codigo != 204 || r.Cuerpo != "" {
			t.Fatalf("No autorizo: %d %s", r.Codigo, r.Cuerpo)
		}
		if len(r.Cookies) != 1 || r.Cookies[0].Name != sesion.NombreDeLaCookie || r.Cookies[0].Value != "" || r.Cookies[0].MaxAge >= 0 {
			t.Errorf("la cookie debe vencerse: %v", r.Cookies)
		}

		for tabla, n := range s.cuantoQueda(persona) {
			if n != 0 {
				t.Errorf("en %s quedan %d filas de la persona", tabla, n)
			}
		}
		// Todo con llave a la persona está en la lista que se recorrió (sesión y credencial incluidas).
		tablas := map[string]bool{}
		for _, ref := range s.referencias() {
			tablas[ref[0]] = true
		}
		for _, quiere := range []string{"credencial", "sesion", "enlace_un_uso", "token_dispositivo", "aviso", "ocultamiento_categoria"} {
			if !tablas[quiere] {
				t.Errorf("la consulta de referencias no vio %s: %v", quiere, tablas)
			}
		}
		// La prueba mínima de la autorización que había queda retirada y conservada, sin llave a nadie (E13 §7, D-135).
		if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NOT NULL AND conservar_hasta IS NOT NULL`, persona); n != 1 {
			t.Errorf("la prueba mínima debe quedar retirada y con conservar_hasta: %d", n)
		}
		if n := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NULL`, persona); n != 0 {
			t.Errorf("no queda ninguna autorización vigente: %d", n)
		}

		// La sesión ya no existe, con la cookie o con el Bearer.
		if g := c.llamar("GET", rutaAutorizar, ""); g.Codigo != 401 || g.Cuerpo != `{"error":"sin_sesion"}` {
			t.Errorf("la sesión debe estar cerrada: %d %s", g.Codigo, g.Cuerpo)
		}
		if g := c.llamar("POST", rutaRechazo, ""); g.Codigo != 401 {
			t.Errorf("rechazar dos veces: %d %s", g.Codigo, g.Cuerpo)
		}
		// La otra cuenta no se tocó.
		if g := otra.llamar("GET", rutaAutorizar, ""); g.Codigo != 200 || s.cuantoQueda(otraPersona)["persona"] != 1 {
			t.Errorf("la otra cuenta debe seguir: %d %s", g.Codigo, g.Cuerpo)
		}
		// Ni el correo ni la contraseña sirven ya: se puede empezar de nuevo (PN-64).
		if g := (&cliente{s: s}).llamar("POST", "/api/v1/sesiones", `{"identificador":"laura@ejemplo.test","contrasena":"`+contrasena+`"}`); g.Codigo != 401 {
			t.Errorf("entrar con la cuenta borrada: %d %s", g.Codigo, g.Cuerpo)
		}
	})
}

// Con una sola necesaria otorgada (parcial) la cuenta sigue en `sin_autorizacion` y «No autorizo» la borra.
func TestRechazarConUnaAutorizacionParcialBorraLaCuenta(t *testing.T) {
	s := nuevoServidor(t)
	c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", false)
	if _, err := s.pool.Exec(context.Background(),
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, 'cuenta_y_acceso', '1.0 del 2026-10-30', now())`, persona); err != nil {
		t.Fatal(err)
	}
	if r := c.llamar("GET", rutaSeguridad, ""); r.Codigo != 403 {
		t.Fatalf("con una sola necesaria sigue sin autorizar: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("POST", rutaRechazo, ""); r.Codigo != 204 {
		t.Fatalf("No autorizo: %d %s", r.Codigo, r.Cuerpo)
	}
	if s.cuantoQueda(persona)["persona"] != 0 || s.contar(`SELECT count(*) FROM autorizacion WHERE retirada_en IS NULL`) != 0 {
		t.Error("la cuenta y sus autorizaciones vigentes deben desaparecer")
	}
}

// Quien ya autorizó no puede borrar su cuenta por «No autorizo»: 403, evento acceso_denegado y nada se toca.
func TestRechazarDespuesDeAutorizarEstaProhibido(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", android)
		if r := c.llamar("POST", rutaAutorizar, cuerpoAutorizar); r.Codigo != 200 {
			t.Fatalf("autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
		antes := s.cuantoQueda(persona)
		r := c.llamar("POST", rutaRechazo, "")
		if r.Codigo != 403 || r.Cuerpo != `{"error":"ya_autorizada"}` || len(r.Cookies) != 0 {
			t.Fatalf("No autorizo tras autorizar: %d %s %v", r.Codigo, r.Cuerpo, r.Cookies)
		}
		for tabla, n := range s.cuantoQueda(persona) {
			if n != antes[tabla] {
				t.Errorf("%s cambió: %d → %d", tabla, antes[tabla], n)
			}
		}
		if g := c.llamar("GET", rutaSeguridad, ""); g.Codigo != 200 {
			t.Errorf("la sesión sigue sirviendo: %d %s", g.Codigo, g.Cuerpo)
		}
		if !strings.Contains(s.eventos.String(), `"evento_seguridad":"acceso_denegado","cuenta":"`+persona+`","ruta":"POST /api/v1/autorizaciones/rechazo","codigo":403`) {
			t.Errorf("falta el evento acceso_denegado: %s", s.eventos)
		}
	})
}

// El repositorio también lo verifica dentro de la transacción: aunque quien llama se equivoque de nivel, no borra.
func TestElRepositorioNoBorraUnaCuentaAutorizada(t *testing.T) {
	s := nuevoServidor(t)
	_, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", false)
	repo := pg.NuevoAutorizaciones(s.pool)
	ahora := s.reloj.T
	necesarias := []string{"cuenta_y_acceso", "funciones_financieras"}
	if err := repo.Otorgar(context.Background(), persona, necesarias, "1.0 del 2026-10-30", ahora); err != nil {
		t.Fatal(err)
	}
	if err := repo.Rechazar(context.Background(), persona, necesarias, ahora, ahora); !errors.Is(err, autorizacion.ErrYaAutorizada) {
		t.Fatalf("Rechazar = %v, se esperaba ErrYaAutorizada", err)
	}
	if s.cuantoQueda(persona)["persona"] != 1 || s.contar(`SELECT count(*) FROM autorizacion WHERE retirada_en IS NULL`) != 2 {
		t.Error("no debe tocar nada")
	}
	// Una cuenta que no existe (ya borrada) no es un fallo de la base.
	if err := repo.Otorgar(context.Background(), "0192f3c4-0000-7000-8000-0000000000ff", necesarias, "1.0 del 2026-10-30", ahora); !errors.Is(err, autorizacion.ErrSinCuenta) {
		t.Errorf("Otorgar sin cuenta = %v", err)
	}
	if err := repo.Rechazar(context.Background(), "0192f3c4-0000-7000-8000-0000000000ff", necesarias, ahora, ahora); !errors.Is(err, autorizacion.ErrSinCuenta) {
		t.Errorf("Rechazar sin cuenta = %v", err)
	}
}

// Otorgar y rechazar a la vez nunca dejan una autorización vigente de una cuenta borrada (`autorizacion` no tiene llave
// a persona): o queda la cuenta con todo lo otorgado, o no queda cuenta y nada vigente.
func TestOtorgarYRechazarAlMismoTiempoQuedanCoherentes(t *testing.T) {
	s := nuevoServidor(t)
	repo := pg.NuevoAutorizaciones(s.pool)
	necesarias := []string{"cuenta_y_acceso", "funciones_financieras"}
	ahora := s.reloj.T
	for i := range 15 {
		persona := s.cuentaSinAutorizar(i)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_ = repo.Otorgar(context.Background(), persona, necesarias, "1.0 del 2026-10-30", ahora)
		}()
		go func() {
			defer wg.Done()
			_ = repo.Rechazar(context.Background(), persona, necesarias, ahora, ahora)
		}()
		wg.Wait()
		cuentas := s.contar(`SELECT count(*) FROM persona WHERE id = $1::uuid`, persona)
		vigentes := s.contar(`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NULL`, persona)
		if !(cuentas == 1 && vigentes == 2) && !(cuentas == 0 && vigentes == 0) {
			t.Fatalf("ronda %d: %d cuentas y %d autorizaciones vigentes", i, cuentas, vigentes)
		}
	}
}

// cuentaSinAutorizar crea directo en la base una cuenta adulta verificada y sin autorizar.
func (s *servidorDePrueba) cuentaSinAutorizar(i int) string {
	s.t.Helper()
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx) // la base exige el perfil en la misma transacción que la persona
	if err != nil {
		s.t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa, creada_en) VALUES ('Laura', 'adulta', now()) RETURNING id::text`).Scan(&id); err != nil {
		s.t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, $2, true)`,
		id, fmt.Sprintf("c%d@ejemplo.test", i)); err != nil {
		s.t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		s.t.Fatal(err)
	}
	return id
}
