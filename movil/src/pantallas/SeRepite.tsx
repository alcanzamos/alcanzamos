import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PERIODICIDADES, obtenerProximas } from '../api/registro';
import { cambiarBorrador, useBorrador } from '../borradorDeRegistro';
import { Aviso } from '../componentes/Aviso';
import { Boton } from '../componentes/Boton';
import { MarcoDeCampo } from '../componentes/CampoDeTexto';
import { ChipsDeEleccion } from '../componentes/ChipsDeEleccion';
import { cifras } from '../componentes/Cifras';
import { Pantalla } from '../componentes/Pantalla';
import { Nota, Texto } from '../componentes/Texto';
import { Tarjeta } from '../componentes/Tarjeta';
import { diaEnPalabras, esFechaDeMovimiento, hoyEnColombia } from '../fechas';
import { estiloDeTipografia } from '../fuentes';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import type { Rutas } from '../navegacion/rutas';
import {
  avisoDeFallo,
  avisos,
  etiquetasDePeriodicidad,
  explicacionesDePeriodicidad,
  type DatosDeAviso,
  type OpcionDePeriodicidad,
} from '../textos';
import { textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';

const p = textos.periodicidad;
const NO_SE_REPITE = 'no_se_repite';

// En el orden de la tabla de E14-PRR 4.3 (fila 3): «No se repite» y las cinco periodicidades de RF-006.
const OPCIONES: OpcionDePeriodicidad[] = [NO_SE_REPITE, ...PERIODICIDADES];

// Lo que respondió el API para una periodicidad y una fecha de inicio; `clave` dice a cuál pedido corresponde, para no
// mostrar las fechas de una elección anterior mientras llegan las de la nueva.
type Resultado =
  | { clave: string; fase: 'listo'; fechas: string[] }
  | { clave: string; fase: 'error'; aviso: DatosDeAviso };

// PN-03 · «Se repite», variante Android (E14-PRR 4.3): pantalla apilada sobre el formulario, sin «Dejar de repetir»
// (solo aplica a un movimiento que ya se repite, US-52). Las próximas fechas las calcula el API (E15 5.2, E17-ECO 4.7,
// D-165): la pantalla manda la periodicidad y «Empieza el», y muestra lo que recibe. Si el API falla, «Listo» sigue
// sirviendo. El Atrás vuelve al formulario sin cambiar nada: solo «Listo» guarda la elección en el borrador.
export function SeRepite({ navigation }: NativeStackScreenProps<Rutas, 'SeRepite'>) {
  const borrador = useBorrador();
  const [elegida, setElegida] = useState<OpcionDePeriodicidad>(borrador.periodicidad ?? NO_SE_REPITE);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [intento, setIntento] = useState(0);

  // «Empieza el» es la fecha del formulario.
  const inicio = borrador.fecha ?? hoyEnColombia();
  const periodicidad = elegida === NO_SE_REPITE ? null : elegida;
  const clave = periodicidad && esFechaDeMovimiento(inicio) ? `${intento} ${periodicidad} ${inicio}` : null;

  useEffect(() => {
    if (!periodicidad || !clave) return;
    let vigente = true;
    void obtenerProximas(periodicidad, inicio).then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) {
        const fechas = respuesta.cuerpo.proximas;
        const validas = Array.isArray(fechas) && fechas.every((f) => diaEnPalabras(f));
        setResultado(
          validas
            ? { clave, fase: 'listo', fechas }
            : { clave, fase: 'error', aviso: avisos.errorAlCargarInformacion },
        );
      } else if (!seguirPorAccesoNegado(navigation, respuesta)) {
        setResultado({ clave, fase: 'error', aviso: avisoDeFallo(respuesta, avisos.errorAlCargarInformacion) });
      }
    });
    return () => {
      vigente = false;
    };
  }, [periodicidad, inicio, clave, navigation]);

  const actual = resultado?.clave === clave ? resultado : null;

  return (
    <Pantalla conBarra>
      <Texto>{p.intro}</Texto>
      <ChipsDeEleccion
        etiqueta={p.etiqueta}
        opciones={OPCIONES.map((valor) => ({ valor, etiqueta: etiquetasDePeriodicidad[valor] }))}
        valor={elegida}
        alElegir={setElegida}
      />
      <Nota>{explicacionesDePeriodicidad[elegida]}</Nota>
      {periodicidad && (
        <>
          <MarcoDeCampo etiqueta={p.empiezaEl}>
            <Text style={estilos.fecha}>{cifras(diaEnPalabras(inicio) ?? '')}</Text>
          </MarcoDeCampo>
          <Tarjeta titulo={p.proximas}>
            <View accessibilityState={{ busy: clave !== null && actual === null }}>
              {clave !== null && actual === null && <ActivityIndicator color={tokens.color.fondo.marca} />}
              {clave === null && <Texto>{p.sinProximas}</Texto>}
              {actual?.fase === 'listo' &&
                (actual.fechas.length > 0 ? (
                  actual.fechas.map((fecha) => <Texto key={fecha}>{diaEnPalabras(fecha) ?? ''}</Texto>)
                ) : (
                  <Texto>{p.sinProximas}</Texto>
                ))}
            </View>
            {actual?.fase === 'error' && (
              <>
                <Aviso {...actual.aviso} />
                <Boton variante="secundario" alTocar={() => setIntento(intento + 1)}>
                  {textos.acciones.intentarDeNuevo}
                </Boton>
              </>
            )}
          </Tarjeta>
          <Texto variante="ayuda">{p.aclaracion}</Texto>
        </>
      )}
      <Boton
        alTocar={() => {
          cambiarBorrador({ periodicidad });
          navigation.goBack();
        }}
      >
        {p.listo}
      </Boton>
    </Pantalla>
  );
}

const estilos = StyleSheet.create({
  fecha: {
    ...estiloDeTipografia('cuerpo'),
    flex: 1,
    paddingHorizontal: tokens.espacio['3'],
    paddingVertical: tokens.espacio['3'],
    color: tokens.color.texto.principal,
  },
});
