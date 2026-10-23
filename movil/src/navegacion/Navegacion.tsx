import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Entrar } from '../pantallas/Entrar';
import { tokens } from '../tokens/tokens.generated';
import type { Rutas } from './rutas';

const Pila = createNativeStackNavigator<Rutas>();

// Navegación con componentes nativos (ADR-003, D-078): la pila de `@react-navigation/native-stack` usa las pantallas
// del sistema y el Atrás de Android hace lo que la persona espera (vuelve a la pantalla anterior y, en la primera,
// sale de la app). La marca de E14 va encima: fondo de página y sin barra, salvo en las pantallas que la piden.
// La primera pantalla es PN-60: la edad nunca se pregunta antes de iniciar sesión (E14-PCP 3, D-090).
export function Navegacion() {
  return (
    <NavigationContainer>
      <Pila.Navigator
        initialRouteName="Entrar"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.color.fondo.pagina },
        }}
      >
        <Pila.Screen name="Entrar" component={Entrar} />
      </Pila.Navigator>
    </NavigationContainer>
  );
}
