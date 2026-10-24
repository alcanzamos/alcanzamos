import { Pantalla } from '../componentes/Pantalla';

// PN-60 · Iniciar sesión: pantalla provisional de la base (A1). Solo el logo y el título de E14-PCP 4.3; PN-60 de
// verdad llega en la rama de sesión (A4). No hace ningún pedido.
export function Entrar() {
  return <Pantalla conLogo titulo="Inicia sesión" />;
}
