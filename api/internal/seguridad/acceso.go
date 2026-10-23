package seguridad

import "errors"

// NivelDeAcceso es lo que una ruta de /api/ exige del estado de la cuenta (E12 `NivelDeAcceso`, D-138). Toda ruta
// declara el suyo al registrarse; el valor cero no es ninguno de los cuatro y hace fallar el arranque (RNF-012).
type NivelDeAcceso int

const (
	nivelSinDeclarar NivelDeAcceso = iota
	// Publica no exige sesión: crear la cuenta, verificar el correo con el enlace, iniciar sesión y recuperar el acceso.
	Publica
	// SinVerificar exige una sesión, aunque sea la limitada de una cuenta con el correo sin verificar (o la sesión de
	// mentira de D-141): solo PN-59 (revisar el estado, reenviar, cambiar el correo) y cerrar sesión.
	SinVerificar
	// SinAutorizacion exige una cuenta con el correo verificado, aunque aún no haya autorizado lo necesario: cerrar
	// sesión y las acciones de PN-63 y PN-64 (US-50).
	SinAutorizacion
	// RequiereAutorizacion exige además la autorización vigente de las finalidades necesarias de la etapa del titular
	// (D-139). Es el nivel que se declara para todo lo demás: ante la duda, el más estricto.
	RequiereAutorizacion
)

// Valido dice si es uno de los cuatro niveles.
func (n NivelDeAcceso) Valido() bool { return n >= Publica && n <= RequiereAutorizacion }

// String es el nombre del nivel como lo escriben E12, E18 y la documentación.
func (n NivelDeAcceso) String() string {
	switch n {
	case Publica:
		return "publica"
	case SinVerificar:
		return "sin_verificar"
	case SinAutorizacion:
		return "sin_autorizacion"
	case RequiereAutorizacion:
		return "requiere_autorizacion"
	}
	return "sin_declarar"
}

// Por qué un Sujeto no alcanza un nivel. Son los códigos del 403.
var (
	ErrVerificacionPendiente = errors.New("verificacion_pendiente") // el correo de la cuenta no está verificado
	ErrAutorizacionPendiente = errors.New("autorizacion_pendiente") // falta autorizar lo necesario
)

// Sujeto es la persona autenticada que actúa en una solicitud (E12 `Sujeto`). Lo arma quien resuelve la sesión y
// viaja en el contexto; no es un concepto del dominio.
type Sujeto struct {
	// Persona es el uuid de la cuenta. Vacío en la sesión de mentira.
	Persona string
	// Verificada: la cuenta confirmó su correo.
	Verificada bool
	// Autorizada: tiene vigentes las finalidades necesarias de su etapa (`ReglaDeFinalidades`, D-139).
	Autorizada bool
	// Senuelo: la sesión de mentira de D-141 (2). No apunta a ninguna cuenta y se trata, en todas las rutas,
	// exactamente como la sesión limitada de una cuenta sin verificar.
	Senuelo bool
}

// Alcanza dice si el Sujeto llega al nivel n: nil, ErrVerificacionPendiente o ErrAutorizacionPendiente. Cada nivel
// exige lo suyo y lo de los anteriores; un Sujeto de un nivel más bajo no entra a las rutas de uno más alto. La sesión
// de mentira nunca está verificada ni autorizada, diga lo que diga el resto de los campos.
func (s Sujeto) Alcanza(n NivelDeAcceso) error {
	verificada := s.Verificada && !s.Senuelo
	switch n {
	case Publica, SinVerificar:
		return nil
	case SinAutorizacion:
		if !verificada {
			return ErrVerificacionPendiente
		}
		return nil
	case RequiereAutorizacion:
		if !verificada {
			return ErrVerificacionPendiente
		}
		if !s.Autorizada {
			return ErrAutorizacionPendiente
		}
		return nil
	}
	// Un nivel inválido nunca llega aquí (Registrar lo rechaza), pero ante la duda se niega.
	return ErrAutorizacionPendiente
}
