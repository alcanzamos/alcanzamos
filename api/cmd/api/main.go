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

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/internal/argon2id"
	"github.com/alcanzamos/alcanzamos/api/internal/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/internal/bd"
	"github.com/alcanzamos/alcanzamos/api/internal/config"
	"github.com/alcanzamos/alcanzamos/api/internal/correo"
	"github.com/alcanzamos/alcanzamos/api/internal/cuenta"
	"github.com/alcanzamos/alcanzamos/api/internal/pg"
	"github.com/alcanzamos/alcanzamos/api/internal/reloj"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
	"github.com/alcanzamos/alcanzamos/api/internal/sesion"
	"github.com/alcanzamos/alcanzamos/api/internal/tareas"
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
		return servir(ctx, log)
	case "tareas":
		return correrTareas(ctx, log)
	case "migrar":
		return migrar(ctx, log)
	default:
		return fmt.Errorf("subcomando desconocido: %q", orden)
	}
}

// servir arma el servidor: configuración, base de datos, servicios y rutas de /api/. Es el compositor de E12:
// crea los adaptadores y los pasa a los servicios; no tiene reglas. Sin la configuración completa no arranca.
func servir(ctx context.Context, log *slog.Logger) error {
	cfg, err := config.Cargar(os.Getenv)
	if err != nil {
		return err
	}
	pool, err := bd.Conectar(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()

	enrutador, esperarEnvios, err := armarEnrutador(cfg, pool, log)
	if err != nil {
		return err
	}
	api, err := enrutador.Construir()
	if err != nil {
		return err
	}
	// Al apagar, los correos que ya salieron en segundo plano terminan antes de cerrar la base.
	defer esperarEnvios()
	return servidor.Servir(ctx, ":"+puerto(), log, api)
}

// armarEnrutador registra todas las rutas de /api/, cada una con su nivel de acceso. Una ruta sin nivel hace fallar
// Construir y el servidor no arranca. Devuelve también la función que espera los envíos de correo en curso.
// Falla si la clave de las sesiones de mentira no sirve (la configuración ya exige 32 bytes).
func armarEnrutador(cfg config.Config, pool *pgxpool.Pool, log *slog.Logger) (*servidor.Enrutador, func(), error) {
	hora := reloj.Sistema{}
	limitador := seguridad.NuevoLimitadorDeIntentos(hora)
	senuelos, err := sesion.NuevosSenuelos(cfg.SesionSenuelo.Bytes(), hora)
	if err != nil {
		return nil, nil, err
	}
	hasher := argon2id.Predeterminado()
	correoSMTP := correo.NuevoSMTP(cfg, hora)
	politica := seguridad.NuevaPoliticaDeContrasena()
	cuentas := cuenta.NuevoServicio(cuenta.Dependencias{
		Repo:      pg.NuevoCuentas(pool),
		Correo:    correoSMTP,
		Politica:  politica,
		Hasher:    hasher,
		Reloj:     hora,
		Limitador: limitador,
		Senuelos:  senuelos,
		Log:       log,
	})
	autenticaciones, err := autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: pg.NuevoAutenticacion(pool), Hasher: hasher, Limitador: limitador, Reloj: hora,
		Correo: correoSMTP, Politica: politica, Log: log,
	})
	if err != nil {
		return nil, nil, err
	}
	sesiones := sesion.NuevoResolutor(pg.NuevoSesiones(pool), senuelos, hora)

	eventos := seguridad.NuevoRegistro(log)
	enrutador := servidor.NuevoEnrutador(sesiones, eventos, log)
	cuenta.NuevoHandler(cuentas, sesiones, log).Registrar(enrutador)
	autenticacion.NuevoHandler(autenticaciones, eventos, log).Registrar(enrutador)
	return enrutador, func() { cuentas.Esperar(); autenticaciones.Esperar() }, nil
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

// correrTareas es el punto de entrada del trabajo programado: conecta con la base, corre cada tarea (E12 EjecutorDeTareas)
// y deja constancia del inicio y del fin. Termina con error, y código 1, si alguna tarea falla o no hay base.
func correrTareas(ctx context.Context, log *slog.Logger) error {
	log.Info("tareas: inicio")
	pool, err := bd.Conectar(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()

	hora := reloj.Sistema{}
	// Las tareas no envían correo ni calculan hashes: el servicio solo usa el repositorio.
	cuentas := cuenta.NuevoServicio(cuenta.Dependencias{Repo: pg.NuevoCuentas(pool), Reloj: hora, Log: log})
	ejecutadas, err := tareas.NuevoEjecutor(cuentas, pg.NuevoLimpieza(pool), hora, log).Ejecutar(ctx)
	log.Info("tareas: fin", "ejecutadas", ejecutadas)
	return err
}
