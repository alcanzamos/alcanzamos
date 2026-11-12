import { StyleSheet, Text, View } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';
import { Texto } from './Texto';

// Una finalidad con su nombre en `tipografia.cuerpo-destacado` y su texto debajo (E13, Q-11; E14-PCP sección 5): la fila de
// las tarjetas de PN-64 y de PN-68.
export function FilaDeFinalidad({ nombre, descripcion }: { nombre: string; descripcion: string }) {
  return (
    <View style={estilos.fila}>
      <Text style={estilos.nombre}>{nombre}</Text>
      <Texto>{descripcion}</Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  fila: { gap: tokens.espacio['1'] },
  nombre: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
});
