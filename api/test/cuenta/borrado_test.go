package cuenta_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

const (
	personaQueBorra = "0192f3c4-0000-7000-8000-0000000000b1"
	correoQueBorra  = "laura@ejemplo.test"
	claveQueBorra   = "lluvia café tren azul"
)

// repoDeBorradoFalso guarda lo que recibiría el Repositorio y devuelve lo que se le ordene.
type repoDeBorradoFalso struct {
	credencial     cuenta.CredencialDeBorrado
	errCredencial  error
	resumen        cuenta.ResumenDeBorrado
	errResumen     error
	errBorrar      error
	borradas       []llamadaDeBorrado
	credencialesDe []string
}

type llamadaDeBorrado struct {
	persona         string
	vistos          []string
	confirmaMenores bool
	ahora, hasta    time.Time
}

func (r *repoDeBorradoFalso) CredencialDe(_ context.Context, persona string) (cuenta.CredencialDeBorrado, error) {
	r.credencialesDe = append(r.credencialesDe, persona)
	return r.credencial, r.errCredencial
}

func (r *repoDeBorradoFalso) Resumen(context.Context, string) (cuenta.ResumenDeBorrado, error) {
	return r.resumen, r.errResumen
}

func (r *repoDeBorradoFalso) BorrarCuenta(_ context.Context, persona string, vistos []string, confirma bool, ahora, hasta time.Time) error {
	r.borradas = append(r.borradas, llamadaDeBorrado{persona, vistos, confirma, ahora, hasta})
	return r.errBorrar
}

// verificadorFalso acepta solo claveQueBorra y cuenta cuántas veces se le pidió.
type verificadorFalso struct {
	veces int
	err   error
}

func (v *verificadorFalso) Verificar(_ context.Context, contrasena, hash string) (bool, error) {
	v.veces++
	return v.err == nil && contrasena == claveQueBorra && hash == "hash-de-laura", v.err
}

type entornoDeBorrado struct {
	repo      *repoDeBorradoFalso
	verif     *verificadorFalso
	servicio  *cuenta.Borrado
	limitador *seguridad.LimitadorDeIntentos
	reloj     *relojtest.Fijo
	registro  *bytes.Buffer
	almacen   almacenFalso
}

func nuevoEntornoDeBorrado() *entornoDeBorrado {
	e := &entornoDeBorrado{
		repo:     &repoDeBorradoFalso{credencial: cuenta.CredencialDeBorrado{Correo: correoQueBorra, Hash: "hash-de-laura"}},
		verif:    &verificadorFalso{},
		reloj:    &relojtest.Fijo{T: ahoraDePrueba},
		registro: &bytes.Buffer{},
		almacen:  almacenFalso{},
	}
	e.limitador = seguridad.NuevoLimitadorDeIntentos(e.reloj)
	e.servicio = cuenta.NuevoBorrado(e.repo, e.verif, e.limitador, e.reloj)
	return e
}

func TestBorrarConLaContrasenaBorraConLasFechasDeLaPruebaDeAutorizacion(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	if err := e.servicio.Borrar(context.Background(), personaQueBorra, claveQueBorra, []string{"m1"}, true, "203.0.113.7"); err != nil {
		t.Fatal(err)
	}
	quiere := llamadaDeBorrado{personaQueBorra, []string{"m1"}, true, ahoraDePrueba, ahoraDePrueba.AddDate(cuenta.AniosDeLaPruebaDeAutorizacion, 0, 0)}
	if len(e.repo.borradas) != 1 || !reflect.DeepEqual(e.repo.borradas[0], quiere) {
		t.Errorf("borradas %+v, se esperaba %+v", e.repo.borradas, quiere)
	}
}

func TestBorrarSinContrasenaNoMiraNiBorraNada(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	err := e.servicio.Borrar(context.Background(), personaQueBorra, "", []string{"m1"}, true, "203.0.113.7")
	var invalida *cuenta.ErrValidacion
	if !errors.As(err, &invalida) || invalida.Campos["contrasena"] != cuenta.ContrasenaVacia || len(invalida.Campos) != 1 {
		t.Fatalf("error %v", err)
	}
	if e.verif.veces != 0 || len(e.repo.borradas) != 0 || len(e.repo.credencialesDe) != 0 {
		t.Error("sin contraseña no se lee la credencial ni se borra")
	}
}

func TestBorrarConLaContrasenaMalNoBorraYCuentaComoFallo(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	for range 5 {
		if err := e.servicio.Borrar(context.Background(), personaQueBorra, "mal", []string{"m1"}, true, "203.0.113.7"); !errors.Is(err, cuenta.ErrContrasenaIncorrecta) {
			t.Fatalf("error %v", err)
		}
	}
	// D-136: el sexto intento ya no llega a comprobar la contraseña, ni siquiera con la buena.
	veces := e.verif.veces
	if err := e.servicio.Borrar(context.Background(), personaQueBorra, claveQueBorra, []string{"m1"}, true, "203.0.113.7"); !errors.Is(err, cuenta.ErrDemasiadosIntentos) {
		t.Fatalf("sexto intento: %v", err)
	}
	if e.verif.veces != veces || len(e.repo.borradas) != 0 {
		t.Error("frenado: no se comprueba ni se borra")
	}
}

// El límite es el del inicio de sesión: se cuenta por el correo de la cuenta, así que borrar no da cinco intentos
// más para adivinar la contraseña con una sesión robada.
func TestElLimiteEsElMismoDelInicioDeSesion(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	for range 5 {
		e.limitador.RegistrarFalloDeIngreso(correoQueBorra, "198.51.100.1")
	}
	if err := e.servicio.Borrar(context.Background(), personaQueBorra, claveQueBorra, []string{"m1"}, true, "203.0.113.7"); !errors.Is(err, cuenta.ErrDemasiadosIntentos) {
		t.Fatalf("error %v", err)
	}
}

func TestSinCorreoElLimiteSeCuentaPorLaPersona(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	e.repo.credencial.Correo = ""
	for range 5 {
		_ = e.servicio.Borrar(context.Background(), personaQueBorra, "mal", []string{"m1"}, false, "203.0.113.7")
	}
	if err := e.servicio.Borrar(context.Background(), personaQueBorra, claveQueBorra, []string{"m1"}, false, "203.0.113.7"); !errors.Is(err, cuenta.ErrDemasiadosIntentos) {
		t.Fatalf("error %v", err)
	}
}

func TestLosErroresDelRepositorioYDelVerificadorSePropagan(t *testing.T) {
	roto := errors.New("roto")
	casos := map[string]func(e *entornoDeBorrado) error{
		"sin credencial": func(e *entornoDeBorrado) error { e.repo.errCredencial = cuenta.ErrNoExiste; return cuenta.ErrNoExiste },
		"verificador":    func(e *entornoDeBorrado) error { e.verif.err = roto; return roto },
		"sin confirmar": func(e *entornoDeBorrado) error {
			e.repo.errBorrar = cuenta.ErrFaltaConfirmarMenores
			return cuenta.ErrFaltaConfirmarMenores
		},
		"menor": func(e *entornoDeBorrado) error {
			e.repo.errBorrar = cuenta.ErrCuentaDeMenor
			return cuenta.ErrCuentaDeMenor
		},
		"repositorio": func(e *entornoDeBorrado) error { e.repo.errBorrar = roto; return roto },
	}
	for nombre, c := range casos {
		t.Run(nombre, func(t *testing.T) {
			e := nuevoEntornoDeBorrado()
			quiere := c(e)
			if err := e.servicio.Borrar(context.Background(), personaQueBorra, claveQueBorra, []string{"m1"}, false, "203.0.113.7"); !errors.Is(err, quiere) {
				t.Errorf("error %v, se esperaba %v", err, quiere)
			}
		})
	}
}

func TestElResumenSeEntregaTalCual(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	e.repo.resumen = cuenta.ResumenDeBorrado{Menores: []cuenta.MenorACargo{{ID: "m1", Nombre: "Mateo"}}}
	r, err := e.servicio.Resumen(context.Background(), personaQueBorra)
	if err != nil || len(r.Menores) != 1 || r.Menores[0].Nombre != "Mateo" {
		t.Fatalf("%+v %v", r, err)
	}
	e.repo.errResumen = cuenta.ErrNoExiste
	if _, err := e.servicio.Resumen(context.Background(), personaQueBorra); !errors.Is(err, cuenta.ErrNoExiste) {
		t.Errorf("error %v", err)
	}
}

// --- HTTP ---

const rutaDeBorrado = "/api/v1/cuenta/borrado"

func (e *entornoDeBorrado) api(t *testing.T) http.Handler {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(e.registro, nil))
	resolutor := sesion.NuevoResolutor(e.almacen, nil, e.reloj)
	enr := servidor.NuevoEnrutador(resolutor, seguridad.NuevoRegistro(log), log)
	cuenta.NuevoHandlerDeBorrado(e.servicio, seguridad.NuevoRegistro(log), log).Registrar(enr)
	h, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

// pedir llama con la sesión de una cuenta verificada y autorizada.
func (e *entornoDeBorrado) pedir(t *testing.T, metodo, cuerpo string, encabezados ...string) *httptest.ResponseRecorder {
	t.Helper()
	token := e.sesionAutorizada()
	r := httptest.NewRequest(metodo, rutaDeBorrado, strings.NewReader(cuerpo))
	r.RemoteAddr = "203.0.113.7:4321"
	r.AddCookie(&http.Cookie{Name: "__Host-sesion", Value: token})
	for i := 0; i+1 < len(encabezados); i += 2 {
		r.Header.Set(encabezados[i], encabezados[i+1])
	}
	rr := httptest.NewRecorder()
	e.api(t).ServeHTTP(rr, r)
	return rr
}

func (e *entornoDeBorrado) sesionAutorizada() string {
	token, huella := seguridad.NuevoTokenOpaco()
	e.almacen[string(huella)] = seguridad.Sujeto{Persona: personaQueBorra, Verificada: true, Autorizada: true}
	return token
}

func json2(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &m); err != nil {
		t.Fatalf("%q: %v", rr.Body, err)
	}
	return m
}

func TestPostBorradoBorraYCierraLaCookie(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	rr := e.pedir(t, "POST", `{"contrasena":"`+claveQueBorra+`","confirma_menores":true,"menores":["m1"]}`)
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"cuenta_borrada"}` || rr.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s %v", rr.Code, rr.Body, rr.Header())
	}
	cs := rr.Result().Cookies()
	if len(cs) != 1 || cs[0].Name != "__Host-sesion" || cs[0].MaxAge >= 0 || cs[0].Value != "" {
		t.Errorf("cookie %+v", cs)
	}
	b := e.repo.borradas
	if len(b) != 1 || b[0].persona != personaQueBorra || !b[0].confirmaMenores || len(b[0].vistos) != 1 || b[0].vistos[0] != "m1" {
		t.Errorf("borradas %+v", e.repo.borradas)
	}
}

func TestPostBorradoSinConfirmarMenoresNoBorra(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	e.repo.errBorrar = cuenta.ErrFaltaConfirmarMenores
	rr := e.pedir(t, "POST", `{"contrasena":"`+claveQueBorra+`"}`)
	m := json2(t, rr)
	campos, _ := m["campos"].(map[string]any)
	if rr.Code != 422 || m["error"] != "validacion" || campos["confirma_menores"] != "confirmacion_requerida" || len(campos) != 1 {
		t.Fatalf("%d %s", rr.Code, rr.Body)
	}
	if rr.Header().Get("Set-Cookie") != "" {
		t.Error("no se cierra la sesión si no se borró")
	}
}

func TestPostBorradoValidaLaContrasenaVacia(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	rr := e.pedir(t, "POST", `{"contrasena":""}`)
	m := json2(t, rr)
	campos, _ := m["campos"].(map[string]any)
	if rr.Code != 422 || campos["contrasena"] != "contrasena_vacia" || len(e.repo.borradas) != 0 {
		t.Fatalf("%d %s", rr.Code, rr.Body)
	}
}

func TestPostBorradoConLaContrasenaMalDa400YDejaElEvento(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	rr := e.pedir(t, "POST", `{"contrasena":"mal"}`)
	if rr.Code != 400 || strings.TrimSpace(rr.Body.String()) != `{"error":"contrasena_incorrecta"}` || rr.Header().Get("Set-Cookie") != "" || len(e.repo.borradas) != 0 {
		t.Fatalf("%d %s %v", rr.Code, rr.Body, rr.Header())
	}
	log := e.registro.String()
	for _, quiere := range []string{`"evento_seguridad":"inicio_sesion_fallido"`, `"cuenta":"` + personaQueBorra + `"`, `"codigo":400`, `"ruta":"POST ` + rutaDeBorrado + `"`} {
		if !strings.Contains(log, quiere) {
			t.Errorf("falta %s en %s", quiere, log)
		}
	}
	if strings.Contains(log, "mal") && strings.Contains(log, `"contrasena"`) || strings.Contains(log, correoQueBorra) {
		t.Errorf("el registro lleva datos personales: %s", log)
	}
}

func TestPostBorradoFrenadoDa429YDejaElEvento(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	for range 5 {
		e.pedir(t, "POST", `{"contrasena":"mal"}`)
	}
	rr := e.pedir(t, "POST", `{"contrasena":"`+claveQueBorra+`"}`)
	if rr.Code != 429 || strings.TrimSpace(rr.Body.String()) != `{"error":"demasiados_intentos"}` || len(e.repo.borradas) != 0 {
		t.Fatalf("%d %s", rr.Code, rr.Body)
	}
	if !strings.Contains(e.registro.String(), `"codigo":429`) {
		t.Error("el intento frenado deja su evento")
	}
}

func TestPostBorradoDeUnaCuentaQueYaNoExisteDa401(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	e.repo.errCredencial = cuenta.ErrNoExiste
	rr := e.pedir(t, "POST", `{"contrasena":"`+claveQueBorra+`"}`)
	if rr.Code != 401 || strings.TrimSpace(rr.Body.String()) != `{"error":"sin_sesion"}` {
		t.Fatalf("%d %s", rr.Code, rr.Body)
	}
}

func TestPostBorradoDeUnMenorDa403(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	e.repo.errBorrar = cuenta.ErrCuentaDeMenor
	rr := e.pedir(t, "POST", `{"contrasena":"`+claveQueBorra+`"}`)
	if rr.Code != 403 || strings.TrimSpace(rr.Body.String()) != `{"error":"cuenta_de_menor"}` {
		t.Fatalf("%d %s", rr.Code, rr.Body)
	}
}

func TestPostBorradoConUnErrorInesperadoDa500SinDatosPersonales(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	e.repo.errBorrar = errors.New("falla de la base")
	rr := e.pedir(t, "POST", `{"contrasena":"`+claveQueBorra+`"}`)
	if rr.Code != 500 || strings.TrimSpace(rr.Body.String()) != `{"error":"error_interno"}` || rr.Header().Get("Set-Cookie") != "" {
		t.Fatalf("%d %s %v", rr.Code, rr.Body, rr.Header())
	}
	log := e.registro.String()
	if !strings.Contains(log, "no se pudo borrar la cuenta") || strings.Contains(log, claveQueBorra) || strings.Contains(log, correoQueBorra) {
		t.Errorf("registro: %s", log)
	}
}

func TestPostBorradoRechazaCuerposQueNoSonDelContrato(t *testing.T) {
	for _, cuerpo := range []string{``, `{`, `{"contrasena":"x","otra":1}`, `{"contrasena":1}`} {
		e := nuevoEntornoDeBorrado()
		rr := e.pedir(t, "POST", cuerpo)
		if rr.Code != 400 || len(e.repo.borradas) != 0 {
			t.Errorf("%q: %d %s", cuerpo, rr.Code, rr.Body)
		}
	}
}

func TestElBorradoExigeSesionYAutorizacion(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	for _, metodo := range []string{"GET", "POST"} {
		r := httptest.NewRequest(metodo, rutaDeBorrado, strings.NewReader(`{"contrasena":"`+claveQueBorra+`"}`))
		rr := httptest.NewRecorder()
		e.api(t).ServeHTTP(rr, r)
		if rr.Code != 401 || len(e.repo.borradas) != 0 {
			t.Errorf("%s sin sesión: %d", metodo, rr.Code)
		}
	}
}

func TestGetBorradoDaElResumenDeLaPantalla(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	nombre := "Nuestro hogar"
	e.repo.resumen = cuenta.ResumenDeBorrado{
		Hogar:   &cuenta.HogarAlBorrar{Nombre: &nombre, EsAdministradora: true, NuevoAdministrador: "Camilo"},
		Menores: []cuenta.MenorACargo{{ID: "m1", Nombre: "Mateo"}},
	}
	rr := e.pedir(t, "GET", "")
	quiere := `{"hogar":{"nombre":"Nuestro hogar","es_administradora":true,"unica_adulta":false,"nuevo_administrador":"Camilo"},"menores":[{"id":"m1","nombre":"Mateo"}]}`
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != quiere || rr.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s %v", rr.Code, rr.Body, rr.Header())
	}

	e.repo.resumen = cuenta.ResumenDeBorrado{}
	rr = e.pedir(t, "GET", "")
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"hogar":null,"menores":[]}` {
		t.Errorf("sin hogar ni menores: %d %s", rr.Code, rr.Body)
	}

	e.repo.resumen = cuenta.ResumenDeBorrado{Hogar: &cuenta.HogarAlBorrar{UnicaAdulta: true}}
	rr = e.pedir(t, "GET", "")
	if !strings.Contains(rr.Body.String(), `"hogar":{"nombre":null,"es_administradora":false,"unica_adulta":true,"nuevo_administrador":null}`) {
		t.Errorf("única adulta, hogar sin nombre: %s", rr.Body)
	}
}

func TestGetBorradoErrores(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	e.repo.errResumen = cuenta.ErrNoExiste
	if rr := e.pedir(t, "GET", ""); rr.Code != 401 {
		t.Errorf("sin cuenta: %d", rr.Code)
	}
	e.repo.errResumen = errors.New("roto")
	if rr := e.pedir(t, "GET", ""); rr.Code != 500 || !strings.Contains(e.registro.String(), "no se pudo leer el resumen del borrado") {
		t.Errorf("roto: %d %s", rr.Code, e.registro)
	}
}

func TestPostBorradoConLosMenoresCambiadosDa409SinCerrarLaSesion(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	e.repo.errBorrar = cuenta.ErrMenoresCambiaron
	rr := e.pedir(t, "POST", `{"contrasena":"`+claveQueBorra+`","confirma_menores":true,"menores":["m1"]}`)
	if rr.Code != 409 || strings.TrimSpace(rr.Body.String()) != `{"error":"menores_cambiaron"}` || rr.Header().Get("Set-Cookie") != "" {
		t.Fatalf("%d %s %v", rr.Code, rr.Body, rr.Header())
	}
}

func TestPostBorradoOcupadoDa503ConLaCuentaIntacta(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	e.repo.errBorrar = cuenta.ErrOcupada
	rr := e.pedir(t, "POST", `{"contrasena":"`+claveQueBorra+`"}`)
	if rr.Code != 503 || strings.TrimSpace(rr.Body.String()) != `{"error":"ocupado"}` || rr.Header().Get("Set-Cookie") != "" {
		t.Fatalf("%d %s", rr.Code, rr.Body)
	}
}

// Una cuenta de menor se rechaza antes de mirar la contraseña: 403 igual con la buena y con la mala, sin gastar el
// límite ni verificar nada.
func TestUnMenorEsRechazadoAntesDeLaContrasena(t *testing.T) {
	e := nuevoEntornoDeBorrado()
	e.repo.credencial.EsMenor = true
	for _, clave := range []string{claveQueBorra, "mal"} {
		if err := e.servicio.Borrar(context.Background(), personaQueBorra, clave, nil, false, "203.0.113.7"); !errors.Is(err, cuenta.ErrCuentaDeMenor) {
			t.Errorf("%q: %v", clave, err)
		}
	}
	rr := e.pedir(t, "POST", `{"contrasena":"mal"}`)
	if rr.Code != 403 || e.verif.veces != 0 || len(e.repo.borradas) != 0 {
		t.Errorf("%d, verificaciones %d", rr.Code, e.verif.veces)
	}
}
