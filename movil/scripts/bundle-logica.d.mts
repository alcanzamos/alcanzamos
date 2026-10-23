export const MARCAS_POR_PAQUETE: Record<string, string[]>;
export const MARCAS_DE_NODE_FORGE: string[];
export function buscarMarcas(contenido: Uint8Array | string, marcas?: string[]): string[];
export function revisarArchivos(
  archivos: Array<{ nombre: string; contenido: Uint8Array | string }>,
  paquetes?: Record<string, string[]>,
): { fallas: string[]; revisados: number };
