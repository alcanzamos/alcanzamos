package cuenta

import (
	"context"
	"errors"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/reloj"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// Errores del borrado de la cuenta (PN-69).
var (
	// ErrContrasenaIncorrecta: la contraseña escrita no es la de la cuenta. PN-69: «No pudimos confirmar tu contraseña.»
	ErrContrasenaIncorrecta = errors.New("la contraseña no coincide")
	// ErrFaltaConfirmarMenores: hay menores que dependen solo de la persona y no confirmó que sus cuentas también se
	// borran (RN-006). PN-69: «Falta confirmar lo de {nombre}.»
	ErrFaltaConfirmarMenores = errors.New("falta confirmar el borrado de las cuentas de los menores")
	// ErrMenoresCambiaron: los menores que dependen solo de la persona ya no son los que la pantalla mostró y confirmó
	// (otro tutor borró su cuenta, o se sumó uno). No se borra nada: la pantalla vuelve a leer el resumen (RN-006).
	ErrMenoresCambiaron = errors.New("los menores a cargo cambiaron desde que se mostraron")
	// ErrOcupada: tras varios intentos la base sigue ocupada con otra operación sobre la misma cuenta y esta sigue
	// existiendo; no se borró nada y se puede intentar de nuevo.
	ErrOcupada = errors.New("la cuenta está ocupada con otra operación")
	// ErrNoExiste lo devuelve el Repositorio cuando la persona ya no existe (otro pedido la borró antes).
	ErrNoExiste = errors.New("la cuenta no existe")
	// ErrCuentaDeMenor: una persona menor no borra su cuenta: lo pide por el canal de consultas y reclamos (E14-PME).
	ErrCuentaDeMenor = errors.New("una cuenta de menor no se borra desde aquí")
)

// Códigos de error de campo de PN-69.
const (
	ConfirmacionRequerida = "confirmacion_requerida"
	campoConfirmaMenores  = "confirma_menores"
)

// HogarAlBorrar es lo que PN-69 dice del hogar (fila 4). `Nombre` es nulo si el hogar no tiene nombre.
type HogarAlBorrar struct {
	Nombre           *string
	EsAdministradora bool
	// UnicaAdulta: el hogar se cierra y lo compartido también se borra (RN-006).
	UnicaAdulta bool
	// NuevoAdministrador es el nombre de la persona adulta con más antigüedad, a quien pasa el papel ahora mismo
	// (RN-007). Vacío si la persona no administra el hogar o si es la única adulta.
	NuevoAdministrador string
}

// ResumenDeBorrado es lo que cambia en PN-69 según el hogar y los menores: sin hogar no hay fila 4 y sin menores no
// hay filas 5 y 6.
type ResumenDeBorrado struct {
	Hogar *HogarAlBorrar
	// Menores son quienes dependen solo de esta persona y se borrarán con ella, por nombre alfabético. El `ID` es lo que
	// el cliente devuelve al borrar: confirma exactamente a quienes mostró (RN-006).
	Menores []MenorACargo
}

// MenorACargo es un menor que depende solo de la persona que borra su cuenta.
type MenorACargo struct{ ID, Nombre string }

// CredencialDeBorrado es lo que hace falta para confirmar con la contraseña.
type CredencialDeBorrado struct {
	Correo, Hash string
	// EsMenor: la cuenta es de un menor, que no borra su cuenta por aquí (E14-PME P-3).
	EsMenor bool
}

// RepositorioDeBorrado es la persistencia del borrado (la implementa src/pg).
type RepositorioDeBorrado interface {
	// CredencialDe lee el correo y el hash de la persona, o ErrNoExiste.
	CredencialDe(ctx context.Context, persona string) (CredencialDeBorrado, error)
	// Resumen lee lo que dice PN-69 del hogar y de los menores, o ErrNoExiste.
	Resumen(ctx context.Context, persona string) (ResumenDeBorrado, error)
	// BorrarCuenta borra la cuenta en una sola transacción (RN-006, RN-007): o queda todo borrado o no cambia nada.
	// `vistos` son los ids de los menores que la pantalla mostró: dentro de la transacción se vuelven a calcular los que
	// dependen solo de la persona y, si no son los mismos, ErrMenoresCambiaron sin cambiar nada. Con menores y
	// `confirmaMenores` en falso, ErrFaltaConfirmarMenores. Las autorizaciones quedan retiradas en `ahora` y se conservan hasta `conservarHasta`.
	BorrarCuenta(ctx context.Context, persona string, vistos []string, confirmaMenores bool, ahora, conservarHasta time.Time) error
}

// Verificador comprueba una contraseña contra su hash (src/argon2id).
type Verificador interface {
	Verificar(ctx context.Context, contrasena, hash string) (bool, error)
}

// Borrado son los casos de uso de PN-69 (E12 `CuentaServicio.BorrarCuenta`, CU-40).
type Borrado struct {
	repo      RepositorioDeBorrado
	hasher    Verificador
	limitador *seguridad.LimitadorDeIntentos
	reloj     reloj.Reloj
}

// NuevoBorrado crea el servicio.
func NuevoBorrado(repo RepositorioDeBorrado, hasher Verificador, limitador *seguridad.LimitadorDeIntentos, hora reloj.Reloj) *Borrado {
	return &Borrado{repo: repo, hasher: hasher, limitador: limitador, reloj: hora}
}

// Resumen devuelve lo que PN-69 muestra del hogar y de los menores.
func (b *Borrado) Resumen(ctx context.Context, persona string) (ResumenDeBorrado, error) {
	return b.repo.Resumen(ctx, persona)
}

// Borrar borra la cuenta de la persona (RF-032, RN-006, CU-40), en el orden de PN-69:
//
//  0. Una cuenta de menor es ErrCuentaDeMenor antes de mirar la contraseña: 400 y 403 no deben decir si acertó.
//  1. Sin la contraseña: *ErrValidacion (`contrasena`: `contrasena_vacia`).
//  2. Con el límite de D-136 alcanzado (el mismo contador del inicio de sesión, por el correo de la cuenta y por
//     origen; sin correo, por la persona): ErrDemasiadosIntentos. Así borrar no da intentos de más para adivinar la
//     contraseña con una sesión robada.
//  3. Si no es la de la cuenta: ErrContrasenaIncorrecta, que cuenta como fallo del límite.
//  4. El Repositorio borra en una transacción. Con menores que dependen solo de ella y sin `confirmaMenores`,
//     ErrFaltaConfirmarMenores y no cambia nada.
//
// Con la cuenta ya borrada es ErrNoExiste: la segunda llamada no borra nada ni inventa un éxito.
func (b *Borrado) Borrar(ctx context.Context, persona, contrasena string, vistos []string, confirmaMenores bool, origen string) error {
	if contrasena == "" {
		return &ErrValidacion{Campos: map[string]string{campoContrasena: ContrasenaVacia}}
	}
	cred, err := b.repo.CredencialDe(ctx, persona)
	if err != nil {
		return err
	}
	if cred.EsMenor {
		return ErrCuentaDeMenor
	}
	identificador := cred.Correo
	if identificador == "" {
		identificador = persona
	}
	if !b.limitador.PermitirIngreso(identificador, origen) {
		return ErrDemasiadosIntentos
	}
	coincide, err := b.hasher.Verificar(ctx, contrasena, cred.Hash)
	if err != nil {
		return err
	}
	if !coincide {
		b.limitador.RegistrarFalloDeIngreso(identificador, origen)
		return ErrContrasenaIncorrecta
	}
	ahora := b.reloj.Ahora()
	return b.repo.BorrarCuenta(ctx, persona, vistos, confirmaMenores, ahora, ahora.AddDate(AniosDeLaPruebaDeAutorizacion, 0, 0))
}
