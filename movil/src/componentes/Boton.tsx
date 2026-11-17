import { useState, type Ref } from 'react';
import { Pressable, StyleSheet, Text, type HostInstance } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';

type Variante = 'primario' | 'secundario' | 'texto' | 'destructivo';

// Botón de E14-SDD 5.2 y botón de texto de 48 dp (tipografía.etiqueta). Alto mínimo `tamano.tactil-minimo`.
// Deshabilitado sigue siendo tocable para el lector de pantalla (`accessibilityState.disabled`) y no hace nada.
// `pista` es la `accessibilityHint`: qué pasa al tocarlo, solo cuando E14 lo dice. `nombre` es el nombre accesible
// cuando E14 da uno distinto del texto («Confirmar Salario de 1200000 pesos del 16 de noviembre de 2026»). `ref` es para
// devolverle el foco de TalkBack cuando se cierra la hoja que abrió (`useLlevarFoco`, L17 de la US-77, punto 3).
// `ocupado` es para el botón que manda algo al API y espera la respuesta (bug 303, ACC-004): se ve igual que
// deshabilitado y un segundo toque no hace nada, pero para TalkBack sigue habilitado y dice «ocupado»
// (`accessibilityState.busy`). Un botón que se deshabilita mientras tiene el foco hace que Android se lo quite a TalkBack,
// que salta a «Navegar hacia arriba». `deshabilitado` es para el que de verdad no se puede tocar.
export function Boton({
  variante = 'primario',
  deshabilitado = false,
  ocupado = false,
  nombre,
  pista,
  alTocar,
  ref,
  children,
}: {
  variante?: Variante;
  deshabilitado?: boolean;
  ocupado?: boolean;
  nombre?: string;
  pista?: string;
  alTocar?: () => void;
  ref?: Ref<HostInstance>;
  children: string;
}) {
  const [enFoco, setEnFoco] = useState(false);
  const sinEfecto = deshabilitado || ocupado;
  const colores = coloresDe(variante, sinEfecto);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityState={ocupado ? { disabled: deshabilitado, busy: true } : { disabled: deshabilitado }}
      accessibilityLabel={nombre}
      accessibilityHint={pista}
      onPress={() => {
        if (!sinEfecto) alTocar?.();
      }}
      onFocus={() => setEnFoco(true)}
      onBlur={() => setEnFoco(false)}
      style={({ pressed }) => [
        estilos.boton,
        variante === 'texto' && estilos.botonDeTexto,
        { backgroundColor: pressed && !sinEfecto ? colores.presionado : colores.fondo, borderColor: colores.borde },
        enFoco && estilos.foco,
      ]}
    >
      <Text style={[variante === 'texto' ? estilos.etiqueta : estilos.texto, { color: colores.texto }]}>
        {children}
      </Text>
    </Pressable>
  );
}

function coloresDe(variante: Variante, deshabilitado: boolean) {
  const { accion } = tokens.color;
  if (deshabilitado && variante !== 'texto') {
    return {
      fondo: accion.deshabilitada.fondo,
      presionado: accion.deshabilitada.fondo,
      borde: 'transparent',
      texto: accion.deshabilitada.texto,
    };
  }
  if (variante === 'primario') {
    return {
      fondo: accion.primaria.fondo,
      presionado: accion.primaria['fondo-presionado'],
      borde: 'transparent',
      texto: accion.primaria.texto,
    };
  }
  if (variante === 'destructivo') {
    return {
      fondo: accion.destructiva.fondo,
      presionado: accion.destructiva['fondo-presionado'],
      borde: 'transparent',
      texto: accion.destructiva.texto,
    };
  }
  if (variante === 'secundario') {
    return {
      fondo: tokens.color.fondo.superficie,
      presionado: accion.secundaria['fondo-presionado'],
      borde: accion.secundaria.borde,
      texto: accion.secundaria.texto,
    };
  }
  return {
    fondo: 'transparent',
    presionado: accion.secundaria['fondo-presionado'],
    borde: 'transparent',
    texto: deshabilitado ? accion.deshabilitada.texto : accion.secundaria.texto,
  };
}

export function BotonDeTexto(props: Omit<Parameters<typeof Boton>[0], 'variante'>) {
  return <Boton {...props} variante="texto" />;
}

const estilos = StyleSheet.create({
  boton: {
    minHeight: tokens.tamano['tactil-minimo'],
    minWidth: tokens.tamano['tactil-minimo'],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.espacio['6'],
    paddingVertical: tokens.espacio['3'],
    borderWidth: tokens['ancho-borde'].grueso,
    borderRadius: tokens.radio.medio,
  },
  botonDeTexto: { alignSelf: 'flex-start' },
  // Foco (E14-SDD 5.2): anillo `color.borde.foco` de `ancho-borde.grueso`.
  foco: { borderColor: tokens.color.borde.foco },
  texto: { ...estiloDeTipografia('cuerpo-destacado'), textAlign: 'center' },
  etiqueta: { ...estiloDeTipografia('etiqueta'), textAlign: 'center' },
});
