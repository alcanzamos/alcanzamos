import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { familiaCargada } from '../fuentes';

// D-123: todo número va en Figtree, también en el texto corrido, con cifras tabulares y sin ss02 (`fontVariant` solo
// pide `tabular-nums`). Parte el texto en sus números («15», «9:40») y los envuelve; el resto sigue en Atkinson.
// `destacado`: sobre texto en negrita (700) el número va en 700; sobre texto regular, en 600 (E14-SDD 5.5).
export function cifras(texto: string, destacado = false): ReactNode[] {
  return texto.split(/(\d+(?::\d+)?)/).map((trozo, i) =>
    i % 2 === 1 ? (
      <Text key={i} style={destacado ? estilos.cifraDestacada : estilos.cifra}>
        {trozo}
      </Text>
    ) : (
      trozo
    ),
  );
}

const estilos = StyleSheet.create({
  cifra: { fontFamily: familiaCargada('Figtree', '600'), fontVariant: ['tabular-nums'] },
  cifraDestacada: { fontFamily: familiaCargada('Figtree', '700'), fontVariant: ['tabular-nums'] },
});
