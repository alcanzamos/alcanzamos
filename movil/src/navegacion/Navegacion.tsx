import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CrearCuenta } from '../pantallas/CrearCuenta';
import { Edad } from '../pantallas/Edad';
import { Entrar } from '../pantallas/Entrar';
import { RevisaTuCorreo } from '../pantallas/RevisaTuCorreo';
import { SinAutorizacion } from '../pantallas/SinAutorizacion';
import { tokens } from '../tokens/tokens.generated';
import type { Rutas } from './rutas';

const Pila = createNativeStackNavigator<Rutas>();

// Navegación con componentes nativos (ADR-003, D-078): la pila de `@react-navigation/native-stack` usa las pantallas
// del sistema y el Atrás de Android hace lo que la persona espera (vuelve a la pantalla anterior y, en la primera,
// sale de la app). La marca de E14 va encima: fondo de página y sin barra, salvo en las pantallas que la piden.
// PN-65 se apila sobre PN-60 (el Atrás del sistema vuelve a PN-60, E14-PCP 4.8); PN-58 la reemplaza; de PN-58 a PN-59 y a
// la pantalla provisional se cambia con `reemplazarPila`, para que Atrás no vuelva al formulario ni a la sesión limitada.
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
        <Pila.Screen name="Edad" component={Edad} />
        <Pila.Screen name="CrearCuenta" component={CrearCuenta} />
        <Pila.Screen name="RevisaTuCorreo" component={RevisaTuCorreo} />
        <Pila.Screen name="SinAutorizacion" component={SinAutorizacion} />
      </Pila.Navigator>
    </NavigationContainer>
  );
}
