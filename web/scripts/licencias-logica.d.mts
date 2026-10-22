export interface Paquete {
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
