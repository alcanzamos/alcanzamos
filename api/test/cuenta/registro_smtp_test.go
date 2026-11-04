package cuenta_test

import (
	"context"
	"net"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/correo"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
)

// Ninguna línea del registro lleva el correo de la persona, diga lo que diga el servidor SMTP (A-15, E17 3.13): el
// servicio real con el adaptador SMTP real contra un servidor de mentira que repite la dirección en su respuesta.
func TestElRegistroNoLlevaElCorreoConNingunaRespuestaDelServidorSMTP(t *testing.T) {
	const direccion = "laura@ejemplo.test"
	repite := "<" + direccion + ">"
	casos := []struct {
		nombre, saludo string
		guion          map[string]string
	}{
		{"RCPT 550 con la dirección", "220 hola", map[string]string{"RCPT": "550 5.1.1 " + repite + " no existe"}},
		{"RCPT sin código (mal formada)", "220 hola", map[string]string{"RCPT": "5.1.1 " + repite + " rejected"}},
		{"RCPT con cierre de la conexión (EOF)", "220 hola", map[string]string{"RCPT": ""}},
		{"DATA 554 multilínea con la dirección", "220 hola", map[string]string{"DATA": "554-" + repite + " no\r\n554 " + repite + " fin"}},
		{"saludo mal formado", repite + " hola", nil},
		{"MAIL mal formado", "220 hola", map[string]string{"MAIL": repite + "?"}},
		{"fin de los datos mal formado", "220 hola", map[string]string{".": "ok " + repite}},
		{"conexión rechazada", "", nil},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			dir := correotest.ServidorGuionado(t, c.saludo, c.guion)
			if c.saludo == "" { // sin servidor: se cierra el puerto
				l, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				dir = l.Addr().String()
				l.Close()
			}
			e := nuevoEntorno()
			smtp := correo.NuevoSMTP(config.Config{
				CorreoSMTP: dir, CorreoRemitente: "no-responder@avisos.ejemplo.test",
				CorreoPrivacidad: "privacidad@ejemplo.test", URLPublica: "https://app.ejemplo.test",
			}, e.reloj)
			svc := cuenta.NuevoServicio(cuenta.Dependencias{
				Repo: e.repo, Correo: smtp, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
				Reloj: e.reloj, Limitador: e.limitador, Senuelos: e.senuelos, Log: e.log(),
			})
			if _, err := svc.CrearCuenta(context.Background(), solicitudValida()); err != nil {
				t.Fatal(err)
			}
			svc.Esperar()
			registro := e.registro.String()
			if !strings.Contains(registro, "no se pudo enviar el correo") {
				t.Fatalf("falta el registro del fallo: %q", registro)
			}
			for _, linea := range strings.Split(strings.TrimSpace(registro), "\n") {
				if strings.Contains(strings.ToLower(linea), "laura") || strings.Contains(linea, "ejemplo.test>") {
					t.Errorf("una línea del registro lleva el correo: %s", linea)
				}
			}
		})
	}
}
