import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { estiloDeTipografia } from '../fuentes';
import type { DatosDeAviso } from '../textos';
import { tokens } from '../tokens/tokens.generated';
import { Logo } from './Logo';
import { MensajeDeEstado } from './MensajeDeEstado';

// La base de toda pantalla: fondo de página, desplazable (el teclado no tapa los campos) y con los márgenes de
// E14-PCP 1. El título (`tipografia.titulo-2`) es el encabezado que el lector de pantalla anuncia.
// - `estado`: el mensaje de estado de la llegada (E14-PCP 4.16 T11); va arriba de todo.
// - `conLogo`: el Logo horizontal en color arriba (PN-58, PN-60 y PN-65).
// - `conBarra`: la pantalla lleva la barra nativa (Barra superior, E14-SDD 5.10) con su título; ya cubre el borde
//   de arriba, así que no se suma el margen de la barra de estado, y la pantalla no repite el título.
export function Pantalla({
  titulo,
  conLogo = false,
  conBarra = false,
  estado,
  children,
}: {
  titulo?: string;
  conLogo?: boolean;
  conBarra?: boolean;
  estado?: DatosDeAviso | null;
  children?: ReactNode;
}) {
  const margenes = useSafeAreaInsets();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={estilos.fondo}
      contentContainerStyle={[
        estilos.contenido,
        { paddingTop: conBarra ? tokens.espacio['4'] : margenes.top + tokens.espacio['6'] },
        { paddingBottom: margenes.bottom + tokens.espacio['6'] },
      ]}
    >
      {estado && <MensajeDeEstado aviso={estado} />}
      {conLogo && <Logo />}
      {titulo && (
        <Text accessibilityRole="header" style={estilos.titulo}>
          {titulo}
        </Text>
      )}
      {children}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: tokens.color.fondo.pagina },
  contenido: { gap: tokens.espacio['4'], paddingHorizontal: tokens.espacio['4'] },
  titulo: { ...estiloDeTipografia('titulo-2'), color: tokens.color.texto.principal },
});
