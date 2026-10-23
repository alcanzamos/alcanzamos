package seguridad

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/reloj"
)

// Cifras del LimitadorDeIntentos. Son del dueño (D-136, D-140) y E12 las repite: cambiar una cambia también E12, E14 y E18.
const (
	// Inicio de sesión (D-136): fallos en una ventana de 15 minutos.
	FallosPorCuenta  = 5
	FallosPorOrigen  = 20
	VentanaDeIngreso = 15 * time.Minute

	// Pedidos de recuperación del acceso y reenvíos de verificación (D-136, D-138): por hora.
	EnlacesPorCuenta = 3
	EnlacesPorOrigen = 20

	// Crear una cuenta (D-140): todos los intentos de un origen, no solo las cuentas creadas.
	CreacionesPorOrigen = 20

	// EsperaCortaDeReenvio es la espera corta de PN-59 entre un reenvío y el siguiente de la misma cuenta («Puedes pedir
	// otro en un momento.»). Son 30 segundos: D-143 (5) los documenta en E14-PCP 4.2 (v1.12, nota del 2026-10-22).
	EsperaCortaDeReenvio = 30 * time.Second

	// Correos a una misma dirección de destino (D-140), sumando verificación, reenvíos y el aviso de D-141.
	CorreosPorDestino = 3

	VentanaPorHora = time.Hour
)

// intervaloDeBarrido es cada cuánto se recorre todo el mapa borrando lo vencido, además de limpiar la clave que se toca.
const intervaloDeBarrido = time.Minute

// LimitadorDeIntentos frena los intentos repetidos (E12 `LimitadorDeIntentos`, RNF-014). Es una espera y no un
// bloqueo: cada intento cuenta durante su ventana y deja de contar al vencer, sin ninguna marca permanente.
//
// Los contadores viven solo en la memoria del API (D-123): se reinician con él y no se comparten entre réplicas.
// La hora sale del Reloj inyectado, así que las pruebas lo adelantan sin esperar. La memoria está acotada: cada
// clave guarda a lo sumo `límite` instantes y lo vencido se borra al tocar la clave y en un barrido cada minuto.
// Las claves de cuentas y direcciones se guardan como SHA-256 para que la memoria no tenga correos (NM-03).
// Es seguro desde varias goroutines.
//
// El origen es un texto que decide quien llama. Hoy es la dirección de la conexión (en local, la del cliente). Detrás
// de Azure Container Apps todos los pedidos llegan con la dirección de su entrada, y el límite por origen sería uno
// solo para todos: antes de desplegar hay que confiar únicamente en la dirección que agrega esa entrada (fila 17 del
// primer despliegue, D-143 (4)). No se lee `X-Forwarded-For` mientras tanto: un cliente podría escribirla.
type LimitadorDeIntentos struct {
	reloj reloj.Reloj

	mu            sync.Mutex
	intentos      map[string][]time.Time
	ultimoBarrido time.Time
}

// NuevoLimitadorDeIntentos crea un limitador vacío que lee la hora de r.
func NuevoLimitadorDeIntentos(r reloj.Reloj) *LimitadorDeIntentos {
	return &LimitadorDeIntentos{reloj: r, intentos: map[string][]time.Time{}}
}

// PermitirIngreso dice si se puede intentar iniciar sesión: no hay ya 5 fallos de la cuenta ni 20 del origen en
// los últimos 15 minutos. No cuenta nada: lo que cuenta es cada fallo (RegistrarFalloDeIngreso). Mientras dura la
// espera responde que no aunque la contraseña sea la correcta (D-136). identificador es el correo o, más adelante,
// el nombre de usuario (D-137 (3)).
func (l *LimitadorDeIntentos) PermitirIngreso(identificador, origen string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	ahora := l.reloj.Ahora()
	l.barrer(ahora)
	return l.libre(ahora, claveDeCuenta("ingreso", identificador), FallosPorCuenta, VentanaDeIngreso) &&
		l.libre(ahora, claveDeOrigen("ingreso", origen), FallosPorOrigen, VentanaDeIngreso)
}

// RegistrarFalloDeIngreso cuenta un fallo (contraseña o identificador incorrectos), exista o no la cuenta.
func (l *LimitadorDeIntentos) RegistrarFalloDeIngreso(identificador, origen string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	ahora := l.reloj.Ahora()
	l.barrer(ahora)
	l.anotar(ahora, claveDeCuenta("ingreso", identificador), FallosPorCuenta, VentanaDeIngreso)
	l.anotar(ahora, claveDeOrigen("ingreso", origen), FallosPorOrigen, VentanaDeIngreso)
}

// PermitirRecuperacion cuenta un pedido del enlace de recuperación y dice si pasa: 3 por hora por cuenta y 20 por
// origen (D-136 (4)). Un pedido frenado no cuenta, así la espera termina una hora después del primero.
func (l *LimitadorDeIntentos) PermitirRecuperacion(identificador, origen string) bool {
	return l.permitirDos("recuperacion", identificador, origen)
}

// PermitirReenvio cuenta un reenvío del correo de verificación o un cambio de correo, y dice si pasa: la espera corta
// de PN-59 desde el último de la cuenta, 3 por hora por cuenta y 20 por origen, las cifras de la recuperación (D-138 (2))
// pero con su propio contador. Solo cuenta si pasan las tres. «cuenta» es la persona o, para la sesión de mentira de
// D-141, su token: los dos se limitan igual, así el 429 no los distingue.
func (l *LimitadorDeIntentos) PermitirReenvio(cuenta, origen string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	ahora := l.reloj.Ahora()
	l.barrer(ahora)
	espera, kc, ko := claveDeCuenta("reenvio-espera", cuenta), claveDeCuenta("reenvio", cuenta), claveDeOrigen("reenvio", origen)
	if !l.libre(ahora, espera, 1, EsperaCortaDeReenvio) || !l.libre(ahora, kc, EnlacesPorCuenta, VentanaPorHora) ||
		!l.libre(ahora, ko, EnlacesPorOrigen, VentanaPorHora) {
		return false
	}
	l.anotar(ahora, espera, 1, EsperaCortaDeReenvio)
	l.anotar(ahora, kc, EnlacesPorCuenta, VentanaPorHora)
	l.anotar(ahora, ko, EnlacesPorOrigen, VentanaPorHora)
	return true
}

// PermitirCreacion cuenta un intento de crear una cuenta y dice si pasa: 20 por hora por origen (D-140 (1)).
// Cuentan todos los intentos: correos nuevos, correos ya registrados y contraseñas rechazadas.
func (l *LimitadorDeIntentos) PermitirCreacion(origen string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	ahora := l.reloj.Ahora()
	l.barrer(ahora)
	return l.intentar(ahora, claveDeOrigen("creacion", origen), CreacionesPorOrigen, VentanaPorHora)
}

// PermitirCorreo cuenta un correo a la dirección de destino y dice si se puede enviar: 3 por hora a una misma
// dirección, desde cualquier origen (D-140 (2)). Quien llama responde igual al cliente haya enviado o no.
func (l *LimitadorDeIntentos) PermitirCorreo(destino string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	ahora := l.reloj.Ahora()
	l.barrer(ahora)
	return l.intentar(ahora, claveDeCuenta("correo", destino), CorreosPorDestino, VentanaPorHora)
}

// permitirDos aplica un límite por cuenta y otro por origen, y solo cuenta si pasan los dos. Es el de la recuperación.
func (l *LimitadorDeIntentos) permitirDos(familia, cuenta, origen string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	ahora := l.reloj.Ahora()
	l.barrer(ahora)
	kc, ko := claveDeCuenta(familia, cuenta), claveDeOrigen(familia, origen)
	if !l.libre(ahora, kc, EnlacesPorCuenta, VentanaPorHora) || !l.libre(ahora, ko, EnlacesPorOrigen, VentanaPorHora) {
		return false
	}
	l.anotar(ahora, kc, EnlacesPorCuenta, VentanaPorHora)
	l.anotar(ahora, ko, EnlacesPorOrigen, VentanaPorHora)
	return true
}

// Claves: la familia separa los contadores y el valor va como SHA-256. Los correos se comparan en minúsculas.
func claveDeCuenta(familia, valor string) string {
	return familia + "|c|" + huellaDeClave(strings.ToLower(strings.TrimSpace(valor)))
}

func claveDeOrigen(familia, valor string) string { return familia + "|o|" + huellaDeClave(valor) }

func huellaDeClave(valor string) string {
	h := sha256.Sum256([]byte(valor))
	return hex.EncodeToString(h[:16])
}

// vigentes devuelve los instantes de la clave que todavía cuentan (ocurrieron hace menos de `ventana`) y deja el
// mapa sin lo vencido. Un intento cuenta durante exactamente `ventana`: al cumplirla ya no.
func (l *LimitadorDeIntentos) vigentes(ahora time.Time, clave string, ventana time.Duration) []time.Time {
	todos := l.intentos[clave]
	i := 0
	for i < len(todos) && !todos[i].After(ahora.Add(-ventana)) {
		i++
	}
	if i == len(todos) {
		delete(l.intentos, clave)
		return nil
	}
	if i > 0 {
		todos = append([]time.Time(nil), todos[i:]...)
		l.intentos[clave] = todos
	}
	return todos
}

func (l *LimitadorDeIntentos) libre(ahora time.Time, clave string, limite int, ventana time.Duration) bool {
	return len(l.vigentes(ahora, clave, ventana)) < limite
}

func (l *LimitadorDeIntentos) anotar(ahora time.Time, clave string, limite int, ventana time.Duration) {
	// Nunca guarda más de `limite` instantes: lo que pase de ahí ya estaría frenado.
	if v := l.vigentes(ahora, clave, ventana); len(v) < limite {
		l.intentos[clave] = append(v, ahora)
	}
}

func (l *LimitadorDeIntentos) intentar(ahora time.Time, clave string, limite int, ventana time.Duration) bool {
	if !l.libre(ahora, clave, limite, ventana) {
		return false
	}
	l.anotar(ahora, clave, limite, ventana)
	return true
}

// barrer borra, como mucho una vez por minuto, todas las claves cuyos instantes ya vencieron. La ventana más larga
// es la de una hora: lo anterior nunca vuelve a contar.
func (l *LimitadorDeIntentos) barrer(ahora time.Time) {
	if ahora.Sub(l.ultimoBarrido) < intervaloDeBarrido {
		return
	}
	l.ultimoBarrido = ahora
	corte := ahora.Add(-VentanaPorHora)
	for clave, v := range l.intentos {
		if len(v) == 0 || !v[len(v)-1].After(corte) {
			delete(l.intentos, clave)
		}
	}
}
