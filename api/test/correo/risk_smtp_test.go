package correo_test

import (
	"bytes"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/correo"
)

// Regresiones de la verificación independiente de US-80 (Risk: item 2).

// El adaptador por valor no deja ver la contraseña con ningún verbo de fmt ni con slog (texto y JSON), igual que
// por puntero: fmt no llama métodos de un campo no exportado, así que la contraseña no puede estar en un campo que fmt recorra.
func TestSMTPPorValorNoRevelaLaContrasena(t *testing.T) {
	s := correo.NuevoSMTP(configConAUTH("127.0.0.1:587"), relojDePrueba())
	porValor := *s
	formas := map[string]any{"puntero": s, "valor": porValor}
	for nombre, forma := range formas {
		t.Run(nombre, func(t *testing.T) {
			var registro bytes.Buffer
			slog.New(slog.NewTextHandler(&registro, nil)).Info("adaptador", "adaptador", forma)
			slog.New(slog.NewJSONHandler(&registro, nil)).Info("adaptador", "adaptador", forma)
			salidas := []string{registro.String()}
			for _, verbo := range []string{"%v", "%+v", "%#v", "%s", "%q", "%x"} {
				salidas = append(salidas, fmt.Sprintf(verbo, forma))
			}
			for _, salida := range salidas {
				if strings.Contains(salida, claveDePrueba) || strings.Contains(salida, "Secreto(") {
					t.Errorf("la salida deja ver la contraseña: %s", salida)
				}
			}
		})
	}
}

// Si AUTH se rechaza, sea cual sea el código, no se llega a MAIL, RCPT ni DATA y el error es de autenticación.
func TestAUTHRechazadoNoEnviaElMensaje(t *testing.T) {
	for _, codigo := range []string{"530", "534", "535", "538", "550"} {
		t.Run(codigo, func(t *testing.T) {
			dir, visto, raices := servidorConAUTH(t, guion{respuestaAUTH: codigo + " 5.7.8 " + textoDelServidor})
			err := enviarPrueba(adaptadorConAUTH(dir, raices))
			if !errors.Is(err, correo.ErrAutenticacion) {
				t.Fatalf("se esperaba ErrAutenticacion: %v", err)
			}
			for _, c := range []string{"MAIL", "RCPT", "DATA"} {
				if visto.huboComando(c) {
					t.Errorf("tras el rechazo de AUTH no debía llegar %s", c)
				}
			}
			if visto.foto().envios != 0 {
				t.Fatal("no debía enviar el mensaje")
			}
			verSinFuga(t, err)
		})
	}
}

// 530, 534, 535 y 538 son de autenticación aunque lleguen al dar el destinatario: no son del destinatario.
func TestCodigosDeAutenticacionEnRCPT(t *testing.T) {
	for _, codigo := range []int{530, 534, 535, 538} {
		t.Run(fmt.Sprint(codigo), func(t *testing.T) {
			dir, _, raices := servidorConAUTH(t, guion{respuestaRCPT: fmt.Sprintf("%d 5.7.0 %s", codigo, textoDelServidor)})
			err := enviarPrueba(adaptadorConAUTH(dir, raices))
			if !errors.Is(err, correo.ErrAutenticacion) || errors.Is(err, correo.ErrDestinatario) {
				t.Fatalf("se esperaba ErrAutenticacion y no ErrDestinatario: %v", err)
			}
			var e *correo.ErrorDeEnvio
			if !errors.As(err, &e) || e.Codigo != codigo {
				t.Fatalf("código %+v, se esperaba %d", e, codigo)
			}
			verSinFuga(t, err)
		})
	}
}

// Un certificado de confianza pero de otro nombre, o un servidor que solo habla TLS 1.0 o 1.1, se rechazan antes de AUTH.
func TestNombreDelCertificadoYVersionMinimaTLS(t *testing.T) {
	casos := []struct {
		nombre string
		guion  guion
	}{
		{"certificado de confianza con otro nombre", guion{certParaOtroHost: true}},
		{"solo TLS 1.0", guion{versionMaximaTLS: tls.VersionTLS10}},
		{"solo TLS 1.1", guion{versionMaximaTLS: tls.VersionTLS11}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			dir, visto, raices := servidorConAUTH(t, c.guion)
			err := enviarPrueba(adaptadorConAUTH(dir, raices))
			if !errors.Is(err, correo.ErrAutenticacion) {
				t.Fatalf("se esperaba ErrAutenticacion: %v", err)
			}
			if visto.huboComando("AUTH") || visto.huboComando("MAIL") || visto.foto().clave != "" {
				claro, cifrado := visto.comandos()
				t.Fatalf("no debía mandar AUTH ni MAIL: %v %v", claro, cifrado)
			}
			verSinFuga(t, err)
		})
	}
}

// El envío sigue funcionando con TLS 1.2 como mínimo del cliente: control de la prueba anterior.
func TestElControlDeTLSConVersionActualFunciona(t *testing.T) {
	dir, _, raices := servidorConAUTH(t, guion{versionMaximaTLS: tls.VersionTLS12})
	if err := enviarPrueba(adaptadorConAUTH(dir, raices)); err != nil {
		t.Fatal(err)
	}
}
