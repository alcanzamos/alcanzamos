package cuenta

import (
	"context"
	"errors"
	"fmt"
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
	// PlazoParaConfirmar: la cuenta que no confirma el correo se borra a los 7 días de creada (D-135, el caso 1). La que
	// confirmó el correo y no autorizó nada (el caso 2) también espera estos 7 días, pero además el aviso (D-203).
	PlazoParaConfirmar = 7 * 24 * time.Hour
	// PlazoParaAvisar: el aviso antes de la purga sale a partir de los 5 días de creada la cuenta del caso 2 (D-203).
	PlazoParaAvisar = 5 * 24 * time.Hour
	// EsperaTrasElAviso: una cuenta del caso 2 se borra al menos 48 horas después del aviso (D-203).
	EsperaTrasElAviso = 48 * time.Hour
	// LimiteSinAviso: si a los 14 días de creada el aviso todavía no salió, la cuenta del caso 2 se borra igual y la tarea
	// deja un error en el registro (D-203).
	LimiteSinAviso = 14 * 24 * time.Hour
	// PlazoDeEnvioConFilasBloqueadas es el tiempo de espera del envío del aviso (D-203, S4). El aviso se manda con la fila
	// de la persona y la de su perfil bloqueadas (`FOR UPDATE`), para que dos pasadas de la tarea no lo manden dos veces ni
	// se mande a quien está autorizando; un servidor de correo que no responde las dejaría bloqueadas, y con ellas a esa
	// persona (iniciar sesión, autorizar, borrar la cuenta). Son 10 segundos: de sobra para el diálogo SMTP de un servidor
	// sano (conectar, STARTTLS, un mensaje de texto plano) y mucho menos que los 30 s del adaptador, que son para un envío
	// que no tiene nada bloqueado. Si se cumple, el envío falla, no se registra y se reintenta en la pasada siguiente.
	PlazoDeEnvioConFilasBloqueadas = 10 * time.Second
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
	// BorrarSinConfirmar borra, con todo lo que tengan (sesiones incluidas), las cuentas adultas que no confirmaron el
	// correo (caso 1) o que lo confirmaron y nunca autorizaron nada (caso 2), según los plazos (D-135, D-203): el caso 1,
	// creadas hasta `CreadasHasta`; el caso 2, creadas hasta `CreadasHasta` y avisadas hasta `AvisadasHasta`, o sin aviso y
	// creadas hasta `SinAvisoHasta`. Devuelve cuántas borró y cuáles (de las del caso 2) sin aviso. Las autorizaciones que
	// tuvieran quedan retiradas en `Ahora` y se conservan hasta `ConservarHasta`.
	BorrarSinConfirmar(ctx context.Context, p PlazosDeLaPurga) (ResultadoDeLaPurga, error)
	// AvisarAntesDeLaPurga recorre las cuentas del caso 2 (adulta, correo confirmado, ninguna autorización como titular)
	// creadas hasta `avisarHasta` y sin aviso, **una por una**: en una transacción bloquea la fila de la persona y la de su
	// perfil, vuelve a evaluar el caso con las filas bloqueadas, llama a `enviar` y, solo si sale bien, escribe en la misma
	// transacción el momento que `enviar` devolvió como `aviso_de_purga_en`. Si `enviar` falla no escribe nada y sigue con
	// la siguiente. Devuelve cuántas quedaron avisadas.
	AvisarAntesDeLaPurga(ctx context.Context, avisarHasta time.Time, enviar EnvioDelAviso) (int, error)
}

// PlazosDeLaPurga son los momentos de corte de una pasada de la purga (D-203), calculados desde la hora de la pasada.
type PlazosDeLaPurga struct {
	Ahora time.Time
	// CreadasHasta es `Ahora − 7 días`: el caso 1 se borra si se creó hasta aquí; el caso 2 también lo exige.
	CreadasHasta time.Time
	// AvisadasHasta es `Ahora − 48 horas`: el caso 2 se borra si su aviso es de hasta aquí.
	AvisadasHasta time.Time
	// SinAvisoHasta es `Ahora − 14 días`: el caso 2 sin aviso se borra si se creó hasta aquí.
	SinAvisoHasta time.Time
	// ConservarHasta es hasta cuándo se conserva la prueba mínima de las autorizaciones retiradas (E13 §7).
	ConservarHasta time.Time
}

// ResultadoDeLaPurga es lo que borró una pasada de la purga.
type ResultadoDeLaPurga struct {
	Borradas int
	// SinAviso son los ids de las cuentas del caso 2 que se borraron por el límite de 14 días sin que el aviso saliera.
	SinAviso []string
}

// CuentaPorAvisar es una cuenta del caso 2 a la que le toca el aviso.
type CuentaPorAvisar struct {
	ID       string
	Correo   string
	CreadaEn time.Time
}

// EnvioDelAviso manda el aviso a una cuenta con sus filas bloqueadas y devuelve el momento del aviso, que el repositorio
// guarda si no hay error. Si devuelve un error, el repositorio no guarda nada.
type EnvioDelAviso func(ctx context.Context, c CuentaPorAvisar) (avisoEn time.Time, err error)

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
	// PlazoDeEnvioConFilasBloqueadas es el tiempo de espera del envío del aviso de la purga; sin valor,
	// PlazoDeEnvioConFilasBloqueadas (10 s). Las pruebas lo acortan para no esperar con un servidor que no responde.
	PlazoDeEnvioConFilasBloqueadas time.Duration
}

// Servicio son los casos de uso de la cuenta.
type Servicio struct {
	d      Dependencias
	envios sync.WaitGroup
	cupo   chan struct{} // un lugar por pedido de verificación en segundo plano (A2)
}

// ErrDependenciaFaltante es el error de NuevoServicio cuando a Dependencias le falta un puerto.
var ErrDependenciaFaltante = errors.New("cuenta: falta una dependencia")

// NuevoServicio arma el servicio con sus puertos. Todos son obligatorios, también para quien solo usa una parte (las
// tareas usan la purga y el aviso, no el hash ni los límites): una dependencia que falta se descubre aquí, al armar, y no
// a mitad de una corrida con un nil pointer (ítem 294, L10). El error es ErrDependenciaFaltante y nombra todas las que faltan.
func NuevoServicio(d Dependencias) (*Servicio, error) {
	var faltan []string
	for _, p := range []struct {
		nombre string
		falta  bool
	}{
		{"Repo", d.Repo == nil},
		{"Correo", d.Correo == nil},
		{"Politica", d.Politica == nil},
		{"Hasher", d.Hasher == nil},
		{"Reloj", d.Reloj == nil},
		{"Limitador", d.Limitador == nil},
		{"Log", d.Log == nil},
	} {
		if p.falta {
			faltan = append(faltan, p.nombre)
		}
	}
	if len(faltan) > 0 {
		return nil, fmt.Errorf("%w: %s", ErrDependenciaFaltante, strings.Join(faltan, ", "))
	}
	if d.CupoDeSolicitudes <= 0 {
		d.CupoDeSolicitudes = CupoDeSolicitudes
	}
	return &Servicio{d: d, cupo: make(chan struct{}, d.CupoDeSolicitudes)}, nil
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

// BorrarCuentasSinConfirmar es la pasada de la tarea con las cuentas que nadie confirmó o autorizó, en dos pasos (D-135,
// D-203). Devuelve cuántas borró.
//
// **Primero la purga**, con todo lo que las cuentas tengan:
//   - caso 1 (el correo sin confirmar): a los 7 días de creada, sin aviso;
//   - caso 2 (el correo confirmado y ninguna autorización como titular): cuando se cumplen 7 días desde creada_en **y**
//     48 horas desde el aviso; sin aviso registrado, a los 14 días de creada, con un ERROR en el registro (el id de la
//     cuenta, nunca el correo).
//
// Una cuenta que ya autorizó algo antes no se borra aunque le falte una finalidad necesaria nueva, como
// `transmision_a_encargados`: queda en `sin_autorizacion` hasta que la acepte (SC-E21-25 sección 5, D-202).
//
// **Después el aviso** (AvisarAntesDeLaPurga): a las cuentas del caso 2 de 5 días o más sin aviso. Va después para que la
// que ya pasó el límite de 14 días se borre en esta pasada, sin que un aviso de última hora la deje 48 horas más.
//
// Es idempotente: una cuenta ya borrada no vuelve a aparecer y una ya avisada no se avisa otra vez.
func (s *Servicio) BorrarCuentasSinConfirmar(ctx context.Context, ahora time.Time) (int, error) {
	res, err := s.d.Repo.BorrarSinConfirmar(ctx, PlazosDeLaPurga{
		Ahora:          ahora,
		CreadasHasta:   ahora.Add(-PlazoParaConfirmar),
		AvisadasHasta:  ahora.Add(-EsperaTrasElAviso),
		SinAvisoHasta:  ahora.Add(-LimiteSinAviso),
		ConservarHasta: ahora.AddDate(AniosDeLaPruebaDeAutorizacion, 0, 0),
	})
	if err != nil {
		return 0, err
	}
	for _, id := range res.SinAviso {
		s.d.Log.ErrorContext(ctx, "cuenta del caso 2 borrada sin aviso: pasaron 14 días desde que se creó y el aviso no salió", "persona_id", id)
	}
	avisadas, err := s.avisarAntesDeLaPurga(ctx, ahora)
	if err != nil {
		return res.Borradas, err
	}
	if avisadas > 0 {
		s.d.Log.InfoContext(ctx, "avisos de purga enviados", "cantidad", avisadas)
	}
	return res.Borradas, nil
}

// avisarAntesDeLaPurga manda el aviso a las cuentas del caso 2 que llevan 5 días o más (D-203, S5). El correo dice el
// momento real del borrado, el que llegue más tarde entre creada_en + 7 días y el aviso + 48 horas, y el aviso que se
// registra es la hora leída justo antes de enviar ese correo, por cada cuenta (no la del inicio de la pasada, que una purga
// o unos envíos lentos dejan atrás): así la purga siempre espera 48 horas o más desde el correo real. El envío lleva un plazo corto
// (PlazoDeEnvioConFilasBloqueadas) porque se hace con las filas bloqueadas. Si falla, no se registra nada y queda un
// aviso en el registro, con el id de la cuenta y no con el correo: la pasada siguiente lo reintenta.
//
// **No pasa por el límite de 3 correos por hora a la dirección** (D-140 (2), D-172 (7)) y tampoco suma a su contador
// (L5 del dueño, D-203): el aviso lo manda la tarea, no la persona, y es la única advertencia antes de borrar la cuenta. Por
// eso este camino no llama a `Limitador.PermitirCorreo`, ni antes ni después de enviar.
func (s *Servicio) avisarAntesDeLaPurga(ctx context.Context, ahora time.Time) (int, error) {
	plazo := s.d.PlazoDeEnvioConFilasBloqueadas
	if plazo <= 0 {
		plazo = PlazoDeEnvioConFilasBloqueadas
	}
	return s.d.Repo.AvisarAntesDeLaPurga(ctx, ahora.Add(-PlazoParaAvisar), func(ctx context.Context, c CuentaPorAvisar) (time.Time, error) {
		ctx, cancelar := context.WithTimeout(ctx, plazo)
		defer cancelar()
		// La hora del aviso se lee aquí, justo antes de enviar y por cada cuenta, y no al empezar la pasada: la purga o
		// los envíos anteriores pueden haber tardado, y con la hora de la pasada las 48 horas contarían desde antes del correo.
		avisoEn := s.d.Reloj.Ahora()
		if err := s.d.Correo.EnviarAvisoDePurga(ctx, c.Correo, momentoDelBorrado(c.CreadaEn, avisoEn)); err != nil {
			s.d.Log.WarnContext(ctx, "aviso de purga no enviado: se reintenta en la pasada siguiente", "persona_id", c.ID, "error", err)
			return time.Time{}, err
		}
		return avisoEn, nil
	})
}

// momentoDelBorrado es cuándo se borra una cuenta del caso 2 avisada en `avisoEn`: lo que llegue más tarde entre creada_en
// + 7 días y el aviso + 48 horas (D-203).
func momentoDelBorrado(creadaEn, avisoEn time.Time) time.Time {
	borrado := creadaEn.Add(PlazoParaConfirmar)
	if tras := avisoEn.Add(EsperaTrasElAviso); tras.After(borrado) {
		return tras
	}
	return borrado
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
