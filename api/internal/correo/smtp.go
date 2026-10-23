package correo

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/config"
	"github.com/alcanzamos/alcanzamos/api/internal/reloj"
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

// enlaceDeVerificacion es URL_PUBLICA + /verificar?t=<token>. La ruta de la web existe desde la US-49 (PR 3).
func (s *SMTP) enlaceDeVerificacion(token string) string {
	return s.urlPublica + "/verificar?t=" + url.QueryEscape(token)
}

// mensajeDeVerificacion arma el mensaje de verificación.
func (s *SMTP) mensajeDeVerificacion(destino, token string) ([]byte, error) {
	cuerpo := "Hola,\r\n\r\n" +
		"Para confirmar tu correo y seguir con tu cuenta de Alcanzamos, abre este enlace. Sirve durante 24 horas:\r\n\r\n" +
		s.enlaceDeVerificacion(token) + "\r\n\r\n" +
		"Si no creaste una cuenta, ignora este mensaje: no pasa nada.\r\n\r\n" +
		"--\r\n" +
		"Este mensaje sale de una dirección que no recibe respuestas.\r\n" +
		"Si tienes preguntas sobre tus datos, escribe a " + s.privacidad + ".\r\n"
	return s.mensaje(destino, "Confirma tu correo en Alcanzamos", cuerpo)
}

// Texto del aviso de correo ya registrado: E14-PCP v1.11, 4.2 bis, palabra por palabra (texto propuesto, lo revisa el
// dueño). No lleva enlaces ni contraseñas. El pie sale de CORREO_PRIVACIDAD.
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
	return s.mensaje(destino, asuntoDelAviso, cuerpoDelAviso+"Si tienes dudas sobre tus datos, escribe a "+s.privacidad+".\r\n")
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

	conexion, err := (&net.Dialer{}).DialContext(ctx, "tcp", s.direccion)
	if err != nil {
		return fmt.Errorf("conectar con el servidor de correo: %w", err)
	}
	if limite, ok := ctx.Deadline(); ok {
		_ = conexion.SetDeadline(limite)
	}
	host, _, _ := net.SplitHostPort(s.direccion)
	cliente, err := smtp.NewClient(conexion, host)
	if err != nil {
		_ = conexion.Close()
		return fmt.Errorf("saludar al servidor de correo: %w", err)
	}
	defer cliente.Close()

	if ofrece, _ := cliente.Extension("STARTTLS"); ofrece {
		if err := cliente.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
			return fmt.Errorf("iniciar TLS con el servidor de correo: %w", err)
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
	return cliente.Quit()
}

// respuesta envuelve un error del servidor SMTP sin su texto: ese texto suele repetir la dirección del destinatario
// y los errores se registran (NM-03). Deja solo el código de la respuesta.
func respuesta(contexto string, err error) error {
	var e *textproto.Error
	if errors.As(err, &e) {
		return fmt.Errorf("%s: el servidor respondió %d", contexto, e.Code)
	}
	return fmt.Errorf("%s: %w", contexto, err)
}
