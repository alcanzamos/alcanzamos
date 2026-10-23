package seguridad

import (
	"context"
	"log/slog"
)

// TipoDeEvento es el valor cerrado del campo evento_seguridad (E17-VTE 2.1, E11-DAR §7).
// La alerta de producción cuenta por este valor: si cambia, cambia también `infra/produccion/alertas.tf`.
type TipoDeEvento string

const (
	InicioSesionFallido TipoDeEvento = "inicio_sesion_fallido" // correo o contraseña incorrectos
	AccesoDenegado      TipoDeEvento = "acceso_denegado"       // el control de acceso niega una ruta o un dato
	ErrorAutorizacion   TipoDeEvento = "error_autorizacion"    // la sesión no existe, venció o fue revocada
)

// CuentaDesconocida es el valor de `cuenta` cuando el evento no se puede atribuir a una cuenta.
const CuentaDesconocida = "desconocida"

// Registro escribe los eventos de seguridad: una línea JSON por evento, con `slog`, en la salida del API.
type Registro struct {
	log *slog.Logger
}

// NuevoRegistro usa el logger del API (JSON). El nivel del evento es siempre WARN.
func NuevoRegistro(log *slog.Logger) *Registro { return &Registro{log: log} }

// Registrar escribe un evento. cuenta es el uuid de la persona o "" si no se conoce; ruta es el patrón del
// ServeMux (Request.Pattern), nunca la URL con valores; codigo es el código HTTP de la respuesta.
// No lleva origen ni IP (D-123), ni correos, contraseñas, tokens o cuerpos (NM-03, RNF-025).
func (r *Registro) Registrar(ctx context.Context, tipo TipoDeEvento, cuenta, ruta string, codigo int) {
	if cuenta == "" {
		cuenta = CuentaDesconocida
	}
	r.log.LogAttrs(ctx, slog.LevelWarn, "evento de seguridad",
		slog.String("evento_seguridad", string(tipo)),
		slog.String("cuenta", cuenta),
		slog.String("ruta", ruta),
		slog.Int("codigo", codigo),
		slog.String("peticion", PeticionDe(ctx)),
	)
}
