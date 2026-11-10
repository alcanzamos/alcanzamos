import { useState, type Ref } from 'react';
import type { TextInputInstance } from 'react-native';
import { montoEnElCampo, SIMBOLO_DE_PESOS } from '../dinero';
import { useLectorDePantalla } from '../lectorDePantalla';
import { textos } from '../textos/es.generated';
import { CampoDeTexto } from './CampoDeTexto';

// El campo «Monto» de Registrar, «Corregir» y «Cambiar el monto» (E14-PPN 3.1), con la opción A del dueño (ACC-004,
// L6): TalkBack leía «$15.000» como «15 dólares cero cero cero» y «15.000» como «15, cero cero cero»; «15000» lo lee
// «quince mil».
// - Mientras se edita, el campo muestra el número sin «$» ni puntos («15000», «15000,50»); al salir, con puntos
//   («15.000»). Lo que se escribe se muestra tal cual mientras se edita.
// - El «$» es un prefijo fijo fuera del campo, que TalkBack no lee (`importantForAccessibility="no"`).
// - Con TalkBack activo, el campo muestra el número sin puntos también fuera de la edición: el foco de TalkBack no es
//   el de edición, y un campo lleno que no se está editando diría «15, cero cero cero».
// `valor` es el texto que guarda quien lo usa; `leerMonto` acepta las dos formas, así que los centavos no cambian.
export function CampoDeMonto({
  valor,
  alCambiar,
  error,
  ref,
}: {
  valor: string;
  alCambiar: (valor: string) => void;
  error?: string;
  ref?: Ref<TextInputInstance>;
}) {
  const [editando, setEditando] = useState(false);
  const lector = useLectorDePantalla();
  return (
    <CampoDeTexto
      ref={ref}
      etiqueta={textos.registro.monto.etiqueta}
      // El nombre que lee TalkBack lleva la moneda (dueño, 2026-11-08); el rótulo visible sigue siendo «Monto».
      nombreAccesible={textos.registro.monto.nombreAccesible}
      teclado="decimal-pad"
      cifra
      prefijo={SIMBOLO_DE_PESOS}
      valor={editando ? valor : montoEnElCampo(valor, { conMiles: !lector })}
      alCambiar={alCambiar}
      alEntrar={() => {
        setEditando(true);
        const sinMiles = montoEnElCampo(valor, { conMiles: false });
        if (sinMiles !== valor) alCambiar(sinMiles);
      }}
      alSalir={() => setEditando(false)}
      error={error}
    />
  );
}
