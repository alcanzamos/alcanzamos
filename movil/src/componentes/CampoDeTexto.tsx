import { useId, useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions, type TextInputInstance, type TextInputProps } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';
import { cifras } from './Cifras';
import { IconoAtencion } from './Iconos';

// El marco de E14-SDD 5.3 que comparten los campos: la etiqueta siempre visible arriba (nunca un texto de ejemplo
// dentro de la caja), la caja de 48 dp, la ayuda y, en error, el ícono de Atención con un texto que dice qué falta.
// `enFoco` pinta el borde de foco; el error pinta el borde de Atención (E14-SDD 5.3). El error lo anuncia la pantalla
// al guardar, con `avisarErrores` (ACC-004, bug 226): una región viva aquí la aplana React Native y no se oye.
// `idDeEtiqueta` es el `nativeID` de la etiqueta, para que el control se nombre con ella (`accessibilityLabelledBy`).
export function MarcoDeCampo({
  etiqueta,
  idDeEtiqueta,
  ayuda,
  error,
  enFoco = false,
  children,
}: {
  etiqueta: string;
  idDeEtiqueta?: string;
  ayuda?: string;
  error?: string;
  enFoco?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={estilos.campo}>
      {/* El nombre lo da el control (accessibilityLabel y accessibilityLabelledBy): así el lector no lo dice dos veces. */}
      <Text nativeID={idDeEtiqueta} importantForAccessibility="no" style={estilos.etiqueta}>
        {etiqueta}
      </Text>
      <View style={[estilos.caja, enFoco && estilos.cajaEnFoco, error !== undefined && estilos.cajaConError]}>
        {children}
      </View>
      {ayuda && <Text style={estilos.ayuda}>{cifras(ayuda)}</Text>}
      {error && (
        <View style={estilos.error}>
          <IconoAtencion color={tokens.color.estado.atencion.icono} />
          <Text style={estilos.textoDeError}>{cifras(error)}</Text>
        </View>
      )}
    </View>
  );
}

// Un campo de solo lectura en el marco de 5.3 («Empieza el» de PN-03): TalkBack lee la etiqueta junto con el valor,
// como un solo elemento (ACC-004, bug 227).
export function CampoDeLectura({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <MarcoDeCampo etiqueta={etiqueta}>
      <Text
        accessible
        accessibilityLabel={[etiqueta, valor].join(', ')}
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
  /** La persona sale del campo (se pierde el foco). */
  alSalir?: () => void;
  ref?: Ref<TextInputInstance>;
};

// Campo de texto de E14-SDD 5.3. `accion` es el botón al final de la caja (Ver u Ocultar en la contraseña).
// El nombre va dos veces a propósito (ACC-004, bug 227): con el campo lleno, TalkBack lee el valor del EditText y no su
// `accessibilityLabel` (contentDescription), pero sí la etiqueta a la que apunta `accessibilityLabelledBy` (labeledBy).
// Vacío, el `accessibilityLabel` es el que ya se oía bien en el celular.
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
  alSalir,
  ref,
  textoSeguro = false,
  accion,
}: PropiedadesDeCampo & { textoSeguro?: boolean; accion?: ReactNode }) {
  const [enFoco, setEnFoco] = useState(false);
  const idDeEtiqueta = useId();
  return (
    <MarcoDeCampo etiqueta={etiqueta} idDeEtiqueta={idDeEtiqueta} ayuda={ayuda} error={error} enFoco={enFoco}>
      <TextInput
        ref={ref}
        value={valor}
        onChangeText={alCambiar}
        onFocus={() => setEnFoco(true)}
        onBlur={() => {
          setEnFoco(false);
          alSalir?.();
        }}
        accessibilityLabel={etiqueta}
        accessibilityLabelledBy={idDeEtiqueta}
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
        style={[estilos.entrada, cifra && estilos.cifra, lineas !== undefined && estilos.variasLineas]}
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
