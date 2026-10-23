import { useEffect, type ReactElement } from "react";
import { navegar, useUbicacion } from "./enrutador";
import { CambiarContrasena } from "./pantallas/CambiarContrasena";
import { CrearCuenta } from "./pantallas/CrearCuenta";
import { Entrar } from "./pantallas/Entrar";
import { Recuperar } from "./pantallas/Recuperar";
import { RecuperarAcceso } from "./pantallas/RecuperarAcceso";
import { RevisaTuCorreo } from "./pantallas/RevisaTuCorreo";
import { SeguridadDeLaCuenta } from "./pantallas/SeguridadDeLaCuenta";
import { SinAutorizacion } from "./pantallas/SinAutorizacion";
import { Verificar } from "./pantallas/Verificar";

function Redirigir({ a }: { a: string }) {
  useEffect(() => navegar(a, true), [a]);
  return null;
}

const pantallas: Record<string, () => ReactElement> = {
  "/entrar": Entrar,
  "/crear-cuenta": CrearCuenta,
  "/revisa-tu-correo": RevisaTuCorreo,
  "/verificar": Verificar,
  "/sin-autorizacion": SinAutorizacion,
  "/recuperar-acceso": RecuperarAcceso,
  "/recuperar": Recuperar,
  "/cuenta/seguridad": SeguridadDeLaCuenta,
  "/cuenta/contrasena": CambiarContrasena,
};

// Rutas de la app. `/` y toda ruta que no existe llevan a `/entrar`: no hay una pantalla de «no encontrada» en E14.
export function App() {
  const { ruta } = useUbicacion();
  const Pantalla = pantallas[ruta];
  return Pantalla ? <Pantalla /> : <Redirigir a="/entrar" />;
}
