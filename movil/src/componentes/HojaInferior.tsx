import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../tokens/tokens.generated';

// Hoja inferior de E14-SDD 5.12: sube desde abajo sobre un velo. El Atrás de Android la cierra (`onRequestClose`) y
// tocar el velo también; el contenido se anuncia como una ventana modal para que TalkBack no salga de la hoja.
export function HojaInferior({
  visible,
  alCerrar,
  children,
}: {
  visible: boolean;
  alCerrar: () => void;
  children: ReactNode;
}) {
  const margenes = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={alCerrar}>
      <View style={estilos.velo} accessibilityViewIsModal>
        <Pressable accessible={false} importantForAccessibility="no" style={estilos.fuera} onPress={alCerrar} />
        <View style={[estilos.hoja, { paddingBottom: margenes.bottom + tokens.espacio['4'] }]}>{children}</View>
      </View>
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
});
