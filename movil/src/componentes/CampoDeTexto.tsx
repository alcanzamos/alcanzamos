import { useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions, type TextInputInstance, type TextInputProps } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';
import { cifras } from './Cifras';
import { IconoAtencion } from './Iconos';

// El marco de E14-SDD 5.3 que comparten los campos: la etiqueta siempre visible arriba (nunca un texto de ejemplo
// dentro de la caja), la caja de 48 dp, la ayuda y, en error, el ícono de Atención con un texto que dice qué falta.
// `enFoco` pinta el borde de foco; el error pinta el borde de Atención (E14-SDD 5.3). La etiqueta y el error se ven,
// pero TalkBack no los lee aparte: el control de adentro los lleva en su nombre y los dice al recibir el foco (ACC-004,
// bugs 226 y 227), así no se leen dos veces. Una región viva aquí la aplana React Native y no se oye.
export function MarcoDeCampo({
  etiqueta,
  ayuda,
  error,
  enFoco = false,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  error?: string;
  enFoco?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={estilos.campo}>
      {/* El nombre lo da el control: así el lector no lo dice dos veces. */}
      <Text importantForAccessibility="no" style={estilos.etiqueta}>
        {etiqueta}
      </Text>
      <View style={[estilos.caja, enFoco && estilos.cajaEnFoco, error !== undefined && estilos.cajaConError]}>
        {children}
      </View>
      {ayuda && <Text style={estilos.ayuda}>{cifras(ayuda)}</Text>}
      {error && (
        <View style={estilos.error}>
          <IconoAtencion color={tokens.color.estado.atencion.icono} />
          <Text importantForAccessibility="no" style={estilos.textoDeError}>
            {cifras(error)}
          </Text>
        </View>
      )}
    </View>
  );
}

/** El nombre accesible de un control con su error: «Monto, Falta el monto.»; sin error, solo la etiqueta. */
export const nombreConError = (...partes: (string | undefined)[]) => partes.filter(Boolean).join(', ');

// Un campo de solo lectura en el marco de 5.3 («Empieza el» de PN-03): TalkBack lee la etiqueta junto con el valor,
// como un solo elemento (ACC-004, bug 227), y el error si lo hay (bug 226).
export function CampoDeLectura({ etiqueta, valor, error }: { etiqueta: string; valor: string; error?: string }) {
  return (
    <MarcoDeCampo etiqueta={etiqueta} error={error}>
      <Text
        accessible
        accessibilityLabel={nombreConError(etiqueta, valor, error)}
        accessibilityHint={undefined}
        style={estilos.lectura}
      >
        {cifras(valor)}
      </Text>
    </MarcoDeCampo>
  );
}

export type PropiedadesDeCampo = {
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
  ayuda?: string;
  error?: string;
  /** El propósito para el autocompletado de Android (`email`, `name`, `new-password`, `current-password`). */
  autocompletar?: TextInputProps['autoComplete'];
  teclado?: KeyboardTypeOptions;
  /** El valor es una cifra: va en Figtree con cifras tabulares (`tipografia.cifra`, D-123). */
  cifra?: boolean;
  maxLength?: number;
  /** Un campo de varias líneas con ese mínimo de líneas (el cuadro de lenguaje natural, E14-PPN 3.1 fila 3). */
  lineas?: number;
  /** La persona entra al campo (recibe el foco de edición). */
  alEntrar?: () => void;
  /** La persona sale del campo (se pierde el foco). */
  alSalir?: () => void;
  ref?: Ref<TextInputInstance>;
};

// Campo de texto de E14-SDD 5.3. `accion` es el botón al final de la caja (Ver u Ocultar en la contraseña); `prefijo`,
// un texto fijo antes del valor (el «$» del monto) que TalkBack no lee.
// El nombre es el texto de ejemplo, transparente: la etiqueta, y el error si lo hay («Monto, Falta el monto.»). Es lo
// que se oyó en el celular (ACC-004, sesión 4): vacío, TalkBack lee el texto de ejemplo («Monto, Falta el monto.,
// Editar casilla»); lleno, lee el valor y después el texto de ejemplo («15000, Editar casilla, Monto»; bug 227). Sin
// `accessibilityLabel`: con el campo vacío, el contentDescription taparía el texto de ejemplo o haría decir la etiqueta
// dos veces, y con el campo lleno TalkBack no lo leía. Sin `accessibilityLabelledBy`: TalkBack no lo leyó.
export function CampoDeTexto({
  etiqueta,
  valor,
  alCambiar,
  ayuda,
  error,
  autocompletar,
  teclado,
  cifra = false,
  maxLength,
  lineas,
  alEntrar,
  alSalir,
  ref,
  textoSeguro = false,
  accion,
  prefijo,
}: PropiedadesDeCampo & { textoSeguro?: boolean; accion?: ReactNode; prefijo?: string }) {
  const [enFoco, setEnFoco] = useState(false);
  return (
    <MarcoDeCampo etiqueta={etiqueta} ayuda={ayuda} error={error} enFoco={enFoco}>
      {prefijo && (
        <Text importantForAccessibility="no" style={[estilos.prefijo, cifra && estilos.cifra]}>
          {prefijo}
        </Text>
      )}
      {/* El nombre es el texto de ejemplo (ACC-004): un accessibilityLabel lo taparía con el campo vacío. */}
      {/* eslint-disable-next-line react-native-a11y/has-valid-accessibility-descriptors */}
      <TextInput
        ref={ref}
        value={valor}
        onChangeText={alCambiar}
        onFocus={() => {
          setEnFoco(true);
          alEntrar?.();
        }}
        onBlur={() => {
          setEnFoco(false);
          alSalir?.();
        }}
        placeholder={nombreConError(etiqueta, error)}
        placeholderTextColor="transparent"
        accessibilityHint={ayuda}
        autoComplete={autocompletar}
        importantForAutofill="yes"
        keyboardType={teclado}
        maxLength={maxLength}
        multiline={lineas !== undefined}
        numberOfLines={lineas}
        secureTextEntry={textoSeguro}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          estilos.entrada,
          cifra && estilos.cifra,
          lineas !== undefined && estilos.variasLineas,
          prefijo !== undefined && estilos.conPrefijo,
        ]}
      />
      {accion}
    </MarcoDeCampo>
  );
}

const estilos = StyleSheet.create({
  campo: { gap: tokens.espacio['1'] },
  etiqueta: { ...estiloDeTipografia('etiqueta'), color: tokens.color.texto.principal },
  caja: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: tokens.tamano['tactil-minimo'],
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.campo,
    borderRadius: tokens.radio.pequeno,
    backgroundColor: tokens.color.fondo.superficie,
  },
  cajaEnFoco: { borderWidth: tokens['ancho-borde'].grueso, borderColor: tokens.color.borde.foco },
  cajaConError: { borderWidth: tokens['ancho-borde'].grueso, borderColor: tokens.color.estado.atencion.borde },
  entrada: {
    ...estiloDeTipografia('cuerpo'),
    flex: 1,
    minWidth: 0,
    minHeight: tokens.tamano['tactil-minimo'],
    paddingHorizontal: tokens.espacio['3'],
    color: tokens.color.texto.principal,
  },
  // Alto mínimo de 96 dp, dos veces `espacio.12` (E14-PPN 3.1, fila 3): el texto empieza arriba y la caja crece con él.
  variasLineas: { minHeight: tokens.espacio['12'] * 2, textAlignVertical: 'top', paddingVertical: tokens.espacio['3'] },
  cifra: { ...estiloDeTipografia('cifra'), fontVariant: ['tabular-nums'] },
  // El prefijo va pegado al valor: la caja le da el margen de la izquierda y el campo no repite el suyo.
  prefijo: { ...estiloDeTipografia('cuerpo'), paddingLeft: tokens.espacio['3'], color: tokens.color.texto.principal },
  conPrefijo: { paddingLeft: tokens.espacio['1'] },
  lectura: {
    ...estiloDeTipografia('cuerpo'),
    flex: 1,
    paddingHorizontal: tokens.espacio['3'],
    paddingVertical: tokens.espacio['3'],
    color: tokens.color.texto.principal,
  },
  ayuda: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.espacio['2'] },
  textoDeError: { ...estiloDeTipografia('pequeno'), flex: 1, color: tokens.color.estado.atencion.texto },
});
