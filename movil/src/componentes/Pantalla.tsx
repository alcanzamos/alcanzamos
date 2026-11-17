import { useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';
import { ScrollView, StyleSheet, Text, type HostInstance, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHayHojaVisible } from '../estadoDeHojas';
import { estiloDeTipografia } from '../fuentes';
import { useLectorDePantalla } from '../lectorDePantalla';
import type { DatosDeAviso } from '../textos';
import { tokens } from '../tokens/tokens.generated';
import { Logo } from './Logo';
import { MensajeDeEstado } from './MensajeDeEstado';
import { RegionDeAnuncios } from './RegionDeAnuncios';

// La base de toda pantalla: fondo de página, desplazable (el teclado no tapa los campos) y con los márgenes de
// E14-PCP 1. El título (`tipografia.titulo-2`) es el encabezado que el lector de pantalla anuncia.
// - `estado`: el mensaje de estado de la llegada (E14-PCP 4.16 T11); va arriba de todo.
// - `conLogo`: el Logo horizontal en color arriba (PN-58, PN-60 y PN-65).
// - `conBarra`: la pantalla lleva la barra nativa (Barra superior, E14-SDD 5.10) con su título; ya cubre el borde
//   de arriba, así que no se suma el margen de la barra de estado, y la pantalla no repite el título.
// Lleva la región viva de la pantalla (los avisos de estado, ACC-004), fuera de lo que se desplaza: así no se va de la
// pantalla cuando la persona baja hasta «Guardar».
// - `ref`: `desplazarHasta(vista, alLlegar)` baja o sube lo justo para que `vista` (un hijo) quede a la vista y, ya
//   dibujada ahí, llama a `alLlegar`; así el foco de TalkBack llega a algo que se ve (`useAvisarErrores`, bug 304).
// Mientras hay una hoja inferior en pantalla y TalkBack está encendido, su contenido no es importante para TalkBack (bug
// 304, `estadoDeHojas.ts`): la hoja es otra ventana y la región viva de arriba no se oculta.
export type ControlDePantalla = { desplazarHasta: (vista: HostInstance, alLlegar: () => void) => void };

export function Pantalla({
  titulo,
  conLogo = false,
  conBarra = false,
  estado,
  ref,
  children,
}: {
  titulo?: string;
  conLogo?: boolean;
  conBarra?: boolean;
  estado?: DatosDeAviso | null;
  ref?: Ref<ControlDePantalla>;
  children?: ReactNode;
}) {
  const margenes = useSafeAreaInsets();
  // Ocultar lo de atrás solo importa con un lector de pantalla encendido.
  const hayHoja = useHayHojaVisible();
  const hayLector = useLectorDePantalla();
  const ocultarElFondo = hayHoja && hayLector;
  const desplazable = useRef<ScrollViewInstance>(null);
  useImperativeHandle(
    ref,
    () => ({
      desplazarHasta(vista, alLlegar) {
        const interior = desplazable.current?.getInnerViewRef();
        if (!interior) return alLlegar();
        // `measureLayout` contesta cuando la vista ya tiene su lugar; sin él no hay dónde ir y el foco va igual.
        vista.measureLayout(
          interior,
          (_x, y) => {
            desplazable.current?.scrollTo({ y: Math.max(0, y - tokens.espacio['4']), animated: false });
            alLlegar();
          },
          alLlegar,
        );
      },
    }),
    [],
  );
  return (
    <>
      <ScrollView
        ref={desplazable}
        importantForAccessibility={ocultarElFondo ? 'no-hide-descendants' : 'auto'}
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
      <RegionDeAnuncios />
    </>
  );
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: tokens.color.fondo.pagina },
  contenido: { gap: tokens.espacio['4'], paddingHorizontal: tokens.espacio['4'] },
  titulo: { ...estiloDeTipografia('titulo-2'), color: tokens.color.texto.principal },
});
