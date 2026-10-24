export interface PaqueteDelLock {
  nombre: string;
  version: string;
}
export interface ExcepcionDeAntiguedad {
  paquete: string;
  version: string;
  motivo: string;
  revisar_antes_de: string;
}
export type Fechas = Map<
  string,
  { time: Record<string, string> } | { error: string }
>;
export const REGISTRO: string;
export const DIA_MS: number;
export function diasDelNpmrc(texto: string): number | undefined;
export function paquetesDelLock(lock: unknown): {
  paquetes: PaqueteDelLock[];
  errores: string[];
};
export function urlDelPaquete(nombre: string): string;
export function obtenerFechas(
  nombres: string[],
  buscar: (nombre: string) => Promise<unknown>,
  concurrencia?: number,
): Promise<Fechas>;
export function validarExcepciones(excepciones: unknown): string[];
export function revisar(entrada: {
  paquetes: PaqueteDelLock[];
  fechas: Fechas;
  excepciones: unknown;
  dias: number;
  ahora: number;
}): {
  fallas: string[];
  aceptados: Array<
    PaqueteDelLock & { fecha: string; motivo: string; revisarAntesDe: string }
  >;
  sobrantes: Array<PaqueteDelLock & { fecha: string }>;
  masJoven: (PaqueteDelLock & { publicado: number }) | undefined;
};
