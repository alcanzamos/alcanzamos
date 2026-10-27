import type { ReactNode } from "react";

// Íconos de E14-SDD 5.1: trazo de 2, extremos redondeados, el color lo da el componente que los usa.
// Siempre acompañan a un texto o al nombre accesible de su botón.
function Icono({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icono"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconoInformacion = () => (
  <Icono>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icono>
);

export const IconoAtencion = () => (
  <Icono>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6M12 16h.01" />
  </Icono>
);

export const IconoLogro = () => (
  <Icono>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 3 3 5-6" />
  </Icono>
);

export const IconoCheck = () => (
  <Icono>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icono>
);

export const IconoVer = () => (
  <Icono>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icono>
);

export const IconoOcultar = () => (
  <Icono>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    <path d="m4 4 16 16" />
  </Icono>
);

export const IconoAtras = () => (
  <Icono>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icono>
);

// Propio, de la Marca de propiedad (E14-SDD 5.16): una persona dentro de un círculo.
export const IconoPropio = () => (
  <Icono>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="10" r="3" />
    <path d="M6.5 18.5c1.2-2.4 3.2-3.5 5.5-3.5s4.3 1.1 5.5 3.5" />
  </Icono>
);

// Compartido, de la Marca de propiedad (E14-SDD 5.16): dos personas.
export const IconoCompartido = () => (
  <Icono>
    <circle cx="9" cy="9" r="3" />
    <circle cx="17" cy="10" r="2.5" />
    <path d="M3.5 19c.9-2.8 2.9-4 5.5-4s4.6 1.2 5.5 4M15 15.3c.7-.2 1.4-.3 2-.3 2 0 3.3 1 4 3.5" />
  </Icono>
);
