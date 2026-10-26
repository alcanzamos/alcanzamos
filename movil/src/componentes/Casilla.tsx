import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';
import { cifras } from './Cifras';
import { IconoAtencion, IconoCheck } from './Iconos';

// Casilla de verificación de E14-SDD 5.17. Nunca viene marcada: quien la usa parte de `false`. Toda la fila, con su
// texto, es el área táctil (mínimo 48 dp). Para TalkBack es un `checkbox` con el texto como nombre y el estado
// «marcada» o «sin marcar»; con error, el texto del error es su pista (`accessibilityHint`) y una región viva cortés
// lo anuncia al aparecer.
export function Casilla({
  texto,
  marcada,
  alCambiar,
  error,
}: {
  texto: string;
  marcada: boolean;
  alCambiar: (marcada: boolean) => void;
  error?: string;
}) {
  const [enFoco, setEnFoco] = useState(false);
  return (
    <View style={estilos.grupo}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: marcada }}
        accessibilityLabel={texto}
        accessibilityHint={error}
        onPress={() => alCambiar(!marcada)}
        onFocus={() => setEnFoco(true)}
        onBlur={() => setEnFoco(false)}
        style={[estilos.fila, enFoco && estilos.foco]}
      >
        <View style={[estilos.caja, marcada && estilos.cajaMarcada, error !== undefined && estilos.cajaConError]}>
          {marcada && <IconoCheck color={tokens.color.accion.primaria.texto} />}
        </View>
        <Text style={estilos.texto}>{cifras(texto)}</Text>
      </Pressable>
      <View accessibilityLiveRegion="polite">
        {error && (
          <View style={estilos.error}>
            <IconoAtencion color={tokens.color.estado.atencion.icono} />
            <Text style={estilos.textoDeError}>{cifras(error)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  grupo: { gap: tokens.espacio['1'] },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espacio['2'],
    minHeight: tokens.tamano['tactil-minimo'],
    borderWidth: tokens['ancho-borde'].grueso,
    borderColor: 'transparent',
    borderRadius: tokens.radio.pequeno,
  },
  // Foco: anillo `color.borde.foco` de `ancho-borde.grueso` alrededor de la fila.
  foco: { borderColor: tokens.color.borde.foco },
  caja: {
    width: tokens.tamano.icono,
    height: tokens.tamano.icono,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.campo,
    borderRadius: tokens.radio.pequeno,
    backgroundColor: tokens.color.fondo.superficie,
  },
  cajaMarcada: { backgroundColor: tokens.color.accion.primaria.fondo, borderColor: tokens.color.accion.primaria.fondo },
  cajaConError: { borderWidth: tokens['ancho-borde'].grueso, borderColor: tokens.color.estado.atencion.borde },
  texto: { ...estiloDeTipografia('cuerpo'), flex: 1, color: tokens.color.texto.principal },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.espacio['2'] },
  textoDeError: { ...estiloDeTipografia('pequeno'), flex: 1, color: tokens.color.estado.atencion.texto },
});
