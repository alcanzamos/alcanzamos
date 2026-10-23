import AsyncStorage from '@react-native-async-storage/async-storage';

// Lo único que el teléfono recuerda de PN-65 (E14-PCP 4.8, D-089): que el resultado fue «menos de 18» y hasta qué hora
// dura el recuerdo (24 horas). Nunca la fecha de nacimiento ni la edad. No es un secreto, así que va en AsyncStorage;
// el token de la sesión no (vive solo en el Keystore, `sesion/token.ts`). Un resultado de persona adulta no se
// recuerda: E14 solo define el estado «Resultado recordado» para menores.
const CLAVE = 'edad.resultado';
export const DURACION_DEL_RECUERDO_MS = 24 * 60 * 60 * 1000;

export async function recordarMenor(ahora = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE, JSON.stringify({ resultado: 'menor', hasta: ahora + DURACION_DEL_RECUERDO_MS }));
  } catch {
    // Sin almacenamiento: la pantalla igual muestra el mensaje; solo se pierde el recuerdo de las 24 horas.
  }
}

/** Verdadero si dentro de las últimas 24 horas el resultado fue «menos de 18». Pasado ese tiempo lo olvida. */
export async function hayMenorRecordado(ahora = Date.now()): Promise<boolean> {
  try {
    const guardado = await AsyncStorage.getItem(CLAVE);
    if (guardado === null) return false;
    const recuerdo: unknown = JSON.parse(guardado);
    const vigente =
      typeof recuerdo === 'object' &&
      recuerdo !== null &&
      (recuerdo as { resultado?: unknown }).resultado === 'menor' &&
      typeof (recuerdo as { hasta?: unknown }).hasta === 'number' &&
      ahora < (recuerdo as { hasta: number }).hasta;
    if (!vigente) await AsyncStorage.removeItem(CLAVE);
    return vigente;
  } catch {
    // Sin almacenamiento o con un valor roto: se pregunta de nuevo.
    return false;
  }
}
