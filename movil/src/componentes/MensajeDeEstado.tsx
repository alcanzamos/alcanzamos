import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { DatosDeAviso } from '../textos';
import { Aviso } from './Aviso';

// Mensaje de estado de la pantalla a la que se llega (E14-PCP 4.16 T11): una región viva cortés que el lector de
// pantalla (TalkBack) anuncia solo, sin mover el foco. El contenedor se pinta primero y el aviso entra un instante
// después: una región viva que ya trae el texto al montarse puede no anunciarse.
export function MensajeDeEstado({ aviso }: { aviso: DatosDeAviso }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setVisible(true));
  }, []);
  return <View accessibilityLiveRegion="polite">{visible && <Aviso {...aviso} viva={false} />}</View>;
}
