import { useEffect } from 'react';
import { anunciar } from '../anuncios';
import type { DatosDeAviso } from '../textos';
import { Aviso, textoHablado } from './Aviso';

// Mensaje de estado de la pantalla a la que se llega (E14-PCP 4.16 T11): un Aviso arriba de todo, que TalkBack anuncia
// solo, sin mover el foco, por la región viva de la pantalla. El anuncio sale pasada la espera de `anuncios.ts`, después
// de lo que TalkBack dice al llegar a la pantalla (ACC-004, bug 225; antes la región viva estaba en una vista que React
// Native aplanaba en Android y no se oía). Cada
// llegada trae su aviso: se anuncia aunque diga lo mismo que el anterior (dos gastos iguales seguidos), y no se repite
// mientras la pantalla siga con el mismo.
export function MensajeDeEstado({ aviso }: { aviso: DatosDeAviso }) {
  useEffect(() => anunciar(textoHablado(aviso)), [aviso]);
  return <Aviso {...aviso} viva={false} />;
}
