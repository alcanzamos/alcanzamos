// La dirección del API sale de la configuración (D-129): ningún dominio fijo en el código.
// Expo reemplaza `process.env.EXPO_PUBLIC_URL_API` al empaquetar; hay que escribirlo con ese nombre exacto.
// Sin barra final. Ejemplo para probar en la red local: ver movil/README.md.
export function urlDelApi(): string | null {
  const url = process.env.EXPO_PUBLIC_URL_API?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}
