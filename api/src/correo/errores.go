package correo

import (
	"context"
	"errors"
	"io"
	"net"
	"net/textproto"
	"strconv"
)

// Categorías de un envío fallido (US-80, D-205 (6)). Se comparan con errors.Is. Quien llama decide qué hacer con cada
// una; hoy todos los llamadores solo registran el error y reintentan en la corrida siguiente.
var (
	// ErrTransitorio: el servidor dijo 4xx, no contestó o se cortó la conexión. Reintentar más tarde puede funcionar.
	ErrTransitorio = errors.New("falla transitoria del servidor de correo")
	// ErrDestinatario: el servidor rechazó la dirección del destinatario con 5xx (550, 553…). Es permanente para esa
	// dirección: reintentar no cambia nada.
	ErrDestinatario = errors.New("el servidor de correo rechazó al destinatario")
	// ErrAutenticacion: credenciales o cifrado. El servidor dijo 530, 535 o cualquier 5xx al autenticar o al negociar TLS,
	// no ofrece STARTTLS o AUTH cuando hay credenciales, o su certificado no es de confianza. Es un error de
	// configuración: no depende del destinatario y reintentar sin cambiar nada no sirve. No se envió ningún mensaje.
	ErrAutenticacion = errors.New("falla de autenticación o de cifrado con el servidor de correo")
	// ErrPermanente: cualquier otro 5xx (el remitente, el cuerpo o el cierre del mensaje).
	ErrPermanente = errors.New("el servidor de correo rechazó el envío")
)

// ErrorDeEnvio es el error de un envío: su categoría, el paso del diálogo SMTP y, si el servidor respondió con un
// código, el código. **Nunca lleva el texto que mandó el servidor ni la contraseña**: ese texto suele repetir la
// dirección del destinatario y los errores se registran (NM-03, E17 3.13).
type ErrorDeEnvio struct {
	// Categoria es una de ErrTransitorio, ErrDestinatario, ErrAutenticacion o ErrPermanente.
	Categoria error
	// Codigo es el código SMTP de la respuesta, o 0 si el servidor no respondió con uno.
	Codigo int
	// Paso dice qué se hacía, por ejemplo «destinatario rechazado».
	Paso string

	detalle string // texto fijo, sin nada del servidor, cuando no hay código
	causa   error  // solo errores de red, de plazo o de conexión cerrada: no traen texto del servidor
}

// Error da el paso y el código, o un texto fijo. Nunca el texto del servidor.
func (e *ErrorDeEnvio) Error() string {
	switch {
	case e.Codigo > 0:
		return e.Paso + ": el servidor respondió " + strconv.Itoa(e.Codigo)
	case e.causa != nil:
		return e.Paso + ": " + e.causa.Error()
	default:
		return e.Paso + ": " + e.detalle
	}
}

// Is dice si el error es de la categoría dada.
func (e *ErrorDeEnvio) Is(destino error) bool { return destino == e.Categoria }

// Unwrap deja a mano la causa de red (io.EOF, context.DeadlineExceeded, net.Error) para errors.Is y errors.As.
func (e *ErrorDeEnvio) Unwrap() error { return e.causa }

// etapa es el paso del diálogo SMTP donde falló algo; con el código decide la categoría.
type etapa int

const (
	etapaOtra etapa = iota
	etapaTLS
	etapaAUTH
	etapaDestinatario
)

// respuesta convierte un error del diálogo SMTP en un ErrorDeEnvio sin el texto que mandó el servidor. Un error con
// código deja solo el código; uno de la red, del plazo o de la conexión cerrada se conserva (sin texto del servidor) y
// es transitorio; cualquier otro (una línea sin código, una respuesta que la biblioteca no entiende, un fallo de TLS)
// se reemplaza por un texto fijo. Así ningún texto del servidor llega al registro, sea cual sea su respuesta.
func respuesta(contexto string, en etapa, err error) error {
	var e *textproto.Error
	var red net.Error
	switch {
	case errors.As(err, &e):
		return &ErrorDeEnvio{Categoria: categoriaDelCodigo(en, e.Code), Codigo: e.Code, Paso: contexto}
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF), errors.Is(err, context.DeadlineExceeded),
		errors.Is(err, context.Canceled), errors.As(err, &red):
		return &ErrorDeEnvio{Categoria: ErrTransitorio, Paso: contexto, causa: err}
	case en == etapaTLS:
		return &ErrorDeEnvio{Categoria: ErrAutenticacion, Paso: contexto, detalle: "no se pudo negociar un TLS de confianza"}
	default:
		return &ErrorDeEnvio{Categoria: ErrPermanente, Paso: contexto, detalle: "respuesta del servidor no válida"}
	}
}

// categoriaDelCodigo: 4xx es transitorio; 530, 534, 535 y 538 son de autenticación en cualquier paso, y todo 5xx lo es al
// autenticar o al negociar TLS; un 5xx al dar el destinatario es del destinatario; lo demás es permanente.
func categoriaDelCodigo(en etapa, codigo int) error {
	switch {
	case codigo >= 400 && codigo < 500:
		return ErrTransitorio
	case codigo == 530 || codigo == 534 || codigo == 535 || codigo == 538, en == etapaAUTH, en == etapaTLS:
		return ErrAutenticacion
	case en == etapaDestinatario:
		return ErrDestinatario
	default:
		return ErrPermanente
	}
}

// errorDeConfiguracion es un fallo de autenticación o de cifrado que se detecta sin respuesta del servidor.
func errorDeConfiguracion(paso, detalle string) error {
	return &ErrorDeEnvio{Categoria: ErrAutenticacion, Paso: paso, detalle: detalle}
}
