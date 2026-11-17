import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';

// Una hoja que se deja de dibujar al cerrarse (`{hoja && <HojaDeMonto … />}`) no puede deslizarse hacia abajo: ya no está.
// `HojaQueSale` envuelve a esas hojas: cuando `children` queda vacío sigue dibujando la última hasta que `HojaInferior`
// termina su animación de cierre y avisa (`alSalir`). Así toda hoja se cierra igual y `useLlevarFoco` tiene un final de
// animación que esperar (ACC-004, bugs 303 y 304).
export const SalidaDeHoja = createContext<{ abierta: boolean; alSalir: () => void } | null>(null);

export function HojaQueSale({ children }: { children: ReactNode }) {
  const [guardada, setGuardada] = useState<ReactNode>(null);
  const abierta = Boolean(children);
  const alSalir = useCallback(() => setGuardada(null), []);
  const salida = useMemo(() => ({ abierta, alSalir }), [abierta, alSalir]);
  // Con una hoja abierta se guarda la última que llegó (React vuelve a dibujar de inmediato, con lo mismo).
  if (abierta && guardada !== children) setGuardada(children);
  return <SalidaDeHoja.Provider value={salida}>{abierta ? children : guardada}</SalidaDeHoja.Provider>;
}
