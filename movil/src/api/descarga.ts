import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { urlDelApi } from '../config';
import { borrarToken, leerToken } from '../sesion/token';
import { cabeceras, SIN_CONEXION, SIN_CONFIGURACION, type Respuesta } from './cliente';

/** El nombre neutro del ZIP que entrega el API (`Content-Disposition`). */
export const NOMBRE_DEL_ZIP = 'alcanzamos-mis-datos.zip';

export type ResultadoDeDescarga = { ok: true } | Extract<Respuesta<never>, { ok: false }>;

const fallo = (estado: number, codigo: string): ResultadoDeDescarga => ({
  ok: false,
  estado,
  codigo,
  campos: {},
});

async function leerJson(respuesta: Response): Promise<unknown> {
  try {
    return JSON.parse(await respuesta.text());
  } catch {
    return {};
  }
}

/**
 * «Descargar mis datos» de PN-69 (RF-032, D-102, D-180): pide el ZIP al API con el Bearer y la cabecera de Android, lo
 * escribe en la carpeta de caché de la app, abre la hoja de compartir de Android y **borra el archivo siempre** (al
 * compartir, al cancelar y ante cualquier error): dentro de la app no queda ninguna copia. Un fallo trae el estado y el
 * código del API; los de escritura o de la hoja son `archivo_no_preparado`.
 */
export async function descargarMisDatos(): Promise<ResultadoDeDescarga> {
  const base = urlDelApi();
  if (!base) return fallo(0, SIN_CONFIGURACION);
  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}/api/v1/cuenta/datos`, {
      method: 'GET',
      headers: {
        ...cabeceras(await leerToken(), false),
        Accept: 'application/zip',
      },
    });
  } catch {
    return fallo(0, SIN_CONEXION);
  }
  if (!respuesta.ok) {
    const cuerpo = await leerJson(respuesta);
    const codigo = typeof cuerpo === 'object' && cuerpo !== null ? (cuerpo as { error?: unknown }).error : undefined;
    // Como en `pedir` (cliente.ts): un `401 sin_sesion` es que el token ya no sirve.
    if (respuesta.status === 401 && codigo === 'sin_sesion') await borrarToken();
    return fallo(respuesta.status, typeof codigo === 'string' ? codigo : 'desconocido');
  }
  const archivo = new File(Paths.cache, NOMBRE_DEL_ZIP);
  try {
    archivo.write(new Uint8Array(await respuesta.arrayBuffer()));
    await Sharing.shareAsync(archivo.uri, {
      mimeType: 'application/zip',
      UTI: 'public.zip-archive',
      dialogTitle: NOMBRE_DEL_ZIP,
    });
    return { ok: true };
  } catch {
    return fallo(respuesta.status, 'archivo_no_preparado');
  } finally {
    // Pase lo que pase, sin copia dentro de la app. Si ni siquiera se pudo crear, no hay nada que borrar.
    try {
      if (archivo.exists) archivo.delete();
    } catch {
      /* ya no está */
    }
  }
}
