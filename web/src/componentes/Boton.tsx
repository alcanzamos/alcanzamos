import type { ReactNode } from "react";
import { alTocarEnlace } from "../enrutador";

type Variante = "primario" | "secundario" | "texto";

// Botón de E14-SDD 5.2 y botón de texto de 48 px. Deshabilitado usa aria-disabled: el foco no se pierde
// y el botón puede seguir enlazado a su explicación con aria-describedby.
export function Boton({
  variante = "primario",
  tipo = "button",
  deshabilitado = false,
  descritoPor,
  alTocar,
  children,
}: {
  variante?: Variante;
  tipo?: "button" | "submit";
  deshabilitado?: boolean;
  descritoPor?: string;
  alTocar?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type={tipo}
      className={`boton boton--${variante}`}
      aria-disabled={deshabilitado || undefined}
      aria-describedby={descritoPor}
      onClick={(evento) => {
        if (deshabilitado) evento.preventDefault();
        else alTocar?.();
      }}
    >
      {children}
    </button>
  );
}

// Un enlace con aspecto de botón: lleva a otra pantalla de la app sin recargar la página.
export function BotonEnlace({
  href,
  variante = "secundario",
  children,
}: {
  href: string;
  variante?: Variante;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={`boton boton--${variante}`}
      onClick={alTocarEnlace(href)}
    >
      {children}
    </a>
  );
}
