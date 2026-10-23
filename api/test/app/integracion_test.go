//go:build integration

package app_test

import (
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

func TestTareasConectaYTerminaSinError(t *testing.T) {
	// Una base propia y migrada: las tareas consultan las tablas de cuenta.
	t.Setenv("BASE_DE_DATOS_URL", pgtest.Nueva(t).Config().ConnString())
	codigo, salida := ejecutar("tareas")
	if codigo != 0 {
		t.Fatalf("código %d, registro %s", codigo, salida)
	}
	if !strings.Contains(salida, "tareas: inicio") || !strings.Contains(salida, "tareas: fin") ||
		!strings.Contains(salida, `"ejecutadas":2`) {
		t.Fatalf("faltan los registros de inicio y fin: %s", salida)
	}
}

// El subcomando migrar deja la base con su esquema y es idempotente: la segunda vez no aplica nada.
func TestMigrarAplicaYNoRepite(t *testing.T) {
	t.Setenv("BASE_DE_DATOS_URL", pgtest.Nueva(t).Config().ConnString())
	codigo, salida := ejecutar("migrar")
	if codigo != 0 || !strings.Contains(salida, `"cantidad":0`) {
		t.Fatalf("código %d, registro %s", codigo, salida)
	}
}

// entornoDeServicio da al API la configuración completa y una base propia, y devuelve un puerto libre para servir.
func entornoDeServicio(t *testing.T) string {
	t.Helper()
	t.Setenv("BASE_DE_DATOS_URL", pgtest.Nueva(t).Config().ConnString())
	t.Setenv("CORREO_SMTP", "127.0.0.1:1")
	t.Setenv("CORREO_REMITENTE", "a@b.test")
	t.Setenv("CORREO_PRIVACIDAD", "p@b.test")
	t.Setenv("URL_PUBLICA", "https://app.b.test")
	t.Setenv("SESION_SENUELO_CLAVE", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	return libre(t)
}

// libre devuelve un puerto TCP que nadie usa en este momento.
func libre(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return fmt.Sprint(l.Addr().(*net.TCPAddr).Port)
}

// Sin subcomando corre el servidor en el puerto de PUERTO, responde /salud y termina con código 0 al recibir SIGTERM.
func TestSinSubcomandoServeEnElPuertoDelEntornoYParaConSIGTERM(t *testing.T) {
	puerto := entornoDeServicio(t)
	t.Setenv("PUERTO", puerto)

	type salida struct {
		codigo   int
		registro string
	}
	hecho := make(chan salida, 1)
	go func() {
		codigo, registro := ejecutar()
		hecho <- salida{codigo, registro}
	}()

	url := "http://127.0.0.1:" + puerto + "/salud"
	var respuesta *http.Response
	var err error
	for range 100 {
		if respuesta, err = http.Get(url); err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("el servidor no respondió: %v", err)
	}
	cuerpo, _ := io.ReadAll(respuesta.Body)
	respuesta.Body.Close()
	if respuesta.StatusCode != http.StatusOK || !strings.Contains(string(cuerpo), `"ok"`) {
		t.Fatalf("/salud dio %d %s", respuesta.StatusCode, cuerpo)
	}

	if err := syscall.Kill(syscall.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-hecho:
		if r.codigo != 0 {
			t.Fatalf("código %d, registro %s", r.codigo, r.registro)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("el servidor no terminó con SIGTERM")
	}
}
