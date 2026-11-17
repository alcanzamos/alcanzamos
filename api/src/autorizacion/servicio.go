// Package autorizacion tiene los casos de uso de PN-63 y PN-64 (US-50): qué finalidades puede autorizar una persona
// adulta, otorgarlas con la versión del texto (RF-031, RF-063) y el «No autorizo», que borra la cuenta recién creada.
// Los textos que ve la persona no están aquí: el API solo entrega códigos y la versión, y cada app pone el texto.
package autorizacion

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/reloj"
)

// Tipos de finalidad que entrega el API.
const (
	Necesaria = "necesaria"
	Accesoria = "accesoria"
)

// Version es la versión del texto de las finalidades (RF-063). Cada app escribe la fecha en palabras.
type Version struct {
	Numero string `json:"numero"`
	Fecha  string `json:"fecha"` // AAAA-MM-DD
}

// Texto es la forma en que `autorizacion.version_del_texto` la guarda: «1.0 del 2026-10-30» (E14-PCP 5).
func (v Version) Texto() string { return v.Numero + " del " + v.Fecha }

// VersionActual es el único texto vigente. Un texto nuevo cambia esta constante y la persona vuelve a autorizar lo que
// cambió. La 1.1 (2026-11-12) suma la aceptación expresa de la transmisión a los encargados (SC-E21-25); lo guardado con la
// 1.0 (2026-10-30) sigue valiendo: no se repite (RF-063).
var VersionActual = Version{Numero: "1.1", Fecha: "2026-11-12"}

// Modos de la lista de PN-64.
const (
	// ModoCompleto: todas las finalidades que se le ofrecen, cada una con si ya la tiene otorgada.
	ModoCompleto = "completo"
	// ModoFaltaUnaAceptacion: la cuenta ya autorizó algo antes y le falta alguna necesaria; solo trae esas, sin otorgar
	// (SC-E21-25, sección 5). Lo que ya autorizó y sus elecciones opcionales no se piden de nuevo.
	ModoFaltaUnaAceptacion = "falta_una_aceptacion"
)

// Lista es lo que PN-64 muestra: el modo y las finalidades.
type Lista struct {
	Modo        string
	Finalidades []Finalidad
}

// Finalidad es una finalidad que la persona puede autorizar ahora, y si ya la tiene otorgada.
type Finalidad struct {
	Codigo   string `json:"codigo"`
	Tipo     string `json:"tipo"`
	Otorgada bool   `json:"otorgada"`
}

// Errores del servicio. El Handler los traduce a su código HTTP.
var (
	// ErrVersionDesactualizada: la versión que manda la persona no es la vigente. El cliente vuelve a pedir la lista.
	ErrVersionDesactualizada = errors.New("la versión del texto no es la vigente")
	// ErrFinalidadInvalida: un código desconocido, inactivo o que no le toca a una persona adulta.
	ErrFinalidadInvalida = errors.New("finalidad que no se ofrece")
	// ErrFaltanNecesarias: no vienen las dos finalidades necesarias.
	ErrFaltanNecesarias = errors.New("faltan las finalidades necesarias")
	// ErrYaAutorizada: «No autorizo» de quien ya autorizó lo necesario. No se puede borrar la cuenta por aquí.
	ErrYaAutorizada = errors.New("la cuenta ya autorizó lo necesario")
	// ErrConHistorial: «No autorizo» de quien ya autorizó algo antes. No se borra de un toque (SC-E21-25, sección 5).
	ErrConHistorial = errors.New("la cuenta ya autorizó algo antes")
	// ErrSinCuenta: no hay una cuenta adulta con ese id (la borraron mientras tanto).
	ErrSinCuenta = errors.New("la cuenta ya no existe")
)

// Repositorio es la persistencia que el servicio necesita (la implementa src/pg).
type Repositorio interface {
	// Vigentes devuelve los códigos que la persona tiene otorgados por sí misma y sin retirar.
	Vigentes(ctx context.Context, persona string) ([]string, error)
	// Otorgar guarda, en una transacción, una autorización por finalidad con titular y otorgante la propia persona.
	// La que ya está vigente no se repite. Devuelve ErrSinCuenta si no hay una cuenta adulta con ese id.
	Otorgar(ctx context.Context, persona string, finalidades []string, version string, ahora time.Time) error
	// Rechazar borra la cuenta en una transacción (ON DELETE CASCADE se lleva persona, credencial, sesiones y
	// enlaces), salvo que ya tenga vigentes todas las `necesarias`: entonces ErrYaAutorizada y no toca nada. Las
	// autorizaciones que tuviera quedan retiradas en `ahora` y se conservan hasta `conservarHasta` (E13 §7).
	Rechazar(ctx context.Context, persona string, necesarias []string, ahora, conservarHasta time.Time) error
	// ConHistorial dice si la persona tiene alguna autorización como titular, vigente o retirada: ya autorizó algo antes.
	// Es el mismo criterio con el que la tarea diaria decide no borrar la cuenta (SC-E21-25, sección 5).
	ConHistorial(ctx context.Context, persona string) (bool, error)
	// Retirar retira, en una transacción, la autorización vigente de la finalidad del titular (retirada_en = ahora). Si es
	// `avisos`, en la misma transacción borra todos sus tokens de dispositivo (SC-E21-25, criterio 12). Sin una vigente
	// no cambia nada. La prueba mínima queda: la fila no se borra.
	Retirar(ctx context.Context, titular, finalidad string, ahora time.Time) error
}

// Servicio son los casos de uso de PN-63 y PN-64.
type Servicio struct {
	repo  Repositorio
	reloj reloj.Reloj
}

// NuevoServicio arma el servicio.
func NuevoServicio(repo Repositorio, r reloj.Reloj) *Servicio { return &Servicio{repo: repo, reloj: r} }

// Ofrecidas son las finalidades que una persona adulta puede autorizar (D-139): las necesarias y las accesorias de
// ReglaDeFinalidades, en ese orden. Las del menor y las inactivas no están, así que ni se listan ni se aceptan.
func Ofrecidas() []Finalidad {
	var regla cuenta.ReglaDeFinalidades
	var lista []Finalidad
	for _, c := range regla.Codigos(cuenta.EtapaAdulta) {
		lista = append(lista, Finalidad{Codigo: c, Tipo: Necesaria})
	}
	for _, c := range regla.Accesorias(cuenta.EtapaAdulta) {
		lista = append(lista, Finalidad{Codigo: c, Tipo: Accesoria})
	}
	return lista
}

// Listar devuelve lo que la persona puede autorizar, cada finalidad con si ya la tiene otorgada. Una cuenta que ya
// autorizó algo antes y a la que le falta una necesaria (la de antes del cambio de SC-E21-25) recibe solo lo que le
// falta, en el modo `falta_una_aceptacion`; la persona nueva y la que ya tiene todo reciben la lista completa.
func (s *Servicio) Listar(ctx context.Context, persona string) (Lista, error) {
	vigentes, err := s.repo.Vigentes(ctx, persona)
	if err != nil {
		return Lista{}, err
	}
	lista := Ofrecidas()
	for i := range lista {
		lista[i].Otorgada = slices.Contains(vigentes, lista[i].Codigo)
	}
	faltantes := faltantes(persona, vigentes)
	if len(faltantes) == 0 {
		return Lista{Modo: ModoCompleto, Finalidades: lista}, nil
	}
	historial, err := s.repo.ConHistorial(ctx, persona)
	if err != nil {
		return Lista{}, err
	}
	if !historial {
		return Lista{Modo: ModoCompleto, Finalidades: lista}, nil
	}
	soloLasFaltantes := slices.DeleteFunc(lista, func(f Finalidad) bool { return !slices.Contains(faltantes, f.Codigo) })
	return Lista{Modo: ModoFaltaUnaAceptacion, Finalidades: soloLasFaltantes}, nil
}

// faltantes son las necesarias de una persona adulta que aún no tiene vigentes, por ReglaDeFinalidades. vigentes son
// las que se otorgó a sí misma.
func faltantes(persona string, vigentes []string) []string {
	otorgadas := make([]cuenta.Otorgamiento, 0, len(vigentes))
	for _, c := range vigentes {
		otorgadas = append(otorgadas, cuenta.Otorgamiento{Finalidad: c, OtorganteID: persona})
	}
	return cuenta.ReglaDeFinalidades{}.Faltantes(cuenta.EtapaAdulta, persona, otorgadas, nil)
}

// Otorgar guarda las finalidades que la persona autoriza en PN-64. Exige la versión vigente y todas las necesarias que
// aún no tiene (la persona nueva, las tres; la cuenta de antes del cambio, solo la que le falta); las accesorias son
// libres. Una finalidad repetida se cuenta una vez y la que ya estaba otorgada no se duplica: repetir la llamada no
// cambia nada.
func (s *Servicio) Otorgar(ctx context.Context, persona string, finalidades []string, version string) error {
	if version != VersionActual.Numero {
		return ErrVersionDesactualizada
	}
	ofrecidas := Ofrecidas()
	pedidas := slices.Clone(finalidades)
	slices.Sort(pedidas)
	pedidas = slices.Compact(pedidas)
	for _, c := range pedidas {
		if !slices.ContainsFunc(ofrecidas, func(f Finalidad) bool { return f.Codigo == c }) {
			return ErrFinalidadInvalida
		}
	}
	vigentes, err := s.repo.Vigentes(ctx, persona)
	if err != nil {
		return err
	}
	for _, c := range faltantes(persona, vigentes) {
		if !slices.Contains(pedidas, c) {
			return ErrFaltanNecesarias
		}
	}
	return s.repo.Otorgar(ctx, persona, pedidas, VersionActual.Texto(), s.reloj.Ahora())
}

// Retirar retira una finalidad accesoria de la persona (PN-67). Solo se retiran las accesorias que PN-64 ofrece: una
// necesaria no se retira, se borra la cuenta (PN-69). Al retirar `avisos` se borran en la misma transacción todos los
// tokens de dispositivo de la persona y no se le envía ningún aviso más por FCM ni por Web Push (SC-E21-25, criterio 12).
// Retirar una finalidad que ya no está vigente no cambia nada.
func (s *Servicio) Retirar(ctx context.Context, persona, finalidad string) error {
	if !slices.Contains(cuenta.ReglaDeFinalidades{}.Accesorias(cuenta.EtapaAdulta), finalidad) {
		return ErrFinalidadInvalida
	}
	return s.repo.Retirar(ctx, persona, finalidad, s.reloj.Ahora())
}

// Rechazar es el «No autorizo» de PN-64 (RF-031, D-089): borra al momento lo que la cuenta tiene guardado, pero solo si
// la cuenta es nueva: la que ya autorizó algo antes recibe ErrConHistorial y no se toca (SC-E21-25, sección 5).
func (s *Servicio) Rechazar(ctx context.Context, persona string) error {
	ahora := s.reloj.Ahora()
	return s.repo.Rechazar(ctx, persona, cuenta.ReglaDeFinalidades{}.Codigos(cuenta.EtapaAdulta), ahora,
		ahora.AddDate(cuenta.AniosDeLaPruebaDeAutorizacion, 0, 0))
}
