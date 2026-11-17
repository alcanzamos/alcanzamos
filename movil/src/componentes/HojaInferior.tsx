import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { estiloDeTipografia } from '../fuentes';
import { textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { hojaVisible } from '../estadoDeHojas';
import { SalidaDeHoja } from './HojaQueSale';
import { IconoCerrar } from './Iconos';
import { RegionDeAnuncios } from './RegionDeAnuncios';

// Hoja inferior de E14-SDD 5.12: sube desde abajo sobre un velo. Se cierra de las tres maneras de 5.12: el ícono
// Cerrar, tocar el velo y el Atrás de Android (`onRequestClose`). El ícono va siempre, arriba a la derecha, en una caja
// de 48 dp con el nombre accesible «Cerrar» (ACC-004, bug 228: sin él, TalkBack no salía de la hoja deslizando). Con
// `titulo` lleva además el encabezado. El contenido se anuncia como una ventana modal para que TalkBack no salga de la
// hoja; sube con el teclado (el campo de «Cambiar el monto» no queda tapado). Lleva su propia región viva (ACC-004): la
// hoja es otra ventana en Android, y sus avisos se dicen en ella y no en la pantalla de atrás.
// `desplazable` es para la hoja con mucho contenido (la de «No autorizo» de PN-54: explicación, descarga, contraseña y dos
// botones): la hoja no pasa de la fracción de la ventana que dice `ALTO_MAXIMO`, el contenido se desplaza dentro de ella
// y el teclado no impide tocar los botones. El encabezado y la región viva quedan fuera de lo que se desplaza.
// La hoja se desliza sola (el `Modal` va con `animationType="none"`): en Android el cierre de la ventana del `Modal` no
// avisa cuándo termina (`onDismiss` es solo de iOS), y `useLlevarFoco` tiene que esperar a que termine para pedir el
// foco (bug 303). Mientras la hoja está en pantalla, `Pantalla` oculta su contenido a TalkBack (`estadoDeHojas.ts`,
// bug 304): `accessibilityViewIsModal` es solo de iOS, y en Android TalkBack leía lo de atrás.
const ALTO_MAXIMO = 0.9;
export const DURACION_DE_LA_HOJA_MS = 250;

export function HojaInferior({
  visible,
  alCerrar,
  titulo,
  desplazable = false,
  children,
}: {
  visible: boolean;
  alCerrar: () => void;
  titulo?: string;
  desplazable?: boolean;
  children: ReactNode;
}) {
  const margenes = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const salida = useContext(SalidaDeHoja);
  const abierta = visible && (salida?.abierta ?? true);
  const [dibujada, setDibujada] = useState(abierta);
  const [posicion] = useState(() => new Animated.Value(height));
  const enPantalla = useRef(abierta);
  // Al abrirse se dibuja ya, en este mismo cuadro: la animación la mete desde fuera de la pantalla.
  if (abierta && !dibujada) setDibujada(true);

  // Entra al abrirse y sale al cerrarse; el `Modal` se quita cuando termina de salir.
  useEffect(() => {
    const animar = (hasta: number, easing: (valor: number) => number, alTerminar?: (terminada: boolean) => void) => {
      const animacion = Animated.timing(posicion, { toValue: hasta, duration: DURACION_DE_LA_HOJA_MS, easing, useNativeDriver: true });
      animacion.start(({ finished }) => alTerminar?.(finished));
      return animacion;
    };
    if (abierta) {
      enPantalla.current = true;
      const entrada = animar(0, Easing.out(Easing.cubic));
      return () => entrada.stop();
    }
    if (!enPantalla.current) return;
    const salir = animar(height, Easing.in(Easing.cubic), (terminada) => {
      if (!terminada) return;
      enPantalla.current = false;
      setDibujada(false);
      salida?.alSalir();
    });
    return () => salir.stop();
  }, [abierta, height, posicion, salida]);

  const seDibuja = abierta || dibujada;
  useEffect(() => (seDibuja ? hojaVisible() : undefined), [seDibuja]);

  return (
    <Modal transparent animationType="none" visible={seDibuja} onRequestClose={alCerrar}>
      <KeyboardAvoidingView
        behavior="padding"
        pointerEvents={abierta ? 'auto' : 'none'}
        style={estilos.velo}
        accessibilityViewIsModal
      >
        <Pressable accessible={false} importantForAccessibility="no" style={estilos.fuera} onPress={alCerrar} />
        <Animated.View
          style={[
            estilos.hoja,
            { paddingBottom: margenes.bottom + tokens.espacio['4'] },
            desplazable && { maxHeight: height * ALTO_MAXIMO },
            { transform: [{ translateY: posicion }] },
          ]}
        >
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
          {desplazable ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={estilos.desplazable}
              contentContainerStyle={estilos.contenido}
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
          <RegionDeAnuncios />
        </Animated.View>
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
  desplazable: { flexShrink: 1 },
  contenido: { gap: tokens.espacio['2'] },
  titulo: { ...estiloDeTipografia('titulo-3'), flex: 1, color: tokens.color.texto.principal },
  cerrar: {
    minWidth: tokens.tamano['tactil-minimo'],
    minHeight: tokens.tamano['tactil-minimo'],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
