import type { ReactNode } from "react";
import { cifras } from "./Cifras";
import { IconoAtencion, IconoCheck } from "./Iconos";

// Casilla de verificación de E14-SDD 5.17. Nunca viene marcada, salvo en «Confirmar todos» (D-093, E14-PRR 4.8).
// Toda la fila, con su texto, es el área táctil; el texto puede ser más que una frase (la fila «Por confirmar»).
// `ayuda` es la nota que explica la casilla (`tipografia.pequeno`, `color.texto.secundario`): va debajo y la describe
// (la frase de los avisos con la app cerrada de PN-64, SC-E21-25 3.6).
export function Casilla({
  id,
  texto,
  ayuda,
  marcada,
  deshabilitada = false,
  alCambiar,
  error,
}: {
  id: string;
  texto: ReactNode;
  ayuda?: string;
  marcada: boolean;
  deshabilitada?: boolean;
  alCambiar: (marcada: boolean) => void;
  error?: string;
}) {
  const descritaPor = [error && `${id}-error`, ayuda && `${id}-ayuda`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="casilla-grupo">
      <label className="casilla" htmlFor={id}>
        <input
          id={id}
          name={id}
          type="checkbox"
          checked={marcada}
          disabled={deshabilitada}
          aria-invalid={error ? true : undefined}
          aria-describedby={descritaPor || undefined}
          onChange={(evento) => alCambiar(evento.target.checked)}
        />
        <span
          className={`casilla__caja${error ? " casilla__caja--error" : ""}`}
        >
          <IconoCheck />
        </span>
        <span>{texto}</span>
      </label>
      {error && (
        <p id={`${id}-error`} className="campo__error">
          <IconoAtencion />
          <span>{cifras(error)}</span>
        </p>
      )}
      {ayuda && (
        <p id={`${id}-ayuda`} className="ayuda">
          {ayuda}
        </p>
      )}
    </div>
  );
}
