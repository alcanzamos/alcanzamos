import type { NavigationProp } from '@react-navigation/native';
import { useState } from 'react';
import { descargarMisDatos } from './api/descarga';
import { seguirPorAccesoNegado } from './navegacion/accesoNegado';
import type { Rutas } from './navegacion/rutas';
import { avisoDeFallo, avisos, type DatosDeAviso } from './textos';

export type EstadoDeDescarga = { fase: 'libre' } | { fase: 'preparando' } | { fase: 'aviso'; aviso: DatosDeAviso };

/**
 * «Descargar mis datos» (RF-032, D-102, D-180), el mismo botón y los mismos estados en PN-69 y en la hoja de «No
 * autorizo» (E14-PME): opcional, no retrasa el borrado ni lo condiciona, y no abre otra pantalla. El archivo se comparte
 * desde la hoja de Android y no queda copia dentro de la app (`api/descarga.ts`); un fallo trae su aviso y un 401 lleva a
 * PN-60.
 */
export function useDescargaDeDatos(navegacion: NavigationProp<Rutas>) {
  const [descarga, setDescarga] = useState<EstadoDeDescarga>({ fase: 'libre' });

  async function descargar() {
    if (descarga.fase === 'preparando') return;
    setDescarga({ fase: 'preparando' });
    const respuesta = await descargarMisDatos();
    if (respuesta.ok) return setDescarga({ fase: 'aviso', aviso: avisos.descargaLista });
    if (seguirPorAccesoNegado(navegacion, respuesta)) return;
    setDescarga({ fase: 'aviso', aviso: avisoDeFallo(respuesta, avisos.errorAlDescargar) });
  }

  return { descarga, descargar };
}
