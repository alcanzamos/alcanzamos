import { useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions, type TextInputInstance, type TextInputProps } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';
import { cifras } from './Cifras';
import { IconoAtencion } from './Iconos';

// El marco de E14-SDD 5.3 que comparten los campos: la etiqueta siempre visible arriba (nunca un texto de ejemplo
// dentro de la caja), la caja de 48 dp, la ayuda y, en error, el ícono de Atención con un texto que dice qué falta.
// `enFoco` pinta el borde de foco; el error pinta el borde de Atención (E14-SDD 5.3). El error es una región viva
// cortés: el lector de pantalla lo anuncia cuando aparece.
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
      {/* El nombre lo da accessibilityLabel del control: así el lector de pantalla no lo dice dos veces. */}
      <Text importantForAccessibility="no" style={estilos.etiqueta}>
        {etiqueta}
      </Text>
      <View style={[estilos.caja, enFoco && estilos.cajaEnFoco, error !== undefined && estilos.cajaConError]}>
        {children}
      </View>
      {ayuda && <Text style={estilos.ayuda}>{cifras(ayuda)}</Text>}
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
  /** La persona sale del campo (se pierde el foco). */
  alSalir?: () => void;
  ref?: Ref<TextInputInstance>;
};

// Campo de texto de E14-SDD 5.3. `accion` es el botón al final de la caja (Ver u Ocultar en la contraseña).
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
  alSalir,
  ref,
  textoSeguro = false,
  accion,
}: PropiedadesDeCampo & { textoSeguro?: boolean; accion?: ReactNode }) {
  const [enFoco, setEnFoco] = useState(false);
  return (
    <MarcoDeCampo etiqueta={etiqueta} ayuda={ayuda} error={error} enFoco={enFoco}>
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
        accessibilityHint={ayuda}
        autoComplete={autocompletar}
        importantForAutofill="yes"
        keyboardType={teclado}
        maxLength={maxLength}
        secureTextEntry={textoSeguro}
        autoCapitalize="none"
        autoCorrect={false}
        style={[estilos.entrada, cifra && estilos.cifra]}
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
  cifra: { ...estiloDeTipografia('cifra'), fontVariant: ['tabular-nums'] },
  ayuda: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.espacio['2'] },
  textoDeError: { ...estiloDeTipografia('pequeno'), flex: 1, color: tokens.color.estado.atencion.texto },
});
