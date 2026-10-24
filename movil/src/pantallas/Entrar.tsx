import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Boton } from '../componentes/Boton';
import { Pantalla } from '../componentes/Pantalla';
import type { Rutas } from '../navegacion/rutas';

// PN-60 · Iniciar sesión: pantalla provisional de las ramas A1 a A3. El título y «Crear una cuenta» (que abre PN-65,
// el único camino a esa pantalla, E14-PCP 4.3) son de E14; PN-60 de verdad llega en la rama de sesión (A4).
export function Entrar({ navigation }: NativeStackScreenProps<Rutas, 'Entrar'>) {
  return (
    <Pantalla conLogo titulo="Inicia sesión">
      <Boton variante="secundario" alTocar={() => navigation.navigate('Edad')}>
        Crear una cuenta
      </Boton>
    </Pantalla>
  );
}
