package autenticacion_test

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
)

const rutaSesiones = "/api/v1/sesiones"

func cuerpoDe(t *testing.T, cuerpo string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(cuerpo), &m); err != nil {
		t.Fatalf("%q: %v", cuerpo, err)
	}
	return m
}

func TestIniciarSesionEnLaWebDaLaCookie(t *testing.T) {
	e := nuevoEntorno(t)
	rr := llamar(e.api(t, nil), "POST", rutaSesiones, entrar(correoDePrueba, claveDePrueba), "203.0.113.7")
	if rr.Code != 200 || rr.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %v", rr.Code, rr.Header())
	}
	if m := cuerpoDe(t, rr.Body.String()); m["estado"] != "activa" || m["token"] != nil || len(m) != 1 {
		t.Errorf("cuerpo %s", rr.Body)
	}
	cs := rr.Result().Cookies()
	if len(cs) != 1 || cs[0].Name != "__Host-sesion" || !cs[0].HttpOnly || !cs[0].Secure || cs[0].SameSite != http.SameSiteStrictMode || cs[0].Path != "/" {
		t.Fatalf("cookie %+v", cs)
	}
	if h, err := seguridad.HuellaDeToken(cs[0].Value); err != nil || string(h) != string(e.repo.sesiones[0].huella) {
		t.Error("la cookie lleva el token de la sesión guardada")
	}
}

func TestIniciarSesionEnAndroidDaElTokenEnElCuerpo(t *testing.T) {
	e := nuevoEntorno(t)
	rr := llamar(e.api(t, nil), "POST", rutaSesiones, entrar("sinverificar@ej.test", claveDePrueba), "203.0.113.7", "X-Alcanzamos-Cliente", "android")
	m := cuerpoDe(t, rr.Body.String())
	if rr.Code != 200 || m["estado"] != "verificacion_pendiente" || len(rr.Result().Cookies()) != 0 {
		t.Fatalf("%d %s %v", rr.Code, rr.Body, rr.Header())
	}
	if _, err := seguridad.HuellaDeToken(m["token"].(string)); err != nil {
		t.Errorf("token %v", m["token"])
	}
}

// D-143 (3): el modo Android se rechaza si el pedido trae cabeceras de navegador, sin sesión ni token.
func TestAndroidConCabecerasDeNavegadorSeRechaza(t *testing.T) {
	for _, cabecera := range []string{"Origin", "Sec-Fetch-Site"} {
		e := nuevoEntorno(t)
		rr := llamar(e.api(t, nil), "POST", rutaSesiones, entrar(correoDePrueba, claveDePrueba), "203.0.113.7",
			"X-Alcanzamos-Cliente", "android", cabecera, "https://otro.test")
		if rr.Code != 400 || strings.TrimSpace(rr.Body.String()) != `{"error":"solicitud_invalida"}` || len(e.repo.sesiones) != 0 || rr.Header().Get("Set-Cookie") != "" {
			t.Errorf("%s: %d %s", cabecera, rr.Code, rr.Body)
		}
	}
}

// El 401 de una cuenta que no existe, el de la contraseña mal y el de un identificador que no es un correo son idénticos
// (estado, cabeceras y cuerpo), y cada uno deja el evento inicio_sesion_fallido sin cuenta.
func TestElFalloEsIdenticoYDejaSuEvento(t *testing.T) {
	var vistos []string
	for _, ident := range []string{correoDePrueba, "nadie@ejemplo.test", "laura_menor"} {
		e := nuevoEntorno(t)
		rr := llamar(e.api(t, nil), "POST", rutaSesiones, entrar(ident, "mal"), "203.0.113.7")
		nombres := make([]string, 0)
		for k := range rr.Header() {
			nombres = append(nombres, k)
		}
		sort.Strings(nombres)
		vistos = append(vistos, strings.Join(append(nombres, rr.Body.String()), "|"))
		if rr.Code != 401 || strings.TrimSpace(rr.Body.String()) != `{"error":"credenciales_invalidas"}` {
			t.Fatalf("%s: %d %s", ident, rr.Code, rr.Body)
		}
		log := e.registro.String()
		for _, quiere := range []string{`"evento_seguridad":"inicio_sesion_fallido"`, `"cuenta":"desconocida"`, `"codigo":401`, `"ruta":"POST /api/v1/sesiones"`} {
			if !strings.Contains(log, quiere) {
				t.Errorf("%s: falta %s en %s", ident, quiere, log)
			}
		}
		if strings.Contains(log, ident) || strings.Contains(log, "203.0.113.7") {
			t.Errorf("el evento no lleva el identificador ni el origen: %s", log)
		}
	}
	if vistos[0] != vistos[1] || vistos[1] != vistos[2] {
		t.Errorf("las respuestas difieren:\n%s\n%s\n%s", vistos[0], vistos[1], vistos[2])
	}
}

// D-136 (2) y (3): el sexto intento da 429, el mismo cuerpo exista o no la cuenta, y cada intento frenado deja su evento.
func TestElSextoIntentoDa429IgualExistaONoLaCuentaYDejaEvento(t *testing.T) {
	var cuerpos []string
	for _, ident := range []string{correoDePrueba, "nadie@ejemplo.test"} {
		e := nuevoEntorno(t)
		h := e.api(t, nil)
		for range 5 {
			if rr := llamar(h, "POST", rutaSesiones, entrar(ident, "mal"), "203.0.113.7"); rr.Code != 401 {
				t.Fatalf("%d", rr.Code)
			}
		}
		antes := strings.Count(e.registro.String(), "inicio_sesion_fallido")
		rr := llamar(h, "POST", rutaSesiones, entrar(ident, claveDePrueba), "203.0.113.7")
		cuerpos = append(cuerpos, rr.Body.String())
		if rr.Code != 429 || strings.TrimSpace(rr.Body.String()) != `{"error":"demasiados_intentos"}` {
			t.Fatalf("%s: %d %s", ident, rr.Code, rr.Body)
		}
		llamar(h, "POST", rutaSesiones, entrar(ident, claveDePrueba), "203.0.113.7")
		log := e.registro.String()
		if n := strings.Count(log, "inicio_sesion_fallido"); n != antes+2 || !strings.Contains(log, `"codigo":429`) {
			t.Errorf("cada intento frenado deja un evento (antes %d, ahora %d): %s", antes, n, log)
		}
	}
	if cuerpos[0] != cuerpos[1] {
		t.Error("el 429 debe ser idéntico exista o no la cuenta")
	}
}

func TestIniciarSesionRechazaCuerposMalos(t *testing.T) {
	casos := []struct {
		cuerpo         string
		codigo         int
		cuerpoEsperado string
	}{
		{`{"identificador":"","contrasena":""}`, 422, `{"campos":{"contrasena":"contrasena_vacia","identificador":"identificador_vacio"},"error":"validacion"}`},
		{`{"correo":"a@b.co","contrasena":"x"}`, 400, `{"error":"solicitud_invalida"}`},
		{`{`, 400, `{"error":"solicitud_invalida"}`},
	}
	for _, c := range casos {
		e := nuevoEntorno(t)
		rr := llamar(e.api(t, nil), "POST", rutaSesiones, c.cuerpo, "203.0.113.7")
		if rr.Code != c.codigo || strings.TrimSpace(rr.Body.String()) != c.cuerpoEsperado {
			t.Errorf("%s: %d %s", c.cuerpo, rr.Code, rr.Body)
		}
	}
}

func TestCerrarSesionBorraLaFilaYLaCookie(t *testing.T) {
	e := nuevoEntorno(t)
	token, huella := seguridad.NuevoTokenOpaco()
	h := e.api(t, &seguridad.Sujeto{Persona: personaDePrueba})
	rr := llamar(h, "DELETE", "/api/v1/sesiones/actual", "", "203.0.113.7", "Cookie", sesion.NombreDeLaCookie+"="+token)
	if rr.Code != 204 || len(e.repo.cerradas) != 1 || string(e.repo.cerradas[0]) != string(huella) {
		t.Fatalf("%d %v", rr.Code, e.repo.cerradas)
	}
	set := rr.Header().Get("Set-Cookie")
	for _, quiere := range []string{"__Host-sesion=", "Max-Age=0", "Path=/", "HttpOnly", "Secure", "SameSite=Strict"} {
		if !strings.Contains(set, quiere) {
			t.Errorf("la cookie debe llevar %q: %s", quiere, set)
		}
	}
	// Sin sesión: 401.
	if rr := llamar(e.api(t, nil), "DELETE", "/api/v1/sesiones/actual", "", "203.0.113.7"); rr.Code != 401 {
		t.Errorf("sin sesión: %d", rr.Code)
	}
}

// La sesión de mentira cierra igual que una limitada real (D-141): mismo estado, mismas cabeceras y mismo cuerpo.
func TestCerrarSesionDeMentiraRespondeIgual(t *testing.T) {
	token, _ := seguridad.NuevoTokenOpaco()
	respuesta := func(s seguridad.Sujeto) (int, string, string) {
		e := nuevoEntorno(t)
		rr := llamar(e.api(t, &s), "DELETE", "/api/v1/sesiones/actual", "", "203.0.113.7", "Authorization", "Bearer "+token)
		return rr.Code, rr.Header().Get("Set-Cookie") + "|" + rr.Header().Get("Cache-Control"), rr.Body.String()
	}
	c1, h1, b1 := respuesta(seguridad.Sujeto{Persona: personaDePrueba})
	c2, h2, b2 := respuesta(seguridad.Sujeto{Senuelo: true})
	if c1 != 204 || c1 != c2 || h1 != h2 || b1 != b2 {
		t.Errorf("limitada %d %s %q; de mentira %d %s %q", c1, h1, b1, c2, h2, b2)
	}
}

func TestSeguridadDaElIngresoAnteriorEnUTC(t *testing.T) {
	e := nuevoEntorno(t)
	h := e.api(t, &seguridad.Sujeto{Persona: personaDePrueba, Verificada: true, Autorizada: true})
	rr := llamar(h, "GET", "/api/v1/cuenta/seguridad", "", "203.0.113.7")
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"ingreso_anterior":null}` {
		t.Fatalf("primer ingreso: %d %s", rr.Code, rr.Body)
	}
	bogota := time.FixedZone("Bogota", -5*3600)
	t0 := time.Date(2026, 11, 1, 21, 40, 0, 0, bogota)
	e.repo.anterior = &t0
	rr = llamar(h, "GET", "/api/v1/cuenta/seguridad", "", "203.0.113.7")
	if strings.TrimSpace(rr.Body.String()) != `{"ingreso_anterior":"2026-11-02T02:40:00Z"}` {
		t.Errorf("cuerpo %s", rr.Body)
	}
	// Sin autorizar: 403, sin leer nada.
	rr = llamar(e.api(t, &seguridad.Sujeto{Persona: personaDePrueba, Verificada: true}), "GET", "/api/v1/cuenta/seguridad", "", "203.0.113.7")
	if rr.Code != 403 || !strings.Contains(rr.Body.String(), "autorizacion_pendiente") {
		t.Errorf("sin autorizar: %d %s", rr.Code, rr.Body)
	}
}
