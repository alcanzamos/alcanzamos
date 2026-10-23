package autenticacion_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
)

const (
	rutaRecuperacion = "/api/v1/recuperacion"
	rutaFijar        = "/api/v1/recuperacion/contrasena"
	rutaCambio       = "/api/v1/cuenta/contrasena"
	claveNueva       = "otra frase larga y rara 2027"
)

func pedirRecuperacion(e *entorno, h http.Handler, correo, origen string) (int, string) {
	rr := llamar(h, "POST", rutaRecuperacion, `{"correo":"`+correo+`"}`, origen)
	e.svc.Esperar()
	return rr.Code, strings.TrimSpace(rr.Body.String())
}

// PN-61: la respuesta es la misma con una cuenta verificada, sin cuenta y con una cuenta sin verificar; solo la primera
// manda el correo.
func TestPedirRecuperacionRespondeIgualYSoloEnviaALaCuentaVerificada(t *testing.T) {
	var vistas []string
	enviados := map[string]int{}
	for _, correo := range []string{correoDePrueba, "nadie@ejemplo.test", "sinverificar@ej.test"} {
		e := nuevoEntorno(t)
		rr := llamar(e.api(t, nil), "POST", rutaRecuperacion, `{"correo":" `+strings.ToUpper(correo)+` "}`, "203.0.113.7")
		e.svc.Esperar()
		var nombres []string
		for k := range rr.Header() {
			nombres = append(nombres, k)
		}
		vistas = append(vistas, strings.Join(append(nombres, rr.Body.String()), "|")) // el orden del mapa no importa aquí: se compara abajo ordenado
		if rr.Code != 202 || strings.TrimSpace(rr.Body.String()) != `{"estado":"enlace_enviado"}` {
			t.Fatalf("%s: %d %s", correo, rr.Code, rr.Body)
		}
		enviados[correo] = len(e.correo.Enviados())
		if correo == correoDePrueba {
			env := e.correo.Enviados()
			if len(env) != 1 || !env[0].Recuperacion || env[0].Destino != correo {
				t.Fatalf("envíos %+v", env)
			}
			huella, err := seguridad.HuellaDeToken(env[0].Token)
			if err != nil || e.repo.enlaces[string(huella)] == nil || !e.repo.enlaces[string(huella)].vence.Equal(ahoraDePrueba.Add(time.Hour)) {
				t.Errorf("el enlace guardado vence a la hora (%v)", err)
			}
		}
		if strings.Contains(e.registro.String(), correo) {
			t.Errorf("el correo no se registra: %s", e.registro)
		}
	}
	if enviados[correoDePrueba] != 1 || enviados["nadie@ejemplo.test"] != 0 || enviados["sinverificar@ej.test"] != 0 {
		t.Errorf("correos enviados %v", enviados)
	}
	if len(vistas[0]) != len(vistas[1]) || len(vistas[1]) != len(vistas[2]) {
		t.Errorf("las respuestas difieren: %q", vistas)
	}
}

func TestPedirOtroEnlaceInvalidaElAnterior(t *testing.T) {
	e := nuevoEntorno(t)
	h := e.api(t, nil)
	pedirRecuperacion(e, h, correoDePrueba, "203.0.113.7")
	pedirRecuperacion(e, h, correoDePrueba, "203.0.113.7")
	env := e.correo.Enviados()
	if len(env) != 2 {
		t.Fatalf("envíos %d", len(env))
	}
	if err := e.svc.FijarContrasena(context.Background(), env[0].Token, claveNueva); !errors.Is(err, cuenta.ErrEnlaceInvalido) {
		t.Errorf("el primero ya no sirve: %v", err)
	}
	if err := e.svc.FijarContrasena(context.Background(), env[1].Token, claveNueva); err != nil {
		t.Errorf("el segundo sí: %v", err)
	}
}

// D-136 (4): 3 pedidos por hora por correo y 20 por origen; el 429 es idéntico exista o no la cuenta.
func TestRecuperacionLimitaPorCuentaYPorOrigen(t *testing.T) {
	var cuerpos []string
	for _, correo := range []string{correoDePrueba, "nadie@ejemplo.test"} {
		e := nuevoEntorno(t)
		h := e.api(t, nil)
		for i := range 3 {
			if c, _ := pedirRecuperacion(e, h, correo, "203.0.113."+string(rune('1'+i))); c != 202 {
				t.Fatalf("pedido %d: %d", i+1, c)
			}
		}
		c, b := pedirRecuperacion(e, h, correo, "203.0.113.50")
		cuerpos = append(cuerpos, b)
		if c != 429 || b != `{"error":"demasiados_intentos"}` {
			t.Fatalf("%s: %d %s", correo, c, b)
		}
		e.reloj.T = e.reloj.T.Add(time.Hour)
		if c, _ := pedirRecuperacion(e, h, correo, "203.0.113.50"); c != 202 {
			t.Errorf("pasada la hora se puede pedir de nuevo: %d", c)
		}
	}
	if cuerpos[0] != cuerpos[1] {
		t.Error("el 429 debe ser idéntico")
	}
	e := nuevoEntorno(t)
	h := e.api(t, nil)
	for i := range 20 {
		if c, _ := pedirRecuperacion(e, h, "u"+strings.Repeat("x", i)+"@ejemplo.test", "203.0.113.7"); c != 202 {
			t.Fatalf("pedido %d: %d", i+1, c)
		}
	}
	if c, _ := pedirRecuperacion(e, h, "otro@ejemplo.test", "203.0.113.7"); c != 429 {
		t.Errorf("el origen se frena al 21: %d", c)
	}
}

// D-140: con 3 correos ya mandados a la dirección esta hora, el pedido responde igual y no manda otro.
func TestRecuperacionRespetaLosTresCorreosPorHoraALaDireccion(t *testing.T) {
	e := nuevoEntorno(t)
	for range 3 {
		e.limitador.PermitirCorreo(correoDePrueba)
	}
	if c, b := pedirRecuperacion(e, e.api(t, nil), correoDePrueba, "203.0.113.7"); c != 202 || b != `{"estado":"enlace_enviado"}` {
		t.Fatalf("%d %s", c, b)
	}
	if n := len(e.correo.Enviados()); n != 0 {
		t.Errorf("no debe salir un cuarto correo: %d", n)
	}
}

func TestPedirRecuperacionConCorreoMalEscrito(t *testing.T) {
	for correo, codigo := range map[string]string{"": "correo_vacio", "sin-arroba": "correo_invalido"} {
		e := nuevoEntorno(t)
		rr := llamar(e.api(t, nil), "POST", rutaRecuperacion, `{"correo":"`+correo+`"}`, "203.0.113.7")
		want := `{"campos":{"correo":"` + codigo + `"},"error":"validacion"}`
		if rr.Code != 422 || strings.TrimSpace(rr.Body.String()) != want {
			t.Errorf("%q: %d %s", correo, rr.Code, rr.Body)
		}
	}
}

func enlaceNuevo(t *testing.T, e *entorno) string {
	t.Helper()
	pedirRecuperacion(e, e.api(t, nil), correoDePrueba, "203.0.113.7")
	return e.correo.Enviados()[len(e.correo.Enviados())-1].Token
}

func TestFijarContrasenaConElEnlace(t *testing.T) {
	e := nuevoEntorno(t)
	token := enlaceNuevo(t, e)
	rr := llamar(e.api(t, nil), "POST", rutaFijar, `{"token":"`+token+`","contrasena":"`+claveNueva+`"}`, "203.0.113.7")
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"contrasena_cambiada"}` || rr.Header().Get("Set-Cookie") != "" {
		t.Fatalf("%d %s %v", rr.Code, rr.Body, rr.Header())
	}
	if len(e.repo.sesiones) != 0 {
		t.Error("no inicia sesión")
	}
	if len(e.repo.fijadas) != 1 || e.repo.fijadas[0] != "$argon2id$falso$"+claveNueva {
		t.Errorf("hash guardado %v", e.repo.fijadas)
	}
	// Un solo uso.
	rr = llamar(e.api(t, nil), "POST", rutaFijar, `{"token":"`+token+`","contrasena":"`+claveNueva+`"}`, "203.0.113.7")
	if rr.Code != 400 || strings.TrimSpace(rr.Body.String()) != `{"error":"enlace_invalido"}` {
		t.Errorf("segundo uso: %d %s", rr.Code, rr.Body)
	}
}

func TestFijarContrasenaConUnEnlaceQueNoSirve(t *testing.T) {
	desconocido, _ := seguridad.NuevoTokenOpaco()
	casos := map[string]func(e *entorno, token string) string{
		"inexistente": func(*entorno, string) string { return desconocido },
		"mal formado": func(*entorno, string) string { return "basura" },
		"vacío":       func(*entorno, string) string { return "" },
		"vencido": func(e *entorno, token string) string {
			e.reloj.T = e.reloj.T.Add(time.Hour) // vence a la hora exacta
			return token
		},
	}
	for nombre, preparar := range casos {
		t.Run(nombre, func(t *testing.T) {
			e := nuevoEntorno(t)
			token := preparar(e, enlaceNuevo(t, e))
			hashes := e.hasher.hashes
			rr := llamar(e.api(t, nil), "POST", rutaFijar, `{"token":"`+token+`","contrasena":"`+claveNueva+`"}`, "203.0.113.7")
			if rr.Code != 400 || strings.TrimSpace(rr.Body.String()) != `{"error":"enlace_invalido"}` {
				t.Fatalf("%d %s", rr.Code, rr.Body)
			}
			if e.hasher.hashes != hashes || len(e.repo.fijadas) != 0 {
				t.Error("un enlace que no sirve no calcula ni guarda nada")
			}
		})
	}
}

// PN-62 + D-142: la política se aplica con el correo de la cuenta y el enlace no se gasta si la contraseña no sirve.
func TestFijarContrasenaAplicaLaPoliticaYNoGastaElEnlace(t *testing.T) {
	casos := map[string]string{
		"":                                 "contrasena_vacia",
		"corta":                            "contrasena_corta",
		"la clave de laura es larga larga": "contrasena_personal",
		"aaaaaaaaaaaaaaaaaaaa":             "contrasena_comun",
	}
	e := nuevoEntorno(t)
	token := enlaceNuevo(t, e)
	for contrasena, codigo := range casos {
		cuerpo, _ := json.Marshal(map[string]string{"token": token, "contrasena": contrasena})
		rr := llamar(e.api(t, nil), "POST", rutaFijar, string(cuerpo), "203.0.113.7")
		want := `{"campos":{"contrasena":"` + codigo + `"},"error":"validacion"}`
		if rr.Code != 422 || strings.TrimSpace(rr.Body.String()) != want {
			t.Errorf("%q: %d %s", contrasena, rr.Code, rr.Body)
		}
	}
	if len(e.repo.fijadas) != 0 {
		t.Fatal("no se guardó nada")
	}
	if err := e.svc.FijarContrasena(context.Background(), token, claveNueva); err != nil {
		t.Errorf("el enlace sigue vigente: %v", err)
	}
}

func cuerpoCambio(actual, nueva string) string {
	b, _ := json.Marshal(map[string]string{"contrasena_actual": actual, "contrasena_nueva": nueva})
	return string(b)
}

func (e *entorno) cambiar(t *testing.T, cuerpo, token string) (int, string) {
	t.Helper()
	h := e.api(t, &seguridad.Sujeto{Persona: personaDePrueba, Verificada: true, Autorizada: true})
	rr := llamar(h, "POST", rutaCambio, cuerpo, "203.0.113.7", "Cookie", sesion.NombreDeLaCookie+"="+token)
	return rr.Code, strings.TrimSpace(rr.Body.String())
}

func TestCambiarContrasenaConservaLaSesionActual(t *testing.T) {
	e := nuevoEntorno(t)
	token, huella := seguridad.NuevoTokenOpaco()
	c, b := e.cambiar(t, cuerpoCambio(claveDePrueba, claveNueva), token)
	if c != 200 || b != `{"estado":"contrasena_cambiada"}` {
		t.Fatalf("%d %s", c, b)
	}
	if len(e.repo.cambios) != 1 {
		t.Fatalf("cambios %v", e.repo.cambios)
	}
	cambio := e.repo.cambios[0]
	if cambio.persona != personaDePrueba || cambio.hash != "$argon2id$falso$"+claveNueva || string(cambio.conservar) != string(huella) {
		t.Errorf("cambio %+v", cambio)
	}
	if e.hasher.verificadas != 1 {
		t.Errorf("Argon2id verificó %d veces la de ahora", e.hasher.verificadas)
	}
}

// D-136: una contraseña de ahora mal escrita es un 400 con evento y cuenta en el límite por cuenta, el mismo del inicio
// de sesión; al quinto fallo, 429 aunque la contraseña ahora sea la correcta.
func TestLaContrasenaActualIncorrectaCuentaComoFalloDeIngreso(t *testing.T) {
	e := nuevoEntorno(t)
	token, _ := seguridad.NuevoTokenOpaco()
	for i := range 5 {
		c, b := e.cambiar(t, cuerpoCambio("no es esa contraseña", claveNueva), token)
		if c != 400 || b != `{"error":"contrasena_actual_incorrecta"}` {
			t.Fatalf("fallo %d: %d %s", i+1, c, b)
		}
	}
	log := e.registro.String()
	if n := strings.Count(log, `"evento_seguridad":"inicio_sesion_fallido"`); n != 5 || !strings.Contains(log, `"cuenta":"`+personaDePrueba+`"`) || !strings.Contains(log, `"codigo":400`) {
		t.Errorf("eventos: %d en %s", n, log)
	}
	if strings.Contains(log, "no es esa contraseña") || strings.Contains(log, claveNueva) {
		t.Error("el registro no lleva contraseñas")
	}
	c, b := e.cambiar(t, cuerpoCambio(claveDePrueba, claveNueva), token)
	if c != 429 || b != `{"error":"demasiados_intentos"}` || len(e.repo.cambios) != 0 {
		t.Errorf("sexto intento: %d %s", c, b)
	}
	if !strings.Contains(e.registro.String(), `"codigo":429`) {
		t.Error("el intento frenado también deja su evento")
	}
	// Los fallos de PN-73 son los mismos del inicio de sesión: la cuenta ya no puede entrar tampoco.
	if _, err := e.svc.IniciarSesion(context.Background(), correoDePrueba, claveDePrueba, "198.51.100.1"); !errors.Is(err, autenticacion.ErrDemasiadosIntentos) {
		t.Errorf("el inicio de sesión comparte el contador: %v", err)
	}
}

func TestCambiarContrasenaValidaLosCampos(t *testing.T) {
	casos := []struct{ actual, nueva, campos string }{
		{"", claveNueva, `{"contrasena_actual":"contrasena_vacia"}`},
		{claveDePrueba, "", `{"contrasena_nueva":"contrasena_vacia"}`},
		{claveDePrueba, "corta", `{"contrasena_nueva":"contrasena_corta"}`},
		{claveDePrueba, "aaaaaaaaaaaaaaaaaaaa", `{"contrasena_nueva":"contrasena_comun"}`},
		{claveDePrueba, "frase con laura@ejemplo.test dentro", `{"contrasena_nueva":"contrasena_personal"}`},
	}
	for _, c := range casos {
		e := nuevoEntorno(t)
		token, _ := seguridad.NuevoTokenOpaco()
		code, body := e.cambiar(t, cuerpoCambio(c.actual, c.nueva), token)
		if code != 422 || body != `{"campos":`+c.campos+`,"error":"validacion"}` || len(e.repo.cambios) != 0 {
			t.Errorf("%q/%q: %d %s", c.actual, c.nueva, code, body)
		}
	}
}
