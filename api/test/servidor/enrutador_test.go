package servidor_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

type sesionFalsa struct {
	sujeto seguridad.Sujeto
	err    error
}

func (s sesionFalsa) SujetoDe(*http.Request) (seguridad.Sujeto, error) { return s.sujeto, s.err }

const personaDePrueba = "0192f3c4-0000-7000-8000-000000000001"

var alcanzado = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	// Un manejador que sí se alcanzó: devuelve lo que el guard dejó en el contexto.
	s, ok := servidor.SujetoDe(r.Context())
	servidor.EscribirJSON(w, http.StatusOK, map[string]any{"persona": seguridad.PersonaDe(r.Context()), "hay_sujeto": ok, "senuelo": s.Senuelo})
})

// api arma un Enrutador con una ruta por nivel y devuelve el manejador completo, con CSP y petición.
func api(t *testing.T, s servidor.Sesiones, salida io.Writer) http.Handler {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(salida, nil))
	e := servidor.NuevoEnrutador(s, seguridad.NuevoRegistro(log), log)
	e.Registrar(seguridad.Publica, "GET /api/v1/prueba/publica", alcanzado)
	e.Registrar(seguridad.SinVerificar, "GET /api/v1/prueba/sin-verificar", alcanzado)
	e.Registrar(seguridad.SinAutorizacion, "GET /api/v1/prueba/sin-autorizacion", alcanzado)
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/prueba/autorizada/{id}", alcanzado)
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

func TestGuardPorNivel(t *testing.T) {
	limitada := seguridad.Sujeto{Persona: personaDePrueba}
	verificada := seguridad.Sujeto{Persona: personaDePrueba, Verificada: true}
	autorizada := seguridad.Sujeto{Persona: personaDePrueba, Verificada: true, Autorizada: true}
	casos := []struct {
		nombre string
		ruta   string
		sesion sesionFalsa
		codigo int
		error  string // código de error del cuerpo; vacío si pasa
		evento string // evento_seguridad esperado; vacío si no hay
		cuenta string // cuenta esperada en el evento
		patron string // ruta (patrón) esperada en el evento
	}{
		{"pública sin sesión pasa", "/api/v1/prueba/publica", sesionFalsa{err: servidor.ErrSinSesion}, 200, "", "", "", ""},
		{"sin verificar: sin sesión da 401", "/api/v1/prueba/sin-verificar", sesionFalsa{err: servidor.ErrSinSesion}, 401, "sin_sesion", "error_autorizacion", "desconocida", "GET /api/v1/prueba/sin-verificar"},
		{"sin verificar: la sesión limitada pasa", "/api/v1/prueba/sin-verificar", sesionFalsa{sujeto: limitada}, 200, "", "", "", ""},
		{"sin verificar: la cuenta ya verificada también pasa (revisar el estado)", "/api/v1/prueba/sin-verificar", sesionFalsa{sujeto: verificada}, 200, "", "", "", ""},
		{"sin autorización: la limitada da 403 verificacion_pendiente", "/api/v1/prueba/sin-autorizacion", sesionFalsa{sujeto: limitada}, 403, "verificacion_pendiente", "acceso_denegado", personaDePrueba, "GET /api/v1/prueba/sin-autorizacion"},
		{"sin autorización: la verificada pasa", "/api/v1/prueba/sin-autorizacion", sesionFalsa{sujeto: verificada}, 200, "", "", "", ""},
		{"requiere autorización: sin sesión da 401", "/api/v1/prueba/autorizada/7", sesionFalsa{err: servidor.ErrSinSesion}, 401, "sin_sesion", "error_autorizacion", "desconocida", "GET /api/v1/prueba/autorizada/{id}"},
		{"requiere autorización: la limitada da 403 verificacion_pendiente", "/api/v1/prueba/autorizada/7", sesionFalsa{sujeto: limitada}, 403, "verificacion_pendiente", "acceso_denegado", personaDePrueba, "GET /api/v1/prueba/autorizada/{id}"},
		{"requiere autorización: verificada sin autorizar da 403 autorizacion_pendiente", "/api/v1/prueba/autorizada/7", sesionFalsa{sujeto: verificada}, 403, "autorizacion_pendiente", "acceso_denegado", personaDePrueba, "GET /api/v1/prueba/autorizada/{id}"},
		{"requiere autorización: autorizada pasa", "/api/v1/prueba/autorizada/7", sesionFalsa{sujeto: autorizada}, 200, "", "", "", ""},
		{"autorizada sin verificar (dato incoherente) no pasa", "/api/v1/prueba/autorizada/7", sesionFalsa{sujeto: seguridad.Sujeto{Persona: personaDePrueba, Autorizada: true}}, 403, "verificacion_pendiente", "acceso_denegado", personaDePrueba, "GET /api/v1/prueba/autorizada/{id}"},
		{"la sesión de mentira no pasa aunque diga estar autorizada", "/api/v1/prueba/autorizada/7", sesionFalsa{sujeto: seguridad.Sujeto{Senuelo: true, Verificada: true, Autorizada: true}}, 403, "verificacion_pendiente", "acceso_denegado", "desconocida", "GET /api/v1/prueba/autorizada/{id}"},
		{"falla la sesión: no pasa", "/api/v1/prueba/sin-verificar", sesionFalsa{err: errors.New("bd caída")}, 500, "error_interno", "", "", ""},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			var salida bytes.Buffer
			rr := httptest.NewRecorder()
			api(t, c.sesion, &salida).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, c.ruta, nil))

			if rr.Code != c.codigo {
				t.Fatalf("código %d, se esperaba %d (%s)", rr.Code, c.codigo, rr.Body)
			}
			if rr.Header().Get("Content-Security-Policy") != politicaCSP {
				t.Error("falta la CSP: debe seguir en toda respuesta")
			}
			var cuerpo map[string]any
			_ = json.Unmarshal(rr.Body.Bytes(), &cuerpo)
			if got, _ := cuerpo["error"].(string); got != c.error {
				t.Errorf("error %q, se esperaba %q", got, c.error)
			}

			lineas := strings.Split(strings.TrimSpace(salida.String()), "\n")
			if c.evento == "" {
				for _, l := range lineas {
					if strings.Contains(l, "evento_seguridad") {
						t.Fatalf("no se esperaba un evento de seguridad: %s", l)
					}
				}
				return
			}
			if len(lineas) != 1 {
				t.Fatalf("se esperaba una línea de registro: %q", salida.String())
			}
			var linea map[string]any
			if err := json.Unmarshal([]byte(lineas[0]), &linea); err != nil {
				t.Fatal(err)
			}
			if linea["evento_seguridad"] != c.evento || linea["cuenta"] != c.cuenta || linea["ruta"] != c.patron || int(linea["codigo"].(float64)) != c.codigo {
				t.Errorf("evento inesperado: %v", linea)
			}
			if p, _ := linea["peticion"].(string); len(p) != 32 {
				t.Errorf("el evento no trae el identificador de la petición: %v", linea["peticion"])
			}
		})
	}
}

func TestElManejadorRecibeElSujetoYLaPersonaDeLaSesion(t *testing.T) {
	rr := httptest.NewRecorder()
	api(t, sesionFalsa{sujeto: seguridad.Sujeto{Persona: personaDePrueba, Verificada: true, Autorizada: true}}, io.Discard).
		ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/prueba/autorizada/1", nil))
	var cuerpo map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &cuerpo)
	if cuerpo["persona"] != personaDePrueba || cuerpo["hay_sujeto"] != true {
		t.Fatalf("el manejador no recibió la persona ni el Sujeto: %s", rr.Body)
	}
}

func TestLaSesionDeMentiraNoDejaPersonaEnElContexto(t *testing.T) {
	rr := httptest.NewRecorder()
	api(t, sesionFalsa{sujeto: seguridad.Sujeto{Senuelo: true}}, io.Discard).
		ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/prueba/sin-verificar", nil))
	var cuerpo map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &cuerpo)
	if rr.Code != 200 || cuerpo["persona"] != "" || cuerpo["senuelo"] != true {
		t.Fatalf("respuesta inesperada: %d %s", rr.Code, rr.Body)
	}
}

func TestRegistroInvalidoNoArranca(t *testing.T) {
	casos := []struct {
		nombre   string
		registro func(*servidor.Enrutador)
		mensaje  string
	}{
		{"sin nivel", func(e *servidor.Enrutador) { e.Registrar(0, "GET /api/v1/x", alcanzado) }, "no declara su nivel de acceso"},
		{"nivel desconocido", func(e *servidor.Enrutador) { e.Registrar(99, "GET /api/v1/x", alcanzado) }, "no declara su nivel de acceso"},
		{"fuera de /api/", func(e *servidor.Enrutador) { e.Registrar(seguridad.Publica, "GET /v1/x", alcanzado) }, "no está bajo /api/"},
		{"la propia /api/", func(e *servidor.Enrutador) { e.Registrar(seguridad.Publica, "/api/", alcanzado) }, "no está bajo /api/"},
		{"repetida con el mismo nivel", func(e *servidor.Enrutador) {
			e.Registrar(seguridad.Publica, "GET /api/v1/x", alcanzado)
			e.Registrar(seguridad.Publica, "GET /api/v1/x", alcanzado)
		}, "está repetida"},
		{"repetida con otro nivel", func(e *servidor.Enrutador) {
			e.Registrar(seguridad.Publica, "GET /api/v1/x", alcanzado)
			e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/x", alcanzado)
		}, "está repetida"},
		{"en conflicto con otra", func(e *servidor.Enrutador) {
			e.Registrar(seguridad.Publica, "GET /api/v1/{a}/x", alcanzado)
			e.Registrar(seguridad.Publica, "GET /api/v1/y/{b}", alcanzado)
		}, "no se pudo registrar"},
		{"patrón inválido", func(e *servidor.Enrutador) { e.Registrar(seguridad.Publica, "GET /api/{x", alcanzado) }, "no se pudo registrar"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			log := slog.New(slog.NewJSONHandler(io.Discard, nil))
			e := servidor.NuevoEnrutador(servidor.SinSesiones{}, seguridad.NuevoRegistro(log), log)
			// Registrar no debe hacer panic en ningún caso: el error sale por Construir.
			c.registro(e)
			h, err := e.Construir()
			if err == nil || h != nil || !strings.Contains(err.Error(), c.mensaje) {
				t.Fatalf("se esperaba un error con %q: %v", c.mensaje, err)
			}
		})
	}
}

func TestRutasRegistradasYRutaDesconocida(t *testing.T) {
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	e := servidor.NuevoEnrutador(servidor.SinSesiones{}, seguridad.NuevoRegistro(log), log)
	e.Registrar(seguridad.Publica, "POST /api/v1/a", alcanzado)
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/b", alcanzado)
	if r := e.Rutas(); len(r) != 2 || r[0] != (servidor.Ruta{Patron: "POST /api/v1/a", Nivel: seguridad.Publica}) || r[1].Nivel != seguridad.RequiereAutorizacion {
		t.Fatalf("rutas: %+v", r)
	}
	h, _ := e.Construir()
	rr := httptest.NewRecorder()
	servidor.ManejadorConAPI(h).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/no-existe", nil))
	if rr.Code != http.StatusNotFound || !strings.Contains(rr.Body.String(), "no_encontrado") {
		t.Fatalf("una ruta sin registrar debe dar 404 JSON: %d %s", rr.Code, rr.Body)
	}
}
