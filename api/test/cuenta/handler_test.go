package cuenta_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
)

func apiDePrueba(t *testing.T, e *entorno) http.Handler {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	resolutor := sesion.NuevoResolutor(e.almacen, e.senuelos.Senuelos, e.reloj)
	enr := servidor.NuevoEnrutador(resolutor, seguridad.NuevoRegistro(log), log)
	cuenta.NuevoHandler(e.svc, resolutor, log).Registrar(enr)
	h, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

// almacenFalso es el almacén de sesiones reales: huella (en texto) → Sujeto. Solo valen estas y las de mentira.
type almacenFalso map[string]seguridad.Sujeto

func (a almacenFalso) Sujeto(_ context.Context, huella []byte, _ time.Time) (seguridad.Sujeto, error) {
	if s, ok := a[string(huella)]; ok {
		return s, nil
	}
	return seguridad.Sujeto{}, seguridad.ErrSinSesion
}

// sesionReal registra en el almacén una sesión real del Sujeto dado y devuelve su token.
func (e *entorno) sesionReal(s seguridad.Sujeto) string {
	token, huella := seguridad.NuevoTokenOpaco()
	e.almacen[string(huella)] = s
	return token
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

const cuerpoValido = `{"correo":"laura@ejemplo.test","contrasena":"lluvia café tren azul","nombre":"Laura","mayor_de_edad":true}`

func TestPostCuentas(t *testing.T) {
	casos := []struct {
		nombre string
		cuerpo string
		codigo int
		campos map[string]any // contenido esperado del JSON de respuesta
	}{
		{"cuenta nueva", cuerpoValido, 202, map[string]any{"estado": "verificacion_pendiente"}},
		{"errores de campo", `{"correo":"x","contrasena":"corta","nombre":"","mayor_de_edad":false}`, 422, map[string]any{
			"error":  "validacion",
			"campos": map[string]any{"correo": "correo_invalido", "contrasena": "contrasena_corta", "nombre": "nombre_vacio", "mayor_de_edad": "mayor_de_edad_requerido"},
		}},
		{"contraseña con el correo", `{"correo":"laura@ejemplo.test","contrasena":"la clave de laura es larga","nombre":"Laura","mayor_de_edad":true}`, 422, map[string]any{
			"error": "validacion", "campos": map[string]any{"contrasena": "contrasena_personal"},
		}},
		{"sin mayor_de_edad equivale a falso", `{"correo":"laura@ejemplo.test","contrasena":"lluvia café tren azul","nombre":"Laura"}`, 422, map[string]any{
			"error": "validacion", "campos": map[string]any{"mayor_de_edad": "mayor_de_edad_requerido"},
		}},
		{"la fecha de nacimiento no se acepta", `{"correo":"laura@ejemplo.test","contrasena":"lluvia café tren azul","nombre":"Laura","mayor_de_edad":true,"fecha_de_nacimiento":"1990-05-14"}`, 400, map[string]any{"error": "solicitud_invalida"}},
		{"JSON roto", `{"correo":`, 400, map[string]any{"error": "solicitud_invalida"}},
		{"dos objetos", cuerpoValido + cuerpoValido, 400, map[string]any{"error": "solicitud_invalida"}},
		{"cuerpo vacío", ``, 400, map[string]any{"error": "solicitud_invalida"}},
		{"cuerpo enorme", `{"nombre":"` + strings.Repeat("a", 20<<10) + `"}`, 400, map[string]any{"error": "solicitud_invalida"}},
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
			if c.codigo != 202 && (len(e.repo.creadas) != 0 || len(e.correo.Enviados()) != 0 || rr.Header().Get("Set-Cookie") != "") {
				t.Error("una solicitud rechazada no crea, no envía ni da sesión")
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

func TestLaCuentaNuevaRecibeLaCookieDeSesion(t *testing.T) {
	e := nuevoEntorno()
	rr := post(apiDePrueba(t, e), "203.0.113.7", "/api/v1/cuentas", cuerpoValido)
	e.svc.Esperar()
	cookies := rr.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "__Host-sesion" || !cookies[0].HttpOnly || !cookies[0].Secure ||
		cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Path != "/" {
		t.Fatalf("cookie inesperada: %v", rr.Header()["Set-Cookie"])
	}
	huella, err := seguridad.HuellaDeToken(cookies[0].Value)
	if err != nil || !bytes.Equal(huella, e.repo.creadas[0].HuellaDeSesion) {
		t.Fatalf("la cookie no lleva el token de la sesión guardada: %v", err)
	}
	if strings.Contains(rr.Body.String(), cookies[0].Value) {
		t.Error("en la web el token solo va en la cookie, no en el cuerpo")
	}
}

func TestAndroidRecibeElTokenEnElCuerpoYNoCookie(t *testing.T) {
	e := nuevoEntorno()
	rr := post(apiDePrueba(t, e), "203.0.113.7", "/api/v1/cuentas", cuerpoValido, sesion.EncabezadoDeCliente, sesion.ClienteAndroid)
	e.svc.Esperar()
	var cuerpo map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &cuerpo); err != nil {
		t.Fatal(err)
	}
	if rr.Code != 202 || len(rr.Result().Cookies()) != 0 || cuerpo["estado"] != "verificacion_pendiente" {
		t.Fatalf("respuesta inesperada: %d %v %s", rr.Code, rr.Header()["Set-Cookie"], rr.Body)
	}
	if huella, err := seguridad.HuellaDeToken(cuerpo["token"]); err != nil || !bytes.Equal(huella, e.repo.creadas[0].HuellaDeSesion) {
		t.Fatalf("el cuerpo no lleva el token de la sesión: %v", err)
	}
}

// D-143 (3): con `X-Alcanzamos-Cliente: android` el pedido no puede traer `Origin` ni `Sec-Fetch-Site` (los mandan
// los navegadores): da 400 sin token y sin `Set-Cookie`, y no crea nada, exista o no la cuenta. Sin la cabecera de
// Android el camino de la web no cambia, con o sin esas cabeceras.
func TestAndroidConCabecerasDeNavegadorSeRechaza(t *testing.T) {
	casos := []struct {
		nombre    string
		cabeceras []string
		codigo    int
		cookie    bool
	}{
		{"android con Origin", []string{"Origin", "https://app.ejemplo.test"}, 400, false},
		{"android con Origin null", []string{"Origin", "null"}, 400, false},
		{"android con Sec-Fetch-Site same-origin", []string{"Sec-Fetch-Site", "same-origin"}, 400, false},
		{"android con Sec-Fetch-Site none", []string{"Sec-Fetch-Site", "none"}, 400, false},
		{"android con las dos", []string{"Origin", "x", "Sec-Fetch-Site", "cross-site"}, 400, false},
	}
	for _, existe := range []bool{false, true} { // con cuenta verificada (sesión de mentira) y sin ella: igual
		for _, c := range casos {
			t.Run(c.nombre, func(t *testing.T) {
				e := nuevoEntorno()
				if existe {
					e.repo.verificadas = map[string]bool{"laura@ejemplo.test": true}
				}
				enc := append([]string{sesion.EncabezadoDeCliente, sesion.ClienteAndroid}, c.cabeceras...)
				rr := post(apiDePrueba(t, e), "203.0.113.7", "/api/v1/cuentas", cuerpoValido, enc...)
				e.svc.Esperar()
				if rr.Code != c.codigo || strings.TrimSpace(rr.Body.String()) != `{"error":"solicitud_invalida"}` {
					t.Fatalf("respuesta: %d %s", rr.Code, rr.Body)
				}
				if rr.Header().Get("Set-Cookie") != "" || strings.Contains(rr.Body.String(), "token") {
					t.Errorf("sin token ni cookie: %v %s", rr.Header(), rr.Body)
				}
				if len(e.repo.creadas) != 0 || e.hasher.llamadas != 0 || len(e.correo.Enviados()) != 0 || e.senuelos.Cantidad() != 0 {
					t.Errorf("no debe crear nada ni enviar nada: %d cuentas, %d hashes, %d correos, %d señuelos",
						len(e.repo.creadas), e.hasher.llamadas, len(e.correo.Enviados()), e.senuelos.Cantidad())
				}
			})
		}
	}
	// Sin la cabecera de Android, Origin y Sec-Fetch-Site no cambian nada: es la web (cookie, sin token en el cuerpo).
	e := nuevoEntorno()
	rr := post(apiDePrueba(t, e), "203.0.113.7", "/api/v1/cuentas", cuerpoValido, "Origin", "https://app.ejemplo.test", "Sec-Fetch-Site", "same-origin")
	e.svc.Esperar()
	cs := rr.Result().Cookies()
	if rr.Code != 202 || len(cs) != 1 || strings.Contains(rr.Body.String(), cs[0].Value) {
		t.Fatalf("la web con sus cabeceras: %d %v %s", rr.Code, rr.Header(), rr.Body)
	}
}

// formaDeLaRespuesta es todo lo que un cliente puede ver de una respuesta salvo el valor del token y de los
// identificadores únicos: estado, nombres de las cabeceras, atributos de la cookie, formato y largo del token, y cuerpo.
type formaDeLaRespuesta struct {
	Estado        int
	Cabeceras     string // nombres, ordenados
	Cookie        string // el Set-Cookie con el valor reemplazado por su forma
	LargoDelToken int
	Cuerpo        string
}

var formatoDeToken = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

func formaDe(t *testing.T, rr *httptest.ResponseRecorder, android bool) formaDeLaRespuesta {
	t.Helper()
	var nombres []string
	for k := range rr.Header() {
		nombres = append(nombres, k)
	}
	sort.Strings(nombres)
	f := formaDeLaRespuesta{Estado: rr.Code, Cabeceras: strings.Join(nombres, ","), Cuerpo: rr.Body.String()}
	token := ""
	if android {
		var c map[string]string
		_ = json.Unmarshal(rr.Body.Bytes(), &c)
		token = c["token"]
		f.Cuerpo = strings.Replace(f.Cuerpo, token, "<TOKEN>", 1)
	} else if cs := rr.Result().Cookies(); len(cs) == 1 {
		token = cs[0].Value
		f.Cookie = strings.Replace(rr.Header().Get("Set-Cookie"), token, "<TOKEN>", 1)
	}
	if !formatoDeToken.MatchString(token) {
		t.Fatalf("el token no tiene el formato de un token opaco: %q", token)
	}
	f.LargoDelToken = len(token)
	return f
}

// SEG-013 (D-141 (3)): crear una cuenta con un correo nuevo, con el de una cuenta sin verificar y con el de una cuenta
// verificada no se distingue: mismo estado, mismas cabeceras, misma cookie (formato y largo), mismo cuerpo, y Argon2id
// corre una vez en cada caso. (Los casos de cada acción de PN-59 con la sesión de mentira se prueban en el PR 6.)
func TestCrearCuentaNoSeDistingueEntreCorreoNuevoSinVerificarYVerificado(t *testing.T) {
	for _, android := range []bool{false, true} {
		nombre := "web"
		var enc []string
		if android {
			nombre, enc = "android", []string{sesion.EncabezadoDeCliente, sesion.ClienteAndroid}
		}
		t.Run(nombre, func(t *testing.T) {
			casos := []struct {
				nombre      string
				existentes  map[string]bool
				esAviso     bool
				esDeMentira bool
			}{
				{"correo nuevo", nil, false, false},
				{"correo con cuenta sin verificar", map[string]bool{"laura@ejemplo.test": false}, false, false},
				{"correo con cuenta verificada", map[string]bool{"laura@ejemplo.test": true}, true, true},
			}
			var formas []formaDeLaRespuesta
			for _, c := range casos {
				e := nuevoEntorno()
				e.repo.verificadas = c.existentes
				rr := post(apiDePrueba(t, e), "203.0.113.7", "/api/v1/cuentas", cuerpoValido, enc...)
				e.svc.Esperar()

				if e.hasher.llamadas != 1 {
					t.Errorf("%s: Argon2id corrió %d veces, se esperaba 1", c.nombre, e.hasher.llamadas)
				}
				if enviados := e.correo.Enviados(); len(enviados) != 1 || enviados[0].Aviso != c.esAviso {
					t.Errorf("%s: correos %+v", c.nombre, enviados)
				}
				if (e.senuelos.Cantidad() == 1) != c.esDeMentira {
					t.Errorf("%s: sesiones de mentira %d", c.nombre, e.senuelos.Cantidad())
				}
				formas = append(formas, formaDe(t, rr, android))
			}
			for i := 1; i < len(formas); i++ {
				if formas[i] != formas[0] {
					t.Errorf("%s se distingue de %s:\n%+v\n%+v", casos[i].nombre, casos[0].nombre, formas[i], formas[0])
				}
			}
			if formas[0].Estado != 202 {
				t.Errorf("estado %d, se esperaba 202", formas[0].Estado)
			}
			if !android && !strings.Contains(formas[0].Cookie, "HttpOnly") {
				t.Errorf("cookie: %s", formas[0].Cookie)
			}
		})
	}
}

// D-140 (1): 20 intentos por hora por origen, todos los intentos, y el 21 es 429 con el mismo cuerpo (SEG-009).
func TestElIntento21DeUnOrigenEnUnaHoraEs429(t *testing.T) {
	e := nuevoEntorno()
	h := apiDePrueba(t, e)
	// Cuentan los correos nuevos, los ya registrados, las contraseñas rechazadas y el JSON roto por igual.
	e.repo.verificadas = map[string]bool{"existente@ejemplo.test": true}
	cuerpos := []string{
		cuerpoValido,
		`{"correo":"existente@ejemplo.test","contrasena":"lluvia café tren azul","nombre":"Laura","mayor_de_edad":true}`,
		`{"correo":"otra@ejemplo.test","contrasena":"corta","nombre":"Laura","mayor_de_edad":true}`,
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
	e.reloj.T = e.reloj.T.Add(time.Hour)
	if rr := post(h, "203.0.113.7", "/api/v1/cuentas", cuerpoValido); rr.Code != 202 {
		t.Fatalf("a la hora vuelve a dejar crear: %d", rr.Code)
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
