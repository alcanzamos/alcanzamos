import { useLayoutEffect, useRef, useState } from "react";

/** Mueve el foco a un elemento por su id (para el primer error o el aviso, tras enviar). */
export function enfocar(id: string) {
  document.getElementById(id)?.focus();
}

/**
 * Pide mover el foco cuando la pantalla ya se volvió a dibujar con los errores o el aviso.
 * Se llama desde el manejador del envío, después de actualizar el estado.
 */
export function useFocoPendiente() {
  const pendiente = useRef<string | null>(null);
  const [, repintar] = useState(0);
  // En el mismo momento en que se pinta el cambio: nadie ve la pantalla nueva sin que el foco ya esté en su sitio.
  useLayoutEffect(() => {
    if (pendiente.current) {
      enfocar(pendiente.current);
      pendiente.current = null;
    }
  });
  return (id: string) => {
    pendiente.current = id;
    repintar((n) => n + 1);
  };
}
