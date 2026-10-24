import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';

type Variante = 'primario' | 'secundario' | 'texto';

// Botón de E14-SDD 5.2 y botón de texto de 48 dp (tipografía.etiqueta). Alto mínimo `tamano.tactil-minimo`.
// Deshabilitado sigue siendo tocable para el lector de pantalla (`accessibilityState.disabled`) y no hace nada.
// `pista` es la `accessibilityHint`: qué pasa al tocarlo, solo cuando E14 lo dice.
export function Boton({
  variante = 'primario',
  deshabilitado = false,
  pista,
  alTocar,
  children,
}: {
  variante?: Variante;
  deshabilitado?: boolean;
  pista?: string;
  alTocar?: () => void;
  children: string;
}) {
  const [enFoco, setEnFoco] = useState(false);
  const colores = coloresDe(variante, deshabilitado);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: deshabilitado }}
      accessibilityHint={pista}
      onPress={() => {
        if (!deshabilitado) alTocar?.();
      }}
      onFocus={() => setEnFoco(true)}
      onBlur={() => setEnFoco(false)}
      style={({ pressed }) => [
        estilos.boton,
        variante === 'texto' && estilos.botonDeTexto,
        { backgroundColor: pressed && !deshabilitado ? colores.presionado : colores.fondo, borderColor: colores.borde },
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
