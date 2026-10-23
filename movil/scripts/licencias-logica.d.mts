export interface Paquete {
  ruta?: string;
  nombre: string;
  version?: string;
  licencia?: string;
}
export const PERMITIDAS: Set<string>;
export function esPermitida(
  expresion: unknown,
  permitidas?: Set<string>,
): boolean;
export function paquetesDeProduccion(
  lock: {
    packages?: Record<
      string,
      { name?: string; version?: string; license?: string; dev?: boolean }
    >;
  },
  leerRespaldo?: (ruta: string) => string | undefined,
): Paquete[];
export function revisar(
  paquetes: Paquete[],
  permitidas?: Set<string>,
): { conteo: Map<string, number>; infractores: Paquete[] };
export interface PaqueteConRuta extends Paquete {
  ruta: string;
}
export interface ExcepcionDeLicencia {
  paquete: string;
  licencia: string;
  rutas: string[];
  motivo: string;
  revisar_antes_de: string;
}
export const hoyUtc: () => string;
export function caminosDeProduccion(
  lock: { packages?: Record<string, object> },
  ruta: string,
): string[];
export function validarExcepciones(excepciones: unknown): string[];
export function revisarConExcepciones(
  lock: { packages?: Record<string, object> },
  leerRespaldo: ((ruta: string) => string | undefined) | undefined,
  excepciones: unknown,
  hoy?: string,
  permitidas?: Set<string>,
): {
  conteo: Map<string, number>;
  fallas: string[];
  aceptados: Array<PaqueteConRuta & { motivo: string; revisarAntesDe: string }>;
};
