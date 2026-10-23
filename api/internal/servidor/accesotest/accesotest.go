// Package accesotest es el ayudante de pruebas del acceso negado por defecto (RNF-012, D-138): para cada ruta
// registrada en un Enrutador comprueba que su nivel está declarado y que responde el estado que le toca a cada clase
// de Sujeto. Una ruta nueva entra sola a la prueba al registrarse; no hay que añadirla a una lista.
//
// Las rutas se prueban con un manejador de relleno que responde 200: lo que se verifica es el guard, no el manejador
// (cada manejador tiene sus propias pruebas). El guard es el mismo código que usa el servidor.
package accesotest

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
)

// Clase de Sujeto que se prueba en cada ruta.
type Clase string

const (
	SinSesion              Clase = "sin sesión"
	Limitada               Clase = "sesión limitada (cuenta sin verificar)"
	Senuelo                Clase = "sesión de mentira (D-141)"
	VerificadaSinAutorizar Clase = "cuenta verificada sin autorizar"
	Autorizada             Clase = "cuenta verificada y autorizada"
)

// Clases son todas las clases de Sujeto, en orden de menos a más acceso.
var Clases = []Clase{SinSesion, Limitada, Senuelo, VerificadaSinAutorizar, Autorizada}

const personaDePrueba = "0192f3c4-0000-7000-8000-0000000000aa"

// Resultado es lo que se espera de una ruta para una clase: el estado y, si es una negación, el código de error.
type Resultado struct {
	Estado int
	Error  string
}

// Esperado dice qué debe responder una ruta del nivel dado a cada clase de Sujeto (D-138):
//
//	nivel                   sin sesión  limitada / mentira            verificada sin autorizar       autorizada
//	publica                 200         200                           200                            200
//	sin_verificar           401         200                           200                            200
//	sin_autorizacion        401         403 verificacion_pendiente    200                            200
//	requiere_autorizacion   401         403 verificacion_pendiente    403 autorizacion_pendiente     200
func Esperado(n seguridad.NivelDeAcceso, c Clase) Resultado {
	pasa := Resultado{Estado: http.StatusOK}
	sinSesion := Resultado{http.StatusUnauthorized, servidor.CodigoSinSesion}
	sinVerificar := Resultado{http.StatusForbidden, servidor.CodigoVerificacionPendiente}
	sinAutorizar := Resultado{http.StatusForbidden, servidor.CodigoAutorizacionPendiente}
	switch n {
	case seguridad.Publica:
		return pasa
	case seguridad.SinVerificar:
		if c == SinSesion {
			return sinSesion
		}
		return pasa
	case seguridad.SinAutorizacion:
		switch c {
		case SinSesion:
			return sinSesion
		case Limitada, Senuelo:
			return sinVerificar
		}
		return pasa
	case seguridad.RequiereAutorizacion:
		switch c {
		case SinSesion:
			return sinSesion
		case Limitada, Senuelo:
			return sinVerificar
		case VerificadaSinAutorizar:
			return sinAutorizar
		}
		return pasa
	}
	return Resultado{Estado: -1}
}

func sujetoDe(c Clase) (seguridad.Sujeto, bool) {
	switch c {
	case Limitada:
		return seguridad.Sujeto{Persona: personaDePrueba}, true
	case Senuelo:
		return seguridad.Sujeto{Senuelo: true}, true
	case VerificadaSinAutorizar:
		return seguridad.Sujeto{Persona: personaDePrueba, Verificada: true}, true
	case Autorizada:
		return seguridad.Sujeto{Persona: personaDePrueba, Verificada: true, Autorizada: true}, true
	}
	return seguridad.Sujeto{}, false
}

type sesionDePrueba Clase

func (s sesionDePrueba) SujetoDe(*http.Request) (seguridad.Sujeto, error) {
	if sujeto, ok := sujetoDe(Clase(s)); ok {
		return sujeto, nil
	}
	return seguridad.Sujeto{}, servidor.ErrSinSesion
}

var comodin = regexp.MustCompile(`\{[^}]*\}`)

// ProbarRutas recorre rutas (las de Enrutador.Rutas) y, para cada una y cada clase de Sujeto, hace la petición y
// compara con Esperado. Falla si no hay ninguna ruta (una lista vacía no prueba nada), si el nivel no es uno de los
// cuatro, o si una negación no deja su evento de seguridad.
func ProbarRutas(t *testing.T, rutas []servidor.Ruta) {
	t.Helper()
	if len(rutas) == 0 {
		t.Fatal("no hay rutas que probar")
	}
	for _, ruta := range rutas {
		if !ruta.Nivel.Valido() {
			t.Errorf("la ruta %q no declara un nivel de acceso", ruta.Patron)
			continue
		}
		metodo, camino, ok := strings.Cut(ruta.Patron, " ")
		if !ok {
			metodo, camino = http.MethodGet, ruta.Patron
		}
		camino = comodin.ReplaceAllString(camino, "1")
		for _, clase := range Clases {
			t.Run(ruta.Patron+" · "+ruta.Nivel.String()+" · "+string(clase), func(t *testing.T) {
				var salida strings.Builder
				log := slog.New(slog.NewJSONHandler(&salida, nil))
				e := servidor.NuevoEnrutador(sesionDePrueba(clase), seguridad.NuevoRegistro(log), log)
				e.Registrar(ruta.Nivel, ruta.Patron, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					servidor.EscribirJSON(w, http.StatusOK, map[string]string{"estado": "ok"})
				}))
				api, err := e.Construir()
				if err != nil {
					t.Fatal(err)
				}
				rr := httptest.NewRecorder()
				servidor.ManejadorConAPI(api).ServeHTTP(rr, httptest.NewRequest(metodo, camino, io.NopCloser(strings.NewReader(""))))

				quiere := Esperado(ruta.Nivel, clase)
				var cuerpo map[string]string
				_ = json.Unmarshal(rr.Body.Bytes(), &cuerpo)
				if rr.Code != quiere.Estado || cuerpo["error"] != quiere.Error {
					t.Fatalf("respondió %d %q; se esperaba %d %q", rr.Code, cuerpo["error"], quiere.Estado, quiere.Error)
				}
				evento := ""
				switch quiere.Estado {
				case http.StatusUnauthorized:
					evento = `"evento_seguridad":"error_autorizacion"`
				case http.StatusForbidden:
					evento = `"evento_seguridad":"acceso_denegado"`
				}
				if evento == "" && strings.Contains(salida.String(), "evento_seguridad") {
					t.Errorf("no se esperaba un evento de seguridad: %s", salida.String())
				}
				if evento != "" && !strings.Contains(salida.String(), evento) {
					t.Errorf("falta el evento %s: %s", evento, salida.String())
				}
			})
		}
	}
}
