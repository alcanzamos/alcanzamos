// Command servidor es el servidor de archivos estáticos de ca-web. Ver web/README.md, «Servidor de ca-web».
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/alcanzamos/alcanzamos/web/servidor/internal/servidor"
)

func main() {
	// Container Apps detiene el contenedor con SIGTERM: se deja terminar lo que está en curso.
	ctx, parar := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	codigo := servidor.Ejecutar(ctx, os.Getenv, os.Stdout, os.Stderr)
	parar()
	os.Exit(codigo)
}
