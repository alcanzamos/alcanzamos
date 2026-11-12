package autorizacion_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

const personaDeLosTokens = "0192f3c4-0000-7000-8000-0000000000aa"

var ahoraDeLosTokens = time.Date(2026, 11, 12, 15, 0, 0, 0, time.UTC)

type registroDeToken struct {
	persona, dispositivo, token string
	ahora                       time.Time
}

// repoDeTokensFalso guarda lo que el servicio le pide y devuelve el error que se le fije.
type repoDeTokensFalso struct {
	mu        sync.Mutex
	registros []registroDeToken
	err       error
}

func (r *repoDeTokensFalso) Registrar(_ context.Context, persona, dispositivo, token string, ahora time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return r.err
	}
	r.registros = append(r.registros, registroDeToken{persona, dispositivo, token, ahora})
	return nil
}

type almacenDeTokensFalso map[string]seguridad.Sujeto

func (a almacenDeTokensFalso) Sujeto(_ context.Context, huella []byte, _ time.Time) (seguridad.Sujeto, error) {
	if s, ok := a[string(huella)]; ok {
		return s, nil
	}
	return seguridad.Sujeto{}, seguridad.ErrSinSesion
}

type entornoDeTokens struct {
	api     http.Handler
	repo    *repoDeTokensFalso
	almacen almacenDeTokensFalso
	eventos *bytes.Buffer
}

func nuevoEntornoDeTokens(t *testing.T) *entornoDeTokens {
	t.Helper()
	e := &entornoDeTokens{repo: &repoDeTokensFalso{}, almacen: almacenDeTokensFalso{}, eventos: &bytes.Buffer{}}
	log := slog.New(slog.NewJSONHandler(e.eventos, nil))
	reloj := &relojtest.Fijo{T: ahoraDeLosTokens}
	enr := servidor.NuevoEnrutador(sesion.NuevoResolutor(e.almacen, reloj), seguridad.NuevoRegistro(log), log)
	autorizacion.NuevoHandlerDeTokens(autorizacion.NuevoServicioDeTokens(e.repo, reloj), seguridad.NuevoRegistro(log), log).Registrar(enr)
	h, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	e.api = csrftest.ConCabeceras(servidor.ManejadorConAPI(h))
	return e
}

func (e *entornoDeTokens) sesion(s seguridad.Sujeto) string {
	token, huella := seguridad.NuevoTokenOpaco()
	e.almacen[string(huella)] = s
	return token
}

var (
	sinAutorizarT = seguridad.Sujeto{Persona: personaDeLosTokens, Verificada: true}
	autorizadaT   = seguridad.Sujeto{Persona: personaDeLosTokens, Verificada: true, Autorizada: true}
	sinVerificarT = seguridad.Sujeto{Persona: personaDeLosTokens}
)

func (e *entornoDeTokens) pedir(metodo, rutaDelToken, cuerpo, token string, android bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(metodo, rutaDelToken, strings.NewReader(cuerpo))
	switch {
	case token == "":
	case android:
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set(sesion.EncabezadoDeCliente, sesion.ClienteAndroid)
	default:
		r.AddCookie(sesion.Cookie(token))
	}
	rr := httptest.NewRecorder()
	e.api.ServeHTTP(rr, r)
	return rr
}

func cuerpoDeT(rr *httptest.ResponseRecorder) string { return strings.TrimSpace(rr.Body.String()) }

const rutaDelToken = "/api/v1/dispositivos/instalacion-1/token"

// SC-E21-25, criterio 10 (a): con `avisos` vigente el registro guarda el token del dispositivo de la persona de la sesión.
func TestRegistrarElTokenGuardaElDeLaSesion(t *testing.T) {
	for _, android := range []bool{false, true} {
		e := nuevoEntornoDeTokens(t)
		rr := e.pedir("PUT", rutaDelToken, `{"token":"fcm-abc"}`, e.sesion(autorizadaT), android)
		if rr.Code != 204 || rr.Body.Len() != 0 || rr.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("android=%v: %d %q %v", android, rr.Code, rr.Body, rr.Header())
		}
		want := registroDeToken{personaDeLosTokens, "instalacion-1", "fcm-abc", ahoraDeLosTokens}
		if len(e.repo.registros) != 1 || e.repo.registros[0] != want {
			t.Errorf("android=%v: registros %+v, se esperaba %+v", android, e.repo.registros, want)
		}
	}
}

// Sin `avisos` vigente el API rechaza con 403 y no guarda nada; deja el evento `acceso_denegado` (criterio 10).
func TestRegistrarElTokenSinAvisosEsUn403ConEvento(t *testing.T) {
	e := nuevoEntornoDeTokens(t)
	e.repo.err = autorizacion.ErrSinAutorizacionDeAvisos
	rr := e.pedir("PUT", rutaDelToken, `{"token":"fcm-abc"}`, e.sesion(autorizadaT), false)
	if rr.Code != 403 || cuerpoDeT(rr) != `{"error":"avisos_no_autorizados"}` {
		t.Fatalf("%d %s", rr.Code, cuerpoDeT(rr))
	}
	if len(e.repo.registros) != 0 {
		t.Error("no debe guardar nada")
	}
	for _, quiere := range []string{`"evento_seguridad":"acceso_denegado"`, `"cuenta":"` + personaDeLosTokens + `"`,
		`"ruta":"PUT /api/v1/dispositivos/{dispositivo_id}/token"`, `"codigo":403`} {
		if !strings.Contains(e.eventos.String(), quiere) {
			t.Errorf("falta %s en el evento: %s", quiere, e.eventos)
		}
	}
	if strings.Contains(e.eventos.String(), "fcm-abc") || strings.Contains(e.eventos.String(), "instalacion-1") {
		t.Errorf("el token y el dispositivo no van al registro: %s", e.eventos)
	}
}

// La ruta es `requiere_autorizacion`: sin sesión 401; sin verificar o sin autorizar lo necesario, 403, sin llegar al repositorio.
func TestRegistrarElTokenExigeSesionYAutorizacion(t *testing.T) {
	e := nuevoEntornoDeTokens(t)
	if rr := e.pedir("PUT", rutaDelToken, `{"token":"t"}`, "", false); rr.Code != 401 || cuerpoDeT(rr) != `{"error":"sin_sesion"}` {
		t.Errorf("sin sesión: %d %s", rr.Code, cuerpoDeT(rr))
	}
	if rr := e.pedir("PUT", rutaDelToken, `{"token":"t"}`, e.sesion(sinVerificarT), false); rr.Code != 403 || cuerpoDeT(rr) != `{"error":"verificacion_pendiente"}` {
		t.Errorf("sin verificar: %d %s", rr.Code, cuerpoDeT(rr))
	}
	if rr := e.pedir("PUT", rutaDelToken, `{"token":"t"}`, e.sesion(sinAutorizarT), false); rr.Code != 403 || cuerpoDeT(rr) != `{"error":"autorizacion_pendiente"}` {
		t.Errorf("sin autorizar: %d %s", rr.Code, cuerpoDeT(rr))
	}
	if len(e.repo.registros) != 0 {
		t.Error("ninguna debía llegar al repositorio")
	}
}

// Lo que no cabe en `token_dispositivo` (E13: dispositivo de 1 a 64 y token de 1 a 2048 caracteres) es una solicitud
// inválida y no llega al repositorio.
func TestRegistrarElTokenConDatosInvalidosEsUn400(t *testing.T) {
	casos := []struct{ nombre, ruta, cuerpo string }{
		{"token vacío", rutaDelToken, `{"token":""}`},
		{"sin token", rutaDelToken, `{}`},
		{"token de 2049", rutaDelToken, `{"token":"` + strings.Repeat("a", 2049) + `"}`},
		{"dispositivo de 65", "/api/v1/dispositivos/" + strings.Repeat("d", 65) + "/token", `{"token":"t"}`},
		{"campo que no está en el contrato", rutaDelToken, `{"token":"t","persona":"x"}`},
		{"JSON roto", rutaDelToken, `{"token":`},
		{"token con NUL", rutaDelToken, `{"token":"\u0000"}`},
		{"token de solo un salto de línea", rutaDelToken, `{"token":"\n"}`},
		{"token con espacio al final", rutaDelToken, `{"token":"abc "}`},
		{"token con letras fuera de ASCII", rutaDelToken, `{"token":"tökén"}`},
		{"dispositivo con NUL", "/api/v1/dispositivos/bad%00device/token", `{"token":"t"}`},
		{"dispositivo de solo un espacio", "/api/v1/dispositivos/%20/token", `{"token":"t"}`},
		{"dispositivo con barra", "/api/v1/dispositivos/bad%2Fdevice/token", `{"token":"t"}`},
	}
	for _, c := range casos {
		e := nuevoEntornoDeTokens(t)
		rr := e.pedir("PUT", c.ruta, c.cuerpo, e.sesion(autorizadaT), false)
		if rr.Code != 400 || cuerpoDeT(rr) != `{"error":"solicitud_invalida"}` || len(e.repo.registros) != 0 {
			t.Errorf("%s: %d %s, registros %+v", c.nombre, rr.Code, cuerpoDeT(rr), e.repo.registros)
		}
	}
	// Los límites caben: 2048 y 64 son válidos.
	e := nuevoEntornoDeTokens(t)
	rr := e.pedir("PUT", "/api/v1/dispositivos/"+strings.Repeat("d", 64)+"/token", `{"token":"`+strings.Repeat("a", 2048)+`"}`, e.sesion(autorizadaT), false)
	if rr.Code != 204 || len(e.repo.registros) != 1 {
		t.Errorf("en el límite: %d %s", rr.Code, cuerpoDeT(rr))
	}
}

func TestRegistrarElTokenConErroresDelRepositorio(t *testing.T) {
	e := nuevoEntornoDeTokens(t)
	e.repo.err = errors.New("base caída")
	if rr := e.pedir("PUT", rutaDelToken, `{"token":"t"}`, e.sesion(autorizadaT), false); rr.Code != 500 || cuerpoDeT(rr) != `{"error":"error_interno"}` {
		t.Errorf("fallo de la base: %d %s", rr.Code, cuerpoDeT(rr))
	}
	e.repo.err = autorizacion.ErrSinCuenta
	if rr := e.pedir("PUT", rutaDelToken, `{"token":"t"}`, e.sesion(autorizadaT), false); rr.Code != 401 || cuerpoDeT(rr) != `{"error":"sin_sesion"}` {
		t.Errorf("cuenta borrada: %d %s", rr.Code, cuerpoDeT(rr))
	}
}
