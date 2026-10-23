package correo

import (
	"bufio"
	"context"
	"errors"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/config"
	"github.com/alcanzamos/alcanzamos/api/internal/reloj"
)

func configDePrueba(direccion string) config.Config {
	return config.Config{
		CorreoSMTP:       direccion,
		CorreoRemitente:  "no-responder@avisos.ejemplo.test",
		CorreoPrivacidad: "privacidad@ejemplo.test",
		URLPublica:       "https://app.ejemplo.test",
	}
}

func relojDePrueba() reloj.Reloj {
	return &reloj.Fijo{T: time.Date(2026, 10, 22, 15, 0, 0, 0, time.UTC)}
}

// leerMensaje decodifica el mensaje crudo: encabezados y cuerpo ya sin quoted-printable.
func leerMensaje(t *testing.T, crudo []byte) (mail.Header, string) {
	t.Helper()
	m, err := mail.ReadMessage(strings.NewReader(string(crudo)))
	if err != nil {
		t.Fatal(err)
	}
	cuerpo, err := io.ReadAll(quotedprintable.NewReader(m.Body))
	if err != nil {
		t.Fatal(err)
	}
	return m.Header, string(cuerpo)
}

func TestMensajeDeVerificacion(t *testing.T) {
	s := NuevoSMTP(configDePrueba("127.0.0.1:1025"), relojDePrueba())
	crudo, err := s.mensajeDeVerificacion("laura@ejemplo.test", "tok-en_123")
	if err != nil {
		t.Fatal(err)
	}
	enc, cuerpo := leerMensaje(t, crudo)

	casos := []struct {
		nombre, obtenido, esperado string
	}{
		{"From", enc.Get("From"), "no-responder@avisos.ejemplo.test"},
		{"To", enc.Get("To"), "laura@ejemplo.test"},
		{"Content-Type", enc.Get("Content-Type"), "text/plain; charset=utf-8"},
		{"Date", enc.Get("Date"), "Thu, 22 Oct 2026 15:00:00 +0000"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			if c.obtenido != c.esperado {
				t.Fatalf("%s = %q, se esperaba %q", c.nombre, c.obtenido, c.esperado)
			}
		})
	}
	asunto, err := new(mime.WordDecoder).DecodeHeader(enc.Get("Subject"))
	if err != nil || asunto != "Confirma tu correo en Alcanzamos" {
		t.Fatalf("asunto %q (%v)", asunto, err)
	}
	if !strings.HasSuffix(enc.Get("Message-ID"), "@avisos.ejemplo.test>") {
		t.Fatalf("Message-ID %q", enc.Get("Message-ID"))
	}
	for _, fragmento := range []string{
		"https://app.ejemplo.test/verificar?t=tok-en_123",
		"24 horas",
		"escribe a privacidad@ejemplo.test.",
		"ignora este mensaje",
	} {
		if !strings.Contains(cuerpo, fragmento) {
			t.Errorf("el cuerpo no contiene %q:\n%s", fragmento, cuerpo)
		}
	}
}

// servidorSMTP es un servidor SMTP mínimo: acepta un mensaje y entrega lo que recibió.
type recibido struct {
	remitente, destinatario, datos string
}

func servidorSMTP(t *testing.T, rechazarDestinatario bool) (string, <-chan recibido) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	salida := make(chan recibido, 1)
	go func() {
		c, err := l.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		r := bufio.NewReader(c)
		resp := func(s string) { _, _ = io.WriteString(c, s+"\r\n") }
		var rec recibido
		resp("220 prueba ESMTP")
		for {
			linea, err := r.ReadString('\n')
			if err != nil {
				return
			}
			linea = strings.TrimRight(linea, "\r\n")
			switch {
			case strings.HasPrefix(linea, "EHLO"):
				resp("250 prueba")
			case strings.HasPrefix(linea, "MAIL FROM:"):
				rec.remitente = strings.Trim(strings.TrimPrefix(linea, "MAIL FROM:"), "<>")
				resp("250 ok")
			case strings.HasPrefix(linea, "RCPT TO:"):
				if rechazarDestinatario {
					resp("550 5.1.1 <" + strings.Trim(strings.TrimPrefix(linea, "RCPT TO:"), "<>") + "> no existe")
					continue
				}
				rec.destinatario = strings.Trim(strings.TrimPrefix(linea, "RCPT TO:"), "<>")
				resp("250 ok")
			case linea == "DATA":
				resp("354 siga")
				var b strings.Builder
				for {
					l, err := r.ReadString('\n')
					if err != nil || l == ".\r\n" {
						break
					}
					b.WriteString(l)
				}
				rec.datos = b.String()
				resp("250 encolado")
			case linea == "QUIT":
				resp("221 adiós")
				salida <- rec
				return
			default:
				resp("250 ok")
			}
		}
	}()
	return l.Addr().String(), salida
}

func TestEnviarVerificacionPorSMTP(t *testing.T) {
	dir, salida := servidorSMTP(t, false)
	s := NuevoSMTP(configDePrueba(dir), relojDePrueba())
	if err := s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "abc"); err != nil {
		t.Fatal(err)
	}
	rec := <-salida
	if rec.remitente != "no-responder@avisos.ejemplo.test" || rec.destinatario != "laura@ejemplo.test" {
		t.Fatalf("sobre inesperado: %+v", rec)
	}
	if _, cuerpo := leerMensaje(t, []byte(rec.datos)); !strings.Contains(cuerpo, "/verificar?t=abc") {
		t.Fatalf("el mensaje no trae el enlace:\n%s", cuerpo)
	}
}

func TestEnviarVerificacionErrores(t *testing.T) {
	t.Run("destino inválido", func(t *testing.T) {
		s := NuevoSMTP(configDePrueba("127.0.0.1:1"), relojDePrueba())
		if err := s.EnviarVerificacion(context.Background(), "no es un correo", "abc"); err == nil {
			t.Fatal("se esperaba un error")
		}
	})
	t.Run("servidor caído", func(t *testing.T) {
		l, _ := net.Listen("tcp", "127.0.0.1:0")
		dir := l.Addr().String()
		l.Close()
		s := NuevoSMTP(configDePrueba(dir), relojDePrueba())
		if err := s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "abc"); err == nil {
			t.Fatal("se esperaba un error")
		}
	})
	t.Run("el texto del servidor, con la dirección, no sale en el error", func(t *testing.T) {
		dir, _ := servidorSMTP(t, true)
		s := NuevoSMTP(configDePrueba(dir), relojDePrueba())
		err := s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "abc")
		if err == nil || strings.Contains(err.Error(), "laura") || !strings.Contains(err.Error(), "550") {
			t.Fatalf("error inesperado: %v", err)
		}
	})
}

func TestFalsoGuardaYFalla(t *testing.T) {
	f := &Falso{}
	if err := f.EnviarVerificacion(context.Background(), "a@b.test", "t"); err != nil {
		t.Fatal(err)
	}
	if e := f.Enviados(); len(e) != 1 || e[0] != (Envio{"a@b.test", "t"}) {
		t.Fatalf("enviados: %+v", e)
	}
	f.Error = errors.New("caído")
	if err := f.EnviarVerificacion(context.Background(), "c@d.test", "u"); err == nil || len(f.Enviados()) != 1 {
		t.Fatal("con Error no debe guardar y debe devolverlo")
	}
}
