import * as SecureStore from 'expo-secure-store';

// El token de la sesión vive solo en expo-secure-store, que en Android lo cifra con el Keystore (ADR-003, AC-3).
// Nunca en el almacenamiento común de la app (sin cifrar), en un archivo ni en una variable que sobreviva a la pantalla.
const CLAVE = 'sesion';

export const leerToken = (): Promise<string | null> => SecureStore.getItemAsync(CLAVE);

export const guardarToken = (token: string): Promise<void> => SecureStore.setItemAsync(CLAVE, token);

export const borrarToken = (): Promise<void> => SecureStore.deleteItemAsync(CLAVE);
