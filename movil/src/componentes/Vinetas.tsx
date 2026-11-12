import { StyleSheet, Text, View } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';
import { cifras } from './Cifras';

// Una lista con viñetas (los derechos, los encargados, lo que trae una consulta y los plazos de PN-68). Para TalkBack es
// una lista de frases; la viñeta es solo un punto dibujado, que no se lee.
export function Vinetas({ items }: { items: readonly string[] }) {
  return (
    <View accessibilityRole="list" style={estilos.lista}>
      {items.map((texto) => (
        <View key={texto} style={estilos.fila}>
          <View importantForAccessibility="no" style={estilos.punto} />
          <Text style={estilos.texto}>{cifras(texto)}</Text>
        </View>
      ))}
    </View>
  );
}

const estilos = StyleSheet.create({
  lista: { gap: tokens.espacio['2'] },
  fila: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.espacio['2'] },
  // El punto va a la altura de la primera línea del texto.
  punto: {
    width: tokens.espacio['2'],
    height: tokens.espacio['2'],
    marginTop: tokens.espacio['2'],
    borderRadius: tokens.radio.total,
    backgroundColor: tokens.color.texto.secundario,
  },
  texto: { ...estiloDeTipografia('cuerpo'), flex: 1, color: tokens.color.texto.principal },
});
