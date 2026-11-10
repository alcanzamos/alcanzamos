import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { hoyEnColombia } from '../fechas';
import { AutorizacionDeDatos } from '../pantallas/AutorizacionDeDatos';
import { BorrarCuenta } from '../pantallas/BorrarCuenta';
import { CambiarContrasena } from '../pantallas/CambiarContrasena';
import { ConfirmarTodos } from '../pantallas/ConfirmarTodos';
import { CrearCuenta } from '../pantallas/CrearCuenta';
import { DetalleDeMovimiento } from '../pantallas/DetalleDeMovimiento';
import { Edad } from '../pantallas/Edad';
import { Entrar } from '../pantallas/Entrar';
import { InformacionDePrivacidad } from '../pantallas/InformacionDePrivacidad';
import { Movimientos } from '../pantallas/Movimientos';
import { Presupuesto } from '../pantallas/Presupuesto';
import { RecuperarAcceso } from '../pantallas/RecuperarAcceso';
import { CorregirMovimiento, Registrar } from '../pantallas/Registrar';
import { RevisaTuCorreo } from '../pantallas/RevisaTuCorreo';
import { SeRepite } from '../pantallas/SeRepite';
import { SeguridadDeLaCuenta } from '../pantallas/SeguridadDeLaCuenta';
import { leerToken } from '../sesion/token';
import { mesEnMinuscula } from '../textosDePresupuesto';
import { formatear, textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { conBarra } from './barra';
import type { Rutas } from './rutas';

const Pila = createNativeStackNavigator<Rutas>();

// La primera pantalla: con una sesión guardada en el Keystore, PN-71 (el inicio provisional), que le pregunta al API si
// la sesión sigue valiendo y, si no, lleva a PN-60, a PN-59 o a PN-63 según el código (accesoNegado.ts).
// Sin sesión, PN-60: la edad nunca se pregunta antes de iniciar sesión (E14-PCP 3, D-090). Esta pantalla no sabe si el
// token es bueno: eso lo decide el API.
async function pantallaInicial(): Promise<keyof Rutas> {
  try {
    return (await leerToken()) ? 'SeguridadDeLaCuenta' : 'Entrar';
  } catch {
    return 'Entrar';
  }
}

// Navegación con componentes nativos (ADR-003, D-078): la pila de `@react-navigation/native-stack` usa las pantallas
// del sistema y el Atrás de Android hace lo que la persona espera (vuelve a la pantalla anterior y, en la primera,
// sale de la app). La marca de E14 va encima: fondo de página y sin barra, salvo en las pantallas que la piden
// (`conBarra`). PN-65 se apila sobre PN-60 (el Atrás del sistema vuelve a PN-60, E14-PCP 4.8); PN-58 la reemplaza; de
// PN-58 a PN-59, de PN-59 a PN-58 («Usar otro correo») o a PN-60 («Ya elegí mi contraseña», D-184), de entrar a PN-71 y de
// cerrar sesión a PN-60 se cambia con `reemplazarPila`, para que Atrás no vuelva al formulario ni a una sesión cerrada. PN-63 es la primera de su pila (sin Atrás: el del
// sistema sale de la app); PN-64 se apila sobre PN-63 (su Atrás vuelve a PN-63), y de PN-64 a PN-71 («Autorizar y continuar»)
// y a PN-60 («No autorizo») se cambia con `reemplazarPila`: Atrás no vuelve a PN-64 ni a una cuenta borrada. PN-63 desde
// el menú (con barra y sin «Continuar») se apila sobre PN-71 y su Atrás vuelve a PN-71 (bug 260). PN-61 se apila sobre PN-60. PN-62 no está: el
// enlace del correo abre la web (D-155) y la app no recibe enlaces hasta los App Links de I08. PN-01 («Movimientos») se apila
// sobre PN-71 (su Atrás vuelve a PN-71) y «Registrar» sobre PN-01 (su Atrás vuelve a PN-01 sin guardar); PN-03 se apila
// sobre «Registrar» (su Atrás vuelve al formulario). PN-02 se apila sobre PN-01 (su Atrás vuelve a PN-01) y «Corregir»
// sobre PN-02 (su Atrás vuelve a PN-02 sin guardar). «Confirmar todos» se apila sobre PN-01 (su Atrás vuelve a PN-01 sin
// guardar nada). Tras guardar, corregir o borrar se vuelve a PN-01 con `popTo` y el aviso como mensaje de estado: el
// formulario, PN-02 y «Confirmar todos» salen de la pila y el Atrás no vuelve a ellos. PN-06 («Presupuesto», que es
// también PN-07) se apila sobre PN-71 (su Atrás vuelve a PN-71) y «Registrar» sobre PN-06; al guardar, el formulario
// deja PN-01 en su lugar (D-164) y el Atrás de PN-01 vuelve a PN-06.
export function Navegacion() {
  const [inicial, setInicial] = useState<keyof Rutas | null>(null);
  useEffect(() => {
    void pantallaInicial().then(setInicial);
  }, []);
  if (inicial === null) return null;
  return (
    <NavigationContainer>
      <Pila.Navigator
        initialRouteName={inicial}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.color.fondo.pagina },
        }}
      >
        <Pila.Screen name="Entrar" component={Entrar} />
        <Pila.Screen name="Edad" component={Edad} />
        <Pila.Screen name="CrearCuenta" component={CrearCuenta} />
        <Pila.Screen name="RevisaTuCorreo" component={RevisaTuCorreo} />
        <Pila.Screen
          name="InformacionDePrivacidad"
          component={InformacionDePrivacidad}
          options={({ route }) => (route.params?.desdeElMenu ? conBarra(textos.privacidad.titulo) : {})}
        />
        <Pila.Screen
          name="AutorizacionDeDatos"
          component={AutorizacionDeDatos}
          options={conBarra(textos.autorizacion.titulo)}
        />
        <Pila.Screen
          name="SeguridadDeLaCuenta"
          component={SeguridadDeLaCuenta}
          options={conBarra(textos.seguridadDeLaCuenta.titulo)}
        />
        <Pila.Screen
          name="CambiarContrasena"
          component={CambiarContrasena}
          options={conBarra(textos.cambiarContrasena.titulo)}
        />
        <Pila.Screen
          name="BorrarCuenta"
          component={BorrarCuenta}
          options={conBarra(textos.borrarCuenta.borrarMiCuenta)}
        />
        <Pila.Screen name="RecuperarAcceso" component={RecuperarAcceso} options={conBarra(textos.recuperarAcceso.titulo)} />
        <Pila.Screen name="ListaDeMovimientos" component={Movimientos} options={conBarra(textos.movimientos.titulo)} />
        <Pila.Screen
          name="DetalleDeMovimiento"
          component={DetalleDeMovimiento}
          options={conBarra(textos.movimientos.detalle.titulo)}
        />
        <Pila.Screen
          name="CorregirMovimiento"
          component={CorregirMovimiento}
          options={conBarra(textos.movimientos.detalle.corregirTitulo)}
        />
        <Pila.Screen
          name="ConfirmarTodos"
          component={ConfirmarTodos}
          options={conBarra(textos.porConfirmar.confirmarTodos)}
        />
        <Pila.Screen
          name="PresupuestoDelMes"
          component={Presupuesto}
          // El mes de hoy en Colombia hasta que el API manda el suyo (la pantalla lo pone en la barra).
          options={() => conBarra(formatear(textos.presupuesto.titulo, { mes: mesEnMinuscula(hoyEnColombia().slice(0, 7)) }))}
        />
        <Pila.Screen name="FormularioDeRegistro" component={Registrar} options={conBarra(textos.registro.titulo)} />
        <Pila.Screen name="SeRepite" component={SeRepite} options={conBarra(textos.periodicidad.titulo)} />
      </Pila.Navigator>
    </NavigationContainer>
  );
}
