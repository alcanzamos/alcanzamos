package cuenta

import (
	"context"
	"errors"
	"log/slog"
	"net/mail"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/alcanzamos/alcanzamos/api/src/correo"
	"github.com/alcanzamos/alcanzamos/api/src/reloj"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// Plazos de la cuenta.
const (
	// VigenciaDelEnlaceDeVerificacion: el enlace de verificación vence a las 24 horas (E13 §5.4).
	VigenciaDelEnlaceDeVerificacion = 24 * time.Hour
	// PlazoParaConfirmar: la cuenta que no confirma el correo o no autoriza se borra a los 7 días de creada (D-135).
	PlazoParaConfirmar = 7 * 24 * time.Hour
	// AniosDeLaPruebaDeAutorizacion: lo que se conserva tras borrar la cuenta, 3 años, es provisional (E13 §7, D-085).
	AniosDeLaPruebaDeAutorizacion = 3

	// NombreProvisional es el nombre que lleva la cuenta pendiente hasta que la persona elige el suyo en PN-74 (D-172
	// (2)): `persona.nombre` no admite nulo y PN-58 pide solo el correo. Nunca se muestra, porque una cuenta pendiente no
	// tiene sesión, y la tarea de D-135 la borra a los 7 días si nadie la confirma.
	NombreProvisional = "Pendiente"

	longitudMaximaDelNombre = 60  // ck_persona_nombre
	longitudMaximaDelCorreo = 254 // RFC 5321
	plazoDelEnvio           = 30 * time.Second

	// CupoDeSolicitudes es el tope global de pedidos de verificación (crear y reenviar) que trabajan en segundo plano a la
	// vez, como la cola de 100 de la recuperación (D-144).
	CupoDeSolicitudes = 100
)

// Errores del servicio.
var (
	// ErrCorreoYaRegistrado lo devuelve el Repositorio cuando el correo ya tiene una cuenta con el correo verificado.
	// El servicio no lo expone: responde igual (D-172 (1)) y manda el aviso al dueño.
	ErrCorreoYaRegistrado = errors.New("el correo ya tiene una cuenta verificada")
	// ErrEnlaceInvalido: el enlace no existe, ya se usó, venció o ya no es el vigente (lo reemplazó uno nuevo). Un solo
	// error para los tres casos, que el cliente muestra como «Ese enlace ya no sirve.» con «Pedir otro enlace» (D-192).
	// ErrSinCuenta lo devuelve el Repositorio cuando se pide la verificación de un correo sin cuenta con SoloSiExiste.
	ErrSinCuenta      = errors.New("el correo no tiene cuenta")
	ErrEnlaceInvalido = errors.New("el enlace ya no sirve")
	// ErrDemasiadosIntentos: el origen o la dirección pasaron el límite de intentos (D-140). El cliente muestra «Hiciste muchos intentos…».
	ErrDemasiadosIntentos = errors.New("demasiados intentos")
)

// Códigos de error de campo (PN-58, PN-74). Los clientes los mapean a los textos de E14; el API no manda textos.
const (
	CorreoVacio          = "correo_vacio"
	CorreoInvalido       = "correo_invalido"
	ContrasenaVacia      = "contrasena_vacia"
	ContrasenaCorta      = "contrasena_corta"
	ContrasenaComun      = "contrasena_comun"
	ContrasenaPersonal   = "contrasena_personal"
	NombreVacio          = "nombre_vacio"
	NombreLargo          = "nombre_largo"
	MayorDeEdadRequerido = "mayor_de_edad_requerido"
	campoCorreo          = "correo"
	campoContrasena      = "contrasena"
	campoNombre          = "nombre"
	campoMayorDeEdad     = "mayor_de_edad"
)

// ErrValidacion reúne los errores de campo de una solicitud: campo → código.
type ErrValidacion struct{ Campos map[string]string }

func (e *ErrValidacion) Error() string { return "solicitud con campos inválidos" }

// SolicitudDeCuenta es lo que entrega la persona en PN-58 (RNF-016, D-172 (1)): el correo, y en la web la casilla «Soy
// mayor de edad». La fecha de nacimiento no existe aquí ni en ninguna parte: «mayor de edad» lo calcula el cliente y el
// API solo exige que sea verdadero (D-089). La contraseña y el nombre se piden después, en PN-74.
type SolicitudDeCuenta struct {
	Correo      string
	MayorDeEdad bool
}

// SesionNueva es la sesión con que termina PN-74: el token, que el cliente guarda (cookie en la web, Bearer en Android).
type SesionNueva struct {
	Token string
}

// NuevaVerificacion es lo que el Repositorio guarda para pedir la verificación de un correo, en una sola transacción.
type NuevaVerificacion struct {
	Correo          string // normalizado por el Servicio; el Repositorio lo vuelve a normalizar como exige la base
	Nombre          string // el de una cuenta nueva: NombreProvisional
	HuellaDelEnlace []byte // SHA-256 del token de verificación
	Ahora           time.Time
	VenceElEnlaceEn time.Time
	// SoloSiExiste: no crear la cuenta si el correo no tiene una (el reenvío de PN-59 no crea cuentas).
	SoloSiExiste bool
}

// CuentaElegida es lo que el Repositorio guarda al completar la cuenta con el enlace (PN-74), en una sola transacción.
type CuentaElegida struct {
	HuellaDelEnlace []byte
	Nombre          string
	HashContrasena  string
	HuellaDeSesion  []byte // SHA-256 del token de la sesión que empieza
	Ahora           time.Time
}

// Repositorio es la persistencia que el servicio necesita (la implementa src/pg).
type Repositorio interface {
	// SolicitarVerificacion guarda, en una sola transacción, un enlace de verificación nuevo para el correo (D-172 (2)).
	// Sin cuenta con ese correo, crea persona y perfil (sin credencial: la contraseña se elige en PN-74). Con una cuenta
	// **sin verificar**, invalida los enlaces pendientes y guarda el nuevo; no borra ni recrea la cuenta (SEG-012). Con
	// una cuenta **verificada** no toca nada y devuelve ErrCorreoYaRegistrado.
	SolicitarVerificacion(ctx context.Context, v NuevaVerificacion) error
	// CorreoDelEnlace devuelve el correo de la cuenta de un enlace de verificación vigente y sin usar, sin consumirlo (la
	// política de contraseñas lo necesita), o ErrEnlaceInvalido.
	CorreoDelEnlace(ctx context.Context, huella []byte, ahora time.Time) (string, error)
	// CompletarCuenta, en una sola transacción: consume el enlace (ErrEnlaceInvalido si no existe, ya se usó, venció o
	// lo reemplazó uno nuevo), guarda el nombre y la credencial, marca el correo como verificado, deja sin efecto los
	// demás enlaces y crea la sesión. Todo o nada: sin la contraseña guardada no hay sesión (D-172 (3)).
	CompletarCuenta(ctx context.Context, c CuentaElegida) error
	// BorrarSinConfirmar borra, con todo lo que tengan (sesiones incluidas), las cuentas adultas creadas hasta
	// `creadasHasta` que no confirmaron el correo o no tienen vigente cada una de las `necesarias` otorgadas por la
	// propia persona (D-135, D-139), y devuelve cuántas. Las autorizaciones que tuvieran quedan retiradas en `ahora`
	// y se conservan hasta `conservarHasta`.
	BorrarSinConfirmar(ctx context.Context, creadasHasta, ahora, conservarHasta time.Time) (int, error)
}

// Hasheador calcula el hash de una contraseña (src/argon2id).
type Hasheador interface {
	Hashear(ctx context.Context, contrasena string) (string, error)
}

// Dependencias son los puertos del servicio.
type Dependencias struct {
	Repo      Repositorio
	Correo    correo.Correo
	Politica  *seguridad.PoliticaDeContrasena
	Hasher    Hasheador
	Reloj     reloj.Reloj
	Limitador *seguridad.LimitadorDeIntentos
	Log       *slog.Logger
	// CupoDeSolicitudes es el tope global de pedidos de verificación en segundo plano; sin valor, 100.
	CupoDeSolicitudes int
}

// Servicio son los casos de uso de la cuenta.
type Servicio struct {
	d      Dependencias
	envios sync.WaitGroup
	cupo   chan struct{} // un lugar por pedido de verificación en segundo plano (A2)
}

// NuevoServicio arma el servicio con sus puertos.
func NuevoServicio(d Dependencias) *Servicio {
	if d.CupoDeSolicitudes <= 0 {
		d.CupoDeSolicitudes = CupoDeSolicitudes
	}
	return &Servicio{d: d, cupo: make(chan struct{}, d.CupoDeSolicitudes)}
}

// Esperar bloquea hasta que terminen las solicitudes y los envíos de correo en curso. Lo usan las pruebas y el apagado ordenado.
func (s *Servicio) Esperar() { s.envios.Wait() }

// PermitirCreacion cuenta un intento de crear una cuenta desde el origen y dice si pasa: 20 por hora por origen, todos
// los intentos, también los rechazados por validación o por JSON roto (D-140).
func (s *Servicio) PermitirCreacion(origen string) bool {
	return s.d.Limitador.PermitirCreacion(origen)
}

// CrearCuenta atiende PN-58 (CU-43, D-172 (1) y (2)): valida el correo y la casilla de edad, y pide la verificación del
// correo. **Nunca entrega una sesión y responde siempre lo mismo**, tenga o no cuenta ese correo, esté verificada o no.
// Quien llama ya contó el intento con PermitirCreacion.
//
// Qué llega al correo (D-172 (2)): a un correo sin cuenta o con una cuenta sin verificar, un enlace nuevo, y el anterior
// deja de servir; a un correo de una cuenta verificada, el aviso «Alguien intentó crear una cuenta con tu correo». Los
// dos cuentan en el límite de 3 correos por hora a esa dirección (D-140 (2)).
//
// Para que el tiempo tampoco lo delate (SEG-013), todo lo que depende de la cuenta (la base y el envío) pasa fuera del
// pedido, en segundo plano: el pedido solo valida y encola, y tarda lo mismo en los tres casos.
func (s *Servicio) CrearCuenta(ctx context.Context, sol SolicitudDeCuenta) error {
	correoNormalizado, codigo := normalizarCorreo(sol.Correo)
	campos := map[string]string{}
	if codigo != "" {
		campos[campoCorreo] = codigo
	}
	if !sol.MayorDeEdad {
		campos[campoMayorDeEdad] = MayorDeEdadRequerido
	}
	if len(campos) > 0 {
		return &ErrValidacion{Campos: campos}
	}
	s.pedirVerificacion(ctx, correoNormalizado, false)
	return nil
}

// ReenviarVerificacion atiende «Reenviar el correo» de PN-59 (D-172 (4)): recibe el correo, sin sesión, y responde igual
// que CrearCuenta con o sin cuenta. Además del límite del correo por hora (D-140 (2)), que se aplica al enviar, tiene la
// espera corta de 30 segundos, 3 por hora por dirección y 20 por origen (D-136), con su propio contador. Los límites
// cuentan por el correo escrito, exista o no la cuenta: el 429 no delata nada. Devuelve ErrDemasiadosIntentos o *ErrValidacion.
func (s *Servicio) ReenviarVerificacion(ctx context.Context, correo, origen string) error {
	correoNormalizado, err := validarCorreo(correo)
	if err != nil {
		return err
	}
	if !s.d.Limitador.PermitirReenvio(correoNormalizado, origen) {
		return ErrDemasiadosIntentos
	}
	s.pedirVerificacion(ctx, correoNormalizado, true)
	return nil
}

// pedirVerificacion hace en segundo plano lo que depende de la cuenta, y nunca cambia lo que ve el cliente:
//
//  1. Cupo global (A2): si ya hay CupoDeSolicitudes pedidos trabajando, el trabajo se descarta y se registra sin el correo
//     ni el token; la persona lo pide otra vez.
//  2. Límite de 3 correos por hora a la dirección, **antes de tocar la base** (A1): un pedido que no va a poder enviar
//     nada no revoca el enlace que la persona ya tiene. Cuenta igual con o sin cuenta, para no delatarla.
//  3. Con `soloSiExiste` (el reenvío, B1) no se crea ninguna cuenta: sin cuenta no se hace nada. Crear (PN-58, que validó
//     `mayor_de_edad`) sí la crea.
//  4. Cuenta nueva o sin verificar, un enlace nuevo (el anterior deja de servir); verificada, el aviso.
//
// Un fallo se registra sin el correo ni el token: la persona lo pide otra vez con «Reenviar el correo» (PN-59).
func (s *Servicio) pedirVerificacion(ctx context.Context, correoNormalizado string, soloSiExiste bool) {
	select {
	case s.cupo <- struct{}{}:
	default:
		s.d.Log.WarnContext(ctx, "pedido de verificación descartado: el trabajo en segundo plano está lleno")
		return
	}
	token, huella := seguridad.NuevoTokenOpaco()
	ahora := s.d.Reloj.Ahora()
	s.envios.Add(1)
	go func() {
		defer s.envios.Done()
		defer func() { <-s.cupo }()
		ctx, cancelar := context.WithTimeout(context.WithoutCancel(ctx), plazoDelEnvio)
		defer cancelar()
		if !s.d.Limitador.PermitirCorreo(correoNormalizado) {
			s.d.Log.InfoContext(ctx, "correo no enviado: límite por dirección")
			return
		}
		err := s.d.Repo.SolicitarVerificacion(ctx, NuevaVerificacion{
			Correo: correoNormalizado, Nombre: NombreProvisional, HuellaDelEnlace: huella,
			Ahora: ahora, VenceElEnlaceEn: ahora.Add(VigenciaDelEnlaceDeVerificacion), SoloSiExiste: soloSiExiste,
		})
		switch {
		case errors.Is(err, ErrSinCuenta):
		case errors.Is(err, ErrCorreoYaRegistrado):
			s.enviar(ctx, "aviso", func(ctx context.Context) error {
				return s.d.Correo.EnviarAvisoDeCorreoRegistrado(ctx, correoNormalizado)
			})
		case err != nil:
			s.d.Log.ErrorContext(ctx, "no se pudo pedir la verificación del correo", "error", err)
		default:
			s.enviar(ctx, "verificación", func(ctx context.Context) error {
				return s.d.Correo.EnviarVerificacion(ctx, correoNormalizado, token)
			})
		}
	}()
}

// VerificarYElegirContrasena completa la cuenta con el enlace del correo (PN-74, D-172 (3)): el token es la autoridad,
// sirve desde cualquier dispositivo y una sola vez. Valida la contraseña (política de D-142, con el correo de la cuenta)
// y el nombre (hasta 60) sin gastar el enlace, para que la persona corrija y vuelva a intentar. Después, en una sola
// transacción, consume el enlace, guarda la credencial, verifica el correo y crea la sesión: **la sesión empieza solo con
// la contraseña ya guardada**. Un enlace inexistente, mal formado, usado, vencido o reemplazado da ErrEnlaceInvalido,
// siempre el mismo (D-192); campos mal escritos, *ErrValidacion.
func (s *Servicio) VerificarYElegirContrasena(ctx context.Context, token, contrasena, nombre string) (SesionNueva, error) {
	huella, err := seguridad.HuellaDeToken(token)
	if err != nil {
		return SesionNueva{}, ErrEnlaceInvalido
	}
	correoDeLaCuenta, err := s.d.Repo.CorreoDelEnlace(ctx, huella, s.d.Reloj.Ahora())
	if err != nil {
		return SesionNueva{}, err
	}
	campos := map[string]string{}
	if codigo := CodigoDeContrasena(s.d.Politica.Validar(contrasena, correoDeLaCuenta, "")); codigo != "" {
		campos[campoContrasena] = codigo
	}
	nombre = strings.TrimSpace(nombre)
	switch {
	case nombre == "":
		campos[campoNombre] = NombreVacio
	case utf8.RuneCountInString(nombre) > longitudMaximaDelNombre:
		campos[campoNombre] = NombreLargo
	}
	if len(campos) > 0 {
		return SesionNueva{}, &ErrValidacion{Campos: campos}
	}
	hash, err := s.d.Hasher.Hashear(ctx, contrasena)
	if err != nil {
		return SesionNueva{}, err
	}
	tokenDeSesion, huellaDeSesion := seguridad.NuevoTokenOpaco()
	if err := s.d.Repo.CompletarCuenta(ctx, CuentaElegida{
		HuellaDelEnlace: huella, Nombre: nombre, HashContrasena: hash, HuellaDeSesion: huellaDeSesion, Ahora: s.d.Reloj.Ahora(),
	}); err != nil {
		return SesionNueva{}, err
	}
	return SesionNueva{Token: tokenDeSesion}, nil
}

// BorrarCuentasSinConfirmar borra, con todo lo que tengan, las cuentas de 7 días o más que no confirmaron el correo o
// que nunca autorizaron nada como titulares (D-135). Una cuenta que ya autorizó algo antes no se borra aunque le falte
// una finalidad necesaria nueva, como `transmision_a_encargados`: queda en `sin_autorizacion` hasta que la acepte
// (SC-E21-25 sección 5, D-202), así que esta tarea ya no consulta ReglaDeFinalidades. No envía correo: la dirección no
// está confirmada y puede ser de otra persona. Es idempotente: una cuenta ya borrada no vuelve a aparecer. Devuelve
// cuántas borró.
func (s *Servicio) BorrarCuentasSinConfirmar(ctx context.Context, ahora time.Time) (int, error) {
	return s.d.Repo.BorrarSinConfirmar(ctx, ahora.Add(-PlazoParaConfirmar), ahora, ahora.AddDate(AniosDeLaPruebaDeAutorizacion, 0, 0))
}

// enviar manda el correo dentro del trabajo en segundo plano, que ya pasó el límite de la dirección y el cupo. Nunca
// registra la dirección, el token ni el cuerpo: solo qué correo era.
func (s *Servicio) enviar(ctx context.Context, que string, envio func(context.Context) error) {
	if err := envio(ctx); err != nil {
		s.d.Log.ErrorContext(ctx, "no se pudo enviar el correo", "correo", que, "error", err)
	}
}

// CodigoDeContrasena es el código de campo (PN-58, PN-62, PN-73) del error de la política de contraseñas, o "" si no
// hay error. Los clientes lo mapean a los textos de E14.
func CodigoDeContrasena(err error) string {
	switch {
	case errors.Is(err, seguridad.ErrContrasenaVacia):
		return ContrasenaVacia
	case errors.Is(err, seguridad.ErrContrasenaCorta):
		return ContrasenaCorta
	case errors.Is(err, seguridad.ErrContrasenaPersonal):
		return ContrasenaPersonal
	case errors.Is(err, seguridad.ErrContrasenaComun):
		return ContrasenaComun
	}
	return ""
}

// normalizarCorreo recorta y pasa a minúsculas el correo, y devuelve el código de error de PN-58 si no sirve ("" si sirve).
func normalizarCorreo(correo string) (normalizado, codigo string) {
	normalizado = strings.TrimSpace(correo)
	switch dir, err := mail.ParseAddress(normalizado); {
	case normalizado == "":
		codigo = CorreoVacio
	case err != nil || dir.Address != normalizado || len(normalizado) > longitudMaximaDelCorreo || !tieneDominio(normalizado):
		codigo = CorreoInvalido
	}
	return strings.ToLower(normalizado), codigo
}

// NormalizarCorreo es el correo recortado y en minúsculas, y si tiene la forma de PN-58. El inicio de sesión lo usa
// para saber si un identificador puede ser un correo (el nombre de usuario llega en I11).
func NormalizarCorreo(correo string) (normalizado string, valido bool) {
	normalizado, codigo := normalizarCorreo(correo)
	return normalizado, codigo == ""
}

// ValidarCorreo devuelve el código de error de PN-58 del correo (`correo_vacio` o `correo_invalido`), o "" si sirve.
func ValidarCorreo(correo string) (normalizado, codigo string) { return normalizarCorreo(correo) }

// validarCorreo valida un correo suelto con las reglas de PN-58 y devuelve el normalizado, o un *ErrValidacion.
func validarCorreo(correo string) (string, error) {
	normalizado, codigo := normalizarCorreo(correo)
	if codigo != "" {
		return "", &ErrValidacion{Campos: map[string]string{campoCorreo: codigo}}
	}
	return normalizado, nil
}

// tieneDominio exige un punto en el dominio, como en el ejemplo de PN-58: nombre@correo.com.
func tieneDominio(correo string) bool {
	_, dominio, _ := strings.Cut(correo, "@")
	i := strings.Index(dominio, ".")
	return i > 0 && i < len(dominio)-1
}
