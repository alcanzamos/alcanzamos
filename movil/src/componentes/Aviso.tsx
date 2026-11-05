import type { ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { estiloDeTipografia } from '../fuentes';
import type { DatosDeAviso, TipoAviso } from '../textos';
import { tokens } from '../tokens/tokens.generated';
import { cifras } from './Cifras';
import { IconoAtencion, IconoInformacion, IconoLogro } from './Iconos';

const iconos: Record<TipoAviso, ComponentType<{ color: string }>> = {
  informacion: IconoInformacion,
  atencion: IconoAtencion,
  logro: IconoLogro,
};

// Aviso de E14-SDD 5.4: ícono + título + mensaje, un solo elemento para el lector de pantalla. Es una región viva
// cortés (`accessibilityLiveRegion="polite"`): lo que aparece o cambia se anuncia sin mover el foco. Con `viva` en
// falso no lo es: lo envuelve quien ya lo es (MensajeDeEstado). Con `tituloHablado` (un título con un monto, ACC-004) el
// nombre del elemento es ese título más el mensaje, para que TalkBack diga los pesos y no «$».
export function Aviso({ tipo, titulo, tituloHablado, mensaje, viva = true }: DatosDeAviso & { viva?: boolean }) {
  const Icono = iconos[tipo];
  const estado = tokens.color.estado[tipo];
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={tituloHablado && [tituloHablado, mensaje].filter(Boolean).join(' ')}
      accessibilityHint={undefined}
      accessibilityLiveRegion={viva ? 'polite' : 'none'}
      style={[estilos.aviso, { backgroundColor: estado.fondo }]}
    >
      <Icono color={estado.icono} />
      <View style={estilos.texto}>
        <Text style={[estilos.titulo, { color: estado.texto }]}>{cifras(titulo, true)}</Text>
        {mensaje && <Text style={estilos.mensaje}>{cifras(mensaje)}</Text>}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.espacio['3'],
    padding: tokens.espacio['4'],
    borderRadius: tokens.radio.grande,
  },
  texto: { flex: 1 },
  titulo: estiloDeTipografia('cuerpo-destacado'),
  mensaje: { ...estiloDeTipografia('cuerpo'), color: tokens.color.texto.principal },
});
