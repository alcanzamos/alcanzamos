import { StyleSheet, Text, View } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { IconoCompartido, IconoPropio } from './Iconos';

// Marca de propiedad (E14-SDD 5.16): ícono y texto juntos, nunca solo color. Es la que dice «Compartido con el hogar»
// (NM-05, SEG-002) o «Solo mío».
export function MarcaDePropiedad({ compartido }: { compartido: boolean }) {
  const Icono = compartido ? IconoCompartido : IconoPropio;
  return (
    <View style={estilos.marca}>
      <Icono color={tokens.color.texto.secundario} />
      <Text style={estilos.texto}>{compartido ? textos.movimientos.fila.compartido : textos.registro.quien.soloMio}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  marca: { flexDirection: 'row', alignItems: 'center', gap: tokens.espacio['1'] },
  texto: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
});
