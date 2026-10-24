import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { estiloDeTipografia } from '../fuentes';
import { tokens } from '../tokens/tokens.generated';

/**
 * La Barra superior de E14-SDD 5.10 sobre la barra nativa de la pila: el título en `tipografia.titulo-2`, fondo de
 * página y sin sombra. El Atrás es el del sistema (ícono y nombre accesible nativos); el Atrás de Android hace lo mismo.
 */
export function conBarra(titulo: string): NativeStackNavigationOptions {
  const { fontFamily, fontSize } = estiloDeTipografia('titulo-2');
  return {
    headerShown: true,
    title: titulo,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: tokens.color.fondo.pagina },
    headerTintColor: tokens.color.texto.principal,
    headerTitleStyle: { fontFamily, fontSize, color: tokens.color.texto.principal },
  };
}
