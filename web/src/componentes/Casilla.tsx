import { cifras } from "./Cifras";
import { IconoAtencion, IconoCheck } from "./Iconos";

// Casilla de verificación de E14-SDD 5.17. Nunca viene marcada: quien la usa parte de `false`.
// Toda la fila, con su texto, es el área táctil.
export function Casilla({
  id,
  texto,
  marcada,
  alCambiar,
  error,
}: {
  id: string;
  texto: string;
  marcada: boolean;
  alCambiar: (marcada: boolean) => void;
  error?: string;
}) {
  return (
    <div className="casilla-grupo">
      <label className="casilla" htmlFor={id}>
        <input
          id={id}
          name={id}
          type="checkbox"
          checked={marcada}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
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
    </div>
  );
}
