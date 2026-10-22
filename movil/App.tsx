import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { archivosDeFuentes } from './src/fuentes';
import { PantallaCifras } from './src/PantallaCifras';
import { tokens } from './src/tokens/tokens.generated';

export default function App() {
  const [cargadas, error] = useFonts(archivosDeFuentes);

  if (error) {
    return (
      <View style={estilos.centro}>
        <Text style={estilos.mensaje}>No se pudieron cargar las fuentes: {error.message}</Text>
      </View>
    );
  }
  if (!cargadas) {
    return (
      <View style={estilos.centro}>
        <ActivityIndicator size="large" color={tokens.color.fondo.marca} />
        <Text style={estilos.mensaje}>Cargando fuentes…</Text>
      </View>
    );
  }
  return (
    <>
      <PantallaCifras />
      <StatusBar style="dark" />
    </>
  );
}

const estilos = StyleSheet.create({
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.espacio['4'],
    padding: tokens.espacio['6'],
    backgroundColor: tokens.color.fondo.pagina,
  },
  mensaje: { color: tokens.color.texto.principal, fontSize: tokens['tamano-letra']['16'] },
});
