package autenticacion

import (
	"context"
	"sync"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// Valores por omisión de la cola de recuperación (D-144): pocos trabajadores, porque cada trabajo es una transacción
// corta y un correo, y una cola acotada, porque los pedidos ya pasaron los límites de D-136 (4).
const (
	TrabajadoresDeRecuperacion  = 2
	LargoDeLaColaDeRecuperacion = 100
)

// trabajoDeRecuperacion es lo único que el pedido le deja al trabajador: el correo ya normalizado.
type trabajoDeRecuperacion struct{ destino string }

// colaDeRecuperacion es el trabajo de PN-61 que se hace **fuera del pedido** (D-144). El pedido solo valida, cuenta los
// límites y encola, así que tarda lo mismo y responde lo mismo exista o no la cuenta, esté verificada o no: la consulta
// de la cuenta, el enlace y el correo ocurren acá, donde el cliente no los ve.
type colaDeRecuperacion struct {
	trabajos   chan trabajoDeRecuperacion
	pendientes sync.WaitGroup // un trabajo cuenta desde que se encola hasta que se procesa o se descarta

	mu      sync.Mutex
	cerrada bool // el contexto terminó: ya no se encola
}

func nuevaColaDeRecuperacion(largo int) *colaDeRecuperacion {
	return &colaDeRecuperacion{trabajos: make(chan trabajoDeRecuperacion, largo)}
}

// encolar devuelve false, sin esperar, si la cola está llena o ya cerró. Quien llama responde igual de todos modos.
func (c *colaDeRecuperacion) encolar(t trabajoDeRecuperacion) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cerrada {
		return false
	}
	c.pendientes.Add(1)
	select {
	case c.trabajos <- t:
		return true
	default:
		c.pendientes.Done()
		return false
	}
}

// cerrar impide encolar y descarta lo que no se alcanzó a procesar. Devuelve cuántos trabajos descartó.
func (c *colaDeRecuperacion) cerrar() int {
	c.mu.Lock()
	c.cerrada = true
	c.mu.Unlock()
	descartados := 0
	for {
		select {
		case <-c.trabajos:
			c.pendientes.Done()
			descartados++
		default:
			return descartados
		}
	}
}

// Iniciar arranca los trabajadores de la recuperación (E12 `AutenticacionServicio`, D-144). Paran cuando `ctx`
// termina: el trabajo en curso se completa y lo que sigue en la cola se descarta, registrando cuántos. Sin Iniciar,
// los pedidos se encolan y no pasa nada más (las pruebas lo usan para ver qué hace el pedido por sí solo).
// Se llama una vez, antes de servir.
func (s *Servicio) Iniciar(ctx context.Context) {
	for range s.trabajadores {
		go func() {
			for {
				select {
				case <-ctx.Done():
					if n := s.recuperaciones.cerrar(); n > 0 {
						s.d.Log.WarnContext(ctx, "recuperación: trabajos descartados al apagar", "cantidad", n)
					}
					return
				case t := <-s.recuperaciones.trabajos:
					s.procesarRecuperacion(ctx, t)
					s.recuperaciones.pendientes.Done()
				}
			}
		}()
	}
}

// Esperar bloquea hasta que todos los trabajos encolados se hayan procesado o descartado. Lo usan las pruebas y el
// apagado ordenado, después de cancelar el contexto de Iniciar. Sin trabajadores y con trabajos en la cola no vuelve.
func (s *Servicio) Esperar() { s.recuperaciones.pendientes.Wait() }

// procesarRecuperacion hace lo que antes hacía el pedido: si la cuenta existe y su correo está verificado, invalida
// los enlaces pendientes y guarda uno nuevo (1 hora); si la dirección no pasó los 3 correos por hora (D-140), no manda
// nada. Con cuenta sin verificar o sin cuenta no hace nada. Un correo perdido (cola llena, fallo del envío, apagado) se
// recupera pidiéndolo otra vez. El registro nunca lleva la dirección ni el token.
func (s *Servicio) procesarRecuperacion(ctx context.Context, t trabajoDeRecuperacion) {
	// El trabajo en curso termina aunque el servidor se esté apagando.
	ctx, cancelar := context.WithTimeout(context.WithoutCancel(ctx), plazoDelEnvio)
	defer cancelar()
	token, huella := seguridad.NuevoTokenOpaco()
	ahora := s.d.Reloj.Ahora()
	hay, err := s.d.Repo.NuevoEnlaceDeRecuperacion(ctx, t.destino, huella, ahora, ahora.Add(VigenciaDelEnlaceDeRecuperacion))
	if err != nil {
		s.d.Log.ErrorContext(ctx, "recuperación: no se pudo guardar el enlace", "error", err)
		return
	}
	if !hay {
		return
	}
	if !s.d.Limitador.PermitirCorreo(t.destino) {
		s.d.Log.InfoContext(ctx, "correo no enviado: límite por dirección", "correo", "recuperación")
		return
	}
	if err := s.d.Correo.EnviarRecuperacion(ctx, t.destino, token); err != nil {
		s.d.Log.ErrorContext(ctx, "no se pudo enviar el correo", "correo", "recuperación", "error", err)
	}
}
