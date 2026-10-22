import { ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { familiaCargada, estiloDeTipografia } from './fuentes';
import { tokens } from './tokens/tokens.generated';

// Cifras inventadas: no son datos de nadie.
const montos = ['$ 1.234.567', '$ 98.000', '$ 111.111', '$ 7.080', '$ 10.001'];
const ceros = '0 10 100 2030';

type Variante = TextStyle['fontVariant'];

const cifra = estiloDeTipografia('cifra');
const textoAtkinson: TextStyle = {
  ...estiloDeTipografia('cuerpo'),
  color: tokens.color.texto.principal,
};
const textoAtkinsonConPeso = (peso: string): TextStyle => ({
  ...textoAtkinson,
  fontFamily: familiaCargada('Atkinson Hyperlegible Next', peso),
});

function ColumnaDeMontos({ titulo, variante }: { titulo: string; variante?: Variante }) {
  return (
    <View style={estilos.columna}>
      <Text style={estilos.subtitulo}>{titulo}</Text>
      {montos.map((m) => (
        <Text key={m} style={[estilos.monto, { fontVariant: variante }]}>
          {m}
        </Text>
      ))}
    </View>
  );
}

function FilaDeCeros({ fuente, etiqueta, variante }: { fuente: TextStyle; etiqueta: string; variante?: Variante }) {
  return (
    <View style={estilos.filaCeros}>
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      <Text style={[fuente, estilos.ceros, { fontVariant: variante }]}>{ceros}</Text>
    </View>
  );
}

export function PantallaCifras() {
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.titulo}>Prueba de tipografía</Text>
      <Text style={estilos.nota}>Pantalla de prueba con cifras inventadas.</Text>

      <Text style={estilos.seccion}>a) Cifras tabulares de Figtree</Text>
      <View style={estilos.tarjeta}>
        <ColumnaDeMontos titulo="Sin tabulares" />
        <ColumnaDeMontos titulo="Con tabulares" variante={['tabular-nums']} />
      </View>

      <Text style={estilos.seccion}>b) Cero de Atkinson Hyperlegible Next</Text>
      <View style={estilos.tarjetaVertical}>
        <FilaDeCeros fuente={textoAtkinson} etiqueta="Sin fontVariant" />
        <FilaDeCeros fuente={textoAtkinson} etiqueta="tabular-nums" variante={['tabular-nums']} />
        <FilaDeCeros fuente={textoAtkinson} etiqueta="stylistic-one (ss01)" variante={['stylistic-one']} />
        <FilaDeCeros fuente={textoAtkinson} etiqueta="stylistic-two (ss02)" variante={['stylistic-two']} />
        <Text style={estilos.nota}>
          Control: Figtree sí define ss02 (cero distinto) en esta misma prueba.
        </Text>
        <FilaDeCeros fuente={cifra} etiqueta="Figtree sin variante" />
        <FilaDeCeros fuente={cifra} etiqueta="Figtree stylistic-two" variante={['stylistic-two']} />
      </View>

      <Text style={estilos.seccion}>c) Fuente cargada</Text>
      <View style={estilos.tarjetaVertical}>
        <Text style={textoAtkinsonConPeso('600')}>
          Cargadas: Figtree (600, 700) y Atkinson Hyperlegible Next (400, 600, 700).
        </Text>
        <Text style={textoAtkinsonConPeso('700')}>Este renglón está en Atkinson Hyperlegible Next, negrita.</Text>
        <Text style={[cifra, estilos.ceros]}>Este renglón está en Figtree, seminegrita.</Text>
      </View>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: tokens.color.fondo.pagina },
  contenido: { padding: tokens.espacio['4'], paddingTop: tokens.espacio['12'], gap: tokens.espacio['3'] },
  titulo: { ...estiloDeTipografia('titulo-2'), color: tokens.color.texto.principal },
  seccion: { ...estiloDeTipografia('titulo-3'), color: tokens.color.texto.marca, marginTop: tokens.espacio['4'] },
  subtitulo: { ...estiloDeTipografia('etiqueta'), color: tokens.color.texto.secundario },
  nota: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  etiqueta: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  tarjeta: {
    flexDirection: 'row',
    gap: tokens.espacio['4'],
    padding: tokens.espacio['4'],
    borderRadius: tokens.radio.medio,
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    backgroundColor: tokens.color.fondo.superficie,
  },
  tarjetaVertical: {
    gap: tokens.espacio['2'],
    padding: tokens.espacio['4'],
    borderRadius: tokens.radio.medio,
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    backgroundColor: tokens.color.fondo.superficie,
  },
  columna: { flex: 1, alignItems: 'flex-end', gap: tokens.espacio['2'] },
  monto: { ...cifra, color: tokens.color.texto.principal },
  filaCeros: { gap: tokens.espacio['1'] },
  ceros: { color: tokens.color.texto.principal, fontSize: tokens['tamano-letra']['24'], lineHeight: 32 },
});
