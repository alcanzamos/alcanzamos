import { cifras } from "./Cifras";
import { IconoAtencion, IconoCheck } from "./Iconos";
import { MarcaDeOculta } from "./MarcaDeOculta";

export type OpcionDeChip<V extends string | number> = {
  valor: V;
  etiqueta: string;
  /** Una categoría que la persona ocultó: lleva el ícono y la palabra «Oculta», no solo color (D-170). */
  oculta?: boolean;
};

// Chips de categoría de E14-SDD (elección única): un grupo de botones de radio con etiqueta y, si hace falta, su error.
// Cada chip es toda un área táctil de 48 px; el elegido lleva fondo de marca y una marca de verificación, no solo color.
// `enFila` los deja en una sola fila que se desplaza a lo ancho (la Categoría, E14-PPN 3.1 fila 9).
export function ChipsDeEleccion<V extends string | number>({
  id,
  etiqueta,
  opciones,
  valor,
  alElegir,
  error,
  enFila = false,
}: {
  id: string;
  etiqueta: string;
  opciones: OpcionDeChip<V>[];
  valor: V | null;
  /** Sin él el chip es de solo lectura (un solo chip, ya elegido). */
  alElegir?: (valor: V) => void;
  error?: string;
  enFila?: boolean;
}) {
  return (
    <fieldset
      className="grupo"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="campo__etiqueta">{etiqueta}</legend>
      <div className={`chips${enFila ? " chips--fila" : ""}`}>
        {opciones.map((opcion) => (
          <label key={opcion.valor} className="chip">
            <input
              id={`${id}-${opcion.valor}`}
              type="radio"
              name={id}
              checked={valor === opcion.valor}
              readOnly={!alElegir}
              onChange={() => alElegir?.(opcion.valor)}
            />
            <span className="chip__texto">
              <IconoCheck />
              {cifras(opcion.etiqueta)}
              {opcion.oculta && <MarcaDeOculta />}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="campo__error">
          <IconoAtencion />
          <span>{cifras(error)}</span>
        </p>
      )}
    </fieldset>
  );
}
