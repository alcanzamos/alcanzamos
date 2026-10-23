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

	"github.com/alcanzamos/alcanzamos/api/internal/correo"
	"github.com/alcanzamos/alcanzamos/api/internal/reloj"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
)

// Plazos de la cuenta.
const (
	// VigenciaDelEnlaceDeVerificacion: el enlace de verificación vence a las 24 horas (E13 §5.4).
	VigenciaDelEnlaceDeVerificacion = 24 * time.Hour
	// PlazoParaConfirmar: la cuenta que no confirma el correo o no autoriza se borra a los 7 días de creada (D-135).
	PlazoParaConfirmar = 7 * 24 * time.Hour

	longitudMaximaDelNombre = 60  // ck_persona_nombre
	longitudMaximaDelCorreo = 254 // RFC 5321
	plazoDelEnvio           = 30 * time.Second
)

// Errores del servicio.
var (
	// ErrCorreoYaRegistrado lo devuelve el Repositorio cuando el correo ya tiene una cuenta con el correo verificado.
	// CrearCuenta no lo expone: responde igual (D-141).
	ErrCorreoYaRegistrado = errors.New("el correo ya tiene una cuenta verificada")
	// ErrDemasiadosIntentos: el origen pasó el límite de intentos (D-140). El cliente muestra «Hiciste muchos intentos…».
	ErrDemasiadosIntentos = errors.New("demasiados intentos")
)

// Códigos de error de campo (PN-58). Los clientes los mapean a los textos de E14; el API no manda textos.
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

// SolicitudDeCuenta es lo que entrega la persona al crear la cuenta (RNF-016). La fecha de nacimiento no existe
// aquí ni en ninguna parte: «mayor de edad» lo calcula el cliente y el API solo exige que sea verdadero (D-089).
type SolicitudDeCuenta struct {
	Correo      string
	Contrasena  string
	Nombre      string
	MayorDeEdad bool
}

// SesionNueva es la sesión que recibe quien crea una cuenta: el token, que el cliente guarda (cookie en la web,
// Bearer en Android). Es del mismo formato y largo si la cuenta es nueva o si es de mentira.
type SesionNueva struct {
	Token string
}

// NuevaCuenta es lo que el Repositorio guarda en una sola transacción.
type NuevaCuenta struct {
	Correo          string // normalizado por el Servicio; el Repositorio lo vuelve a normalizar como exige la base
	Nombre          string
	HashContrasena  string
	HuellaDelEnlace []byte // SHA-256 del token de verificación
	HuellaDeSesion  []byte // SHA-256 del token de la sesión limitada
	Ahora           time.Time
	VenceElEnlaceEn time.Time
}

// Repositorio es la persistencia que el servicio necesita (la implementa internal/pg).
type Repositorio interface {
	// Crear guarda persona, perfil_adulto, credencial, el enlace de verificación y la sesión limitada en una sola
	// transacción (D-141 (1)): si el correo ya tiene una cuenta **sin verificar**, la borra (CASCADE se lleva sus
	// sesiones y enlaces) y crea la nueva con la contraseña de ahora. Si la cuenta es **verificada**, no toca nada y
	// devuelve ErrCorreoYaRegistrado. Devuelve el uuid de la persona.
	Crear(ctx context.Context, c NuevaCuenta) (string, error)
}

// Hasheador calcula el hash de una contraseña (internal/argon2id).
type Hasheador interface {
	Hashear(ctx context.Context, contrasena string) (string, error)
}

// GeneradorDeSenuelos da el token de una sesión de mentira (D-141, D-143 (2)): firmado, sin guardarlo en ningún lado.
// Lo implementa *sesion.Senuelos.
type GeneradorDeSenuelos interface {
	Crear() string
}

// Dependencias son los puertos del servicio.
type Dependencias struct {
	Repo      Repositorio
	Correo    correo.Correo
	Politica  *seguridad.PoliticaDeContrasena
	Hasher    Hasheador
	Reloj     reloj.Reloj
	Limitador *seguridad.LimitadorDeIntentos
	Senuelos  GeneradorDeSenuelos
	Log       *slog.Logger
}

// Servicio son los casos de uso de la cuenta.
type Servicio struct {
	d      Dependencias
	envios sync.WaitGroup
}

// NuevoServicio arma el servicio con sus puertos.
func NuevoServicio(d Dependencias) *Servicio { return &Servicio{d: d} }

// Esperar bloquea hasta que terminen los envíos de correo en curso. Lo usan las pruebas y el apagado ordenado.
func (s *Servicio) Esperar() { s.envios.Wait() }

// PermitirCreacion cuenta un intento de crear una cuenta desde el origen y dice si pasa: 20 por hora por origen, todos
// los intentos, también los rechazados por contraseña o por JSON roto (D-140).
func (s *Servicio) PermitirCreacion(origen string) bool {
	return s.d.Limitador.PermitirCreacion(origen)
}

// CrearCuenta crea la cuenta de una persona adulta, inactiva hasta que confirme el correo (CU-43), le envía el enlace
// y le da una sesión limitada (D-138). Quien llama ya contó el intento con PermitirCreacion.
//
// Qué pasa con un correo que ya existe (D-141, PN-58): la respuesta es siempre la misma y nunca revela si el correo
// estaba registrado.
//
//  1. Sin cuenta, o con una cuenta **sin verificar**: se trata como cuenta nueva. La pendiente se borra y se crea de
//     nuevo con la contraseña de ahora, una sesión limitada real y un enlace nuevo; el anterior deja de servir. Así
//     nadie crea una cuenta con un correo ajeno y su propia contraseña a la espera de que la dueña la verifique.
//  2. Con una cuenta **verificada**: no se toca nada. La sesión es de mentira (un token del mismo formato, firmado
//     con la clave de la configuración y sin guardar, que no apunta a ninguna cuenta) y al dueño le llega el aviso «Alguien intentó crear una
//     cuenta con tu correo». Cuenta en el límite de 3 correos por hora a esa dirección, como la verificación.
//  3. Argon2id corre antes de saber en cuál caso estamos, y los dos envían un correo en segundo plano: el tiempo de
//     respuesta tampoco lo delata.
func (s *Servicio) CrearCuenta(ctx context.Context, sol SolicitudDeCuenta) (SesionNueva, error) {
	correoNormalizado, nombre, err := s.validar(sol)
	if err != nil {
		return SesionNueva{}, err
	}
	hash, err := s.d.Hasher.Hashear(ctx, sol.Contrasena)
	if err != nil {
		return SesionNueva{}, err
	}
	tokenDelEnlace, huellaDelEnlace := seguridad.NuevoTokenOpaco()
	tokenDeSesion, huellaDeSesion := seguridad.NuevoTokenOpaco()
	ahora := s.d.Reloj.Ahora()

	_, err = s.d.Repo.Crear(ctx, NuevaCuenta{
		Correo:          correoNormalizado,
		Nombre:          nombre,
		HashContrasena:  hash,
		HuellaDelEnlace: huellaDelEnlace,
		HuellaDeSesion:  huellaDeSesion,
		Ahora:           ahora,
		VenceElEnlaceEn: ahora.Add(VigenciaDelEnlaceDeVerificacion),
	})
	switch {
	case errors.Is(err, ErrCorreoYaRegistrado):
		tokenDeSesion = s.d.Senuelos.Crear()
		s.enviar(ctx, correoNormalizado, "aviso", func(ctx context.Context) error {
			return s.d.Correo.EnviarAvisoDeCorreoRegistrado(ctx, correoNormalizado)
		})
	case err != nil:
		return SesionNueva{}, err
	default:
		// Si el envío falla, la cuenta existe y la persona puede pedir otro enlace con «Reenviar el correo» (PN-59).
		s.enviar(ctx, correoNormalizado, "verificación", func(ctx context.Context) error {
			return s.d.Correo.EnviarVerificacion(ctx, correoNormalizado, tokenDelEnlace)
		})
	}
	return SesionNueva{Token: tokenDeSesion}, nil
}

// enviar manda un correo en segundo plano si la dirección no pasó el límite de 3 por hora (D-140). Quien llama
// responde igual al cliente haya enviado o no. Nunca registra la dirección, el token ni el cuerpo: solo qué correo era.
func (s *Servicio) enviar(ctx context.Context, destino, que string, envio func(context.Context) error) {
	if !s.d.Limitador.PermitirCorreo(destino) {
		s.d.Log.InfoContext(ctx, "correo no enviado: límite por dirección", "correo", que)
		return
	}
	s.envios.Add(1)
	go func() {
		defer s.envios.Done()
		ctx, cancelar := context.WithTimeout(context.WithoutCancel(ctx), plazoDelEnvio)
		defer cancelar()
		if err := envio(ctx); err != nil {
			s.d.Log.ErrorContext(ctx, "no se pudo enviar el correo", "correo", que, "error", err)
		}
	}()
}

// validar aplica las reglas de PN-58 y devuelve el correo y el nombre normalizados, o un *ErrValidacion.
func (s *Servicio) validar(sol SolicitudDeCuenta) (correoNormalizado, nombre string, err error) {
	campos := map[string]string{}
	correoNormalizado = strings.TrimSpace(sol.Correo)
	switch dir, errCorreo := mail.ParseAddress(correoNormalizado); {
	case correoNormalizado == "":
		campos[campoCorreo] = CorreoVacio
	case errCorreo != nil || dir.Address != correoNormalizado || len(correoNormalizado) > longitudMaximaDelCorreo || !tieneDominio(correoNormalizado):
		campos[campoCorreo] = CorreoInvalido
	}
	correoNormalizado = strings.ToLower(correoNormalizado)

	switch errContrasena := s.d.Politica.Validar(sol.Contrasena, correoNormalizado, ""); {
	case errors.Is(errContrasena, seguridad.ErrContrasenaVacia):
		campos[campoContrasena] = ContrasenaVacia
	case errors.Is(errContrasena, seguridad.ErrContrasenaCorta):
		campos[campoContrasena] = ContrasenaCorta
	case errors.Is(errContrasena, seguridad.ErrContrasenaPersonal):
		campos[campoContrasena] = ContrasenaPersonal
	case errors.Is(errContrasena, seguridad.ErrContrasenaComun):
		campos[campoContrasena] = ContrasenaComun
	}

	nombre = strings.TrimSpace(sol.Nombre)
	switch {
	case nombre == "":
		campos[campoNombre] = NombreVacio
	case utf8.RuneCountInString(nombre) > longitudMaximaDelNombre:
		campos[campoNombre] = NombreLargo
	}
	if !sol.MayorDeEdad {
		campos[campoMayorDeEdad] = MayorDeEdadRequerido
	}
	if len(campos) > 0 {
		return "", "", &ErrValidacion{Campos: campos}
	}
	return correoNormalizado, nombre, nil
}

// tieneDominio exige un punto en el dominio, como en el ejemplo de PN-58: nombre@correo.com.
func tieneDominio(correo string) bool {
	_, dominio, _ := strings.Cut(correo, "@")
	i := strings.Index(dominio, ".")
	return i > 0 && i < len(dominio)-1
}
