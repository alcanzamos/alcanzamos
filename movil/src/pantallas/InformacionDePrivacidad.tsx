import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ComponentType } from 'react';
import { Boton } from '../componentes/Boton';
import { IconoInformacion, IconoPropio } from '../componentes/Iconos';
import { Pantalla } from '../componentes/Pantalla';
import { Tarjeta } from '../componentes/Tarjeta';
import { Texto } from '../componentes/Texto';
import { avisoDeLlegada } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { textos } from '../textos/es.generated';

const t = textos.privacidad.tarjetas;

// Las ocho tarjetas, en el orden de E14-PCP 4.6 (filas 3 a 9 b); la de «Lo tuyo es solo tuyo» lleva el ícono Propio
// (E14-SDD 5.16) y la de «Cuida lo que escribes», el de Información.
const tarjetas: { tarjeta: { titulo: string; cuerpo: string }; Icono?: ComponentType<{ color: string }> }[] = [
  { tarjeta: t.queGuardamos },
  { tarjeta: t.paraQue },
  { tarjeta: t.loTuyo, Icono: IconoPropio },
  { tarjeta: t.avisos },
  { tarjeta: t.cuidado, Icono: IconoInformacion },
  { tarjeta: t.derechos },
  { tarjeta: t.quienResponde },
  { tarjeta: t.dondeSeGuardan },
];

// PN-63 · Información de privacidad (E14-PCP 4.6): solo informa, no pide nada. Dos modos, una pantalla:
// - primer uso: sin barra ni Atrás (es la única pantalla de su pila: el Atrás del sistema sale de la app) y con
//   «Continuar» a PN-64; «Listo, confirmamos tu correo.» llega arriba como mensaje de estado (4.16 T11);
// - desde el menú (`desdeElMenu`): la barra nativa con el título y el Atrás (Navegacion.tsx), sin «Continuar». Mientras
//   no exista PN-66, se abre con la entrada provisional «Cómo cuidamos tus datos» de PN-71 (nota del 2026-11-08 de 4.14,
//   bug 260).
// Sin «Leer la política completa»: abre PN-68, que no está construida.
export function InformacionDePrivacidad({ navigation, route }: NativeStackScreenProps<Rutas, 'InformacionDePrivacidad'>) {
  if (route.params?.desdeElMenu)
    return (
      <Pantalla conBarra>
        <Contenido />
      </Pantalla>
    );
  return (
    <Pantalla titulo={textos.privacidad.titulo} estado={avisoDeLlegada(route.params?.llegada)}>
      <Contenido />
      <Boton alTocar={() => navigation.navigate('AutorizacionDeDatos')}>{textos.privacidad.continuar}</Boton>
    </Pantalla>
  );
}

// La frase de entrada y las tarjetas, iguales en los dos modos.
function Contenido() {
  return (
    <>
      <Texto>{textos.privacidad.intro}</Texto>
      {tarjetas.map(({ tarjeta, Icono }) => (
        <Tarjeta key={tarjeta.titulo} titulo={tarjeta.titulo} Icono={Icono}>
          <Texto>{tarjeta.cuerpo}</Texto>
        </Tarjeta>
      ))}
    </>
  );
}
