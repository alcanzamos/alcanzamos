import { StyleSheet, Text, View } from 'react-native';
import { Logo } from '../componentes/Logo';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';

// PN-60 · Iniciar sesión: pantalla provisional de la base (A1). Solo el logo y el título de E14-PCP 4.3; PN-60 de
// verdad llega en la rama de sesión (A4). No hace ningún pedido.
export function Entrar() {
  return (
    <View style={estilos.pantalla}>
      <Logo />
      <Text accessibilityRole="header" style={estilos.titulo}>
        Inicia sesión
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: {
    flex: 1,
    gap: tokens.espacio['6'],
    padding: tokens.espacio['6'],
    backgroundColor: tokens.color.fondo.pagina,
  },
  titulo: {
    ...estiloDeTipografia('titulo-2'),
    color: tokens.color.texto.principal,
  },
});
