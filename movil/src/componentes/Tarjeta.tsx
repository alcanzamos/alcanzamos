import type { ComponentType, ReactNode, Ref } from 'react';
import { StyleSheet, Text, View, type HostInstance } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';

// Tarjeta de E14-SDD 5.7: blanca sobre la página, borde decorativo de 1, `radio.grande`, relleno de 16, sin sombra.
// El título (`tipografia.titulo-3`) es un encabezado; `Icono` es el que E14 pida junto al título (PN-63 filas 5 y 7).
// `refDelTitulo` es para llevarle el foco de TalkBack (`useLlevarFoco`).
export function Tarjeta({
  titulo,
  Icono,
  refDelTitulo,
  children,
}: {
  titulo: string;
  Icono?: ComponentType<{ color: string }>;
  refDelTitulo?: Ref<HostInstance>;
  children: ReactNode;
}) {
  return (
    <View style={estilos.tarjeta}>
      <View style={estilos.encabezado}>
        {Icono && <Icono color={tokens.color.texto.marca} />}
        <Text ref={refDelTitulo} accessibilityRole="header" style={estilos.titulo}>
          {titulo}
        </Text>
      </View>
      {children}
    </View>
  );
}

const estilos = StyleSheet.create({
  tarjeta: {
    gap: tokens.espacio['2'],
    padding: tokens.espacio['4'],
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    borderRadius: tokens.radio.grande,
    backgroundColor: tokens.color.fondo.superficie,
  },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: tokens.espacio['2'] },
  titulo: { ...estiloDeTipografia('titulo-3'), flex: 1, color: tokens.color.texto.principal },
});
