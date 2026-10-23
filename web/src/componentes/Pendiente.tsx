import { Pagina } from "./Pagina";

// Ruta que un PR siguiente de la US-49 reemplaza por su pantalla. Solo lleva la marca (E14-PCP 4.1, fila 1) y el nombre
// de la app como título: no tiene texto propio.
export function Pendiente() {
  return <Pagina titulo="Alcanzamos" conLogo />;
}
