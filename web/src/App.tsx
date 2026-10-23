import { useEffect, type ReactElement } from "react";
import { Pendiente } from "./componentes/Pendiente";
import { navegar, useUbicacion } from "./enrutador";

function Redirigir({ a }: { a: string }) {
  useEffect(() => navegar(a, true), [a]);
  return null;
}

// Las pantallas de la US-49 entran de a una en los PR siguientes; mientras, cada ruta muestra `Pendiente`.
const pantallas: Record<string, () => ReactElement> = {
  "/entrar": Pendiente,
  "/crear-cuenta": Pendiente,
  "/revisa-tu-correo": Pendiente,
  "/verificar": Pendiente,
  "/sin-autorizacion": Pendiente,
  "/recuperar-acceso": Pendiente,
  "/recuperar": Pendiente,
  "/cuenta/seguridad": Pendiente,
  "/cuenta/contrasena": Pendiente,
};

// Rutas de la app. `/` y toda ruta que no existe llevan a `/entrar`: no hay una pantalla de «no encontrada» en E14.
export function App() {
  const { ruta } = useUbicacion();
  const Pantalla = pantallas[ruta];
  return Pantalla ? <Pantalla /> : <Redirigir a="/entrar" />;
}
