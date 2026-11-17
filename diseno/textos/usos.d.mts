export function archivosDe(carpeta: string): string[];
/** Los grupos de textos ya aprobados cuya pantalla todavía no se construye: no cuentan como «sin uso». */
export const RESERVADOS: string[][];
export function comparar(
  hojas: string[][],
  usos: string[][],
): { noExisten: string[]; sinUso: string[] };
// `ts` es el módulo `typescript` de la app que prueba (el generador no lo importa).
export function analizar(
  ts: unknown,
  nombre: string,
  codigo: string,
  hojas: string[][],
): { usos: string[][]; problemas: string[] };
