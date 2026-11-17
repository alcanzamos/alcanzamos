//go:build integration

package autorizacion_test

import (
	"strings"
	"testing"
)

// Lo que no es un token ni un dispositivo válido (caracteres de control, NUL, blancos, `/`) es `400 solicitud_invalida` y no
// guarda nada: antes unos daban 500 por la base (NUL) y otros se guardaban (blancos, `/`).
func TestElTokenYElDispositivoInvalidosSeRechazanSinGuardarNada(t *testing.T) {
	casos := []struct{ nombre, dispositivo, cuerpo string }{
		{"token con NUL", "instalacion-1", `{"token":"\u0000"}`},
		{"dispositivo con NUL", "bad%00device", `{"token":"fcm-ok"}`},
		{"token de solo un salto de línea", "instalacion-1", `{"token":"\n"}`},
		{"dispositivo de solo un espacio", "%20", `{"token":"fcm-ok"}`},
		{"dispositivo con barra", "bad%2Fdevice", `{"token":"fcm-ok"}`},
		{"token de solo espacios", "instalacion-1", `{"token":"   "}`},
		{"token con espacio al principio", "instalacion-1", `{"token":" fcm-ok"}`},
		{"token con espacio al final", "instalacion-1", `{"token":"fcm-ok "}`},
		{"token con un espacio en medio", "instalacion-1", `{"token":"fcm ok"}`},
		{"token con tabulación", "instalacion-1", `{"token":"fcm\tok"}`},
		{"token con un carácter de control", "instalacion-1", `{"token":"fcm\u001fok"}`},
		{"token con DEL", "instalacion-1", `{"token":"fcm\u007fok"}`},
		{"token con letras fuera de ASCII", "instalacion-1", `{"token":"tökén"}`},
		{"dispositivo con espacio en medio", "bad%20device", `{"token":"fcm-ok"}`},
		{"dispositivo con punto y coma", "bad;device", `{"token":"fcm-ok"}`},
		{"dispositivo con letras fuera de ASCII", "instalaci%C3%B3n", `{"token":"fcm-ok"}`},
	}
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", android)
		if r := c.llamar("POST", rutaAutorizar, cuerpoAutorizar); r.Codigo != 200 { // con `avisos`
			t.Fatalf("autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
		for _, caso := range casos {
			r := c.llamar("PUT", "/api/v1/dispositivos/"+caso.dispositivo+"/token", caso.cuerpo)
			if r.Codigo != 400 || r.Cuerpo != `{"error":"solicitud_invalida"}` {
				t.Errorf("%s: %d %s, se esperaba 400 solicitud_invalida", caso.nombre, r.Codigo, r.Cuerpo)
			}
		}
		if n := s.tokens(persona); n != 0 {
			t.Errorf("no debe guardarse nada: %d filas", n)
		}
	})
}

// Lo que sí es un token o un dispositivo: el token de FCM, la URL del servicio de push y la suscripción de Web Push como JSON
// compacto (`JSON.stringify`, sin blancos), y un identificador generado al instalar (UUID o base64url).
func TestElTokenYElDispositivoValidosSeGuardan(t *testing.T) {
	const suscripcion = `{\"endpoint\":\"https://fcm.googleapis.com/fcm/send/dX1_a-b:APA91bH\",\"keys\":{\"p256dh\":\"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM\",\"auth\":\"tBHItJI5svbpez7KI4CCXg\"}}`
	casos := []struct{ nombre, dispositivo, token string }{
		{"token de FCM", "d1", "dX1_a-b:APA91bHuA-9zQ_x-0123456789"},
		{"suscripción de Web Push en JSON compacto", "d2", suscripcion},
		{"dispositivo UUID", "0192f3c4-0000-7000-8000-0000000000aa", "token-uuid"},
		{"dispositivo base64url con punto", "aB3_-.xY", "token-b64"},
		{"signos de puntuación imprimibles en el token", "d3", "a!#$%&'()*+,./:;<=>?@[]^_`{|}~-z"},
	}
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuentaVerificada("laura@ejemplo.test", android)
		if r := c.llamar("POST", rutaAutorizar, cuerpoAutorizar); r.Codigo != 200 {
			t.Fatalf("autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
		for _, caso := range casos {
			cuerpo := `{"token":"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(caso.token) + `"}`
			if strings.HasPrefix(caso.token, "{") {
				cuerpo = `{"token":"` + caso.token + `"}` // ya viene escapada para JSON
			}
			if r := c.llamar("PUT", "/api/v1/dispositivos/"+caso.dispositivo+"/token", cuerpo); r.Codigo != 204 {
				t.Errorf("%s: %d %s", caso.nombre, r.Codigo, r.Cuerpo)
			}
		}
		if n := s.tokens(persona); n != len(casos) {
			t.Errorf("filas guardadas: %d, se esperaban %d", n, len(casos))
		}
	})
}
