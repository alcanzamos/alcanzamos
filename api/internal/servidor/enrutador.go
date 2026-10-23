package servidor

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
)

// ErrSinSesion lo devuelve Sesiones cuando la petición no trae una sesión válida: falta, venció o fue revocada.
var ErrSinSesion = errors.New("sin sesión")

// Sesiones resuelve el Sujeto de una petición (E12 `ResolutorDeSujeto` sobre el almacén de sesiones). El Enrutador
// no sabe cómo se guardan las sesiones ni cómo se sabe si una cuenta está verificada o autorizada: eso lo trae quien
// implementa esta interfaz.
type Sesiones interface {
	// SujetoDe devuelve el Sujeto de la sesión de la petición, o ErrSinSesion. Cualquier otro error es un fallo
	// (la base caída, por ejemplo) y el Enrutador no deja pasar.
	SujetoDe(r *http.Request) (seguridad.Sujeto, error)
}

// SinSesiones es la implementación sin almacén: ninguna petición tiene sesión.
type SinSesiones struct{}

// SujetoDe siempre da ErrSinSesion.
func (SinSesiones) SujetoDe(*http.Request) (seguridad.Sujeto, error) {
	return seguridad.Sujeto{}, ErrSinSesion
}

// Códigos de error de las negaciones. El cliente los traduce a su texto.
const (
	CodigoSinSesion             = "sin_sesion"
	CodigoVerificacionPendiente = "verificacion_pendiente"
	CodigoAutorizacionPendiente = "autorizacion_pendiente"
	codigoErrorInterno          = "error_interno"
)

type claveDelContexto struct{}

// ConSujeto devuelve un contexto que lleva el Sujeto de la petición.
func ConSujeto(ctx context.Context, s seguridad.Sujeto) context.Context {
	return context.WithValue(ctx, claveDelContexto{}, s)
}

// SujetoDe devuelve el Sujeto que el Enrutador dejó en el contexto. No hay en una ruta Publica.
func SujetoDe(ctx context.Context) (seguridad.Sujeto, bool) {
	s, ok := ctx.Value(claveDelContexto{}).(seguridad.Sujeto)
	return s, ok
}

// Ruta es una ruta registrada con su nivel de acceso.
type Ruta struct {
	Patron string
	Nivel  seguridad.NivelDeAcceso
}

// Enrutador registra las rutas de /api/ sobre net/http (E12 `Enrutador` y `MiddlewareDeSeguridad`). Cada ruta lleva su
// NivelDeAcceso y el guard común lo aplica: lo que no se declara no se puede alcanzar (RNF-012, D-138).
type Enrutador struct {
	mux      *http.ServeMux
	sesiones Sesiones
	eventos  *seguridad.Registro
	log      *slog.Logger
	rutas    []Ruta
	vistas   map[string]bool
	errores  []error
}

// NuevoEnrutador crea un enrutador con una única ruta: la 404 en JSON de todo lo que no se registre bajo /api/.
func NuevoEnrutador(s Sesiones, eventos *seguridad.Registro, log *slog.Logger) *Enrutador {
	e := &Enrutador{mux: http.NewServeMux(), sesiones: s, eventos: eventos, log: log, vistas: map[string]bool{}}
	e.mux.HandleFunc("/api/", noEncontradoAPI)
	return e
}

// Registrar añade una ruta con su nivel. patron es el de ServeMux («POST /api/v1/cuentas») y debe estar bajo /api/.
// Un registro inválido (sin nivel, fuera de /api/ o repetido) no entra al mux: Construir lo devuelve como error, así
// el servidor no arranca. Nunca hace panic.
func (e *Enrutador) Registrar(n seguridad.NivelDeAcceso, patron string, h http.Handler) {
	if !n.Valido() {
		e.errores = append(e.errores, fmt.Errorf("la ruta %q no declara su nivel de acceso", patron))
		return
	}
	ruta := patron
	if _, resto, ok := strings.Cut(patron, " "); ok {
		ruta = resto
	}
	if !strings.HasPrefix(ruta, "/api/") || ruta == "/api/" {
		e.errores = append(e.errores, fmt.Errorf("la ruta %q no está bajo /api/", patron))
		return
	}
	if e.vistas[patron] {
		e.errores = append(e.errores, fmt.Errorf("la ruta %q está repetida", patron))
		return
	}
	defer func() {
		// ServeMux hace panic con un patrón inválido o en conflicto con otro: aquí es un error de arranque.
		if r := recover(); r != nil {
			e.errores = append(e.errores, fmt.Errorf("la ruta %q no se pudo registrar: %v", patron, r))
		}
	}()
	e.mux.Handle(patron, e.proteger(n, h))
	e.vistas[patron] = true
	e.rutas = append(e.rutas, Ruta{Patron: patron, Nivel: n})
}

// Rutas devuelve las rutas registradas con su nivel, en el orden de registro. Sirve a las pruebas que verifican ruta
// por ruta que ninguna quedó sin guard (paquete accesotest).
func (e *Enrutador) Rutas() []Ruta { return append([]Ruta(nil), e.rutas...) }

// Construir devuelve el manejador de /api/ o el error de los registros inválidos.
func (e *Enrutador) Construir() (http.Handler, error) {
	if len(e.errores) > 0 {
		return nil, fmt.Errorf("rutas de /api/ inválidas: %w", errors.Join(e.errores...))
	}
	return e.mux, nil
}

// proteger aplica el guard del nivel. Negar es lo que pasa ante cualquier duda: un error al resolver la sesión
// responde 500 y no deja pasar.
//
//   - Sin sesión: 401 y evento error_autorizacion.
//   - Con sesión que no alcanza el nivel: 403 con verificacion_pendiente o autorizacion_pendiente, y evento
//     acceso_denegado de la cuenta. La sesión de mentira (D-141) recibe lo mismo que la limitada real, con cuenta
//     «desconocida» en el evento: el registro no la distingue por fuera.
func (e *Enrutador) proteger(n seguridad.NivelDeAcceso, h http.Handler) http.Handler {
	if n == seguridad.Publica {
		return h
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sujeto, err := e.sesiones.SujetoDe(r)
		if errors.Is(err, ErrSinSesion) {
			e.eventos.Registrar(r.Context(), seguridad.ErrorAutorizacion, "", r.Pattern, http.StatusUnauthorized)
			EscribirError(w, http.StatusUnauthorized, CodigoSinSesion)
			return
		}
		if err != nil {
			e.fallar(w, r, "resolver la sesión", err)
			return
		}
		ctx := ConSujeto(r.Context(), sujeto)
		if sujeto.Persona != "" && !sujeto.Senuelo {
			ctx = seguridad.ConPersona(ctx, sujeto.Persona)
		}
		r = r.WithContext(ctx)
		if err := sujeto.Alcanza(n); err != nil {
			e.eventos.Registrar(ctx, seguridad.AccesoDenegado, seguridad.PersonaDe(ctx), r.Pattern, http.StatusForbidden)
			codigo := CodigoAutorizacionPendiente
			if errors.Is(err, seguridad.ErrVerificacionPendiente) {
				codigo = CodigoVerificacionPendiente
			}
			EscribirError(w, http.StatusForbidden, codigo)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func (e *Enrutador) fallar(w http.ResponseWriter, r *http.Request, que string, err error) {
	e.log.ErrorContext(r.Context(), "falló el guard de /api/", "paso", que, "ruta", r.Pattern, "peticion", seguridad.PeticionDe(r.Context()), "error", err)
	EscribirError(w, http.StatusInternalServerError, codigoErrorInterno)
}

// conPeticion pone a cada petición un identificador nuevo para el registro de eventos (E17-VTE 2.1).
func conPeticion(siguiente http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		siguiente.ServeHTTP(w, r.WithContext(seguridad.ConPeticion(r.Context(), seguridad.NuevaPeticion())))
	})
}
