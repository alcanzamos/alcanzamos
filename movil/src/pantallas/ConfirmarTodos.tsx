import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fechasPorConfirmar, listarIngresos } from '../api/presupuesto';
import { decidir, listarPendientes, type Decision, type FechaPorConfirmar } from '../api/repeticiones';
import { useAnuncio } from '../anuncios';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { Casilla } from '../componentes/Casilla';
import { cifras } from '../componentes/Cifras';
import { Pantalla } from '../componentes/Pantalla';
import { Texto } from '../componentes/Texto';
import { formatearPesos } from '../dinero';
import { estiloDeTipografia } from '../fuentes';
import { montoHablado } from '../montoHablado';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, type DatosDeAviso } from '../textos';
import { avisoDeGuardado, avisosDePorConfirmar, textosDeFilaPorConfirmar } from '../textosDePorConfirmar';
import { formatear, plural, textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { HojaDeMas, HojaDeMonto } from './HojasDeFecha';
import { claveDe } from './PorConfirmar';

const t = textos.porConfirmar;

/** Lo que la persona hizo con una fila; lo que no tocó viene marcada, con el monto habitual (D-093). */
type Eleccion = { marcada: boolean; monto: bigint | null; omitida: boolean };
const INICIAL: Eleccion = { marcada: true, monto: null, omitida: false };

// «Confirmar todos» (E14-PRR 4.8, D-093), variante Android: una pantalla de la pila con «Guardar» fijo al pie. Todo viene
// marcado y no se guarda nada hasta «Guardar»; el Atrás del sistema vuelve a la pantalla que la abrió (PN-01 o PN-08) y
// descarta lo cambiado. Solo viajan las filas marcadas y las «No pasó»: lo desmarcado sigue pendiente. El API lo guarda
// todo o nada (una sola transacción).
export function ConfirmarTodos({ navigation, route }: NativeStackScreenProps<Rutas, 'ConfirmarTodos'>) {
  const { pendientes } = route.params.pendientes;
  const periodoDeIngresos = route.params.periodoDeIngresos;
  const [elecciones, setElecciones] = useState<Record<string, Eleccion>>({});
  const [hoja, setHoja] = useState<{ tipo: 'mas' | 'monto'; fila: FechaPorConfirmar } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<DatosDeAviso | null>(null);
  const margenes = useSafeAreaInsets();

  const de = (fila: FechaPorConfirmar) => elecciones[claveDe(fila)] ?? INICIAL;
  const cambiar = (fila: FechaPorConfirmar, cambios: Partial<Eleccion>) =>
    setElecciones({ ...elecciones, [claveDe(fila)]: { ...de(fila), ...cambios } });

  const marcados = pendientes.filter((f) => de(f).marcada && !de(f).omitida);
  const omitidas = pendientes.filter((f) => de(f).omitida);
  const nadaQueGuardar = marcados.length === 0 && omitidas.length === 0;
  const recuento = formatear(t.todos.marcados, { marcados: String(marcados.length), total: String(pendientes.length) });
  // ACC-004 (bug 225): al marcar, desmarcar o «No pasó», TalkBack anuncia el recuento nuevo; al abrir no hace falta.
  useAnuncio(recuento, { alAparecer: false });
  const textoDeGuardar =
    marcados.length === 0 && omitidas.length > 0 ? t.todos.guardarSoloNoPaso : plural(t.todos.guardar, marcados.length);

  async function guardar() {
    if (guardando || nadaQueGuardar) return;
    const decisiones: Decision[] = pendientes.flatMap((fila) => {
      const eleccion = de(fila);
      const base = { recurrenteId: fila.recurrente_id, fecha: fila.fecha };
      if (eleccion.omitida) return [{ ...base, omitida: true }];
      if (!eleccion.marcada) return [];
      return [eleccion.monto === null ? base : { ...base, montoCentavos: eleccion.monto }];
    });
    setGuardando(true);
    setError(null);
    const respuesta = await decidir(decisiones);
    setGuardando(false);
    if (respuesta.ok) {
      const { guardados, omitidas: noPaso } = respuesta.cuerpo.resumen;
      // Vuelve con el aviso a PN-01 o a PN-08: «Confirmar todos» sale de la pila y la pantalla pide lo suyo otra vez al
      // recibir el foco.
      const aviso = avisoDeGuardado(guardados, noPaso);
      if (periodoDeIngresos) navigation.popTo('IngresosDelPeriodo', { aviso }, { merge: true });
      else navigation.popTo('ListaDeMovimientos', { aviso }, { merge: true });
      return;
    }
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
    // La lista y lo marcado se conservan; con un 409 se piden las fechas de nuevo y lo que siga pendiente sigue como estaba.
    setError(avisoDeFallo(respuesta, avisosDePorConfirmar.errorAlGuardar));
    if (respuesta.estado === 409 && periodoDeIngresos) {
      const actuales = await listarIngresos(periodoDeIngresos);
      if (actuales.ok) navigation.setParams({ pendientes: { pendientes: fechasPorConfirmar(actuales.cuerpo) } });
    } else if (respuesta.estado === 409) {
      const actuales = await listarPendientes();
      if (actuales.ok) navigation.setParams({ pendientes: actuales.cuerpo });
    }
  }

  return (
    <View style={estilos.pantalla}>
      <Pantalla conBarra>
        <Texto>{t.todos.explicacion}</Texto>
        <Text style={estilos.ayuda}>
          {cifras(recuento)}
        </Text>
        {error && <Aviso {...error} />}
        <View style={estilos.tarjeta}>
          {pendientes.map((fila) => {
            const eleccion = de(fila);
            const tf = textosDeFilaPorConfirmar(fila);
            const centavos = eleccion.monto ?? BigInt(fila.monto_habitual_centavos);
            const monto = formatearPesos(centavos);
            const estado = eleccion.omitida
              ? t.todos.noPaso
              : !eleccion.marcada
                ? t.todos.siguePorConfirmar
                : eleccion.monto !== null
                  ? t.todos.montoCambiado
                  : null;
            return (
              <View key={claveDe(fila)} style={estilos.fila}>
                <View style={estilos.casilla}>
                  <Casilla
                    texto={[tf.principal, tf.apoyoSinMedio, estado, montoHablado(centavos)].filter(Boolean).join(', ')}
                    marcada={eleccion.marcada && !eleccion.omitida}
                    deshabilitada={eleccion.omitida}
                    alCambiar={(marcada) => cambiar(fila, { marcada })}
                    contenido={
                      <View style={estilos.datos}>
                        <View style={estilos.columna}>
                          <Text style={estilos.principal}>{cifras(tf.principal, true)}</Text>
                          <Text style={estilos.apoyo}>{cifras(tf.apoyoSinMedio)}</Text>
                          {estado && <Text style={estilos.apoyo}>{estado}</Text>}
                        </View>
                        <Text style={estilos.monto}>{cifras(monto, true)}</Text>
                      </View>
                    }
                  />
                </View>
                <BotonDeTexto nombre={tf.nombreDeMas} alTocar={() => setHoja({ tipo: 'mas', fila })}>
                  {t.mas}
                </BotonDeTexto>
              </View>
            );
          })}
        </View>
        <Texto variante="ayuda">{t.todos.aclaracion}</Texto>
      </Pantalla>
      <View style={[estilos.fijo, { paddingBottom: margenes.bottom + tokens.espacio['4'] }]}>
        <Boton deshabilitado={guardando || nadaQueGuardar} alTocar={() => void guardar()}>
          {textoDeGuardar}
        </Boton>
      </View>
      {hoja?.tipo === 'mas' && (
        <HojaDeMas
          fila={hoja.fila}
          conIncluir={de(hoja.fila).omitida}
          alCerrar={() => setHoja(null)}
          alElegir={(opcion) => {
            if (opcion === 'monto') return setHoja({ tipo: 'monto', fila: hoja.fila });
            cambiar(hoja.fila, opcion === 'no_paso' ? { omitida: true } : INICIAL);
            setHoja(null);
          }}
        />
      )}
      {hoja?.tipo === 'monto' && (
        <HojaDeMonto
          fila={hoja.fila}
          textoDelBoton={t.hoja.listo}
          alCerrar={() => setHoja(null)}
          alConfirmar={(centavos) => {
            cambiar(hoja.fila, { monto: centavos === BigInt(hoja.fila.monto_habitual_centavos) ? null : centavos });
            setHoja(null);
          }}
        />
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: tokens.color.fondo.pagina },
  ayuda: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  // Tarjeta de E14-SDD 5.7 con las filas dentro, sin título: la barra ya dice «Confirmar todos».
  tarjeta: {
    gap: tokens.espacio['2'],
    padding: tokens.espacio['4'],
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    borderRadius: tokens.radio.grande,
    backgroundColor: tokens.color.fondo.superficie,
  },
  // Una Fila de lista · Por confirmar con Casilla (E14-PRR 7.1): la casilla con el nombre, el apoyo y el monto, y «Más».
  fila: { flexDirection: 'row', alignItems: 'center', gap: tokens.espacio['2'] },
  casilla: { flex: 1 },
  datos: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: tokens.espacio['3'] },
  columna: { flex: 1, gap: tokens.espacio['1'] },
  principal: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
  apoyo: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  monto: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
  // El Botón «Guardar» fijo al pie (E14-SDD 5.14), como «Registrar» en PN-01.
  fijo: {
    padding: tokens.espacio['4'],
    borderTopWidth: tokens['ancho-borde'].fino,
    borderTopColor: tokens.color.borde.decorativo,
    backgroundColor: tokens.color.fondo.pagina,
  },
});
