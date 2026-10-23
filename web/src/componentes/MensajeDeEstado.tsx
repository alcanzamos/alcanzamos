import { useEffect, useState } from "react";
import type { DatosDeAviso } from "../textos";
import { Aviso } from "./Aviso";

// Mensaje de estado de la pantalla a la que se llega (E14-PCP 4.16 T11): un `role="status"` que el lector de pantalla
// anuncia solo, sin mover el foco. El contenedor se pinta primero y el aviso entra un instante después: una región
// viva que ya viene con el texto al cargar la página puede no anunciarse.
export function MensajeDeEstado({ aviso }: { aviso: DatosDeAviso }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setVisible(true));
  }, []);
  return (
    <div role="status">
      {visible && <Aviso {...aviso} id="mensaje-de-estado" viva={false} />}
    </div>
  );
}
