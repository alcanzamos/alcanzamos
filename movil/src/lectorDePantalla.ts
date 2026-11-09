import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Si el lector de pantalla (TalkBack) está activo: lo pregunta al montarse y sigue sus cambios mientras el componente
 * esté en pie (`screenReaderChanged`). Un cambio que llega antes de la respuesta a la pregunta es el que vale.
 */
export function useLectorDePantalla(): boolean {
  const [activo, setActivo] = useState(false);
  useEffect(() => {
    let respondido = false;
    void AccessibilityInfo.isScreenReaderEnabled().then((inicial) => {
      if (!respondido) setActivo(inicial);
    });
    const suscripcion = AccessibilityInfo.addEventListener('screenReaderChanged', (nuevo: boolean) => {
      respondido = true;
      setActivo(nuevo);
    });
    return () => {
      respondido = true;
      suscripcion.remove();
    };
  }, []);
  return activo;
}
