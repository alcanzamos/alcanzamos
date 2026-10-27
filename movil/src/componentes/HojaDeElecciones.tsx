import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';
import { HojaInferior } from './HojaInferior';
import { IconoCheck } from './Iconos';

export type Eleccion<V extends string | number> = { valor: V; etiqueta: string };

// Una Hoja inferior (E14-SDD 5.12) con una lista de elección única: «Ver todas» las categorías y «Otro mes». Cada fila
// es un `radio` con su estado, de 48 dp, y la elegida lleva una marca de verificación además del estado.
export function HojaDeElecciones<V extends string | number>({
  visible,
  alCerrar,
  opciones,
  valor,
  alElegir,
}: {
  visible: boolean;
  alCerrar: () => void;
  opciones: Eleccion<V>[];
  valor: V | null;
  alElegir: (valor: V) => void;
}) {
  const { height } = useWindowDimensions();
  return (
    <HojaInferior visible={visible} alCerrar={alCerrar}>
      <ScrollView style={{ maxHeight: height * 0.6 }}>
        <View accessibilityRole="radiogroup">
          {opciones.map((o) => (
            <Pressable
              key={o.valor}
              accessibilityRole="radio"
              accessibilityState={{ checked: o.valor === valor }}
              onPress={() => alElegir(o.valor)}
              style={estilos.fila}
            >
              <Text style={estilos.texto}>{o.etiqueta}</Text>
              {o.valor === valor && <IconoCheck color={tokens.color.texto.marca} />}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </HojaInferior>
  );
}

const estilos = StyleSheet.create({
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espacio['2'],
    minHeight: tokens.tamano['tactil-minimo'],
  },
  texto: { ...estiloDeTipografia('cuerpo'), flex: 1, color: tokens.color.texto.principal },
});
