export interface Aviso {
  id: string;
  paquete: string;
  severidad: string;
  titulo?: string;
  caminos: string[];
}
export interface Excepcion {
  ghsa: string;
  paquete: string;
  rutas: string[];
  motivo: string;
  revisado: string;
  revisar_antes_de: string;
}
export interface Vulnerabilidad {
  isDirect?: boolean;
  effects?: string[];
  via?: Array<string | { source?: number; severity?: string; title?: string; url?: string }>;
}
export interface Informe {
  vulnerabilities?: Record<string, Vulnerabilidad>;
}
export const hoyUtc: () => string;
export function idDelAviso(url?: string): string | undefined;
export function caminosHasta(
  paquete: string,
  vulnerabilidades: Record<string, Vulnerabilidad>,
): string[];
export function avisosGraves(informe: Informe): Aviso[];
export function validarExcepciones(excepciones: unknown): string[];
export function revisar(
  informe: Informe,
  excepciones: unknown,
  hoy?: string,
): {
  fallas: string[];
  aceptados: Array<Aviso & { motivo: string; revisado: string; revisarAntesDe: string }>;
};
