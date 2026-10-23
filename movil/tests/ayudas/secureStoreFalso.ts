// expo-secure-store en memoria, para las pruebas: nada toca el Keystore. Cada llamada queda en `llamadas`.
export function crearSecureStoreFalso() {
  const guardado = new Map<string, string>();
  const llamadas: { metodo: string; clave: string; valor?: string }[] = [];
  return {
    guardado,
    llamadas,
    getItemAsync: jest.fn(async (clave: string) => {
      llamadas.push({ metodo: 'get', clave });
      return guardado.get(clave) ?? null;
    }),
    setItemAsync: jest.fn(async (clave: string, valor: string) => {
      llamadas.push({ metodo: 'set', clave, valor });
      guardado.set(clave, valor);
    }),
    deleteItemAsync: jest.fn(async (clave: string) => {
      llamadas.push({ metodo: 'delete', clave });
      guardado.delete(clave);
    }),
  };
}
