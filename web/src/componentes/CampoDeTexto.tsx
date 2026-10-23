import type { ReactNode } from "react";
import { cifras } from "./Cifras";
import { IconoAtencion } from "./Iconos";

export type PropiedadesDeCampo = {
  id: string;
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
  autocompletar: string;
  ayuda?: string;
  error?: string;
  tipo?: "text" | "email" | "password";
};

// Campo de texto de E14-SDD 5.3: etiqueta siempre visible, ayuda y error ligados con aria-describedby.
// `accion` es el botón al final de la caja (Ver u Ocultar en el campo de contraseña).
export function CampoDeTexto({
  id,
  etiqueta,
  valor,
  alCambiar,
  autocompletar,
  ayuda,
  error,
  tipo = "text",
  accion,
}: PropiedadesDeCampo & { accion?: ReactNode }) {
  const descripcion =
    [ayuda && `${id}-ayuda`, error && `${id}-error`]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="campo">
      <label htmlFor={id} className="campo__etiqueta">
        {etiqueta}
      </label>
      <div className={`campo__caja${error ? " campo__caja--error" : ""}`}>
        <input
          id={id}
          name={id}
          type={tipo}
          value={valor}
          autoComplete={autocompletar}
          aria-invalid={error ? true : undefined}
          aria-describedby={descripcion}
          onChange={(evento) => alCambiar(evento.target.value)}
        />
        {accion}
      </div>
      {ayuda && (
        <p id={`${id}-ayuda`} className="campo__ayuda">
          {cifras(ayuda)}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="campo__error">
          <IconoAtencion />
          <span>{cifras(error)}</span>
        </p>
      )}
    </div>
  );
}
