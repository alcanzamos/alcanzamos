import type { ReactElement } from "react";
import type { DatosDeAviso, TipoAviso } from "../textos";
import { cifras } from "./Cifras";
import { IconoAtencion, IconoInformacion, IconoLogro } from "./Iconos";

const iconos: Record<TipoAviso, () => ReactElement> = {
  informacion: IconoInformacion,
  atencion: IconoAtencion,
  logro: IconoLogro,
};

// Aviso de E14-SDD 5.4: ícono + título + mensaje. Se puede enfocar para llevar ahí el foco tras un envío.
// Con `viva` en falso no es una región viva ni se enfoca: lo envuelve quien ya lo es (MensajeDeEstado).
export function Aviso({
  id = "aviso",
  tipo,
  titulo,
  mensaje,
  viva = true,
}: DatosDeAviso & { id?: string; viva?: boolean }) {
  const Icono = iconos[tipo];
  return (
    <div
      id={id}
      className={`aviso aviso--${tipo}`}
      role={viva ? "status" : undefined}
      tabIndex={viva ? -1 : undefined}
    >
      <Icono />
      <div>
        <p className="aviso__titulo">{cifras(titulo)}</p>
        {mensaje && <p>{cifras(mensaje)}</p>}
      </div>
    </div>
  );
}
