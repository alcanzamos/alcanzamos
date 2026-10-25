import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { archivosDeFuentes } from './src/fuentes';
import { Navegacion } from './src/navegacion/Navegacion';
import { textosDeArranque } from './src/textos';
import { tokens } from './src/tokens/tokens.generated';

export default function App() {
  const [cargadas, error] = useFonts(archivosDeFuentes);

  // El detalle técnico va solo al registro, nunca a la pantalla (D-163).
  useEffect(() => {
    if (error) console.error('[App] No se cargaron las fuentes:', error);
  }, [error]);

  if (error) {
    return (
      <View style={estilos.centro}>
        <Text style={estilos.mensaje}>{textosDeArranque.noAbrio}</Text>
      </View>
    );
  }
  if (!cargadas) {
    return (
      <View style={estilos.centro}>
        <ActivityIndicator size="large" color={tokens.color.fondo.marca} />
        <Text style={estilos.mensaje}>{textosDeArranque.cargando}</Text>
      </View>
    );
  }
  return (
    <>
      <Navegacion />
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
