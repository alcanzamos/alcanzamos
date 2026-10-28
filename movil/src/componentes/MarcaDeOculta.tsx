import { StyleSheet, Text, View } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { IconoOcultar } from './Iconos';

// La marca de una categoría que la persona ocultó y el movimiento conserva (E14-PRR 4.2, D-170): ícono y palabra
// juntos, nunca solo color. Va junto al nombre de la categoría, en un chip o en una fila de la hoja de elecciones.
export function MarcaDeOculta({ color }: { color: string }) {
  return (
    <View style={estilos.marca}>
      <IconoOcultar color={color} />
      <Text style={[estilos.texto, { color }]}>{textos.movimientos.oculta}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  marca: { flexDirection: 'row', alignItems: 'center', gap: tokens.espacio['1'] },
  texto: { ...estiloDeTipografia('pequeno') },
});
