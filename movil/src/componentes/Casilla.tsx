import { useState, type ReactNode, type Ref } from 'react';
import { Pressable, StyleSheet, Text, View, type HostInstance } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';
import { nombreConError } from './CampoDeTexto';
import { cifras } from './Cifras';
import { IconoAtencion, IconoCheck } from './Iconos';

// Casilla de verificación de E14-SDD 5.17. Nunca viene marcada: quien la usa parte de `false`. Toda la fila, con su
// texto, es el área táctil (mínimo 48 dp). Para TalkBack es un `checkbox` con el texto como nombre y el estado
// «marcada» o «sin marcar»; con error, el error es parte del nombre («…, Falta tu autorización…») y TalkBack lo dice
// cuando la pantalla le lleva el foco al guardar (`avisarErrores` y `ref`, ACC-004, bug 226); el texto visible del error
// no se lee aparte. En la sesión del celular se oyó la casilla con su error. `deshabilitada` (la fila «No pasó» de
// «Confirmar todos», E14-PRR 4.8) no cambia al tocarla; `contenido` reemplaza el texto visible cuando la fila lleva más
// (nombre, apoyo y monto), y `texto` sigue siendo el nombre. `ayuda` es la nota que explica la casilla (la frase de los
// avisos con la app cerrada de PN-64, SC-E21-25 3.6): se ve debajo (`tipografia.pequeno`, `color.texto.secundario`) y es la
// pista de accesibilidad de la casilla, como la ayuda de un campo de texto: TalkBack la dice después del nombre y el estado.
export function Casilla({
  texto,
  ayuda,
  marcada,
  deshabilitada = false,
  contenido,
  alCambiar,
  error,
  ref,
}: {
  texto: string;
  ayuda?: string;
  marcada: boolean;
  deshabilitada?: boolean;
  contenido?: ReactNode;
  alCambiar: (marcada: boolean) => void;
  error?: string;
  ref?: Ref<HostInstance>;
}) {
  const [enFoco, setEnFoco] = useState(false);
  return (
    <View style={estilos.grupo}>
      <Pressable
        ref={ref}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: marcada, disabled: deshabilitada }}
        accessibilityLabel={nombreConError(texto, error)}
        accessibilityHint={ayuda}
        onPress={() => {
          if (!deshabilitada) alCambiar(!marcada);
        }}
        onFocus={() => setEnFoco(true)}
        onBlur={() => setEnFoco(false)}
        style={[estilos.fila, enFoco && estilos.foco]}
      >
        <View style={[estilos.caja, marcada && estilos.cajaMarcada, error !== undefined && estilos.cajaConError]}>
          {marcada && <IconoCheck color={tokens.color.accion.primaria.texto} />}
        </View>
        {contenido ?? <Text style={estilos.texto}>{cifras(texto)}</Text>}
      </Pressable>
      {error && (
        <View style={estilos.error}>
          <IconoAtencion color={tokens.color.estado.atencion.icono} />
          <Text importantForAccessibility="no" style={estilos.textoDeError}>
            {cifras(error)}
          </Text>
        </View>
      )}
      {ayuda && <Text style={estilos.ayuda}>{cifras(ayuda)}</Text>}
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
  ayuda: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
});
