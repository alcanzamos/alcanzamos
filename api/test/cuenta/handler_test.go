package cuenta_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

func apiDePrueba(t *testing.T, e *entorno) http.Handler {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	enr := servidor.NuevoEnrutador(servidor.SinSesiones{}, seguridad.NuevoRegistro(log), log).ConURLPublica("https://app.ejemplo.test")
	cuenta.NuevoHandler(e.svc, log).Registrar(enr)
	h, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return csrftest.ConCabeceras(servidor.ManejadorConAPI(h))
}

func post(h http.Handler, origen, ruta, cuerpo string, encabezados ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, ruta, strings.NewReader(cuerpo))
	r.RemoteAddr = origen + ":4321"
	for i := 0; i+1 < len(encabezados); i += 2 {
		r.Header.Set(encabezados[i], encabezados[i+1])
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	return rr
}

const (
	cuerpoValido   = `{"correo":"laura@ejemplo.test","mayor_de_edad":true}`
	respuestaIgual = `{"estado":"verificacion_pendiente"}`
)

// USA-005 (RNF-016): PN-58 pide solo el correo, más «Soy mayor de edad» (D-089); cualquier otro campo se rechaza sin
// crear nada, también la contraseña y el nombre, que ahora se piden en PN-74.
func TestUSA_005ElRegistroRechazaCualquierOtroCampo(t *testing.T) {
	for _, extra := range []string{"contrasena", "nombre", "apellido", "telefono", "documento", "fecha_de_nacimiento", "direccion", "banco", "rol"} {
		t.Run(extra, func(t *testing.T) {
			e := nuevoEntorno()
			h := apiDePrueba(t, e)
			cuerpo := strings.Replace(cuerpoValido, `"mayor_de_edad":true}`, `"mayor_de_edad":true,"`+extra+`":"x"}`, 1)
			rr := post(h, "203.0.113.7", "/api/v1/cuentas", cuerpo)
			e.svc.Esperar()
			if rr.Code != 400 || strings.TrimSpace(rr.Body.String()) != `{"error":"solicitud_invalida"}` ||
				len(e.repo.solicitudes) != 0 || len(e.correo.Enviados()) != 0 {
				t.Errorf("código %d, se esperaba 400 sin crear nada: %s", rr.Code, rr.Body)
			}
		})
	}
	// Con solo los dos campos se acepta.
	e := nuevoEntorno()
	rr := post(apiDePrueba(t, e), "203.0.113.7", "/api/v1/cuentas", cuerpoValido)
	e.svc.Esperar()
	if rr.Code != 202 {
		t.Errorf("con correo y mayor_de_edad: %d %s", rr.Code, rr.Body)
	}
}

func TestPostCuentas(t *testing.T) {
	casos := []struct {
		nombre string
		cuerpo string
		codigo int
		campos map[string]any // contenido esperado del JSON de respuesta
	}{
		{"cuenta nueva", cuerpoValido, 202, map[string]any{"estado": "verificacion_pendiente"}},
		{"errores de campo", `{"correo":"x","mayor_de_edad":false}`, 422, map[string]any{
			"error":  "validacion",
			"campos": map[string]any{"correo": "correo_invalido", "mayor_de_edad": "mayor_de_edad_requerido"},
		}},
		{"sin mayor_de_edad equivale a falso", `{"correo":"laura@ejemplo.test"}`, 422, map[string]any{
			"error": "validacion", "campos": map[string]any{"mayor_de_edad": "mayor_de_edad_requerido"},
		}},
		{"la fecha de nacimiento no se acepta", `{"correo":"laura@ejemplo.test","mayor_de_edad":true,"fecha_de_nacimiento":"1990-05-14"}`, 400, map[string]any{"error": "solicitud_invalida"}},
		{"JSON roto", `{"correo":`, 400, map[string]any{"error": "solicitud_invalida"}},
		{"dos objetos", cuerpoValido + cuerpoValido, 400, map[string]any{"error": "solicitud_invalida"}},
		{"cuerpo vacío", ``, 400, map[string]any{"error": "solicitud_invalida"}},
		{"cuerpo enorme", `{"correo":"` + strings.Repeat("a", 20<<10) + `"}`, 400, map[string]any{"error": "solicitud_invalida"}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno()
			h := apiDePrueba(t, e)
			rr := post(h, "203.0.113.7", "/api/v1/cuentas", c.cuerpo)
			e.svc.Esperar()
			if rr.Code != c.codigo {
				t.Fatalf("código %d, se esperaba %d: %s", rr.Code, c.codigo, rr.Body)
			}
			var obtenido map[string]any
			if err := json.Unmarshal(rr.Body.Bytes(), &obtenido); err != nil {
				t.Fatal(err)
			}
			a, _ := json.Marshal(obtenido)
			b, _ := json.Marshal(c.campos)
			if !bytes.Equal(a, b) {
				t.Errorf("respuesta %s, se esperaba %s", a, b)
			}
			if len(rr.Result().Cookies()) != 0 {
				t.Error("crear la cuenta nunca da sesión")
			}
			if c.codigo != 202 && (len(e.repo.solicitudes) != 0 || len(e.correo.Enviados()) != 0) {
				t.Error("una solicitud rechazada no crea ni envía nada")
			}
		})
	}
}

func TestSoloPOST(t *testing.T) {
	h := apiDePrueba(t, nuevoEntorno())
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/cuentas", nil))
	if rr.Code == http.StatusOK || rr.Code == http.StatusAccepted {
		t.Fatalf("GET no debe llegar al manejador: %d", rr.Code)
	}
}

// D-172 (5): se retiran las rutas de la sesión limitada de PN-59, «Ya lo confirmé» y «Cambiar el correo». No existen:
// responden el 404 de /api/, sin tocar nada.
func TestLasRutasDeLaSesionLimitadaYaNoExisten(t *testing.T) {
	for _, ruta := range []struct{ metodo, camino string }{
		{"GET", "/api/v1/cuentas/estado"}, {"POST", "/api/v1/cuentas/correo"},
	} {
		e := nuevoEntorno()
		r := httptest.NewRequest(ruta.metodo, ruta.camino, strings.NewReader(`{"correo":"nuevo@ejemplo.test"}`))
		r.Header.Set("Sec-Fetch-Site", "same-origin")
		r.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		apiDePrueba(t, e).ServeHTTP(rr, r)
		if rr.Code != 404 || len(e.correo.Enviados()) != 0 || len(e.repo.solicitudes) != 0 {
			t.Errorf("%s %s: %d %s", ruta.metodo, ruta.camino, rr.Code, rr.Body)
		}
	}
}

// vista es todo lo que un cliente puede ver de una respuesta menos la fecha: estado, cabeceras (con sus valores) y
// cuerpo, y si trae cookie.
type vista struct {
	Estado    int
	Cabeceras string
	Cuerpo    string
}

func vistaDe(rr *httptest.ResponseRecorder) vista {
	var lineas []string
	for k, v := range rr.Header() {
		if k != "Date" {
			lineas = append(lineas, k+": "+strings.Join(v, ","))
		}
	}
	sort.Strings(lineas)
	return vista{rr.Code, strings.Join(lineas, "\n"), rr.Body.String()}
}

// SEG-013 (D-172 (1) y (4); A-16): crear una cuenta y «Reenviar el correo» con un correo nuevo, con el de una cuenta sin
// verificar y con el de una cuenta verificada dan el mismo estado, las mismas cabeceras y el mismo cuerpo, sin cookie,
// ni con el cliente web ni con el de Android (que ya no recibe token: crear no da sesión). Lo único que cambia es qué
// correo sale.
func TestCrearYReenviarNoSeDistinguenEntreCorreoNuevoSinVerificarYVerificado(t *testing.T) {
	casos := []struct {
		nombre  string
		cuentas map[string]bool
		esAviso bool
	}{
		{"correo nuevo", nil, false},
		{"correo con cuenta sin verificar", map[string]bool{"laura@ejemplo.test": false}, false},
		{"correo con cuenta verificada", map[string]bool{"laura@ejemplo.test": true}, true},
	}
	rutas := map[string]string{
		"crear":    "/api/v1/cuentas",
		"reenviar": "/api/v1/cuentas/verificacion/reenvio",
	}
	cuerpos := map[string]string{"crear": cuerpoValido, "reenviar": `{"correo":"laura@ejemplo.test"}`}
	for accion, ruta := range rutas {
		for _, cabeceras := range [][]string{nil, {sesion.EncabezadoDeCliente, sesion.ClienteAndroid}} {
			t.Run(accion+" "+strings.Join(cabeceras, "="), func(t *testing.T) {
				var vistas []vista
				for _, c := range casos {
					e := nuevoEntorno()
					e.repo.verificadas = c.cuentas
					rr := post(apiDePrueba(t, e), "203.0.113.7", ruta, cuerpos[accion], cabeceras...)
					e.svc.Esperar()
					enviados := e.correo.Enviados()
					if sinCorreo := accion == "reenviar" && c.cuentas == nil; sinCorreo {
						// B1: el reenvío no crea cuentas; con un correo sin cuenta no sale nada, y el cliente no lo nota.
						if len(enviados) != 0 || len(e.repo.verificadas) != 0 {
							t.Errorf("%s: el reenvío no debe crear ni enviar: %+v", c.nombre, enviados)
						}
					} else if len(enviados) != 1 || enviados[0].Aviso != c.esAviso {
						t.Errorf("%s: correos %+v", c.nombre, enviados)
					}
					if len(rr.Result().Cookies()) != 0 || len(rr.Header().Values("Set-Cookie")) != 0 || strings.Contains(rr.Body.String(), "token") {
						t.Errorf("%s: no debe dar sesión ni token: %v %s", c.nombre, rr.Header(), rr.Body)
					}
					vistas = append(vistas, vistaDe(rr))
				}
				for i := 1; i < len(vistas); i++ {
					if vistas[i] != vistas[0] {
						t.Errorf("%s se distingue de %s:\n%+v\n%+v", casos[i].nombre, casos[0].nombre, vistas[i], vistas[0])
					}
				}
				if vistas[0].Estado != 202 || strings.TrimSpace(vistas[0].Cuerpo) != respuestaIgual {
					t.Errorf("respuesta: %+v", vistas[0])
				}
			})
		}
	}
}

// D-140 (1): 20 intentos por hora por origen, todos los intentos, y el 21 es 429 con el mismo cuerpo (SEG-009).
func TestElIntento21DeUnOrigenEnUnaHoraEs429(t *testing.T) {
	e := nuevoEntorno()
	h := apiDePrueba(t, e)
	// Cuentan los correos nuevos, los ya registrados, los errores de campo y el JSON roto por igual.
	e.repo.verificadas = map[string]bool{"existente@ejemplo.test": true}
	cuerpos := []string{
		cuerpoValido,
		`{"correo":"existente@ejemplo.test","mayor_de_edad":true}`,
		`{"correo":"otra@ejemplo.test","mayor_de_edad":false}`,
		`{"correo":`,
	}
	for i := range 20 {
		rr := post(h, "203.0.113.7", "/api/v1/cuentas", cuerpos[i%len(cuerpos)])
		if rr.Code == http.StatusTooManyRequests {
			t.Fatalf("el intento %d no debía frenarse", i+1)
		}
	}
	for _, cuerpo := range cuerpos {
		rr := post(h, "203.0.113.7", "/api/v1/cuentas", cuerpo)
		if rr.Code != http.StatusTooManyRequests || strings.TrimSpace(rr.Body.String()) != `{"error":"demasiados_intentos"}` {
			t.Fatalf("el intento 21 debe dar 429 sin importar el cuerpo: %d %s", rr.Code, rr.Body)
		}
		if rr.Header().Get("Set-Cookie") != "" {
			t.Error("un intento frenado no da sesión")
		}
	}
	if rr := post(h, "203.0.113.8", "/api/v1/cuentas", cuerpoValido); rr.Code != 202 {
		t.Fatalf("otro origen no se afecta: %d", rr.Code)
	}
	e.svc.Esperar()
	e.reloj.T = e.reloj.T.Add(time.Hour)
	if rr := post(h, "203.0.113.7", "/api/v1/cuentas", cuerpoValido); rr.Code != 202 {
		t.Fatalf("a la hora vuelve a dejar crear: %d", rr.Code)
	}
	e.svc.Esperar()
}

// PN-59 (D-172 (4), D-143 (5)): «Reenviar el correo» es público, pide el correo, responde 202 igual con o sin cuenta; con
// la espera corta de 30 segundos, 3 por hora por dirección y 20 por origen responde 429 con el mismo cuerpo siempre;
// con un correo mal escrito, 422 con su código.
func TestReenviarPorHTTP(t *testing.T) {
	const ruta = "/api/v1/cuentas/verificacion/reenvio"
	e := nuevoEntorno()
	h := apiDePrueba(t, e)
	rr := post(h, "203.0.113.7", ruta, `{"correo":"laura@ejemplo.test"}`)
	if rr.Code != 202 || strings.TrimSpace(rr.Body.String()) != respuestaIgual {
		t.Fatalf("reenvío: %d %s", rr.Code, rr.Body)
	}
	rr = post(h, "203.0.113.8", ruta, `{"correo":"laura@ejemplo.test"}`)
	if rr.Code != 429 || strings.TrimSpace(rr.Body.String()) != `{"error":"demasiados_intentos"}` || len(rr.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("la espera corta: %d %s", rr.Code, rr.Body)
	}
	e.svc.Esperar()
	e.reloj.T = e.reloj.T.Add(31 * time.Second)
	if rr := post(h, "203.0.113.9", ruta, `{"correo":"laura@ejemplo.test"}`); rr.Code != 202 {
		t.Fatalf("pasada la espera: %d %s", rr.Code, rr.Body)
	}
	for cuerpo, esperado := range map[string]string{
		`{"correo":""}`:                          `{"campos":{"correo":"correo_vacio"},"error":"validacion"}`,
		`{"correo":"sin-arroba"}`:                `{"campos":{"correo":"correo_invalido"},"error":"validacion"}`,
		`{"correo":"a@b.test","contrasena":"x"}`: `{"error":"solicitud_invalida"}`,
	} {
		rr := post(h, "203.0.113.7", ruta, cuerpo)
		if strings.TrimSpace(rr.Body.String()) != esperado || rr.Code < 400 || len(rr.Header().Values("Set-Cookie")) != 0 {
			t.Errorf("%s: %d %s", cuerpo, rr.Code, rr.Body)
		}
	}
	e.svc.Esperar()
	if n := len(e.repo.solicitudes); n != 0 {
		t.Errorf("el reenvío no crea cuentas ni enlaces para un correo sin cuenta: %d", n)
	}
}

// PN-74 por HTTP, en la web: 200 con la cookie de sesión `HttpOnly`, y el token solo en la cookie.
func TestCompletarLaCuentaDaLaCookieDeSesion(t *testing.T) {
	e := nuevoEntorno()
	h := apiDePrueba(t, e)
	token := e.enlaceDePrueba(t)
	rr := post(h, "203.0.113.7", "/api/v1/cuentas/verificacion", `{"token":"`+token+`","contrasena":"`+claveDePrueba+`","nombre":"Laura"}`)
	cookies := rr.Result().Cookies()
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"activa"}` || rr.Header().Get("Cache-Control") != "no-store" ||
		len(cookies) != 1 || cookies[0].Name != "__Host-sesion" || !cookies[0].HttpOnly || !cookies[0].Secure ||
		cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Path != "/" {
		t.Fatalf("respuesta: %d %s %v", rr.Code, rr.Body, rr.Header())
	}
	huella, err := seguridad.HuellaDeToken(cookies[0].Value)
	if err != nil || !bytes.Equal(huella, e.repo.completadas[0].HuellaDeSesion) {
		t.Fatalf("la cookie no lleva el token de la sesión guardada: %v", err)
	}
}

// En Android el token va en el cuerpo y no hay `Set-Cookie`.
func TestCompletarLaCuentaEnAndroidDaElTokenEnElCuerpo(t *testing.T) {
	e := nuevoEntorno()
	token := e.enlaceDePrueba(t)
	rr := post(apiDePrueba(t, e), "203.0.113.7", "/api/v1/cuentas/verificacion",
		`{"token":"`+token+`","contrasena":"`+claveDePrueba+`","nombre":"Laura"}`, sesion.EncabezadoDeCliente, sesion.ClienteAndroid)
	var cuerpo map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &cuerpo); err != nil {
		t.Fatal(err)
	}
	if rr.Code != 200 || len(rr.Result().Cookies()) != 0 || cuerpo["estado"] != "activa" {
		t.Fatalf("respuesta inesperada: %d %v %s", rr.Code, rr.Header()["Set-Cookie"], rr.Body)
	}
	if huella, err := seguridad.HuellaDeToken(cuerpo["token"]); err != nil || !bytes.Equal(huella, e.repo.completadas[0].HuellaDeSesion) {
		t.Fatalf("el cuerpo no lleva el token de la sesión: %v", err)
	}
}

// D-143 (3): con `X-Alcanzamos-Cliente: android` el pedido no puede traer `Origin` ni `Sec-Fetch-Site` (los mandan los
// navegadores): 400 sin token y sin `Set-Cookie`, y el enlace no se gasta. Sin la cabecera de Android, el camino de la
// web no cambia.
func TestAndroidConCabecerasDeNavegadorSeRechazaAlCompletar(t *testing.T) {
	for _, extra := range [][]string{{"Origin", "https://app.ejemplo.test"}, {"Sec-Fetch-Site", "same-origin"}} {
		e := nuevoEntorno()
		token := e.enlaceDePrueba(t)
		cabeceras := append([]string{sesion.EncabezadoDeCliente, sesion.ClienteAndroid}, extra...)
		rr := post(apiDePrueba(t, e), "203.0.113.7", "/api/v1/cuentas/verificacion",
			`{"token":"`+token+`","contrasena":"`+claveDePrueba+`","nombre":"Laura"}`, cabeceras...)
		if rr.Code != 400 || strings.TrimSpace(rr.Body.String()) != `{"error":"solicitud_invalida"}` ||
			len(rr.Header().Values("Set-Cookie")) != 0 || len(e.repo.completadas) != 0 || e.hasher.llamadas != 0 {
			t.Fatalf("%v: %d %s %v", extra, rr.Code, rr.Body, rr.Header())
		}
	}
	e := nuevoEntorno()
	token := e.enlaceDePrueba(t)
	rr := post(apiDePrueba(t, e), "203.0.113.7", "/api/v1/cuentas/verificacion",
		`{"token":"`+token+`","contrasena":"`+claveDePrueba+`","nombre":"Laura"}`, "Origin", "https://app.ejemplo.test", "Sec-Fetch-Site", "same-origin")
	if rr.Code != 200 || len(rr.Result().Cookies()) != 1 {
		t.Fatalf("la web con sus cabeceras: %d %v %s", rr.Code, rr.Header(), rr.Body)
	}
}

// Los rechazos de PN-74 no dan sesión ni tocan nada: estado, cuerpo exacto, sin `Set-Cookie`.
func TestCompletarLaCuentaRechazos(t *testing.T) {
	e := nuevoEntorno()
	h := apiDePrueba(t, e)
	token := e.enlaceDePrueba(t)
	desconocido, _ := seguridad.NuevoTokenOpaco()
	casos := []struct {
		nombre, cuerpo, esperado string
		codigo                   int
	}{
		{"enlace que no sirve", `{"token":"` + desconocido + `","contrasena":"` + claveDePrueba + `","nombre":"Laura"}`, `{"error":"enlace_invalido"}`, 400},
		{"token mal formado", `{"token":"xyz","contrasena":"` + claveDePrueba + `","nombre":"Laura"}`, `{"error":"enlace_invalido"}`, 400},
		{"sin token", `{"contrasena":"` + claveDePrueba + `","nombre":"Laura"}`, `{"error":"enlace_invalido"}`, 400},
		{"contraseña con el correo", `{"token":"` + token + `","contrasena":"la clave de laura es larga","nombre":"Laura"}`, `{"campos":{"contrasena":"contrasena_personal"},"error":"validacion"}`, 422},
		{"contraseña corta y nombre vacío", `{"token":"` + token + `","contrasena":"corta","nombre":""}`, `{"campos":{"contrasena":"contrasena_corta","nombre":"nombre_vacio"},"error":"validacion"}`, 422},
		{"campo desconocido", `{"token":"` + token + `","contrasena":"` + claveDePrueba + `","nombre":"Laura","correo":"otro@ejemplo.test"}`, `{"error":"solicitud_invalida"}`, 400},
		{"JSON roto", `{"token":`, `{"error":"solicitud_invalida"}`, 400},
	}
	for _, c := range casos {
		rr := post(h, "203.0.113.7", "/api/v1/cuentas/verificacion", c.cuerpo)
		if rr.Code != c.codigo || strings.TrimSpace(rr.Body.String()) != c.esperado || len(rr.Header().Values("Set-Cookie")) != 0 {
			t.Errorf("%s: %d %s %v", c.nombre, rr.Code, rr.Body, rr.Header())
		}
	}
	if len(e.repo.completadas) != 0 || e.hasher.llamadas != 0 {
		t.Error("ningún rechazo completa la cuenta ni calcula el hash")
	}
	// Tras todos los rechazos, el enlace sigue sirviendo.
	if rr := post(h, "203.0.113.7", "/api/v1/cuentas/verificacion", `{"token":"`+token+`","contrasena":"`+claveDePrueba+`","nombre":"Laura"}`); rr.Code != 200 {
		t.Errorf("el enlace debía seguir vigente: %d %s", rr.Code, rr.Body)
	}
}

func TestOrigenDe(t *testing.T) {
	casos := map[string]string{
		"203.0.113.7:5000":                     "203.0.113.7",
		"[::ffff:203.0.113.7]:5000":            "203.0.113.7",
		"[2001:db8:1:2:aaaa:bbbb:cccc:dddd]:1": "2001:db8:1:2::/64",
		"[2001:db8:1:2::1]:2":                  "2001:db8:1:2::/64",
		"sin-puerto":                           "sin-puerto",
	}
	for remota, quiere := range casos {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = remota
		r.Header.Set("X-Forwarded-For", "198.51.100.9")
		if got := cuenta.OrigenDe(r); got != quiere {
			t.Errorf("OrigenDe(%q) = %q, se esperaba %q", remota, got, quiere)
		}
	}
}
