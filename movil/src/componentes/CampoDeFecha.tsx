import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import { fechaLocalEnPalabras } from '../fechas';
import { tokens } from '../tokens/tokens.generated';
import { cifras } from './Cifras';
import { IconoCalendario } from './Iconos';
import { MarcoDeCampo } from './CampoDeTexto';

// Campo de fecha de PN-65 (E14-PCP 4.8): Campo de texto con el ícono Calendario. Al tocarlo abre el selector de fecha
// nativo de Android (ADR-003, condición 1: selectores del sistema), no uno dibujado en JavaScript. No hay fecha por
// defecto ni año sugerido: el campo está vacío hasta que la persona confirma una fecha, y no se fija una fecha máxima
// ni mínima, para no dar pistas sobre la edad que se espera. El dispositivo siempre abre el diálogo en una fecha
// (la de hoy, o la última elegida): no se puede abrir «sin elegir nada».
export function CampoDeFecha({
  etiqueta,
  valor,
  texto: textoDelValor,
  alCambiar,
  ayuda,
  error,
}: {
  etiqueta: string;
  valor?: Date;
  /** Lo que dice el campo en lugar de la fecha en palabras («Hoy», E14-PPN 3.1 fila 8). */
  texto?: string;
  alCambiar: (fecha: Date) => void;
  ayuda?: string;
  error?: string;
}) {
  const [enFoco, setEnFoco] = useState(false);
  const texto = textoDelValor ?? (valor ? fechaLocalEnPalabras(valor) : undefined);
  const abrir = () =>
    DateTimePickerAndroid.open({
      value: valor ?? new Date(),
      mode: 'date',
      onValueChange: (_evento, fecha) => alCambiar(fecha),
      // Cerrar el selector sin confirmar no cambia nada: el campo sigue como estaba.
      onDismiss: () => {},
    });
  return (
    <MarcoDeCampo etiqueta={etiqueta} ayuda={ayuda} error={error} enFoco={enFoco}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={texto ? [etiqueta, texto].join(', ') : etiqueta}
        accessibilityHint={ayuda}
        onPress={abrir}
        onFocus={() => setEnFoco(true)}
        onBlur={() => setEnFoco(false)}
        style={estilos.entrada}
      >
        <Text style={estilos.texto}>{texto ? cifras(texto) : ''}</Text>
        <IconoCalendario color={tokens.color.texto.secundario} />
      </Pressable>
    </MarcoDeCampo>
  );
}

const estilos = StyleSheet.create({
  entrada: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: tokens.tamano['tactil-minimo'],
    paddingHorizontal: tokens.espacio['3'],
    gap: tokens.espacio['2'],
  },
  texto: { ...estiloDeTipografia('cuerpo'), flex: 1, color: tokens.color.texto.principal },
});
