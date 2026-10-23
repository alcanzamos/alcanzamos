import { useEffect, type ReactElement } from "react";
import { Pendiente } from "./componentes/Pendiente";
import { navegar, useUbicacion } from "./enrutador";
import { CrearCuenta } from "./pantallas/CrearCuenta";
import { RevisaTuCorreo } from "./pantallas/RevisaTuCorreo";
import { SinAutorizacion } from "./pantallas/SinAutorizacion";
import { Verificar } from "./pantallas/Verificar";

function Redirigir({ a }: { a: string }) {
  useEffect(() => navegar(a, true), [a]);
  return null;
}

// Las pantallas de la US-49 entran de a una en los PR siguientes; mientras, cada ruta muestra `Pendiente`.
const pantallas: Record<string, () => ReactElement> = {
  "/entrar": Pendiente,
  "/crear-cuenta": CrearCuenta,
  "/revisa-tu-correo": RevisaTuCorreo,
  "/verificar": Verificar,
  "/sin-autorizacion": SinAutorizacion,
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
