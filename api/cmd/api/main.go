// Comando api: un solo binario con subcomandos. Sin subcomando corre el servidor.
package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/alcanzamos/alcanzamos/api/internal/bd"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
)

func main() {
	log := nuevoRegistro(os.Stdout)
	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()

	if err := ejecutar(ctx, os.Args[1:], log); err != nil {
		log.Error("falló", "error", err)
		os.Exit(1)
	}
}

// nuevoRegistro es el logger del API: JSON, una línea por evento, con la hora en UTC (E17-VTE 2.1), también fuera de
// la imagen, donde la zona del equipo puede no ser UTC.
func nuevoRegistro(w io.Writer) *slog.Logger {
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{ReplaceAttr: func(grupos []string, a slog.Attr) slog.Attr {
		if len(grupos) == 0 && a.Key == slog.TimeKey {
			a.Value = slog.TimeValue(a.Value.Time().UTC())
		}
		return a
	}}))
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
	case "tareas":
		return tareas(ctx, log)
	case "migrar":
		return migrar(ctx, log)
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

// migrar aplica las migraciones pendientes y termina.
func migrar(ctx context.Context, log *slog.Logger) error {
	pool, err := bd.Conectar(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	n, err := bd.Subir(ctx, pool)
	if err != nil {
		return err
	}
	log.Info("migraciones aplicadas", "cantidad", n)
	return nil
}

// tareas es el punto de entrada del trabajo programado. Todavía no hay tareas reales (son de I05):
// conecta con la base, deja constancia del inicio y del fin, y termina con código 0.
func tareas(ctx context.Context, log *slog.Logger) error {
	log.Info("tareas: inicio")
	pool, err := bd.Conectar(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	log.Info("tareas: fin", "ejecutadas", 0)
	return nil
}
