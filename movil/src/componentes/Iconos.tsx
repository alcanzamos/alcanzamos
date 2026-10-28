import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { tokens } from '../tokens/tokens.generated';

// Íconos de E14-SDD 5.1: caja de 24, trazo de 2, extremos redondeados; el color lo da el componente que los usa.
// Siempre acompañan a un texto o al nombre accesible de su botón, así que el lector de pantalla los salta.
const TRAZO = tokens['ancho-borde'].grueso;

function Icono({ color, children }: { color: string; children: ReactNode }) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={tokens.tamano.icono}
      height={tokens.tamano.icono}
      fill="none"
      stroke={color}
      strokeWidth={TRAZO}
      strokeLinecap="round"
      strokeLinejoin="round"
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </Svg>
  );
}

type Propiedades = { color: string };

export const IconoInformacion = ({ color }: Propiedades) => (
  <Icono color={color}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 11v5M12 8h.01" />
  </Icono>
);

export const IconoAtencion = ({ color }: Propiedades) => (
  <Icono color={color}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 7v6M12 16h.01" />
  </Icono>
);

export const IconoLogro = ({ color }: Propiedades) => (
  <Icono color={color}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="m8 12.5 3 3 5-6" />
  </Icono>
);

export const IconoVer = ({ color }: Propiedades) => (
  <Icono color={color}>
    <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <Circle cx="12" cy="12" r="3" />
  </Icono>
);

export const IconoOcultar = ({ color }: Propiedades) => (
  <Icono color={color}>
    <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <Circle cx="12" cy="12" r="3" />
    <Path d="m4 4 16 16" />
  </Icono>
);

// El Calendario de PN-65 (E14-PCP 4.8, fila 4).
export const IconoCalendario = ({ color }: Propiedades) => (
  <Icono color={color}>
    <Rect x="4" y="5" width="16" height="15" rx="2" />
    <Path d="M4 10h16M8 3v4M16 3v4" />
  </Icono>
);

// El Check de la Casilla de verificación (E14-SDD 5.17).
export const IconoCheck = ({ color }: Propiedades) => (
  <Icono color={color}>
    <Path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icono>
);

// Propio, de la Marca de propiedad (E14-SDD 5.16, PN-63 fila 5): una persona dentro de un círculo.
export const IconoPropio = ({ color }: Propiedades) => (
  <Icono color={color}>
    <Circle cx="12" cy="12" r="9" />
    <Circle cx="12" cy="10" r="3" />
    <Path d="M6.5 18.5c1.2-2.4 3.2-3.5 5.5-3.5s4.3 1.1 5.5 3.5" />
  </Icono>
);

// Compartido, de la Marca de propiedad (E14-SDD 5.16): dos personas.
export const IconoCompartido = ({ color }: Propiedades) => (
  <Icono color={color}>
    <Circle cx="9" cy="9" r="3" />
    <Circle cx="17" cy="10" r="2.5" />
    <Path d="M3.5 19c.9-2.8 2.9-4 5.5-4s4.6 1.2 5.5 4M15 15.3c.7-.2 1.4-.3 2-.3 2 0 3.3 1 4 3.5" />
  </Icono>
);

// El Siguiente del final de una Fila de lista navegable (E14-SDD 5.20).
export const IconoSiguiente = ({ color }: Propiedades) => (
  <Icono color={color}>
    <Path d="m9 6 6 6-6 6" />
  </Icono>
);
