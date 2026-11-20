package correo_test

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/correo"
)

// US-80 (D-205 (6)): el adaptador se autentica después de STARTTLS. Estas pruebas usan un servidor SMTP falso, en el
// mismo proceso, con un certificado autofirmado que solo el cliente de la prueba acepta.

const (
	usuarioDePrueba = "emailapikey"
	claveDePrueba   = "clave-secreta-del-agente-4455"
	// textoDelServidor es lo que un servidor puede repetir en sus respuestas: la dirección y hasta la clave.
	textoDelServidor = "texto-del-servidor-que-no-debe-salir laura@ejemplo.test " + claveDePrueba
)

// guion dice cómo responde el servidor falso. Una cadena vacía es la respuesta normal de cada paso.
type guion struct {
	sinSTARTTLS       bool   // no ofrece STARTTLS
	sinAUTH           bool   // no ofrece AUTH
	saludo            string // 220 por defecto
	respuestaSTARTTLS string // 220 por defecto
	respuestaAUTH     string // 235 por defecto
	respuestaMAIL     string
	respuestaRCPT     string
	respuestaDATA     string // la que sigue a «DATA»; 354 por defecto
	respuestaFin      string // la que sigue al punto final; 250 por defecto
	cortarEnMAIL      bool
	certParaOtroHost  bool   // el certificado es de confianza pero no es válido para 127.0.0.1
	versionMaximaTLS  uint16 // 0: la del servidor por defecto
}

// vistoPorElServidor es lo que el servidor falso observó.
type vistoPorElServidor struct {
	mu sync.Mutex
	estadoDelServidor
}

type estadoDelServidor struct {
	claro         []string // comandos recibidos antes de TLS
	cifrado       []string // comandos recibidos después de TLS
	usuario       string
	clave         string
	mecanismo     string
	autenticado   bool
	mailAntesAuth bool
	datos         string
	envios        int
}

// foto copia lo observado bajo el candado: el servidor lo escribe en otra goroutine.
func (v *vistoPorElServidor) foto() estadoDelServidor {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.estadoDelServidor
}

func (v *vistoPorElServidor) comandos() (claro, cifrado []string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return append([]string(nil), v.claro...), append([]string(nil), v.cifrado...)
}

func (v *vistoPorElServidor) huboComando(prefijo string) bool {
	claro, cifrado := v.comandos()
	for _, c := range append(claro, cifrado...) {
		if strings.HasPrefix(c, prefijo) {
			return true
		}
	}
	return false
}

// certificadoAutofirmado devuelve el certificado del servidor (válido para 127.0.0.1) y el conjunto de raíces que lo acepta.
func certificadoAutofirmado(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	return certificadoPara(t, net.ParseIP("127.0.0.1"))
}

// certificadoPara es un certificado autofirmado válido solo para la IP dada.
func certificadoPara(t *testing.T, ip net.IP) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	clave, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	plantilla := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "smtp de prueba"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		IPAddresses:           []net.IP{ip},
	}
	der, err := x509.CreateCertificate(rand.Reader, plantilla, plantilla, &clave.PublicKey, clave)
	if err != nil {
		t.Fatal(err)
	}
	hoja, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(hoja)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: clave}, pool
}

// servidorConAUTH levanta el servidor falso. Exige AUTH PLAIN antes de MAIL cuando ofrece AUTH. Devuelve la dirección,
// lo que observó y las raíces que el cliente debe confiar.
func servidorConAUTH(t *testing.T, g guion) (string, *vistoPorElServidor, *x509.CertPool) {
	t.Helper()
	cert, raices := certificadoAutofirmado(t)
	if g.certParaOtroHost {
		cert, raices = certificadoPara(t, net.ParseIP("10.20.30.40"))
	}
	cfgTLS := &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
	if g.versionMaximaTLS != 0 {
		cfgTLS.MinVersion, cfgTLS.MaxVersion = tls.VersionTLS10, g.versionMaximaTLS
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	visto := &vistoPorElServidor{}
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go atenderConAUTH(c, g, visto, cfgTLS)
		}
	}()
	return l.Addr().String(), visto, raices
}

func atenderConAUTH(c net.Conn, g guion, visto *vistoPorElServidor, cfgTLS *tls.Config) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(10 * time.Second))
	conn := net.Conn(c)
	leer := bufio.NewReader(conn)
	cifrado := false
	resp := func(s string) { _, _ = io.WriteString(conn, s+"\r\n") }
	o := func(por, normal string) string {
		if por != "" {
			return por
		}
		return normal
	}
	registrar := func(linea string) {
		visto.mu.Lock()
		defer visto.mu.Unlock()
		if cifrado {
			visto.cifrado = append(visto.cifrado, linea)
		} else {
			visto.claro = append(visto.claro, linea)
		}
	}
	resp(o(g.saludo, "220 prueba ESMTP"))
	for {
		linea, err := leer.ReadString('\n')
		if err != nil {
			return
		}
		linea = strings.TrimRight(linea, "\r\n")
		if strings.HasPrefix(linea, "AUTH ") {
			// No se guarda la línea de AUTH tal cual en los comandos: lleva la clave en base64.
			registrar("AUTH " + strings.Fields(linea)[1])
		} else {
			registrar(linea)
		}
		switch {
		case strings.HasPrefix(linea, "EHLO"):
			lineas := []string{"250-prueba"}
			if !g.sinSTARTTLS && !cifrado {
				lineas = append(lineas, "250-STARTTLS")
			}
			if !g.sinAUTH {
				lineas = append(lineas, "250-AUTH PLAIN LOGIN")
			}
			lineas = append(lineas, "250 8BITMIME")
			resp(strings.Join(lineas, "\r\n"))
		case linea == "STARTTLS":
			r := o(g.respuestaSTARTTLS, "220 listo")
			resp(r)
			if !strings.HasPrefix(r, "220") {
				continue
			}
			tc := tls.Server(conn, cfgTLS)
			if err := tc.Handshake(); err != nil {
				return
			}
			conn = tc
			leer = bufio.NewReader(conn)
			cifrado = true
		case strings.HasPrefix(linea, "AUTH PLAIN "):
			crudo, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(linea, "AUTH PLAIN "))
			partes := strings.Split(string(crudo), "\x00")
			r := o(g.respuestaAUTH, "235 2.7.0 autenticado")
			if err != nil || len(partes) != 3 {
				r = "501 formato"
			}
			visto.mu.Lock()
			visto.mecanismo = "PLAIN"
			if len(partes) == 3 {
				visto.usuario, visto.clave = partes[1], partes[2]
			}
			visto.autenticado = strings.HasPrefix(r, "235")
			visto.mu.Unlock()
			resp(r)
		case strings.HasPrefix(linea, "AUTH "):
			resp("504 mecanismo no admitido")
		case strings.HasPrefix(linea, "MAIL FROM:"):
			if g.cortarEnMAIL {
				return
			}
			visto.mu.Lock()
			if !g.sinAUTH && !visto.autenticado {
				visto.mailAntesAuth = true
				visto.mu.Unlock()
				resp("530 5.7.0 " + textoDelServidor)
				continue
			}
			visto.mu.Unlock()
			resp(o(g.respuestaMAIL, "250 ok"))
		case strings.HasPrefix(linea, "RCPT TO:"):
			resp(o(g.respuestaRCPT, "250 ok"))
		case linea == "DATA":
			r := o(g.respuestaDATA, "354 siga")
			resp(r)
			if !strings.HasPrefix(r, "354") {
				continue
			}
			var b strings.Builder
			for {
				l, err := leer.ReadString('\n')
				if err != nil || l == ".\r\n" {
					break
				}
				b.WriteString(l)
			}
			visto.mu.Lock()
			visto.datos = b.String()
			visto.mu.Unlock()
			r = o(g.respuestaFin, "250 encolado")
			if strings.HasPrefix(r, "250") {
				visto.mu.Lock()
				visto.envios++
				visto.mu.Unlock()
			}
			resp(r)
		case linea == "QUIT":
			resp("221 adiós")
			return
		default:
			resp("250 ok")
		}
	}
}

func configConAUTH(direccion string) config.Config {
	c := configDePrueba(direccion)
	c.CorreoUsuario = usuarioDePrueba
	c.CorreoContrasena = config.Secreto(claveDePrueba)
	return c
}

func adaptadorConAUTH(direccion string, raices *x509.CertPool) *correo.SMTP {
	return correo.NuevoSMTP(configConAUTH(direccion), relojDePrueba()).ConRaicesDeConfianza(raices)
}

func enviarPrueba(s *correo.SMTP) error {
	return s.EnviarVerificacion(context.Background(), "laura@ejemplo.test", "tok-en_123")
}

// Camino feliz: STARTTLS, después AUTH PLAIN con el usuario y la contraseña, y solo entonces el mensaje.
func TestAutenticaDespuesDeSTARTTLS(t *testing.T) {
	dir, visto, raices := servidorConAUTH(t, guion{})
	if err := enviarPrueba(adaptadorConAUTH(dir, raices)); err != nil {
		t.Fatal(err)
	}
	e := visto.foto()
	if e.usuario != usuarioDePrueba || e.clave != claveDePrueba || e.mecanismo != "PLAIN" {
		t.Fatalf("credenciales recibidas: %q / mecanismo %q (la contraseña %s)", e.usuario, e.mecanismo, map[bool]string{true: "coincide", false: "no coincide"}[e.clave == claveDePrueba])
	}
	claro, cifrado := visto.comandos()
	for _, c := range claro {
		if strings.HasPrefix(c, "AUTH") || strings.HasPrefix(c, "MAIL") {
			t.Errorf("AUTH o MAIL antes de TLS: %v", claro)
		}
	}
	if len(cifrado) < 3 || !strings.HasPrefix(cifrado[1], "AUTH PLAIN") || !strings.HasPrefix(cifrado[2], "MAIL FROM:") {
		t.Fatalf("el orden después de TLS debía ser EHLO, AUTH, MAIL: %v", cifrado)
	}
	if e.mailAntesAuth {
		t.Fatal("el servidor vio MAIL sin AUTH")
	}
	if _, cuerpo := leerMensaje(t, []byte(e.datos)); e.envios != 1 || !strings.Contains(cuerpo, "/verificar?t=tok-en_123") {
		t.Fatalf("el mensaje no llegó: %d envíos, %q", e.envios, cuerpo)
	}
}

// El servidor falso también ofrece LOGIN; el adaptador usa PLAIN y no se confunde.
func TestElMecanismoEsPLAINAunqueElServidorOfrezcaLOGIN(t *testing.T) {
	dir, visto, raices := servidorConAUTH(t, guion{})
	if err := enviarPrueba(adaptadorConAUTH(dir, raices)); err != nil {
		t.Fatal(err)
	}
	if m := visto.foto().mecanismo; m != "PLAIN" {
		t.Fatalf("mecanismo %q", m)
	}
}

// STARTTLS es obligatorio con credenciales: si el servidor no lo ofrece (o alguien lo quita de la respuesta, un
// ataque de degradación) no se manda AUTH, ni MAIL, ni la contraseña en claro.
func TestConCredencialesSinSTARTTLSNoEnviaNiAutentica(t *testing.T) {
	dir, visto, raices := servidorConAUTH(t, guion{sinSTARTTLS: true})
	err := enviarPrueba(adaptadorConAUTH(dir, raices))
	if !errors.Is(err, correo.ErrAutenticacion) {
		t.Fatalf("se esperaba ErrAutenticacion: %v", err)
	}
	if visto.huboComando("AUTH") || visto.huboComando("MAIL") || visto.huboComando("RCPT") || visto.huboComando("DATA") {
		claro, cifrado := visto.comandos()
		t.Fatalf("no debía mandar AUTH, MAIL, RCPT ni DATA: %v %v", claro, cifrado)
	}
	if e := visto.foto(); e.autenticado || e.clave != "" || e.envios != 0 {
		t.Fatal("no debía autenticarse ni enviar")
	}
	verSinFuga(t, err)
}

// Si STARTTLS falla, tampoco se manda AUTH ni se sigue en claro. Tres formas de fallar: el servidor lo rechaza, lo
// acepta y no negocia, o el certificado no es de confianza.
func TestConCredencialesSiSTARTTLSFallaNoEnviaNiAutentica(t *testing.T) {
	casos := []struct {
		nombre     string
		guion      guion
		sinRaices  bool
		categorias []error
	}{
		{"rechazado con 454", guion{respuestaSTARTTLS: "454 4.7.0 " + textoDelServidor}, false, []error{correo.ErrTransitorio}},
		{"rechazado con 5xx", guion{respuestaSTARTTLS: "554 5.7.0 " + textoDelServidor}, false, []error{correo.ErrAutenticacion}},
		{"certificado que el cliente no acepta", guion{}, true, []error{correo.ErrAutenticacion}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			dir, visto, raices := servidorConAUTH(t, c.guion)
			if c.sinRaices {
				raices = nil
			}
			s := correo.NuevoSMTP(configConAUTH(dir), relojDePrueba())
			if raices != nil {
				s = s.ConRaicesDeConfianza(raices)
			}
			err := enviarPrueba(s)
			if err == nil {
				t.Fatal("se esperaba un error")
			}
			if !errors.Is(err, c.categorias[0]) {
				t.Fatalf("categoría inesperada: %v", err)
			}
			if visto.huboComando("AUTH") || visto.huboComando("MAIL") || visto.foto().clave != "" {
				claro, cifrado := visto.comandos()
				t.Fatalf("no debía mandar AUTH ni MAIL: %v %v", claro, cifrado)
			}
			verSinFuga(t, err)
		})
	}
}

// Con credenciales, un servidor que cifra pero no ofrece AUTH no recibe el mensaje.
func TestConCredencialesSinAUTHNoEnvia(t *testing.T) {
	dir, visto, raices := servidorConAUTH(t, guion{sinAUTH: true})
	err := enviarPrueba(adaptadorConAUTH(dir, raices))
	if !errors.Is(err, correo.ErrAutenticacion) {
		t.Fatalf("se esperaba ErrAutenticacion: %v", err)
	}
	if visto.huboComando("MAIL") || visto.foto().envios != 0 {
		t.Fatal("no debía mandar el mensaje")
	}
	verSinFuga(t, err)
}

// Cada respuesta del servidor cae en una categoría, con el código que dio y sin su texto.
func TestCategoriasDeLasRespuestas(t *testing.T) {
	casos := []struct {
		nombre    string
		guion     guion
		categoria error
		otras     []error // categorías que NO debe tener
		codigo    int
		paso      string
	}{
		{"535 al autenticar", guion{respuestaAUTH: "535 5.7.8 " + textoDelServidor}, correo.ErrAutenticacion, []error{correo.ErrTransitorio, correo.ErrDestinatario, correo.ErrPermanente}, 535, "autenticar"},
		{"530 al pedir el remitente", guion{respuestaMAIL: "530 5.7.0 " + textoDelServidor}, correo.ErrAutenticacion, []error{correo.ErrTransitorio, correo.ErrDestinatario}, 530, "remitente"},
		{"454 al autenticar es transitorio", guion{respuestaAUTH: "454 4.7.0 " + textoDelServidor}, correo.ErrTransitorio, []error{correo.ErrAutenticacion, correo.ErrDestinatario}, 454, "autenticar"},
		{"550 del destinatario", guion{respuestaRCPT: "550 5.1.1 " + textoDelServidor}, correo.ErrDestinatario, []error{correo.ErrTransitorio, correo.ErrAutenticacion, correo.ErrPermanente}, 550, "destinatario"},
		{"553 del destinatario", guion{respuestaRCPT: "553 5.1.3 " + textoDelServidor}, correo.ErrDestinatario, []error{correo.ErrTransitorio, correo.ErrAutenticacion, correo.ErrPermanente}, 553, "destinatario"},
		{"421 del destinatario", guion{respuestaRCPT: "421 4.7.0 " + textoDelServidor}, correo.ErrTransitorio, []error{correo.ErrDestinatario, correo.ErrAutenticacion, correo.ErrPermanente}, 421, "destinatario"},
		{"451 del destinatario", guion{respuestaRCPT: "451 4.3.0 " + textoDelServidor}, correo.ErrTransitorio, []error{correo.ErrDestinatario, correo.ErrAutenticacion, correo.ErrPermanente}, 451, "destinatario"},
		{"451 del remitente", guion{respuestaMAIL: "451 4.3.0 " + textoDelServidor}, correo.ErrTransitorio, []error{correo.ErrDestinatario, correo.ErrAutenticacion}, 451, "remitente"},
		{"550 del remitente no es del destinatario", guion{respuestaMAIL: "550 5.7.1 " + textoDelServidor}, correo.ErrPermanente, []error{correo.ErrDestinatario, correo.ErrTransitorio, correo.ErrAutenticacion}, 550, "remitente"},
		{"554 al empezar los datos", guion{respuestaDATA: "554 5.3.0 " + textoDelServidor}, correo.ErrPermanente, []error{correo.ErrDestinatario, correo.ErrTransitorio, correo.ErrAutenticacion}, 554, "cuerpo"},
		{"451 al terminar el mensaje", guion{respuestaFin: "451 4.3.0 " + textoDelServidor}, correo.ErrTransitorio, []error{correo.ErrDestinatario, correo.ErrAutenticacion, correo.ErrPermanente}, 451, "mensaje"},
		{"554 al terminar el mensaje", guion{respuestaFin: "554 5.6.0 " + textoDelServidor}, correo.ErrPermanente, []error{correo.ErrDestinatario, correo.ErrTransitorio, correo.ErrAutenticacion}, 554, "mensaje"},
		{"421 al saludar", guion{saludo: "421 4.3.2 " + textoDelServidor}, correo.ErrTransitorio, []error{correo.ErrDestinatario, correo.ErrAutenticacion}, 421, "saludar"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			dir, _, raices := servidorConAUTH(t, c.guion)
			err := enviarPrueba(adaptadorConAUTH(dir, raices))
			if !errors.Is(err, c.categoria) {
				t.Fatalf("se esperaba %v: %v", c.categoria, err)
			}
			for _, otra := range c.otras {
				if errors.Is(err, otra) {
					t.Errorf("no debía ser %v: %v", otra, err)
				}
			}
			var e *correo.ErrorDeEnvio
			if !errors.As(err, &e) || e.Codigo != c.codigo || !strings.Contains(e.Paso, c.paso) {
				t.Fatalf("código y paso: %+v (se esperaba %d en %q)", e, c.codigo, c.paso)
			}
			if !strings.Contains(err.Error(), fmt.Sprint(c.codigo)) {
				t.Errorf("el error debe llevar el código %d: %v", c.codigo, err)
			}
			verSinFuga(t, err)
		})
	}
}

// Sin respuesta del servidor (conexión cortada) o sin servidor, el error es transitorio y la causa sigue a la mano.
func TestLosFallosDeRedSonTransitoriosYConservanLaCausa(t *testing.T) {
	t.Run("conexión cortada al dar el remitente", func(t *testing.T) {
		dir, _, raices := servidorConAUTH(t, guion{cortarEnMAIL: true})
		err := enviarPrueba(adaptadorConAUTH(dir, raices))
		if !errors.Is(err, correo.ErrTransitorio) || !errors.Is(err, io.EOF) {
			t.Fatalf("se esperaba transitorio con io.EOF: %v", err)
		}
	})
	t.Run("servidor caído", func(t *testing.T) {
		l, _ := net.Listen("tcp", "127.0.0.1:0")
		dir := l.Addr().String()
		l.Close()
		err := enviarPrueba(correo.NuevoSMTP(configConAUTH(dir), relojDePrueba()))
		if !errors.Is(err, correo.ErrTransitorio) {
			t.Fatalf("se esperaba transitorio: %v", err)
		}
	})
	t.Run("plazo vencido", func(t *testing.T) {
		dir, _, raices := servidorConAUTH(t, guion{})
		ctx, cancelar := context.WithCancel(context.Background())
		cancelar()
		err := adaptadorConAUTH(dir, raices).EnviarVerificacion(ctx, "laura@ejemplo.test", "abc")
		if !errors.Is(err, correo.ErrTransitorio) || !errors.Is(err, context.Canceled) {
			t.Fatalf("se esperaba transitorio con context.Canceled: %v", err)
		}
	})
}

// verSinFuga comprueba que el error, en cualquier formato, no trae la contraseña ni nada de lo que dijo el servidor.
func verSinFuga(t *testing.T, err error) {
	t.Helper()
	for _, formato := range []string{"%v", "%+v", "%#v", "%s", "%q"} {
		s := fmt.Sprintf(formato, err)
		for _, prohibido := range []string{claveDePrueba, "texto-del-servidor", "laura", base64.StdEncoding.EncodeToString([]byte("\x00" + usuarioDePrueba + "\x00" + claveDePrueba))} {
			if strings.Contains(s, prohibido) {
				t.Errorf("el error con %s deja ver %q: %s", formato, prohibido, s)
			}
		}
	}
	for cadena := err; cadena != nil; cadena = errors.Unwrap(cadena) {
		if strings.Contains(cadena.Error(), claveDePrueba) || strings.Contains(cadena.Error(), "texto-del-servidor") {
			t.Errorf("un error de la cadena deja ver la contraseña o el texto del servidor: %s", cadena.Error())
		}
	}
}

// Ni el adaptador ni la configuración dejan la contraseña en los registros, aunque alguien los registre enteros.
func TestLaContrasenaNoSaleEnLosRegistros(t *testing.T) {
	dir, _, raices := servidorConAUTH(t, guion{respuestaAUTH: "535 5.7.8 " + textoDelServidor})
	s := adaptadorConAUTH(dir, raices)
	err := enviarPrueba(s)
	if err == nil {
		t.Fatal("se esperaba un error")
	}
	var registro bytes.Buffer
	log := slog.New(slog.NewTextHandler(&registro, nil))
	log.Error("no se pudo enviar", "error", err, "adaptador", s, "config", configConAUTH(dir))
	log = slog.New(slog.NewJSONHandler(&registro, nil))
	log.Error("no se pudo enviar", "error", err, "adaptador", s, "config", configConAUTH(dir))
	salida := registro.String() + fmt.Sprintf("%v %+v %#v", s, s, s)
	if strings.Contains(salida, claveDePrueba) || strings.Contains(salida, "texto-del-servidor") {
		t.Fatalf("el registro deja ver la contraseña o el texto del servidor:\n%s", salida)
	}
}

// Sin credenciales el comportamiento no cambia: no autentica aunque el servidor ofrezca AUTH, y usa STARTTLS si se
// ofrece (Mailpit, D-120). Sin STARTTLS envía en claro, como siempre.
func TestSinCredencialesNoAutenticaYUsaSTARTTLSSiSeOfrece(t *testing.T) {
	t.Run("con STARTTLS y AUTH ofrecidos", func(t *testing.T) {
		dir, visto, raices := servidorConAUTH(t, guion{sinAUTH: true})
		s := correo.NuevoSMTP(configDePrueba(dir), relojDePrueba()).ConRaicesDeConfianza(raices)
		if err := enviarPrueba(s); err != nil {
			t.Fatal(err)
		}
		if visto.huboComando("AUTH") || visto.foto().envios != 1 {
			t.Fatalf("no debía autenticar y sí enviar: %d envíos", visto.foto().envios)
		}
		if _, cifrado := visto.comandos(); len(cifrado) == 0 {
			t.Fatal("debía usar STARTTLS al ofrecerse")
		}
	})
	t.Run("sin STARTTLS, en claro", func(t *testing.T) {
		dir, visto, _ := servidorConAUTH(t, guion{sinSTARTTLS: true, sinAUTH: true})
		if err := enviarPrueba(correo.NuevoSMTP(configDePrueba(dir), relojDePrueba())); err != nil {
			t.Fatal(err)
		}
		if visto.huboComando("AUTH") || visto.foto().envios != 1 {
			t.Fatalf("no debía autenticar y sí enviar: %d envíos", visto.foto().envios)
		}
		if _, cifrado := visto.comandos(); len(cifrado) != 0 {
			t.Fatal("no había TLS")
		}
	})
	t.Run("un servidor que exige AUTH da el error de autenticación", func(t *testing.T) {
		dir, _, raices := servidorConAUTH(t, guion{})
		s := correo.NuevoSMTP(configDePrueba(dir), relojDePrueba()).ConRaicesDeConfianza(raices)
		err := enviarPrueba(s)
		if !errors.Is(err, correo.ErrAutenticacion) {
			t.Fatalf("se esperaba ErrAutenticacion (530): %v", err)
		}
		verSinFuga(t, err)
	})
}

// Conservar lo que ya pasaba: el servidor sin TLS ni AUTH de las pruebas de siempre sigue funcionando con la
// configuración de antes (sin credenciales), y su 550 sigue llevando solo el código.
func TestElCaminoSinCredencialesSigueIgual(t *testing.T) {
	dir, salida := servidorSMTP(t, false)
	if err := enviarPrueba(correo.NuevoSMTP(configDePrueba(dir), relojDePrueba())); err != nil {
		t.Fatal(err)
	}
	if rec := <-salida; rec.destinatario != "laura@ejemplo.test" {
		t.Fatalf("sobre inesperado: %+v", rec)
	}
	dir, _ = servidorSMTP(t, true)
	err := enviarPrueba(correo.NuevoSMTP(configDePrueba(dir), relojDePrueba()))
	if !errors.Is(err, correo.ErrDestinatario) || strings.Contains(err.Error(), "laura") || !strings.Contains(err.Error(), "destinatario rechazado: el servidor respondió 550") {
		t.Fatalf("error inesperado: %v", err)
	}
}
