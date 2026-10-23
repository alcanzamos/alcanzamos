import { useEffect, useRef, type ReactNode } from "react";
import { llegoNavegando } from "../enrutador";
import type { DatosDeAviso } from "../textos";
import { MensajeDeEstado } from "./MensajeDeEstado";
import logo from "../../../marca/logo-horizontal-color.svg";

// Columna centrada de antes de entrar (E14-PCP 1: PN-58 a PN-64, sin barra lateral). El título es el h1.
// `estado` es el mensaje de estado de la llegada (E14-PCP 4.16 T11) y va arriba de todo. `conLogo` pone arriba el Logo horizontal en color de 40 px (PN-58 y PN-60). Al llegar por una navegación
// el foco pasa al título, para que el lector de pantalla anuncie la pantalla nueva.
export function Pagina({
  titulo,
  conLogo = false,
  estado,
  children,
}: {
  titulo: string;
  conLogo?: boolean;
  estado?: DatosDeAviso | null;
  children?: ReactNode;
}) {
  const encabezado = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${titulo} · Alcanzamos`;
    if (llegoNavegando()) encabezado.current?.focus();
  }, [titulo]);
  return (
    <main className="columna">
      {estado && <MensajeDeEstado aviso={estado} />}
      {conLogo && <img src={logo} alt="Alcanzamos" className="logo" />}
      <h1 ref={encabezado} tabIndex={-1} className="titulo">
        {titulo}
      </h1>
      {children}
    </main>
  );
}
