import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { estiloDeTipografia } from '../fuentes';
import { textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { IconoCerrar } from './Iconos';
import { RegionDeAnuncios } from './RegionDeAnuncios';

// Hoja inferior de E14-SDD 5.12: sube desde abajo sobre un velo. Se cierra de las tres maneras de 5.12: el ícono
// Cerrar, tocar el velo y el Atrás de Android (`onRequestClose`). El ícono va siempre, arriba a la derecha, en una caja
// de 48 dp con el nombre accesible «Cerrar» (ACC-004, bug 228: sin él, TalkBack no salía de la hoja deslizando). Con
// `titulo` lleva además el encabezado. El contenido se anuncia como una ventana modal para que TalkBack no salga de la
// hoja; sube con el teclado (el campo de «Cambiar el monto» no queda tapado). Lleva su propia región viva (ACC-004): la
// hoja es otra ventana en Android, y sus avisos se dicen en ella y no en la pantalla de atrás.
export function HojaInferior({
  visible,
  alCerrar,
  titulo,
  children,
}: {
  visible: boolean;
  alCerrar: () => void;
  titulo?: string;
  children: ReactNode;
}) {
  const margenes = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={alCerrar}>
      <KeyboardAvoidingView behavior="padding" style={estilos.velo} accessibilityViewIsModal>
        <Pressable accessible={false} importantForAccessibility="no" style={estilos.fuera} onPress={alCerrar} />
        <View style={[estilos.hoja, { paddingBottom: margenes.bottom + tokens.espacio['4'] }]}>
          <View style={estilos.encabezado}>
            {titulo && (
              <Text accessibilityRole="header" style={estilos.titulo}>
                {titulo}
              </Text>
            )}
            {/* E14-SDD 5.12 fija solo el nombre del ícono Cerrar, no una pista. */}
            {/* eslint-disable-next-line react-native-a11y/has-accessibility-hint */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={textos.porConfirmar.cerrar}
              onPress={alCerrar}
              style={estilos.cerrar}
            >
              <IconoCerrar color={tokens.color.texto.principal} />
            </Pressable>
          </View>
          {children}
          <RegionDeAnuncios />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  velo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  fuera: { flex: 1 },
  hoja: {
    gap: tokens.espacio['2'],
    padding: tokens.espacio['4'],
    borderTopLeftRadius: tokens.radio.grande,
    borderTopRightRadius: tokens.radio.grande,
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    backgroundColor: tokens.color.fondo.superficie,
  },
  encabezado: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: tokens.espacio['2'] },
  titulo: { ...estiloDeTipografia('titulo-3'), flex: 1, color: tokens.color.texto.principal },
  cerrar: {
    minWidth: tokens.tamano['tactil-minimo'],
    minHeight: tokens.tamano['tactil-minimo'],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
