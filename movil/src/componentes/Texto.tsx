import { StyleSheet, Text, View } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';
import { cifras } from './Cifras';
import { IconoInformacion } from './Iconos';

// El texto corrido de una pantalla: `cuerpo` (tipografia.cuerpo) o `ayuda` (tipografia.pequeno, color secundario).
// Los números van en Figtree (D-123).
// `etiqueta` es el nombre accesible cuando el lector de pantalla debe decir otra cosa, como un monto en pesos (ACC-004).
export function Texto({
  variante = 'cuerpo',
  etiqueta,
  children,
}: {
  variante?: 'cuerpo' | 'ayuda';
  etiqueta?: string;
  children: string;
}) {
  return (
    <Text accessibilityLabel={etiqueta} accessibilityHint={undefined} style={variante === 'ayuda' ? estilos.ayuda : estilos.cuerpo}>
      {cifras(children)}
    </Text>
  );
}

// «Tipografía pequeña, ícono Información» de E14-PCP (PN-58 fila 10, PN-59 fila 3): una nota con su ícono.
export function Nota({ children }: { children: string }) {
  return (
    <View style={estilos.nota}>
      <IconoInformacion color={tokens.color.estado.informacion.icono} />
      <Text style={estilos.textoDeNota}>{cifras(children)}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  cuerpo: { ...estiloDeTipografia('cuerpo'), color: tokens.color.texto.principal },
  ayuda: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  nota: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.espacio['2'] },
  textoDeNota: { ...estiloDeTipografia('pequeno'), flex: 1, color: tokens.color.estado.informacion.texto },
});
