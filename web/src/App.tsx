import { useEffect, type ReactElement } from "react";
import { reiniciarBorrador, RUTAS_DEL_BORRADOR } from "./borradorDeRegistro";
import { navegar, useUbicacion } from "./enrutador";
import { Autorizacion } from "./pantallas/Autorizacion";
import { CambiarContrasena } from "./pantallas/CambiarContrasena";
import { CrearCuenta } from "./pantallas/CrearCuenta";
import { Entrar } from "./pantallas/Entrar";
import { Movimientos } from "./pantallas/Movimientos";
import { Privacidad } from "./pantallas/Privacidad";
import { Recuperar } from "./pantallas/Recuperar";
import { Registrar } from "./pantallas/Registrar";
import { RecuperarAcceso } from "./pantallas/RecuperarAcceso";
import { RevisaTuCorreo } from "./pantallas/RevisaTuCorreo";
import { SeRepite } from "./pantallas/SeRepite";
import { SeguridadDeLaCuenta } from "./pantallas/SeguridadDeLaCuenta";
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
  "/privacidad": Privacidad,
  "/autorizacion": Autorizacion,
  "/recuperar-acceso": RecuperarAcceso,
  "/recuperar": Recuperar,
  "/cuenta/seguridad": SeguridadDeLaCuenta,
  "/cuenta/contrasena": CambiarContrasena,
  "/movimientos": Movimientos,
  "/registrar": Registrar,
  "/registrar/se-repite": SeRepite,
};

// Rutas de la app. `/` y toda ruta que no existe llevan a `/entrar`: no hay una pantalla de «no encontrada» en E14.
export function App() {
  const { ruta } = useUbicacion();
  const Pantalla = pantallas[ruta];
  const conBorrador = RUTAS_DEL_BORRADOR.includes(ruta);
  useEffect(() => {
    if (!conBorrador) reiniciarBorrador();
  }, [conBorrador]);
  return Pantalla ? <Pantalla /> : <Redirigir a="/entrar" />;
}
