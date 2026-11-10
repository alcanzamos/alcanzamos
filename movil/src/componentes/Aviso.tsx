import type { ComponentType, Ref } from 'react';
import { StyleSheet, Text, View, type HostInstance } from 'react-native';
import { useAnuncio } from '../anuncios';
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

// Aviso de E14-SDD 5.4: ícono + título + mensaje, un solo elemento para el lector de pantalla. Es un mensaje de estado:
// TalkBack lo anuncia cuando aparece y cada vez que cambia, sin mover el foco, por la región viva de la pantalla o de la
// hoja (`useAnuncio`, ACC-004, bug 225; en `src/anuncios.ts` está por qué el aviso no lleva una región viva propia).
// Con `viva` en falso es contenido fijo de la pantalla («Vas a borrar tu cuenta») y no se anuncia: se lee al
// recorrerla. Con `tituloHablado` (un título con un monto, ACC-004) el nombre del elemento y el anuncio son ese título
// más el mensaje, para que TalkBack diga los pesos y no «$». `ref` es para llevarle el foco de TalkBack cuando el aviso
// es un error del formulario (la repetición en Registrar, `avisarErrores`).
export function Aviso({
  tipo,
  titulo,
  tituloHablado,
  mensaje,
  viva = true,
  ref,
}: DatosDeAviso & { viva?: boolean; ref?: Ref<HostInstance> }) {
  const Icono = iconos[tipo];
  const estado = tokens.color.estado[tipo];
  const hablado = textoHablado({ tipo, titulo, tituloHablado, mensaje });
  useAnuncio(viva ? hablado : undefined);
  return (
    <View
      ref={ref}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={tituloHablado && hablado}
      accessibilityHint={undefined}
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

/** Lo que TalkBack dice de un aviso: el título (hablado, si tiene un monto) y el mensaje. */
export const textoHablado = ({ titulo, tituloHablado, mensaje }: DatosDeAviso) =>
  [tituloHablado ?? titulo, mensaje].filter(Boolean).join(' ');

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
