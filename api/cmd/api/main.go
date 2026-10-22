// Comando api: un solo binario con subcomandos. Sin subcomando corre el servidor.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()

	if err := ejecutar(ctx, os.Args[1:], log); err != nil {
		log.Error("falló", "error", err)
		os.Exit(1)
	}
}

// ejecutar despacha el subcomando; "api" es el predeterminado.
func ejecutar(ctx context.Context, args []string, log *slog.Logger) error {
	orden := "api"
	if len(args) > 0 {
		orden = args[0]
	}
	switch orden {
	case "api":
		return servidor.Servir(ctx, ":"+puerto(), log)
	default:
		return fmt.Errorf("subcomando desconocido: %q", orden)
	}
}

func puerto() string {
	if p := os.Getenv("PUERTO"); p != "" {
		return p
	}
	return "8080"
}
