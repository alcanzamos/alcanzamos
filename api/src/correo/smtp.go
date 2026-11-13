package correo

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/reloj"
)

const plazoDeEnvio = 30 * time.Second

// SMTP envía por un servidor SMTP con la biblioteca estándar (Mailpit en local, D-120).
// Usa STARTTLS si el servidor lo ofrece. Todavía no autentica: el proveedor de producción está por definir (O-4).
type SMTP struct {
	direccion  string
	remitente  string
	privacidad string
	urlPublica string
	reloj      reloj.Reloj
}

// NuevoSMTP arma el adaptador con la configuración ya validada.
func NuevoSMTP(c config.Config, r reloj.Reloj) *SMTP {
	return &SMTP{
		direccion:  c.CorreoSMTP,
		remitente:  c.CorreoRemitente,
		privacidad: c.CorreoPrivacidad,
		urlPublica: c.URLPublica,
		reloj:      r,
	}
}

// EnviarVerificacion manda el mensaje de verificación. No registra el destino, el token ni el cuerpo.
func (s *SMTP) EnviarVerificacion(ctx context.Context, destino, token string) error {
	dir, err := mail.ParseAddress(destino)
	if err != nil {
		return fmt.Errorf("destino inválido: %w", err)
	}
	mensaje, err := s.mensajeDeVerificacion(dir.Address, token)
	if err != nil {
		return err
	}
	return s.enviar(ctx, dir.Address, mensaje)
}

// EnviarRecuperacion manda el enlace de recuperación del acceso. No registra el destino, el token ni el cuerpo.
func (s *SMTP) EnviarRecuperacion(ctx context.Context, destino, token string) error {
	dir, err := mail.ParseAddress(destino)
	if err != nil {
		return fmt.Errorf("destino inválido: %w", err)
	}
	mensaje, err := s.mensajeDeRecuperacion(dir.Address, token)
	if err != nil {
		return err
	}
	return s.enviar(ctx, dir.Address, mensaje)
}

// EnviarAvisoDeCorreoRegistrado manda al dueño del correo el aviso de que alguien intentó crear una cuenta con él
// (D-141). No registra el destino ni el cuerpo.
func (s *SMTP) EnviarAvisoDeCorreoRegistrado(ctx context.Context, destino string) error {
	dir, err := mail.ParseAddress(destino)
	if err != nil {
		return fmt.Errorf("destino inválido: %w", err)
	}
	mensaje, err := s.mensajeDeAviso(dir.Address)
	if err != nil {
		return err
	}
	return s.enviar(ctx, dir.Address, mensaje)
}

// EnviarAvisoDePurga manda a una cuenta del caso 2 el aviso de que se borra en `borradoEn` si no autoriza (ítem 294, D-203).
// No registra el destino ni el cuerpo.
func (s *SMTP) EnviarAvisoDePurga(ctx context.Context, destino string, borradoEn time.Time) error {
	dir, err := mail.ParseAddress(destino)
	if err != nil {
		return fmt.Errorf("destino inválido: %w", err)
	}
	mensaje, err := s.mensajeDelAvisoDePurga(dir.Address, borradoEn)
	if err != nil {
		return err
	}
	return s.enviar(ctx, dir.Address, mensaje)
}

// enlaceDeVerificacion es URL_PUBLICA + /verificar?t=<token>. La ruta de la web existe desde la US-49 (PR 3).
func (s *SMTP) enlaceDeVerificacion(token string) string {
	return s.urlPublica + "/verificar?t=" + url.QueryEscape(token)
}

// mensajeDeVerificacion arma el correo de verificación con el asunto y el cuerpo de E14-PCP 4.2 quater, palabra por
// palabra (aprobados por D-176; la duración del enlace, D-192, aprobada por el dueño el 2026-11-06). La última frase la
// cambió el dueño el 2026-11-13 (ítem 294, D-203): dice lo que pasa con la cuenta y con el correo si nadie elige la contraseña.
func (s *SMTP) mensajeDeVerificacion(destino, token string) ([]byte, error) {
	cuerpo := "Hola,\r\n\r\n" +
		"Pediste crear una cuenta en Alcanzamos con este correo. Para confirmarlo y elegir tu contraseña, abre este enlace. Sirve durante 24 horas y una sola vez:\r\n\r\n" +
		s.enlaceDeVerificacion(token) + "\r\n\r\n" +
		"Si no lo pediste, ignora este mensaje: si nadie elige la contraseña, en 7 días borramos la cuenta y esta dirección de correo.\r\n\r\n" +
		"--\r\n" +
		"Este mensaje sale de una dirección que no recibe respuestas.\r\n" +
		s.pie()
	return s.mensaje(destino, "Elige tu contraseña para tu cuenta de Alcanzamos", cuerpo)
}

// enlaceDeEntrar es URL_PUBLICA + /entrar: la pantalla de iniciar sesión de la web (PN-60).
func (s *SMTP) enlaceDeEntrar() string { return s.urlPublica + "/entrar" }

// mensajeDelAvisoDePurga arma el aviso de antes de la purga con el asunto y el cuerpo que dictó el dueño el 2026-11-13
// (ítem 294, D-203), palabra por palabra. {fecha} es el momento real del borrado, en palabras y en hora de Colombia
// (D-090); el enlace es /entrar. Después va el pie de siempre, como en la verificación y la recuperación.
func (s *SMTP) mensajeDelAvisoDePurga(destino string, borradoEn time.Time) ([]byte, error) {
	cuerpo := "Hola,\r\n\r\n" +
		"Confirmaste tu correo en Alcanzamos, pero todavía no autorizaste el uso de tus datos. Sin esa autorización no podemos guardar tu cuenta. Si no autorizas, la borramos el " +
		fechas.EnPalabras(borradoEn) + ", con todo lo que tenga.\r\n\r\n" +
		"Para autorizar, entra a Alcanzamos con tu correo y tu contraseña, en la app o aquí: " + s.enlaceDeEntrar() + "\r\n\r\n" +
		"Si ya no quieres la cuenta, no tienes que hacer nada.\r\n\r\n" +
		"--\r\n" +
		"Este mensaje sale de una dirección que no recibe respuestas.\r\n" +
		s.pie()
	return s.mensaje(destino, "Tu cuenta de Alcanzamos se borra en 2 días", cuerpo)
}

// enlaceDeRecuperacion es URL_PUBLICA + /recuperar?t=<token> (PN-62).
func (s *SMTP) enlaceDeRecuperacion(token string) string {
	return s.urlPublica + "/recuperar?t=" + url.QueryEscape(token)
}

// mensajeDeRecuperacion arma el correo de recuperación del acceso. E14-PCP no escribe su texto, solo que lleva el mismo
// pie (D-143): el texto es una propuesta que revisa el dueño. El enlace sirve 1 hora y una sola vez (E13 §5.4).
func (s *SMTP) mensajeDeRecuperacion(destino, token string) ([]byte, error) {
	cuerpo := "Hola,\r\n\r\n" +
		"Pediste recuperar el acceso a tu cuenta de Alcanzamos. Para elegir una contraseña nueva, abre este enlace. Sirve durante 1 hora y una sola vez:\r\n\r\n" +
		s.enlaceDeRecuperacion(token) + "\r\n\r\n" +
		"Si no lo pediste, ignora este mensaje: tu contraseña sigue igual.\r\n\r\n" +
		"--\r\n" +
		"Este mensaje sale de una dirección que no recibe respuestas.\r\n" +
		s.pie()
	return s.mensaje(destino, "Recupera el acceso a tu cuenta de Alcanzamos", cuerpo)
}

// Texto del aviso de correo ya registrado: E14-PCP 4.2 bis, palabra por palabra (aprobado por D-192). No lleva enlaces ni contraseñas. El pie sale de CORREO_PRIVACIDAD.
const (
	asuntoDelAviso = "Alguien intentó crear una cuenta con tu correo"
	cuerpoDelAviso = "Hola.\r\n\r\n" +
		"Alguien intentó crear una cuenta en Alcanzamos con este correo.\r\n\r\n" +
		"No creamos ninguna cuenta nueva. Tu cuenta sigue igual.\r\n\r\n" +
		"Si fuiste tú, puedes iniciar sesión. Si no recuerdas tu contraseña, puedes recuperar el acceso desde la pantalla de inicio de sesión.\r\n\r\n" +
		"Si no fuiste tú, no tienes que hacer nada.\r\n\r\n" +
		"--\r\n"
)

// mensajeDeAviso arma el aviso de correo ya registrado.
func (s *SMTP) mensajeDeAviso(destino string) ([]byte, error) {
	return s.mensaje(destino, asuntoDelAviso, cuerpoDelAviso+s.pie())
}

// pie es el cierre de todos los correos de la cuenta (E14-PCP 4.2 bis, D-143): termina siempre con esta línea.
func (s *SMTP) pie() string {
	return "Si tienes dudas sobre tus datos, escribe a " + s.privacidad + ".\r\n"
}

// mensaje arma el mensaje completo: encabezados y cuerpo de texto plano en UTF-8.
func (s *SMTP) mensaje(destino, asunto, cuerpo string) ([]byte, error) {
	idAleatorio := make([]byte, 16)
	if _, err := rand.Read(idAleatorio); err != nil {
		return nil, fmt.Errorf("generar el identificador del mensaje: %w", err)
	}
	dominio := s.remitente[strings.LastIndex(s.remitente, "@")+1:]

	var b strings.Builder
	encabezado := func(k, v string) { b.WriteString(k + ": " + v + "\r\n") }
	encabezado("From", s.remitente)
	encabezado("To", destino)
	encabezado("Subject", mime.QEncoding.Encode("utf-8", asunto))
	encabezado("Date", s.reloj.Ahora().Format(time.RFC1123Z))
	encabezado("Message-ID", "<"+hex.EncodeToString(idAleatorio)+"@"+dominio+">")
	encabezado("MIME-Version", "1.0")
	encabezado("Content-Type", "text/plain; charset=utf-8")
	encabezado("Content-Transfer-Encoding", "quoted-printable")
	b.WriteString("\r\n")

	qp := quotedprintable.NewWriter(&b)
	if _, err := qp.Write([]byte(cuerpo)); err != nil {
		return nil, err
	}
	if err := qp.Close(); err != nil {
		return nil, err
	}
	return []byte(b.String()), nil
}

func (s *SMTP) enviar(ctx context.Context, destino string, mensaje []byte) error {
	ctx, cancelar := context.WithTimeout(ctx, plazoDeEnvio)
	defer cancelar()

	host, _, err := net.SplitHostPort(s.direccion)
	if err != nil {
		return fmt.Errorf("la dirección del servidor de correo no es host:puerto: %w", err)
	}
	conexion, err := (&net.Dialer{}).DialContext(ctx, "tcp", s.direccion)
	if err != nil {
		return fmt.Errorf("conectar con el servidor de correo: %w", err)
	}
	if limite, ok := ctx.Deadline(); ok {
		// En una conexión TCP recién abierta SetDeadline no falla; y si fallara, el primer paso del diálogo devuelve el error.
		conexion.SetDeadline(limite) //nolint:errcheck // ver el comentario de arriba
	}
	cliente, err := smtp.NewClient(conexion, host)
	if err != nil {
		conexion.Close() //nolint:errcheck // ya se devuelve el error de saludar
		return respuesta("saludar al servidor de correo", err)
	}
	defer cliente.Close() //nolint:errcheck // tras Quit la conexión ya está cerrada; si se sale antes, ya se devuelve el error de ese paso

	if ofrece, _ := cliente.Extension("STARTTLS"); ofrece {
		if err := cliente.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
			return respuesta("iniciar TLS con el servidor de correo", err)
		}
	}
	if err := cliente.Mail(s.remitente); err != nil {
		return respuesta("remitente rechazado", err)
	}
	if err := cliente.Rcpt(destino); err != nil {
		return respuesta("destinatario rechazado", err)
	}
	w, err := cliente.Data()
	if err != nil {
		return respuesta("iniciar el cuerpo del mensaje", err)
	}
	if _, err := w.Write(mensaje); err != nil {
		return fmt.Errorf("escribir el mensaje: %w", err)
	}
	if err := w.Close(); err != nil {
		return respuesta("el servidor no aceptó el mensaje", err)
	}
	if err := cliente.Quit(); err != nil {
		return respuesta("cerrar el diálogo con el servidor de correo", err)
	}
	return nil
}

// respuesta envuelve un error del diálogo SMTP sin el texto que mandó el servidor: ese texto suele repetir la dirección
// del destinatario y los errores se registran (NM-03, E17 3.13). Un error con código deja solo el código; uno de la
// red o de la conexión cerrada se conserva, porque no trae texto del servidor; cualquier otro (una línea sin código,
// una respuesta que la biblioteca no entiende) se reemplaza por un texto fijo. Así ningún texto del servidor llega
// al registro, sea cual sea su respuesta.
func respuesta(contexto string, err error) error {
	var e *textproto.Error
	var red net.Error
	switch {
	case errors.As(err, &e):
		return fmt.Errorf("%s: el servidor respondió %d", contexto, e.Code)
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF), errors.Is(err, context.DeadlineExceeded),
		errors.Is(err, context.Canceled), errors.As(err, &red):
		return fmt.Errorf("%s: %w", contexto, err)
	default:
		return fmt.Errorf("%s: respuesta del servidor no válida", contexto)
	}
}
