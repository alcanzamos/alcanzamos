// Package autenticacion son los casos de uso de entrar y salir de la cuenta (E12 `AutenticacionServicio`, CU-52,
// CU-69): iniciar y cerrar sesión, y leer el ingreso anterior (RF-062). Las reglas de contraseña y de límites están en
// `internal/seguridad`; el almacén de sesiones y la credencial, en `internal/pg`.
package autenticacion

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/correo"
	"github.com/alcanzamos/alcanzamos/api/internal/cuenta"
	"github.com/alcanzamos/alcanzamos/api/internal/reloj"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
)

// Errores del servicio.
var (
	// ErrCredencialesInvalidas: el identificador no tiene cuenta o la contraseña no es la suya. Es el mismo error, y
	// el mismo cuerpo, en los dos casos (CU-52 2a, RNF-014).
	ErrCredencialesInvalidas = errors.New("credenciales inválidas")
	// ErrDemasiadosIntentos: la cuenta o el origen pasaron el límite de fallos (D-136).
	ErrDemasiadosIntentos = errors.New("demasiados intentos")
	// ErrContrasenaActualIncorrecta: en PN-73 la contraseña de ahora no es la de la cuenta.
	ErrContrasenaActualIncorrecta = errors.New("la contraseña de ahora no coincide")
	// ErrNoExiste lo devuelve el Repositorio cuando no hay credencial para el correo.
	ErrNoExiste = errors.New("no existe")
)

// Códigos de error de campo del inicio de sesión (PN-60): el cliente los mapea a los textos de E14.
const (
	IdentificadorVacio = "identificador_vacio"
	campoIdentificador = "identificador"
	campoContrasena    = "contrasena"
)

// Credencial es lo que el inicio de sesión necesita de la cuenta.
type Credencial struct {
	Persona    string
	Hash       string
	Correo     string // solo lo llena CredencialDe
	Verificada bool   // el correo ya se confirmó
}

// Repositorio es la persistencia que el servicio necesita (la implementa internal/pg).
type Repositorio interface {
	// CredencialPorCorreo busca la credencial de la cuenta con ese correo (normalizado), o ErrNoExiste.
	CredencialPorCorreo(ctx context.Context, correo string) (Credencial, error)
	// IniciarSesion guarda la sesión nueva y, **en la misma transacción**, `ingreso_anterior = ultimo_ingreso` y
	// `ultimo_ingreso = ahora` (D-134). Si `mejora` no es nil, en esa misma transacción reemplaza el hash de la
	// credencial (D-144: subir los parámetros viejos), pero solo si el hash guardado sigue siendo el verificado:
	// un cambio de contraseña en medio no se pisa.
	IniciarSesion(ctx context.Context, persona string, huella []byte, ahora time.Time, mejora *MejoraDeHash) error
	// CerrarSesion borra la fila de la sesión. Si no existe no hace nada.
	CerrarSesion(ctx context.Context, huella []byte) error
	// IngresoAnterior devuelve el inicio de sesión anterior al último, o nil si es el primer ingreso (RF-062).
	IngresoAnterior(ctx context.Context, persona string) (*time.Time, error)

	// CredencialDe lee el hash y el correo de la persona (PN-73).
	CredencialDe(ctx context.Context, persona string) (Credencial, error)
	// NuevoEnlaceDeRecuperacion invalida los enlaces de recuperación pendientes de la cuenta con ese correo y guarda
	// el nuevo (E13 §5.4). Devuelve false, sin guardar nada, si no hay cuenta o su correo no está verificado.
	NuevoEnlaceDeRecuperacion(ctx context.Context, correo string, huella []byte, ahora, vence time.Time) (bool, error)
	// CorreoDelEnlaceDeRecuperacion devuelve el correo de la cuenta de un enlace vigente y sin usar, sin consumirlo
	// (la política de contraseñas lo necesita), o cuenta.ErrEnlaceInvalido.
	CorreoDelEnlaceDeRecuperacion(ctx context.Context, huella []byte, ahora time.Time) (string, error)
	// FijarContrasenaConEnlace, en una transacción: consume el enlace (cuenta.ErrEnlaceInvalido si ya no sirve),
	// guarda el hash nuevo y borra **todas** las sesiones de la persona (RF-036).
	FijarContrasenaConEnlace(ctx context.Context, huella []byte, hash string, ahora time.Time) error
	// CambiarContrasena, en una transacción: guarda el hash nuevo y borra todas las sesiones de la persona **menos**
	// la de `conservar` (RF-065, D-090).
	CambiarContrasena(ctx context.Context, persona, hash string, conservar []byte) error
}

// MejoraDeHash es el reemplazo de un hash de parámetros viejos: el que se verificó y el que lo sustituye.
type MejoraDeHash struct{ Viejo, Nuevo string }

// Hasheador calcula y comprueba contraseñas (internal/argon2id).
type Hasheador interface {
	Hashear(ctx context.Context, contrasena string) (string, error)
	Verificar(ctx context.Context, contrasena, hash string) (bool, error)
	// NecesitaMejora indica si el hash guardado tiene parámetros menores que los vigentes (E12, ADR-002 §5.1).
	NecesitaMejora(hash string) (bool, error)
}

// Dependencias son los puertos del servicio.
type Dependencias struct {
	Repo      Repositorio
	Hasher    Hasheador
	Limitador *seguridad.LimitadorDeIntentos
	Reloj     reloj.Reloj
	Correo    correo.Correo
	Politica  *seguridad.PoliticaDeContrasena
	Log       *slog.Logger
}

// Servicio son los casos de uso de entrar y salir.
type Servicio struct {
	d      Dependencias
	envios sync.WaitGroup
	// hashDeRelleno es un hash válido de una contraseña que nadie conoce: contra él se verifica cuando la cuenta no
	// existe, para hacer el mismo trabajo y no delatarlo por el tiempo.
	hashDeRelleno string
}

// NuevoServicio arma el servicio y calcula el hash de relleno, con los mismos parámetros del Hasheador.
func NuevoServicio(d Dependencias) (*Servicio, error) {
	if d.Log == nil {
		d.Log = slog.New(slog.DiscardHandler)
	}
	azar := make([]byte, 16)
	_, _ = rand.Read(azar)
	hash, err := d.Hasher.Hashear(context.Background(), hex.EncodeToString(azar))
	if err != nil {
		return nil, fmt.Errorf("calcular el hash de relleno: %w", err)
	}
	return &Servicio{d: d, hashDeRelleno: hash}, nil
}

// SesionIniciada es la sesión nueva: el token, que el cliente guarda (cookie en la web, Bearer en Android), y si la
// cuenta ya confirmó el correo. Si no, la sesión es la limitada de D-138 y el cliente sigue a PN-59.
type SesionIniciada struct {
	Token      string
	Verificada bool
}

// IniciarSesion entra con un identificador y una contraseña (CU-52, PN-60). Hoy el identificador solo puede ser un
// correo; el nombre de usuario de los menores llega en I11 sin cambiar el contrato (D-137). Uno que no sea un correo
// se trata como una cuenta que no existe.
//
//  1. Sin identificador o sin contraseña: *cuenta.ErrValidacion, sin contar ni calcular nada.
//  2. Con 5 fallos del identificador o 20 del origen en 15 minutos: ErrDemasiadosIntentos, aunque la contraseña sea
//     la correcta y exista o no la cuenta (D-136). Quien llama registra el intento frenado.
//  3. Argon2id corre **siempre una vez**: contra el hash de la cuenta o, si no existe (o el identificador no es un
//     correo), contra el de relleno. Los dos fallos son ErrCredencialesInvalidas y cuentan en los límites.
//  4. Con la contraseña correcta, sesión nueva con token nuevo (nunca se reutiliza uno) y, en la misma transacción,
//     el ingreso anterior (D-134).
//  5. Si el hash guardado tiene parámetros menores que los vigentes, se calcula uno nuevo con la contraseña (fuera de
//     la transacción, con el cupo de Argon2id) y se guarda en esa misma transacción (D-144, E12 `NecesitaMejora`).
//     Si no se puede calcular, la sesión se inicia igual y queda el hash viejo.
func (s *Servicio) IniciarSesion(ctx context.Context, identificador, contrasena, origen string) (SesionIniciada, error) {
	identificador = strings.TrimSpace(identificador)
	campos := map[string]string{}
	if identificador == "" {
		campos[campoIdentificador] = IdentificadorVacio
	}
	if contrasena == "" {
		campos[campoContrasena] = cuenta.ContrasenaVacia
	}
	if len(campos) > 0 {
		return SesionIniciada{}, &cuenta.ErrValidacion{Campos: campos}
	}
	if !s.d.Limitador.PermitirIngreso(identificador, origen) {
		return SesionIniciada{}, ErrDemasiadosIntentos
	}

	hash, cred := s.hashDeRelleno, Credencial{}
	if correo, esCorreo := cuenta.NormalizarCorreo(identificador); esCorreo {
		c, err := s.d.Repo.CredencialPorCorreo(ctx, correo)
		switch {
		case err == nil:
			hash, cred = c.Hash, c
		case !errors.Is(err, ErrNoExiste):
			return SesionIniciada{}, err
		}
	}
	coincide, err := s.d.Hasher.Verificar(ctx, contrasena, hash)
	if err != nil {
		return SesionIniciada{}, err
	}
	if !coincide || cred.Persona == "" {
		s.d.Limitador.RegistrarFalloDeIngreso(identificador, origen)
		return SesionIniciada{}, ErrCredencialesInvalidas
	}

	mejora := s.hashMejorado(ctx, contrasena, cred)
	token, huella := seguridad.NuevoTokenOpaco()
	if err := s.d.Repo.IniciarSesion(ctx, cred.Persona, huella, s.d.Reloj.Ahora(), mejora); err != nil {
		return SesionIniciada{}, err
	}
	return SesionIniciada{Token: token, Verificada: cred.Verificada}, nil
}

// hashMejorado devuelve el reemplazo del hash si el guardado quedó con parámetros viejos, o nil si no hace
// falta o no se pudo calcular: subir el hash nunca impide entrar. El registro no lleva la contraseña ni el hash.
func (s *Servicio) hashMejorado(ctx context.Context, contrasena string, cred Credencial) *MejoraDeHash {
	viejo, err := s.d.Hasher.NecesitaMejora(cred.Hash)
	if err != nil || !viejo {
		return nil
	}
	nuevo, err := s.d.Hasher.Hashear(ctx, contrasena)
	if err != nil {
		s.d.Log.WarnContext(ctx, "no se pudo subir el hash de la contraseña; queda el anterior", "persona", cred.Persona, "error", err)
		return nil
	}
	return &MejoraDeHash{Viejo: cred.Hash, Nuevo: nuevo}
}

// CerrarSesion borra la sesión del token (CU-52). Con un token de mentira o ya borrado no hace nada y no falla:
// la respuesta es la misma (D-141).
func (s *Servicio) CerrarSesion(ctx context.Context, token string) error {
	huella, err := seguridad.HuellaDeToken(token)
	if err != nil {
		return nil
	}
	return s.d.Repo.CerrarSesion(ctx, huella)
}

// IngresoAnterior es el inicio de sesión anterior al último de la persona, o nil si es el primero (RF-062, CU-69).
// Nunca es el de la sesión actual.
func (s *Servicio) IngresoAnterior(ctx context.Context, persona string) (*time.Time, error) {
	return s.d.Repo.IngresoAnterior(ctx, persona)
}
