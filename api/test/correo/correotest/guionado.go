package correotest

import (
	"bufio"
	"io"
	"net"
	"strings"
	"testing"
)

// ServidorGuionado es un servidor SMTP que responde lo que dice el guion a cada comando (por prefijo; «.» es el fin
// de los datos) y 250 a lo demás. Una respuesta vacía cierra la conexión. Tras un 220 a STARTTLS manda basura en
// lugar de negociar TLS.
func ServidorGuionado(t *testing.T, saludo string, guion map[string]string) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	go func() {
		c, err := l.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		r := bufio.NewReader(c)
		resp := func(s string) bool {
			if s == "" {
				return false
			}
			_, _ = io.WriteString(c, s+"\r\n")
			return true
		}
		if !resp(saludo) {
			return
		}
		for {
			linea, err := r.ReadString('\n')
			if err != nil {
				return
			}
			linea = strings.TrimRight(linea, "\r\n")
			clave, quiere := "", "250 ok"
			if strings.HasPrefix(linea, "DATA") {
				quiere = "354 siga"
			}
			for _, k := range []string{"EHLO", "STARTTLS", "MAIL", "RCPT", "DATA", "QUIT"} {
				if strings.HasPrefix(linea, k) {
					clave = k
				}
			}
			if o, ok := guion[clave]; ok && clave != "" {
				quiere = o
			}
			switch clave {
			case "DATA":
				if !resp(quiere) || !strings.HasPrefix(quiere, "354") {
					return
				}
				for {
					l, err := r.ReadString('\n')
					if err != nil || l == ".\r\n" {
						break
					}
				}
				quiere = "250 ok"
				if o, ok := guion["."]; ok {
					quiere = o
				}
			case "STARTTLS":
				if resp(quiere) && strings.HasPrefix(quiere, "220") {
					_, _ = io.WriteString(c, "esto no es TLS")
				}
				return
			}
			if !resp(quiere) {
				return
			}
		}
	}()
	return l.Addr().String()
}
