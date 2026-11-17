package correo_test

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

	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/correo"
	"github.com/alcanzamos/alcanzamos/api/src/reloj"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
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
	return &relojtest.Fijo{T: time.Date(2026, 10, 22, 15, 0, 0, 0, time.UTC)}
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

// mensajeEnviado manda un correo con envio por SMTP a un servidor de prueba y devuelve el mensaje crudo que recibió.
func mensajeEnviado(t *testing.T, envio func(s *correo.SMTP) error) []byte {
	t.Helper()
	dir, salida := servidorSMTP(t, false)
	if err := envio(correo.NuevoSMTP(configDePrueba(dir), relojDePrueba())); err != nil {
		t.Fatal(err)
	}
	return []byte((<-salida).datos)
}

func TestMensajeDeVerificacion(t *testing.T) {
	crudo := mensajeEnviado(t, func(s *correo.SMTP) error {
		return s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "tok-en_123")
	})
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
	if err != nil || asunto != "Elige tu contraseña para tu cuenta de Alcanzamos" {
		t.Fatalf("asunto %q (%v)", asunto, err)
	}
	if !strings.HasSuffix(enc.Get("Message-ID"), "@avisos.ejemplo.test>") {
		t.Fatalf("Message-ID %q", enc.Get("Message-ID"))
	}
	for _, fragmento := range []string{
		"https://app.ejemplo.test/verificar?t=tok-en_123",
		// E14-PCP 4.2 quater, palabra por palabra (D-176; la duración, D-192, aprobada por el dueño el 2026-11-06; la última
		// frase cambió con el ítem 294, D-203: el dueño la dictó el 2026-11-13).
		"Hola,\r\n\r\nPediste crear una cuenta en Alcanzamos con este correo. Para confirmarlo y elegir tu contraseña, abre este enlace. Sirve durante 24 horas y una sola vez:\r\n\r\n",
		"Si no lo pediste, ignora este mensaje: si nadie elige la contraseña, en 7 días borramos la cuenta y esta dirección de correo.\r\n",
		"Este mensaje sale de una dirección que no recibe respuestas.\r\n",
	} {
		if !strings.Contains(cuerpo, fragmento) {
			t.Errorf("el cuerpo no contiene %q:\n%s", fragmento, cuerpo)
		}
	}
}

// El aviso de correo ya registrado lleva el asunto y el cuerpo de E14-PCP 4.2 bis palabra por palabra, el pie sale de
// CORREO_PRIVACIDAD y no trae enlaces ni contraseñas (SEG-014).
func TestMensajeDeAvisoDeCorreoRegistrado(t *testing.T) {
	crudo := mensajeEnviado(t, func(s *correo.SMTP) error {
		return s.EnviarAvisoDeCorreoRegistrado(context.Background(), "laura@ejemplo.test")
	})
	enc, cuerpo := leerMensaje(t, crudo)
	asunto, err := new(mime.WordDecoder).DecodeHeader(enc.Get("Subject"))
	if err != nil || asunto != "Alguien intentó crear una cuenta con tu correo" {
		t.Fatalf("asunto %q (%v)", asunto, err)
	}
	if enc.Get("From") != "no-responder@avisos.ejemplo.test" || enc.Get("To") != "laura@ejemplo.test" {
		t.Fatalf("encabezados: %v", enc)
	}
	esperado := "Hola.\r\n\r\n" +
		"Alguien intentó crear una cuenta en Alcanzamos con este correo.\r\n\r\n" +
		"No creamos ninguna cuenta nueva. Tu cuenta sigue igual.\r\n\r\n" +
		"Si fuiste tú, puedes iniciar sesión. Si no recuerdas tu contraseña, puedes recuperar el acceso desde la pantalla de inicio de sesión.\r\n\r\n" +
		"Si no fuiste tú, no tienes que hacer nada.\r\n\r\n" +
		"--\r\n" +
		"Si tienes dudas sobre tus datos, escribe a privacidad@ejemplo.test.\r\n"
	if cuerpo != esperado {
		t.Fatalf("cuerpo:\n%q\nse esperaba:\n%q", cuerpo, esperado)
	}
	for _, prohibido := range []string{"http://", "https://", "verificar", "contraseña:"} {
		if strings.Contains(cuerpo, prohibido) {
			t.Errorf("el aviso no debe llevar %q", prohibido)
		}
	}
}

// Los dos correos terminan con el pie de E14-PCP 4.2 bis, con el texto exacto (D-143).
func TestLosDosCorreosTerminanConElPieExacto(t *testing.T) {
	const pie = "Si tienes dudas sobre tus datos, escribe a privacidad@ejemplo.test.\r\n"
	verificacion := mensajeEnviado(t, func(s *correo.SMTP) error {
		return s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "tok-en_123")
	})
	aviso := mensajeEnviado(t, func(s *correo.SMTP) error {
		return s.EnviarAvisoDeCorreoRegistrado(context.Background(), "laura@ejemplo.test")
	})
	recuperacion := mensajeEnviado(t, func(s *correo.SMTP) error {
		return s.EnviarRecuperacion(context.Background(), "laura@ejemplo.test", "tok-en_123")
	})
	for nombre, crudo := range map[string][]byte{"verificación": verificacion, "aviso": aviso, "recuperación": recuperacion} {
		_, cuerpo := leerMensaje(t, crudo)
		if !strings.HasSuffix(cuerpo, "\r\n"+pie) {
			t.Errorf("el correo de %s no termina con el pie exacto:\n%q", nombre, cuerpo)
		}
		if strings.Contains(cuerpo, "Si tienes preguntas") {
			t.Errorf("el correo de %s trae el pie anterior", nombre)
		}
	}
}

// El correo de recuperación lleva el enlace de PN-62 con el token y dice que sirve 1 hora (E13 §5.4).
func TestMensajeDeRecuperacion(t *testing.T) {
	crudo := mensajeEnviado(t, func(s *correo.SMTP) error {
		return s.EnviarRecuperacion(context.Background(), "laura@ejemplo.test", "tok-en_123")
	})
	enc, cuerpo := leerMensaje(t, crudo)
	if asunto, err := new(mime.WordDecoder).DecodeHeader(enc.Get("Subject")); err != nil || asunto != "Recupera el acceso a tu cuenta de Alcanzamos" {
		t.Fatalf("asunto %q (%v)", asunto, err)
	}
	if enc.Get("From") != "no-responder@avisos.ejemplo.test" || enc.Get("To") != "laura@ejemplo.test" {
		t.Fatalf("encabezados: %v", enc)
	}
	for _, fragmento := range []string{"https://app.ejemplo.test/recuperar?t=tok-en_123", "1 hora", "ignora este mensaje"} {
		if !strings.Contains(cuerpo, fragmento) {
			t.Errorf("el cuerpo no contiene %q:\n%s", fragmento, cuerpo)
		}
	}
}

func TestEnviarRecuperacionPorSMTP(t *testing.T) {
	dir, salida := servidorSMTP(t, false)
	s := correo.NuevoSMTP(configDePrueba(dir), relojDePrueba())
	if err := s.EnviarRecuperacion(context.Background(), "laura@ejemplo.test", "abc"); err != nil {
		t.Fatal(err)
	}
	rec := <-salida
	if rec.destinatario != "laura@ejemplo.test" {
		t.Fatalf("sobre inesperado: %+v", rec)
	}
	if _, cuerpo := leerMensaje(t, []byte(rec.datos)); !strings.Contains(cuerpo, "/recuperar?t=abc") {
		t.Fatalf("el mensaje no trae el enlace:\n%s", cuerpo)
	}
	if err := s.EnviarRecuperacion(context.Background(), "no es un correo", "abc"); err == nil {
		t.Error("un destino inválido debe fallar")
	}
}

func TestEnviarAvisoPorSMTP(t *testing.T) {
	dir, salida := servidorSMTP(t, false)
	s := correo.NuevoSMTP(configDePrueba(dir), relojDePrueba())
	if err := s.EnviarAvisoDeCorreoRegistrado(context.Background(), "laura@ejemplo.test"); err != nil {
		t.Fatal(err)
	}
	rec := <-salida
	if rec.remitente != "no-responder@avisos.ejemplo.test" || rec.destinatario != "laura@ejemplo.test" {
		t.Fatalf("sobre inesperado: %+v", rec)
	}
	if err := s.EnviarAvisoDeCorreoRegistrado(context.Background(), "no es un correo"); err == nil {
		t.Fatal("un destino inválido debe fallar")
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
	s := correo.NuevoSMTP(configDePrueba(dir), relojDePrueba())
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
		s := correo.NuevoSMTP(configDePrueba("127.0.0.1:1"), relojDePrueba())
		if err := s.EnviarVerificacion(context.Background(), "no es un correo", "abc"); err == nil {
			t.Fatal("se esperaba un error")
		}
	})
	t.Run("dirección del servidor sin puerto", func(t *testing.T) {
		s := correo.NuevoSMTP(configDePrueba("sin-puerto"), relojDePrueba())
		err := s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "abc")
		if err == nil || !strings.Contains(err.Error(), "host:puerto") || strings.Contains(err.Error(), "laura") {
			t.Fatalf("error inesperado: %v", err)
		}
	})
	t.Run("servidor caído", func(t *testing.T) {
		l, _ := net.Listen("tcp", "127.0.0.1:0")
		dir := l.Addr().String()
		l.Close()
		s := correo.NuevoSMTP(configDePrueba(dir), relojDePrueba())
		if err := s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "abc"); err == nil {
			t.Fatal("se esperaba un error")
		}
	})
	t.Run("el texto del servidor, con la dirección, no sale en el error", func(t *testing.T) {
		dir, _ := servidorSMTP(t, true)
		s := correo.NuevoSMTP(configDePrueba(dir), relojDePrueba())
		err := s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "abc")
		if err == nil || strings.Contains(err.Error(), "laura") || !strings.Contains(err.Error(), "550") {
			t.Fatalf("error inesperado: %v", err)
		}
	})
}

// Cada paso del diálogo SMTP que falla da un error propio y, cuando el servidor responde con un código, solo el código.
func TestEnviarFallaEnCadaPasoDelDialogo(t *testing.T) {
	casos := []struct {
		nombre, saludo string
		guion          map[string]string
		quiere         string
	}{
		{"saludo rechazado", "554 sin servicio", nil, "saludar al servidor de correo"},
		{"TLS que no negocia", "220 hola", map[string]string{"EHLO": "250-prueba\r\n250 STARTTLS", "STARTTLS": "220 listo"}, "iniciar TLS"},
		{"remitente rechazado", "220 hola", map[string]string{"MAIL": "550 no"}, "remitente rechazado: el servidor respondió 550"},
		{"conexión cortada al dar el remitente", "220 hola", map[string]string{"MAIL": ""}, "remitente rechazado"},
		{"inicio de los datos rechazado", "220 hola", map[string]string{"DATA": "554 no"}, "iniciar el cuerpo del mensaje: el servidor respondió 554"},
		{"cierre del diálogo", "220 hola", map[string]string{"QUIT": ""}, "cerrar el diálogo con el servidor de correo"},
		{"mensaje no aceptado", "220 hola", map[string]string{".": "554 spam"}, "el servidor no aceptó el mensaje: el servidor respondió 554"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			s := correo.NuevoSMTP(configDePrueba(correotest.ServidorGuionado(t, c.saludo, c.guion)), relojDePrueba())
			err := s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "abc")
			if err == nil || !strings.Contains(err.Error(), c.quiere) || strings.Contains(err.Error(), "laura") {
				t.Fatalf("error %v, se esperaba %q", err, c.quiere)
			}
		})
	}
}

func TestFalsoGuardaYFalla(t *testing.T) {
	f := &correotest.Falso{}
	if err := f.EnviarVerificacion(context.Background(), "a@b.test", "t"); err != nil {
		t.Fatal(err)
	}
	if e := f.Enviados(); len(e) != 1 || e[0] != (correotest.Envio{Destino: "a@b.test", Token: "t"}) {
		t.Fatalf("enviados: %+v", e)
	}
	if err := f.EnviarAvisoDeCorreoRegistrado(context.Background(), "e@f.test"); err != nil {
		t.Fatal(err)
	}
	if e := f.Enviados(); len(e) != 2 || e[1] != (correotest.Envio{Destino: "e@f.test", Aviso: true}) {
		t.Fatalf("enviados: %+v", e)
	}
	if err := f.EnviarRecuperacion(context.Background(), "g@h.test", "r"); err != nil {
		t.Fatal(err)
	}
	if e := f.Enviados(); len(e) != 3 || e[2] != (correotest.Envio{Destino: "g@h.test", Token: "r", Recuperacion: true}) {
		t.Fatalf("enviados: %+v", e)
	}
	if err := f.EnviarAvisoDePurga(context.Background(), "i@j.test", momentoDelBorradoDePrueba); err != nil {
		t.Fatal(err)
	}
	if e := f.Enviados(); len(e) != 4 || e[3] != (correotest.Envio{Destino: "i@j.test", AvisoDePurga: true, BorradoEn: momentoDelBorradoDePrueba}) {
		t.Fatalf("enviados: %+v", e)
	}
	f.Error = errors.New("caído")
	if err := f.EnviarAvisoDePurga(context.Background(), "c@d.test", momentoDelBorradoDePrueba); err == nil || len(f.Enviados()) != 4 {
		t.Fatal("el aviso de purga con Error tampoco guarda")
	}
	if err := f.EnviarVerificacion(context.Background(), "c@d.test", "u"); err == nil || len(f.Enviados()) != 4 {
		t.Fatal("con Error no debe guardar y debe devolverlo")
	}
	if err := f.EnviarAvisoDeCorreoRegistrado(context.Background(), "c@d.test"); err == nil || len(f.Enviados()) != 4 {
		t.Fatal("el aviso con Error tampoco guarda")
	}
	if err := f.EnviarRecuperacion(context.Background(), "c@d.test", "u"); err == nil || len(f.Enviados()) != 4 {
		t.Fatal("la recuperación con Error tampoco guarda")
	}
}

// Los textos de los correos no pasan por diseno/textos/es.json: esta prueba es lo único que los cuida. Compara el asunto
// y el cuerpo completo, con el pie, palabra por palabra contra E14-PCP: 4.2 quater (verificación; D-176, D-192 y D-203),
// 4.2 bis (aviso de correo ya registrado; D-192), el aviso de antes de la purga (ítem 294; D-203) y 4.4 bis
// (recuperación del acceso; D-143).
func TestLosCuatroCorreosSonPalabraPorPalabraLosDeE14(t *testing.T) {
	const pie = "Si tienes dudas sobre tus datos, escribe a privacidad@ejemplo.test.\r\n"
	casos := []struct {
		nombre, asunto, cuerpo string
		envio                  func(s *correo.SMTP) error
	}{
		{"verificación (4.2 quater)", "Elige tu contraseña para tu cuenta de Alcanzamos",
			"Hola,\r\n\r\n" +
				"Pediste crear una cuenta en Alcanzamos con este correo. Para confirmarlo y elegir tu contraseña, abre este enlace. Sirve durante 24 horas y una sola vez:\r\n\r\n" +
				"https://app.ejemplo.test/verificar?t=tok-en_123\r\n\r\n" +
				"Si no lo pediste, ignora este mensaje: si nadie elige la contraseña, en 7 días borramos la cuenta y esta dirección de correo.\r\n\r\n" +
				"--\r\n" +
				"Este mensaje sale de una dirección que no recibe respuestas.\r\n" + pie,
			func(s *correo.SMTP) error {
				return s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "tok-en_123")
			}},
		{"aviso (4.2 bis)", "Alguien intentó crear una cuenta con tu correo",
			"Hola.\r\n\r\n" +
				"Alguien intentó crear una cuenta en Alcanzamos con este correo.\r\n\r\n" +
				"No creamos ninguna cuenta nueva. Tu cuenta sigue igual.\r\n\r\n" +
				"Si fuiste tú, puedes iniciar sesión. Si no recuerdas tu contraseña, puedes recuperar el acceso desde la pantalla de inicio de sesión.\r\n\r\n" +
				"Si no fuiste tú, no tienes que hacer nada.\r\n\r\n" +
				"--\r\n" + pie,
			func(s *correo.SMTP) error {
				return s.EnviarAvisoDeCorreoRegistrado(context.Background(), "laura@ejemplo.test")
			}},
		{"aviso de antes de la purga (ítem 294)", "Tu cuenta de Alcanzamos se borra en 2 días",
			"Hola,\r\n\r\n" +
				"Confirmaste tu correo en Alcanzamos, pero todavía no autorizaste el uso de tus datos. Sin esa autorización no podemos guardar tu cuenta. Si no autorizas, la borramos el 18 de noviembre de 2026, a las 9:30 a. m., con todo lo que tenga.\r\n\r\n" +
				"Para autorizar, entra a Alcanzamos con tu correo y tu contraseña, en la app o aquí: https://app.ejemplo.test/entrar\r\n\r\n" +
				"Si ya no quieres la cuenta, no tienes que hacer nada.\r\n\r\n" +
				"--\r\n" +
				"Este mensaje sale de una dirección que no recibe respuestas.\r\n" + pie,
			func(s *correo.SMTP) error {
				return s.EnviarAvisoDePurga(context.Background(), "laura@ejemplo.test", momentoDelBorradoDePrueba)
			}},
		{"recuperación (4.4 bis)", "Recupera el acceso a tu cuenta de Alcanzamos",
			"Hola,\r\n\r\n" +
				"Pediste recuperar el acceso a tu cuenta de Alcanzamos. Para elegir una contraseña nueva, abre este enlace. Sirve durante 1 hora y una sola vez:\r\n\r\n" +
				"https://app.ejemplo.test/recuperar?t=tok-en_123\r\n\r\n" +
				"Si no lo pediste, ignora este mensaje: tu contraseña sigue igual.\r\n\r\n" +
				"--\r\n" +
				"Este mensaje sale de una dirección que no recibe respuestas.\r\n" + pie,
			func(s *correo.SMTP) error {
				return s.EnviarRecuperacion(context.Background(), "laura@ejemplo.test", "tok-en_123")
			}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			enc, cuerpo := leerMensaje(t, mensajeEnviado(t, c.envio))
			asunto, err := new(mime.WordDecoder).DecodeHeader(enc.Get("Subject"))
			if err != nil || asunto != c.asunto {
				t.Errorf("asunto %q (%v), se esperaba %q", asunto, err, c.asunto)
			}
			if cuerpo != c.cuerpo {
				t.Errorf("cuerpo:\n%q\nse esperaba:\n%q", cuerpo, c.cuerpo)
			}
		})
	}
}

// 18 de noviembre de 2026, 14:30 UTC = 9:30 a. m. en Colombia.
var momentoDelBorradoDePrueba = time.Date(2026, time.November, 18, 14, 30, 0, 0, time.UTC)

// El aviso de antes de la purga (ítem 294, S5): el asunto y el cuerpo del dueño, palabra por palabra; la fecha es el momento
// del borrado en palabras y en hora de Colombia (D-090); el enlace es URL_PUBLICA + /entrar; y después va el pie de siempre.
func TestMensajeDelAvisoDePurga(t *testing.T) {
	crudo := mensajeEnviado(t, func(s *correo.SMTP) error {
		return s.EnviarAvisoDePurga(context.Background(), "laura@ejemplo.test", momentoDelBorradoDePrueba)
	})
	enc, cuerpo := leerMensaje(t, crudo)
	asunto, err := new(mime.WordDecoder).DecodeHeader(enc.Get("Subject"))
	if err != nil || asunto != "Tu cuenta de Alcanzamos se borra en 2 días" {
		t.Fatalf("asunto %q (%v)", asunto, err)
	}
	if enc.Get("From") != "no-responder@avisos.ejemplo.test" || enc.Get("To") != "laura@ejemplo.test" {
		t.Fatalf("encabezados: %v", enc)
	}
	esperado := "Hola,\r\n\r\n" +
		"Confirmaste tu correo en Alcanzamos, pero todavía no autorizaste el uso de tus datos. Sin esa autorización no podemos guardar tu cuenta. Si no autorizas, la borramos el 18 de noviembre de 2026, a las 9:30 a. m., con todo lo que tenga.\r\n\r\n" +
		"Para autorizar, entra a Alcanzamos con tu correo y tu contraseña, en la app o aquí: https://app.ejemplo.test/entrar\r\n\r\n" +
		"Si ya no quieres la cuenta, no tienes que hacer nada.\r\n\r\n" +
		"--\r\n" +
		"Este mensaje sale de una dirección que no recibe respuestas.\r\n" +
		"Si tienes dudas sobre tus datos, escribe a privacidad@ejemplo.test.\r\n"
	if cuerpo != esperado {
		t.Fatalf("cuerpo:\n%q\nse esperaba:\n%q", cuerpo, esperado)
	}
	if strings.Contains(cuerpo, "?t=") {
		t.Error("el aviso no lleva ningún token: se entra con el correo y la contraseña")
	}
}

// La fecha del aviso sale del momento que se le pasa, no de la hora del reloj del correo: el Date del mensaje sigue siendo
// el del reloj (22 de octubre) y el cuerpo dice el 18 de noviembre.
func TestElAvisoDePurgaDiceLaFechaDelBorradoNoLaDeHoy(t *testing.T) {
	crudo := mensajeEnviado(t, func(s *correo.SMTP) error {
		return s.EnviarAvisoDePurga(context.Background(), "laura@ejemplo.test", time.Date(2026, time.December, 1, 2, 45, 0, 0, time.UTC))
	})
	enc, cuerpo := leerMensaje(t, crudo)
	if enc.Get("Date") != "Thu, 22 Oct 2026 15:00:00 +0000" {
		t.Errorf("Date %q", enc.Get("Date"))
	}
	if !strings.Contains(cuerpo, "la borramos el 30 de noviembre de 2026, a las 9:45 p. m., con todo lo que tenga.") {
		t.Errorf("la fecha debe ser la de Colombia (30 de noviembre, 9:45 p. m.):\n%s", cuerpo)
	}
}

func TestEnviarAvisoDePurgaPorSMTP(t *testing.T) {
	dir, salida := servidorSMTP(t, false)
	s := correo.NuevoSMTP(configDePrueba(dir), relojDePrueba())
	if err := s.EnviarAvisoDePurga(context.Background(), "laura@ejemplo.test", momentoDelBorradoDePrueba); err != nil {
		t.Fatal(err)
	}
	rec := <-salida
	if rec.remitente != "no-responder@avisos.ejemplo.test" || rec.destinatario != "laura@ejemplo.test" {
		t.Fatalf("sobre inesperado: %+v", rec)
	}
	if err := s.EnviarAvisoDePurga(context.Background(), "no es un correo", momentoDelBorradoDePrueba); err == nil {
		t.Fatal("un destino inválido debe fallar")
	}
}

// Un servidor que acepta la conexión y no dice nada: con un contexto corto, el envío falla en ese plazo y no antes de
// tiempo (S4: la tarea manda el aviso con las filas bloqueadas y no puede quedarse esperando).
func TestEnviarAvisoDePurgaConUnServidorQueNoResponde(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			t.Cleanup(func() { c.Close() })
		}
	}()
	s := correo.NuevoSMTP(configDePrueba(l.Addr().String()), relojDePrueba())
	ctx, cancelar := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancelar()
	inicio := time.Now()
	err = s.EnviarAvisoDePurga(ctx, "laura@ejemplo.test", momentoDelBorradoDePrueba)
	if err == nil {
		t.Fatal("se esperaba un error")
	}
	if tardo := time.Since(inicio); tardo > 3*time.Second {
		t.Errorf("el envío tardó %v con un plazo de 300 ms", tardo)
	}
}
