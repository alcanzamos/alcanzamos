import { useEffect, type ReactElement } from "react";
import { reiniciarBorrador, RUTAS_DEL_BORRADOR } from "./borradorDeRegistro";
import { navegar, useUbicacion } from "./enrutador";
import { Autorizacion } from "./pantallas/Autorizacion";
import { BorrarCuenta } from "./pantallas/BorrarCuenta";
import { CambiarContrasena } from "./pantallas/CambiarContrasena";
import { CrearCuenta } from "./pantallas/CrearCuenta";
import { Entrar } from "./pantallas/Entrar";
import { Ingresos } from "./pantallas/Ingresos";
import { Movimientos } from "./pantallas/Movimientos";
import { Politica } from "./pantallas/Politica";
import { Presupuesto } from "./pantallas/Presupuesto";
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

// PN-63 desde el menú (E14-PCP 4.6): con Atrás y sin «Continuar»; `/privacidad` sigue siendo el primer uso.
const PrivacidadDesdeElMenu = () => <Privacidad desdeElMenu />;

const pantallas: Record<string, () => ReactElement> = {
  "/entrar": Entrar,
  "/crear-cuenta": CrearCuenta,
  "/revisa-tu-correo": RevisaTuCorreo,
  "/verificar": Verificar,
  "/privacidad": Privacidad,
  // PN-68 es pública (D-195): sin sesión; de dónde se abre lo dice `?desde=`.
  "/politica": Politica,
  "/autorizacion": Autorizacion,
  "/recuperar-acceso": RecuperarAcceso,
  "/recuperar": Recuperar,
  "/cuenta/seguridad": SeguridadDeLaCuenta,
  "/cuenta/contrasena": CambiarContrasena,
  "/cuenta/borrar": BorrarCuenta,
  "/cuenta/privacidad": PrivacidadDesdeElMenu,
  "/movimientos": Movimientos,
  "/registrar": Registrar,
  "/registrar/se-repite": SeRepite,
  "/presupuesto": Presupuesto,
  "/ingresos": Ingresos,
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
