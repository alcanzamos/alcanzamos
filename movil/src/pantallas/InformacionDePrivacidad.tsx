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

// PN-63 · Información de privacidad en el primer uso (E14-PCP 4.6): solo informa, no pide nada. Sin Atrás en la barra
// (es la única pantalla de su pila: el Atrás del sistema sale de la app) y con «Continuar» a PN-64. Sin «Leer la
// política completa»: abre PN-68, que no está construida. «Desde el menú» (PN-66) tampoco: PN-66 no existe. «Listo,
// confirmamos tu correo.» llega arriba como mensaje de estado (4.16 T11).
export function InformacionDePrivacidad({ navigation, route }: NativeStackScreenProps<Rutas, 'InformacionDePrivacidad'>) {
  return (
    <Pantalla titulo={textos.privacidad.titulo} estado={avisoDeLlegada(route.params?.llegada)}>
      <Texto>{textos.privacidad.intro}</Texto>
      {tarjetas.map(({ tarjeta, Icono }) => (
        <Tarjeta key={tarjeta.titulo} titulo={tarjeta.titulo} Icono={Icono}>
          <Texto>{tarjeta.cuerpo}</Texto>
        </Tarjeta>
      ))}
      <Boton alTocar={() => navigation.navigate('AutorizacionDeDatos')}>{textos.privacidad.continuar}</Boton>
    </Pantalla>
  );
}
