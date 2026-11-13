// Package app es el compositor del API (E12): despacha los subcomandos del binario (api, tareas y migrar), arma
// los adaptadores y los pasa a los servicios. Vive aquí y no en cmd/api porque un paquete main no se puede importar
// desde las pruebas de api/test (D-145); cmd/api solo llama a Main.
package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/argon2id"
	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/bd"
	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/correo"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/interpretacion"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/presupuesto"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/reloj"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/src/tareas"
)

// Main corre el API con los argumentos de la línea de comandos (sin el nombre del programa), escribe su registro en
// salida y devuelve el código de salida del proceso. Termina el servidor al recibir SIGINT o SIGTERM.
func Main(args []string, salida io.Writer) int {
	log := nuevoRegistro(salida)
	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()

	if err := ejecutar(ctx, args, log); err != nil {
		log.Error("falló", "error", err)
		return 1
	}
	return 0
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

	enrutador, esperarEnvios, err := ArmarEnrutador(ctx, cfg, pool, log)
	if err != nil {
		return err
	}
	api, err := enrutador.Construir()
	if err != nil {
		return err
	}
	// Al apagar, los correos que ya salieron en segundo plano y el trabajo de recuperación en curso terminan antes de
	// cerrar la base.
	defer esperarEnvios()
	return servidor.Servir(ctx, ":"+puerto(), log, api)
}

// ArmarEnrutador registra todas las rutas de /api/, cada una con su nivel de acceso. Una ruta sin nivel hace fallar
// Construir y el servidor no arranca. Arranca los trabajadores de la recuperación, que paran con `ctx`. Devuelve también la función que espera los envíos
// de correo y los trabajos de recuperación pendientes: se llama al apagar, después de cancelar `ctx`.
func ArmarEnrutador(ctx context.Context, cfg config.Config, pool *pgxpool.Pool, log *slog.Logger) (*servidor.Enrutador, func(), error) {
	hora := reloj.Sistema{}
	limitador := seguridad.NuevoLimitadorDeIntentos(hora)
	hasher := argon2id.Predeterminado()
	correoSMTP := correo.NuevoSMTP(cfg, hora)
	politica := seguridad.NuevaPoliticaDeContrasena()
	cuentas, err := cuenta.NuevoServicio(cuenta.Dependencias{
		Repo:      pg.NuevoCuentas(pool),
		Correo:    correoSMTP,
		Politica:  politica,
		Hasher:    hasher,
		Reloj:     hora,
		Limitador: limitador,
		Log:       log,
	})
	if err != nil {
		return nil, nil, err
	}
	autenticaciones, err := autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: pg.NuevoAutenticacion(pool), Hasher: hasher, Limitador: limitador, Reloj: hora,
		Correo: correoSMTP, Politica: politica, Log: log,
	})
	if err != nil {
		return nil, nil, err
	}
	autenticaciones.Iniciar(ctx) // trabajadores de la recuperación (D-144): paran con ctx
	sesiones := sesion.NuevoResolutor(pg.NuevoSesiones(pool), hora)

	eventos := seguridad.NuevoRegistro(log)
	enrutador := servidor.NuevoEnrutador(sesiones, eventos, log).ConURLPublica(cfg.URLPublica)
	cuenta.NuevoHandler(cuentas, log).Registrar(enrutador)
	autenticacion.NuevoHandler(autenticaciones, eventos, log).Registrar(enrutador)
	autorizacion.NuevoHandler(autorizacion.NuevoServicio(pg.NuevoAutorizaciones(pool), hora), eventos, log).Registrar(enrutador)
	// Las reglas de interpretación se cargan y compilan una vez, al arrancar: una regla mala se ve en el despliegue (E12 §6.2).
	reglas, err := interpretacion.ReglasIncluidas()
	if err != nil {
		return nil, nil, fmt.Errorf("reglas de interpretación: %w", err)
	}
	registro.NuevoHandler(registro.NuevoServicio(pg.NuevoMovimientos(pool), hora).ConInterpretador(interpretacion.NuevoPorReglas(reglas)), log).Registrar(enrutador)
	presupuesto.NuevoHandler(presupuesto.NuevoServicio(pg.NuevoPresupuestos(pool), hora), log).Registrar(enrutador)
	repoDeBorrado := pg.NuevoBorrado(pool)
	cuenta.NuevoHandlerDeBorrado(cuenta.NuevoBorrado(repoDeBorrado, hasher, limitador, hora), eventos, log).Registrar(enrutador)
	cuenta.NuevoHandlerDeExportacion(cuenta.NuevoExportador(repoDeBorrado), log).Registrar(enrutador)
	autorizacion.NuevoHandlerDeTokens(autorizacion.NuevoServicioDeTokens(pg.NuevoTokens(pool), hora), eventos, log).Registrar(enrutador)
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

// correrTareas es el punto de entrada del trabajo programado: carga la misma configuración del correo que el API, conecta
// con la base, arma las tareas (ArmarTareas), las corre (E12 EjecutorDeTareas) y deja constancia del inicio y del fin.
// Termina con error, y código 1, si falta la configuración, si alguna tarea falla o si no hay base.
func correrTareas(ctx context.Context, log *slog.Logger) error {
	log.Info("tareas: inicio")
	// Con el aviso antes de la purga (ítem 294, D-203) la tarea envía correo: necesita CORREO_SMTP, CORREO_REMITENTE,
	// CORREO_PRIVACIDAD y URL_PUBLICA, igual que el API. Sin ellas no corre nada, en vez de fallar en el primer aviso.
	cfg, err := config.Cargar(os.Getenv)
	if err != nil {
		return err
	}
	pool, err := bd.Conectar(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()

	ejecutor, err := ArmarTareas(cfg, pool, log)
	if err != nil {
		return err
	}
	ejecutadas, err := ejecutor.Ejecutar(ctx)
	log.Info("tareas: fin", "ejecutadas", ejecutadas)
	return err
}

// ArmarTareas es el único lugar donde se arman las tareas programadas: `api tareas` (correrTareas) y las pruebas lo
// llaman, así que lo que se prueba es lo que corre en producción (ítem 294, L10: el servicio de las tareas se armaba sin
// correo y se caía con el primer aviso). Las tareas envían correo (el aviso antes de la purga), con el mismo adaptador SMTP
// y la misma configuración del API. Falla si falta una dependencia del servicio de cuentas, antes de correr nada.
func ArmarTareas(cfg config.Config, pool *pgxpool.Pool, log *slog.Logger) (*tareas.Ejecutor, error) {
	if pool == nil {
		return nil, errors.New("tareas: falta el pool de la base")
	}
	hora := reloj.Sistema{}
	// El servicio de cuentas exige todos sus puertos aunque las tareas solo usen la purga y el aviso (repositorio, correo,
	// reloj y registro): el hash, la política y los límites no se llaman desde aquí.
	cuentas, err := cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: pg.NuevoCuentas(pool), Correo: correo.NuevoSMTP(cfg, hora), Politica: seguridad.NuevaPoliticaDeContrasena(),
		Hasher: argon2id.Predeterminado(), Reloj: hora, Limitador: seguridad.NuevoLimitadorDeIntentos(hora), Log: log,
	})
	if err != nil {
		return nil, err
	}
	return tareas.NuevoEjecutor(cuentas, pg.NuevoLimpieza(pool), hora, log), nil
}
