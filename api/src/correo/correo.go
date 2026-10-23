// Package correo es el puerto de correo (E12 `Correo`) y su adaptador SMTP de la biblioteca estándar (el falso de las
// pruebas está en test/correo/correotest). El puerto es estrecho a propósito: solo tiene los envíos permitidos (NM-04).
package correo

import "context"

// Correo son los envíos permitidos. El adaptador pone el texto: quien llama solo entrega el destino y el token.
// El token viaja dentro del enlace del mensaje; nunca se registra.
type Correo interface {
	// EnviarVerificacion manda el enlace para confirmar el correo (CU-43).
	EnviarVerificacion(ctx context.Context, destino, token string) error
	// EnviarRecuperacion manda el enlace para elegir una contraseña nueva (CU-44, PN-61). Sirve 1 hora.
	EnviarRecuperacion(ctx context.Context, destino, token string) error
	// EnviarAvisoDeCorreoRegistrado avisa al dueño de un correo con cuenta verificada que alguien intentó crear una
	// cuenta con él (D-141). No lleva enlace ni contraseña.
	EnviarAvisoDeCorreoRegistrado(ctx context.Context, destino string) error
}
