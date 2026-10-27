import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';
import { cifras } from './Cifras';
import { IconoAtencion, IconoCheck } from './Iconos';

export type OpcionDeChip<V extends string | number> = { valor: V; etiqueta: string };

// Chips de categoría de E14-SDD (elección única): un grupo de botones de radio con su etiqueta y, si hace falta, su
// error en una región viva cortés. Cada chip es toda un área táctil de 48 dp; el elegido lleva fondo de marca y una
// marca de verificación, no solo color. Para TalkBack cada uno es un `radio` con el estado «marcado» o «sin marcar».
// `enFila` los deja en una sola fila que se desplaza a lo ancho (la Categoría, E14-PPN 3.1 fila 9).
export function ChipsDeEleccion<V extends string | number>({
  etiqueta,
  opciones,
  valor,
  alElegir,
  error,
  enFila = false,
}: {
  etiqueta: string;
  opciones: OpcionDeChip<V>[];
  valor: V | null;
  /** Sin él el chip es de solo lectura (un solo chip, ya elegido). */
  alElegir?: (valor: V) => void;
  error?: string;
  enFila?: boolean;
}) {
  const chips = opciones.map((opcion) => (
    <Chip
      key={opcion.valor}
      etiqueta={opcion.etiqueta}
      elegido={valor === opcion.valor}
      alTocar={alElegir && (() => alElegir(opcion.valor))}
    />
  ));
  return (
    <View accessibilityRole="radiogroup" style={estilos.grupo}>
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      {enFila ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={estilos.chips}>
          {chips}
        </ScrollView>
      ) : (
        <View style={[estilos.chips, estilos.chipsEnVarias]}>{chips}</View>
      )}
      <View accessibilityLiveRegion="polite">
        {error && (
          <View style={estilos.error}>
            <IconoAtencion color={tokens.color.estado.atencion.icono} />
            <Text style={estilos.textoDeError}>{cifras(error)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Chip({ etiqueta, elegido, alTocar }: { etiqueta: string; elegido: boolean; alTocar?: () => void }) {
  const [enFoco, setEnFoco] = useState(false);
  const { primaria } = tokens.color.accion;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: elegido }}
      onPress={alTocar}
      onFocus={() => setEnFoco(true)}
      onBlur={() => setEnFoco(false)}
      style={[estilos.chip, elegido && estilos.chipElegido, enFoco && estilos.chipEnFoco]}
    >
      {elegido && <IconoCheck color={primaria.texto} />}
      <Text style={[estilos.textoDelChip, elegido && { color: primaria.texto }]}>{cifras(etiqueta)}</Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  grupo: { gap: tokens.espacio['1'] },
  etiqueta: { ...estiloDeTipografia('etiqueta'), color: tokens.color.texto.principal },
  chips: { gap: tokens.espacio['2'] },
  chipsEnVarias: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espacio['1'],
    minHeight: tokens.tamano['tactil-minimo'],
    paddingHorizontal: tokens.espacio['4'],
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.campo,
    borderRadius: tokens.radio.total,
    backgroundColor: tokens.color.fondo.superficie,
  },
  chipElegido: { borderColor: tokens.color.accion.primaria.fondo, backgroundColor: tokens.color.accion.primaria.fondo },
  chipEnFoco: { borderWidth: tokens['ancho-borde'].grueso, borderColor: tokens.color.borde.foco },
  textoDelChip: { ...estiloDeTipografia('cuerpo'), color: tokens.color.texto.principal },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.espacio['2'] },
  textoDeError: { ...estiloDeTipografia('pequeno'), flex: 1, color: tokens.color.estado.atencion.texto },
});
