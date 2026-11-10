import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { registrarRegion } from '../anuncios';
import { tokens } from '../tokens/tokens.generated';

// La región viva de una pantalla (`Pantalla`) o de una hoja (`HojaInferior`) por la que pasan los avisos de estado
// (ACC-004, bug 225; ver `src/anuncios.ts`): TalkBack dice su texto cada vez que cambia, en cola («polite», el
// `role="status"` de E14). Así funcionan las regiones vivas de Android: la vista existe desde el principio y lo que
// cambia es su contenido. En la sesión 4 del celular se oyó.
// - `collapsable={false}`: sin eso Fabric aplana una vista que solo lleva la región viva y no llega a Android.
// - Cada anuncio es un `Text` nuevo (`key`): Android avisa del cambio aunque el texto sea el mismo de antes (dos
//   gastos iguales seguidos).
// - No se ve, pero sigue en el árbol de accesibilidad. TalkBack no dice una vista que Android no considera visible
//   (`isVisibleToUser`): ni con `display: 'none'`, ni con tamaño cero, ni con opacidad cero. Por eso mide 1 × 1 dp
//   (`ancho-borde.fino`), dentro de la pantalla, recorta su contenido y el texto es transparente. Va después del
//   contenido, así que al recorrer la pantalla con el dedo sería lo último; su texto es el del último anuncio.
export function RegionDeAnuncios() {
  const [anuncio, setAnuncio] = useState({ texto: '', vez: 0 });
  useEffect(() => registrarRegion((texto) => setAnuncio((anterior) => ({ texto, vez: anterior.vez + 1 }))), []);
  return (
    <View collapsable={false} accessibilityLiveRegion="polite" style={estilos.region}>
      <Text key={anuncio.vez} style={estilos.texto}>
        {anuncio.texto}
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  region: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: tokens['ancho-borde'].fino,
    height: tokens['ancho-borde'].fino,
    overflow: 'hidden',
  },
  texto: { color: 'transparent' },
});
