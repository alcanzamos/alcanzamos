// PN-68 · Política de tratamiento (E14-PCP 4.11): lo que no es texto de la pantalla.

/**
 * La versión del texto de la política que lleva esta app. Es la `autorizacion.VersionActual` del API (RF-063): una
 * política nueva cambia las dos a la vez, y `tests/politica.test.ts` lee el archivo de Go y falla si no coinciden.
 */
export const VERSION_DE_LA_POLITICA = {
  numero: '1.1',
  fecha: '2026-11-12',
} as const;
