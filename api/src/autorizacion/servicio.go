// Package autorizacion tiene los casos de uso de PN-63 y PN-64 (US-50): qué finalidades puede autorizar una persona
// adulta, otorgarlas con la versión del texto (RF-031, RF-063) y el «No autorizo», que borra la cuenta recién creada.
// Los textos que ve la persona no están aquí: el API solo entrega códigos y la versión, y cada app pone el texto.
package autorizacion

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
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
// cambió. La 1.1 (2026-11-12) sumó la aceptación expresa de la transmisión a los encargados (SC-E21-25); la 1.2
// (2026-11-17) cambia los encargados que nombra: el correo sale por Zoho CPaaS y Azure queda en Estados Unidos
// (SC-E21-26, D-205 y D-208). Un cliente que todavía manda la 1.1 recibe `409 version_desactualizada`. Una finalidad
// necesaria aceptada con una versión anterior no cuenta como otorgada (bug 308, D-210): la persona la acepta de nuevo, la
// aceptación de antes queda como prueba (`reemplazada_en`) y las opcionales no se vuelven obligatorias.
var VersionActual = Version{Numero: "1.2", Fecha: "2026-11-17"}

// VersionAnterior dice si la versión guardada («1.1 del 2026-11-12», o solo «1.1») es anterior a la actual. Compara solo el
// número, por partes y como enteros (1.10 es posterior a 1.9), y no la fecha. Una versión guardada que no se lee es anterior
// (no cuenta como aceptada); si la actual no se lee, nada es anterior.
func VersionAnterior(guardada, actual string) bool {
	g, okG := partesDeLaVersion(guardada)
	a, okA := partesDeLaVersion(actual)
	if !okA {
		return false
	}
	if !okG {
		return true
	}
	for i := 0; i < max(len(g), len(a)); i++ {
		var pg, pa int
		if i < len(g) {
			pg = g[i]
		}
		if i < len(a) {
			pa = a[i]
		}
		if pg != pa {
			return pg < pa
		}
	}
	return false
}

// partesDeLaVersion saca los enteros del número que abre el texto de la versión («1.2 del 2026-11-17» → [1 2]).
func partesDeLaVersion(texto string) ([]int, bool) {
	numero, _, _ := strings.Cut(strings.TrimSpace(texto), " ")
	var partes []int
	for _, p := range strings.Split(numero, ".") {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil, false
		}
		partes = append(partes, n)
	}
	return partes, true
}

// CuentaComoOtorgada dice si una autorización vigente guardada con esa versión cuenta hoy: una finalidad necesaria solo si su
// versión no es anterior a VersionActual (bug 308, D-210); una opcional cuenta con la versión con que se aceptó. Es la regla
// que usan este servicio y la sesión, para que lo «completo» se decida igual en las dos.
func CuentaComoOtorgada(finalidad, version string) bool {
	if !(cuenta.ReglaDeFinalidades{}).Clasificada(finalidad) {
		return true
	}
	return !VersionAnterior(version, VersionActual.Texto())
}

// Modos de la lista de PN-64.
const (
	// ModoCompleto: todas las finalidades que se le ofrecen, cada una con si ya la tiene otorgada.
	ModoCompleto = "completo"
	// ModoFaltaUnaAceptacion: la cuenta ya autorizó algo antes y le falta alguna necesaria (nueva o con texto nuevo); solo trae esas, sin otorgar
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

// Aceptada es una autorización vigente de la persona y la versión del texto con que la aceptó.
type Aceptada struct {
	Codigo  string
	Version string // `version_del_texto`: «1.1 del 2026-11-12»
}

// Repositorio es la persistencia que el servicio necesita (la implementa src/pg).
type Repositorio interface {
	// Vigentes devuelve lo que la persona tiene otorgado por sí misma, sin retirar ni reemplazar, con la versión aceptada.
	// El servicio decide cuáles cuentan (CuentaComoOtorgada).
	Vigentes(ctx context.Context, persona string) ([]Aceptada, error)
	// Otorgar guarda, en una transacción, una autorización por finalidad con titular y otorgante la propia persona.
	// La que ya está vigente no se repite, salvo una necesaria de una versión anterior a `version`: esa queda reemplazada
	// (`reemplazada_en`, sin retirarla ni borrarla) y se guarda la nueva. Devuelve ErrSinCuenta si no hay una cuenta adulta
	// con ese id.
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
// autorizó algo antes y a la que le falta una necesaria (la de antes del cambio de SC-E21-25, o la que aceptó con una
// versión anterior del texto: bug 308) recibe solo lo que le falta, en el modo `falta_una_aceptacion`; la persona nueva y la que ya tiene todo reciben la lista completa.
func (s *Servicio) Listar(ctx context.Context, persona string) (Lista, error) {
	vigentes, err := s.vigentes(ctx, persona)
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

// vigentes son los códigos que la persona tiene otorgados y que cuentan: sin retirar ni reemplazar, y las necesarias con la
// versión vigente del texto (CuentaComoOtorgada).
func (s *Servicio) vigentes(ctx context.Context, persona string) ([]string, error) {
	aceptadas, err := s.repo.Vigentes(ctx, persona)
	if err != nil {
		return nil, err
	}
	var codigos []string
	for _, a := range aceptadas {
		if CuentaComoOtorgada(a.Codigo, a.Version) {
			codigos = append(codigos, a.Codigo)
		}
	}
	return codigos, nil
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
// aún no tiene o que tiene con una versión anterior (la persona nueva, las tres; la cuenta de antes del cambio, solo la
// que le falta o cambió); las accesorias son libres. Una finalidad repetida se cuenta una vez y la que ya estaba otorgada no se duplica: repetir la llamada no
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
	vigentes, err := s.vigentes(ctx, persona)
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
