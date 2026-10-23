// PN-65 · la edad se calcula aquí, en el teléfono (E14-PCP 4.8, D-089): la fecha de nacimiento no se envía ni se guarda.
// Es la única regla de negocio que vive en el cliente: la decidió E14 por privacidad (excepción a ADR-005).
// El corte es de 18 años (D-089).
export const MAYORIA_DE_EDAD = 18;

export type ResultadoDeEdad = 'vacia' | 'futura' | 'menor' | 'mayor';

/**
 * Compara por día del calendario local, sin horas: quien cumple 18 hoy ya es mayor, y quien los cumple mañana, no.
 * Quien nació un 29 de febrero cumple en el 1 de marzo de los años que no son bisiestos.
 */
export function resultadoDeEdad(nacimiento: Date | undefined, hoy: Date): ResultadoDeEdad {
  if (!nacimiento || Number.isNaN(nacimiento.getTime())) return 'vacia';
  const de = (fecha: Date) => fecha.getFullYear() * 10000 + (fecha.getMonth() + 1) * 100 + fecha.getDate();
  if (de(nacimiento) > de(hoy)) return 'futura';
  const cumple18 = de(nacimiento) + MAYORIA_DE_EDAD * 10000;
  return de(hoy) >= cumple18 ? 'mayor' : 'menor';
}
