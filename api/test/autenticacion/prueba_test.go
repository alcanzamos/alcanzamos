package autenticacion_test

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

const (
	personaDePrueba = "0192f3c4-0000-7000-8000-000000000001"
	correoDePrueba  = "laura@ejemplo.test"
	claveDePrueba   = "lluvia café tren azul"
)

var ahoraDePrueba = time.Date(2026, 10, 22, 15, 0, 0, 0, time.UTC)

// hasheadorFalso «hashea» como "$argon2id$falso$"+contraseña y cuenta cada verificación.
// Un hash que empieza por prefijoViejo vale (verifica) pero necesita mejora.
type hasheadorFalso struct {
	mu             sync.Mutex
	hashes         int
	verificadas    int
	falloHashear   error // si no es nil, Hashear falla con él
	falloVerificar error // si no es nil, Verificar falla con él
}

const (
	prefijoActual = "$argon2id$falso$"
	prefijoViejo  = "$argon2id$viejo$"
)

func (h *hasheadorFalso) Hashear(_ context.Context, c string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.hashes++
	if h.falloHashear != nil {
		return "", h.falloHashear
	}
	return prefijoActual + c, nil
}

func (h *hasheadorFalso) Verificar(_ context.Context, c, hash string) (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.verificadas++
	if h.falloVerificar != nil {
		return false, h.falloVerificar
	}
	return hash == prefijoActual+c || hash == prefijoViejo+c, nil
}

func (h *hasheadorFalso) NecesitaMejora(hash string) (bool, error) {
	return strings.HasPrefix(hash, prefijoViejo), nil
}

type sesionGuardada struct {
	persona string
	huella  []byte
	en      time.Time
}

type enlaceFalso struct {
	correo string
	vence  time.Time
	usado  bool
}

type cambioFalso struct {
	persona, hash string
	conservar     []byte
}

type repoFalso struct {
	mu       sync.Mutex
	cuentas  map[string]autenticacion.Credencial // correo → credencial
	sesiones []sesionGuardada
	mejoras  []*autenticacion.MejoraDeHash // una por cada inicio de sesión, nil si no hubo
	cerradas [][]byte
	anterior *time.Time

	enlaces map[string]*enlaceFalso // huella → enlace de recuperación
	fijadas []string                // hashes guardados con un enlace; cada uno borra todas las sesiones
	cambios []cambioFalso           // cambios con la sesión iniciada

	errores map[string]error // si un método tiene error, falla con él sin hacer nada más

	consultasDeRecuperacion atomic.Int32  // veces que se buscó la cuenta para recuperar
	compuerta               chan struct{} // si no es nil, esa búsqueda espera a que se cierre
}

func (r *repoFalso) CredencialDe(_ context.Context, persona string) (autenticacion.Credencial, error) {
	if err := r.fallo("CredencialDe"); err != nil {
		return autenticacion.Credencial{}, err
	}
	for correo, c := range r.cuentas {
		if c.Persona == persona {
			c.Correo = correo
			return c, nil
		}
	}
	return autenticacion.Credencial{}, autenticacion.ErrNoExiste
}

func (r *repoFalso) NuevoEnlaceDeRecuperacion(_ context.Context, correo string, huella []byte, ahora, vence time.Time) (bool, error) {
	if err := r.fallo("NuevoEnlaceDeRecuperacion"); err != nil {
		return false, err
	}
	r.consultasDeRecuperacion.Add(1)
	if r.compuerta != nil {
		<-r.compuerta
	}
	c, ok := r.cuentas[correo]
	if !ok || !c.Verificada {
		return false, nil
	}
	if r.enlaces == nil {
		r.enlaces = map[string]*enlaceFalso{}
	}
	for _, e := range r.enlaces {
		if e.correo == correo {
			e.usado = true // los pendientes dejan de servir
		}
	}
	r.enlaces[string(huella)] = &enlaceFalso{correo: correo, vence: vence}
	return true, nil
}

func (r *repoFalso) CorreoDelEnlaceDeRecuperacion(_ context.Context, huella []byte, ahora time.Time) (string, error) {
	if e, ok := r.enlaces[string(huella)]; ok && !e.usado && e.vence.After(ahora) {
		return e.correo, nil
	}
	return "", cuenta.ErrEnlaceInvalido
}

func (r *repoFalso) FijarContrasenaConEnlace(ctx context.Context, huella []byte, hash string, ahora time.Time) error {
	if err := r.fallo("FijarContrasenaConEnlace"); err != nil {
		return err
	}
	correo, err := r.CorreoDelEnlaceDeRecuperacion(ctx, huella, ahora)
	if err != nil {
		return err
	}
	r.enlaces[string(huella)].usado = true
	c := r.cuentas[correo]
	c.Hash = hash
	r.cuentas[correo] = c
	r.fijadas = append(r.fijadas, hash)
	return nil
}

func (r *repoFalso) CambiarContrasena(_ context.Context, persona, hash string, conservar []byte) error {
	if err := r.fallo("CambiarContrasena"); err != nil {
		return err
	}
	r.cambios = append(r.cambios, cambioFalso{persona, hash, conservar})
	return nil
}

func (r *repoFalso) CredencialPorCorreo(_ context.Context, correo string) (autenticacion.Credencial, error) {
	if err := r.fallo("CredencialPorCorreo"); err != nil {
		return autenticacion.Credencial{}, err
	}
	if c, ok := r.cuentas[correo]; ok {
		return c, nil
	}
	return autenticacion.Credencial{}, autenticacion.ErrNoExiste
}

func (r *repoFalso) IniciarSesion(_ context.Context, persona string, huella []byte, ahora time.Time, mejora *autenticacion.MejoraDeHash) error {
	if err := r.fallo("IniciarSesion"); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.mejoras = append(r.mejoras, mejora)
	r.sesiones = append(r.sesiones, sesionGuardada{persona, huella, ahora})
	return nil
}

func (r *repoFalso) CerrarSesion(_ context.Context, huella []byte) error {
	if err := r.fallo("CerrarSesion"); err != nil {
		return err
	}
	r.cerradas = append(r.cerradas, huella)
	return nil
}

func (r *repoFalso) IngresoAnterior(context.Context, string) (*time.Time, error) {
	if err := r.fallo("IngresoAnterior"); err != nil {
		return nil, err
	}
	return r.anterior, nil
}

func (r *repoFalso) fallo(metodo string) error { return r.errores[metodo] }

type entorno struct {
	svc       *autenticacion.Servicio
	repo      *repoFalso
	hasher    *hasheadorFalso
	reloj     *relojtest.Fijo
	limitador *seguridad.LimitadorDeIntentos
	registro  *bytes.Buffer // los eventos de seguridad y el resto del registro
	correo    *correotest.Falso
}

// nuevoEntorno arma el servicio con los trabajadores de la recuperación ya andando (paran al terminar la prueba).
func nuevoEntorno(t *testing.T) *entorno {
	t.Helper()
	e := nuevoEntornoSinTrabajadores(t)
	e.iniciar(t)
	return e
}

func (e *entorno) iniciar(t *testing.T) {
	t.Helper()
	ctx, cancelar := context.WithCancel(context.Background())
	t.Cleanup(func() { cancelar(); e.svc.Esperar() })
	e.svc.Iniciar(ctx)
}

// nuevoEntornoSinTrabajadores deja los pedidos de recuperación en la cola: sirve para ver qué hace el pedido solo.
func nuevoEntornoSinTrabajadores(t *testing.T) *entorno {
	t.Helper()
	e := &entorno{
		repo: &repoFalso{cuentas: map[string]autenticacion.Credencial{
			correoDePrueba:         {Persona: personaDePrueba, Hash: "$argon2id$falso$" + claveDePrueba, Verificada: true},
			"viejo@ej.test":        {Persona: "0192f3c4-0000-7000-8000-000000000003", Hash: prefijoViejo + claveDePrueba, Verificada: true},
			"sinverificar@ej.test": {Persona: "0192f3c4-0000-7000-8000-000000000002", Hash: "$argon2id$falso$" + claveDePrueba},
		}},
		hasher:   &hasheadorFalso{},
		reloj:    &relojtest.Fijo{T: ahoraDePrueba},
		registro: &bytes.Buffer{},
		correo:   &correotest.Falso{},
	}
	e.limitador = seguridad.NuevoLimitadorDeIntentos(e.reloj)
	svc, err := autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: e.repo, Hasher: e.hasher, Limitador: e.limitador, Reloj: e.reloj,
		Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Log: slog.New(slog.NewJSONHandler(e.registro, nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	e.svc = svc
	e.hasher.hashes, e.hasher.verificadas = 0, 0
	return e
}

// sesionesFalsas resuelve el Sujeto que se le dé, para probar las rutas con guard sin base.
type sesionesFalsas struct{ sujeto *seguridad.Sujeto }

func (s sesionesFalsas) SujetoDe(*http.Request) (seguridad.Sujeto, error) {
	if s.sujeto == nil {
		return seguridad.Sujeto{}, seguridad.ErrSinSesion
	}
	return *s.sujeto, nil
}

func (e *entorno) api(t *testing.T, sujeto *seguridad.Sujeto) http.Handler {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(e.registro, nil))
	enr := servidor.NuevoEnrutador(sesionesFalsas{sujeto}, seguridad.NuevoRegistro(log), log)
	autenticacion.NuevoHandler(e.svc, seguridad.NuevoRegistro(log), log).Registrar(enr)
	h, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

func llamar(h http.Handler, metodo, ruta, cuerpo, origen string, encabezados ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	r.RemoteAddr = origen + ":4321"
	for i := 0; i+1 < len(encabezados); i += 2 {
		r.Header.Set(encabezados[i], encabezados[i+1])
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	return rr
}

func entrar(correo, clave string) string {
	return `{"identificador":"` + correo + `","contrasena":"` + clave + `"}`
}

// pedido arma un pedido para llamar2: el cuerpo y los encabezados (pares nombre, valor) son los de llamar.
func pedido(metodo, ruta, cuerpo string, encabezados ...string) func(*testing.T, *entorno) *http.Request {
	return func(*testing.T, *entorno) *http.Request {
		r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
		r.RemoteAddr = "203.0.113.7:4321"
		for i := 0; i+1 < len(encabezados); i += 2 {
			r.Header.Set(encabezados[i], encabezados[i+1])
		}
		return r
	}
}

func llamar2(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	return rr
}
