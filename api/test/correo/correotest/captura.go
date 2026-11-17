package correotest

import (
	"bufio"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
)

// Capturado es un mensaje que llegó entero al servidor de ServidorQueCaptura.
type Capturado struct {
	Remitente    string
	Destinatario string
	Datos        string // encabezados y cuerpo tal como los mandó el cliente, sin el punto final
}

// Capturas son los mensajes recibidos por un servidor de ServidorQueCaptura.
type Capturas struct {
	mu sync.Mutex
	ms []Capturado
}

// Mensajes devuelve una copia de lo recibido hasta ahora, en orden de llegada.
func (c *Capturas) Mensajes() []Capturado {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]Capturado(nil), c.ms...)
}

// ServidorQueCaptura es un servidor SMTP de mentira, sin STARTTLS, que acepta todo, atiende varias conexiones y guarda
// cada mensaje que recibe completo. Sirve para comprobar que un correo llegó de verdad por el adaptador SMTP.
func ServidorQueCaptura(t *testing.T) (string, *Capturas) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	capturas := &Capturas{}
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go atender(c, capturas)
		}
	}()
	return l.Addr().String(), capturas
}

func atender(c net.Conn, capturas *Capturas) {
	defer c.Close()
	r := bufio.NewReader(c)
	resp := func(s string) { _, _ = io.WriteString(c, s+"\r\n") }
	resp("220 captura")
	var actual Capturado
	for {
		linea, err := r.ReadString('\n')
		if err != nil {
			return
		}
		linea = strings.TrimRight(linea, "\r\n")
		switch {
		case strings.HasPrefix(linea, "MAIL FROM:"):
			actual = Capturado{Remitente: direccion(linea)}
			resp("250 ok")
		case strings.HasPrefix(linea, "RCPT TO:"):
			actual.Destinatario = direccion(linea)
			resp("250 ok")
		case strings.HasPrefix(linea, "DATA"):
			resp("354 siga")
			var datos strings.Builder
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if l == ".\r\n" {
					break
				}
				datos.WriteString(l)
			}
			actual.Datos = datos.String()
			capturas.mu.Lock()
			capturas.ms = append(capturas.ms, actual)
			capturas.mu.Unlock()
			resp("250 ok")
		case strings.HasPrefix(linea, "QUIT"):
			resp("221 fin")
			return
		default:
			resp("250 ok")
		}
	}
}

// direccion es lo que va entre < y > en `MAIL FROM:<a@b>` o `RCPT TO:<a@b>`.
func direccion(linea string) string {
	i, j := strings.Index(linea, "<"), strings.LastIndex(linea, ">")
	if i < 0 || j < i {
		return ""
	}
	return linea[i+1 : j]
}
