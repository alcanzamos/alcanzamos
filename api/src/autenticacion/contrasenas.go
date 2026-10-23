package autenticacion

import (
	"context"
	"errors"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// VigenciaDelEnlaceDeRecuperacion: el enlace de recuperación vence a la hora (E13 §5.4).
const VigenciaDelEnlaceDeRecuperacion = time.Hour

// Campos de error de la contraseña nueva de PN-73 y de la actual.
const (
	campoContrasenaActual = "contrasena_actual"
	campoContrasenaNueva  = "contrasena_nueva"
	plazoDelEnvio         = 30 * time.Second
)

// PedirRecuperacion atiende PN-61: pide el enlace para elegir una contraseña nueva. **Hace siempre lo mismo y responde
// siempre igual** (nil), tenga cuenta el correo o no, esté verificada o no, para no revelarlo (CU-44 2a, D-144):
// valida el correo, cuenta el pedido contra los límites de D-136 (4) por correo normalizado y por origen, encola el
// trabajo y vuelve. No consulta la base ni manda nada: eso lo hace un trabajador fuera del pedido
// (`procesarRecuperacion`), así que el tiempo de respuesta no delata si la cuenta existe. Si la cola está llena, el
// trabajo se descarta (se registra sin el correo) y la respuesta es la misma: quien no recibe el correo lo pide otra vez.
//
// Pasados 3 pedidos por hora por correo o 20 por origen, ErrDemasiadosIntentos, igual para todos. Un correo mal escrito
// da *cuenta.ErrValidacion, que no depende de la cuenta.
func (s *Servicio) PedirRecuperacion(ctx context.Context, correoCrudo, origen string) error {
	destino, codigo := cuenta.ValidarCorreo(correoCrudo)
	if codigo != "" {
		return &cuenta.ErrValidacion{Campos: map[string]string{"correo": codigo}}
	}
	if !s.d.Limitador.PermitirRecuperacion(destino, origen) {
		return ErrDemasiadosIntentos
	}
	if !s.recuperaciones.encolar(trabajoDeRecuperacion{destino: destino}) {
		s.d.Log.WarnContext(ctx, "recuperación descartada: cola llena o servidor apagándose")
	}
	return nil
}

// FijarContrasena atiende PN-62: con el token del enlace pone la contraseña nueva. Un enlace que no sirve (inexistente,
// mal formado, usado o vencido) es cuenta.ErrEnlaceInvalido, siempre el mismo, y se mira antes de calcular nada. La
// contraseña pasa por la política con el correo de la cuenta (`contrasena_personal`, D-142); si no cumple es
// *cuenta.ErrValidacion y **el enlace no se gasta**: la persona corrige y vuelve a intentar. Al guardar, en una sola
// transacción, se consume el enlace, se guarda el hash nuevo y se **borran todas las sesiones de la persona** (la
// contraseña vieja pudo estar comprometida, RF-036). No inicia sesión: el cliente va a PN-60.
func (s *Servicio) FijarContrasena(ctx context.Context, token, contrasena string) error {
	huella, err := seguridad.HuellaDeToken(token)
	if err != nil {
		return cuenta.ErrEnlaceInvalido
	}
	ahora := s.d.Reloj.Ahora()
	correoDeLaCuenta, err := s.d.Repo.CorreoDelEnlaceDeRecuperacion(ctx, huella, ahora)
	if err != nil {
		return err
	}
	if codigo := cuenta.CodigoDeContrasena(s.d.Politica.Validar(contrasena, correoDeLaCuenta, "")); codigo != "" {
		return &cuenta.ErrValidacion{Campos: map[string]string{campoContrasena: codigo}}
	}
	hash, err := s.d.Hasher.Hashear(ctx, contrasena)
	if err != nil {
		return err
	}
	return s.d.Repo.FijarContrasenaConEnlace(ctx, huella, hash, ahora)
}

// CambiarContrasena atiende PN-73 (RF-065, CU-70): con la sesión iniciada, cambia la contraseña escribiendo la de
// ahora y la nueva. `tokenActual` es el de la sesión de la petición, que se conserva.
//
//  1. Sin la contraseña de ahora: *cuenta.ErrValidacion (`contrasena_actual`: `contrasena_vacia`).
//  2. Con el límite de D-136 alcanzado (mismo contador que el inicio de sesión, por el correo de la cuenta y por
//     origen): ErrDemasiadosIntentos. Así este camino no da 5 intentos más para adivinar la contraseña.
//  3. Si la de ahora no es la de la cuenta: ErrContrasenaActualIncorrecta y cuenta como fallo del límite.
//  4. La nueva pasa por la política (`contrasena_nueva`, con el correo de la cuenta).
//  5. En una transacción: hash nuevo y se borran las **demás** sesiones, no la actual (D-090).
func (s *Servicio) CambiarContrasena(ctx context.Context, persona, tokenActual, actual, nueva, origen string) error {
	if actual == "" {
		return &cuenta.ErrValidacion{Campos: map[string]string{campoContrasenaActual: cuenta.ContrasenaVacia}}
	}
	cred, err := s.d.Repo.CredencialDe(ctx, persona)
	if err != nil {
		return err
	}
	// La cuenta se cuenta por su correo, como en el inicio de sesión; sin correo (un menor), por su persona.
	identificador := cred.Correo
	if identificador == "" {
		identificador = persona
	}
	if !s.d.Limitador.PermitirIngreso(identificador, origen) {
		return ErrDemasiadosIntentos
	}
	coincide, err := s.d.Hasher.Verificar(ctx, actual, cred.Hash)
	if err != nil {
		return err
	}
	if !coincide {
		s.d.Limitador.RegistrarFalloDeIngreso(identificador, origen)
		return ErrContrasenaActualIncorrecta
	}
	if codigo := cuenta.CodigoDeContrasena(s.d.Politica.Validar(nueva, cred.Correo, "")); codigo != "" {
		return &cuenta.ErrValidacion{Campos: map[string]string{campoContrasenaNueva: codigo}}
	}
	conservar, err := seguridad.HuellaDeToken(tokenActual)
	if err != nil {
		return errors.New("la sesión actual no tiene un token válido")
	}
	hash, err := s.d.Hasher.Hashear(ctx, nueva)
	if err != nil {
		return err
	}
	return s.d.Repo.CambiarContrasena(ctx, persona, hash, conservar)
}
