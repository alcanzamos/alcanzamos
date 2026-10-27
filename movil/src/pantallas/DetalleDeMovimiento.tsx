import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { borrarMovimiento } from '../api/movimientos';
import { Aviso } from '../componentes/Aviso';
import { Boton } from '../componentes/Boton';
import { cifras } from '../componentes/Cifras';
import { HojaInferior } from '../componentes/HojaInferior';
import { MarcaDePropiedad } from '../componentes/MarcaDePropiedad';
import { Pantalla } from '../componentes/Pantalla';
import { Texto } from '../componentes/Texto';
import { formatearPesos } from '../dinero';
import { hoyEnColombia } from '../fechas';
import { estiloDeTipografia } from '../fuentes';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, etiquetasDePeriodicidad, type DatosDeAviso } from '../textos';
import {
  avanceQueBaja,
  avisoDeBorrado,
  mediosEnPalabras,
  queSeBorra,
  resumenDelDetalle,
  tituloDelDia,
} from '../textosDeMovimientos';
import { textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';

const d = textos.movimientos.detalle;
const b = textos.movimientos.borrar;

// PN-02 · Detalle de un movimiento: corregir o borrar, variante Android (E14-PRR 4.2). Se abre desde una fila de PN-01 con
// el movimiento que ya trae la lista (no hay un segundo pedido). «Corregir» abre el formulario en su propia pantalla
// y borrar, una hoja inferior de confirmación. Tras corregir o borrar se vuelve a PN-01 con `popTo`: PN-02 sale de la pila
// y el Atrás no vuelve al movimiento. Sin las «Horas de vida» (RF-054), sin «Registrado por» (hogares) y sin «Cambiar
// cómo se repite» (abre PN-03 para una repetición que ya existe y el API de la US-52 no trae cómo cambiarla).
export function DetalleDeMovimiento({ navigation, route }: NativeStackScreenProps<Rutas, 'DetalleDeMovimiento'>) {
  const { movimiento: m, noExiste } = route.params;
  const [verBorrar, setVerBorrar] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const hoy = hoyEnColombia();

  async function borrar() {
    if (borrando) return;
    setBorrando(true);
    setAviso(null);
    const respuesta = await borrarMovimiento(m.id);
    setBorrando(false);
    if (respuesta.ok) {
      navigation.popTo('ListaDeMovimientos', { aviso: avisoDeBorrado(m) }, { merge: true });
      return;
    }
    if (respuesta.estado === 404) {
      setVerBorrar(false);
      navigation.setParams({ noExiste: true });
    } else if (!seguirPorAccesoNegado(navigation, respuesta)) setAviso(avisoDeFallo(respuesta, avisos.errorAlBorrar));
  }

  if (noExiste)
    return (
      <Pantalla conBarra>
        <Aviso {...avisos.movimientoNoExiste} />
        <Boton variante="secundario" alTocar={() => navigation.popTo('ListaDeMovimientos', undefined, { merge: true })}>
          {b.irAMovimientos}
        </Boton>
      </Pantalla>
    );

  const avance = avanceQueBaja(m);
  return (
    <Pantalla conBarra>
      <View style={estilos.tarjeta}>
        <Text style={estilos.monto}>{cifras(formatearPesos(BigInt(m.monto_centavos)))}</Text>
        <Texto>{resumenDelDetalle(m)}</Texto>
      </View>
      <View style={estilos.tarjeta}>
        <Dato etiqueta={d.fecha}>
          <Texto>{tituloDelDia(m.fecha, hoy)}</Texto>
        </Dato>
        <Dato etiqueta={textos.registro.medio.etiqueta}>
          <Texto>{mediosEnPalabras[m.medio]}</Texto>
        </Dato>
        <Dato etiqueta={textos.registro.quien.etiqueta}>
          <MarcaDePropiedad compartido={m.compartido} />
        </Dato>
        {m.descripcion && (
          <Dato etiqueta={d.descripcion}>
            <Texto>{m.descripcion}</Texto>
          </Dato>
        )}
      </View>
      {m.recurrente && (
        <View style={estilos.tarjeta}>
          <Dato etiqueta={textos.registro.seRepite.etiqueta}>
            <Texto>{etiquetasDePeriodicidad[m.recurrente.periodicidad]}</Texto>
          </Dato>
        </View>
      )}
      <Boton alTocar={() => navigation.navigate('CorregirMovimiento', { movimiento: m })}>{d.corregir}</Boton>
      <Boton variante="secundario" alTocar={() => setVerBorrar(true)}>
        {d.borrar}
      </Boton>
      <HojaInferior visible={verBorrar} alCerrar={() => setVerBorrar(false)}>
        <Text accessibilityRole="header" style={estilos.tituloDeHoja}>
          {b.titulo}
        </Text>
        {aviso && <Aviso {...aviso} />}
        <View style={estilos.tarjeta}>
          <Texto>{queSeBorra(m, hoy)}</Texto>
        </View>
        <Texto>{b.quePasa}</Texto>
        {avance && <Texto>{avance}</Texto>}
        {m.recurrente?.vuelve_a_pendiente && <Texto>{d.volveraPorConfirmar}</Texto>}
        <Boton variante="destructivo" deshabilitado={borrando} alTocar={() => void borrar()}>
          {b.confirmar}
        </Boton>
        <Boton variante="secundario" alTocar={() => setVerBorrar(false)}>
          {d.ahoraNo}
        </Boton>
      </HojaInferior>
    </Pantalla>
  );
}

// Una Fila de lista sin enlace (E14-SDD 5.15): la etiqueta y su valor, juntos para el lector de pantalla.
const Dato = ({ etiqueta, children }: { etiqueta: string; children: ReactNode }) => (
  <View accessible style={estilos.dato}>
    <Text style={estilos.etiqueta}>{etiqueta}</Text>
    {children}
  </View>
);

// Tarjeta de E14-SDD 5.7: blanca sobre la página, borde decorativo de 1, `radio.grande`, relleno de 16, sin sombra.
const estilos = StyleSheet.create({
  tarjeta: {
    gap: tokens.espacio['2'],
    padding: tokens.espacio['4'],
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    borderRadius: tokens.radio.grande,
    backgroundColor: tokens.color.fondo.superficie,
  },
  monto: { ...estiloDeTipografia('cifra-grande'), color: tokens.color.texto.principal },
  dato: { gap: tokens.espacio['1'], minHeight: tokens.tamano['tactil-minimo'] },
  etiqueta: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  tituloDeHoja: { ...estiloDeTipografia('titulo-3'), color: tokens.color.texto.principal },
});
