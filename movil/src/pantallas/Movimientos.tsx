import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listarMovimientos, type Listado, type Movimiento } from '../api/movimientos';
import { reiniciarBorrador } from '../borradorDeRegistro';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { cifras } from '../componentes/Cifras';
import { ChipsDeEleccion } from '../componentes/ChipsDeEleccion';
import { HojaDeElecciones } from '../componentes/HojaDeElecciones';
import { IconoSiguiente } from '../componentes/Iconos';
import { MarcaDePropiedad } from '../componentes/MarcaDePropiedad';
import { Pantalla } from '../componentes/Pantalla';
import { Tarjeta } from '../componentes/Tarjeta';
import { Texto } from '../componentes/Texto';
import { formatearPesos } from '../dinero';
import { hoyEnColombia, mesAnterior, mesEnPalabras } from '../fechas';
import { estiloDeTipografia } from '../fuentes';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, type DatosDeAviso } from '../textos';
import { nombreDeCategoria, textosDeFila, tituloDelDia } from '../textosDeMovimientos';
import { formatear, plural, textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';

type Estado = { fase: 'cargando' } | { fase: 'error'; aviso: DatosDeAviso } | { fase: 'listo'; datos: Listado };

const m = textos.movimientos;
const TODAS = 0;
// Los chips muestran hasta tres categorías; «Ver todas» abre la lista completa (E14-PRR 4.1, fila 4).
const CHIPS_DE_CATEGORIA = 3;

// Los movimientos que vienen seguidos con la misma fecha, para un título por día (la lista ya llega ordenada).
function porDia(movimientos: Movimiento[]) {
  const dias: { fecha: string; filas: Movimiento[] }[] = [];
  for (const fila of movimientos) {
    const ultimo = dias.at(-1);
    if (ultimo?.fecha === fila.fecha) ultimo.filas.push(fila);
    else dias.push({ fecha: fila.fecha, filas: [fila] });
  }
  return dias;
}

// PN-01 · Movimientos: lista y filtros, variante Android (E14-PRR 4.1). Una columna, con «Registrar» fijo abajo. Los
// filtros viven en los parámetros de la ruta: así sobreviven a abrir un movimiento y volver. Sin la sección «Por
// confirmar» (US-60, D-168), sin las «Horas de vida» (RF-054), sin el contexto «Nuestro hogar» y sin «Sin conexión.
// Mostramos lo último que cargó.» (la app no guarda lo último que cargó): sin conexión sale el aviso de siempre.
export function Movimientos({ navigation, route }: NativeStackScreenProps<Rutas, 'ListaDeMovimientos'>) {
  const periodo = route.params?.periodo ?? null;
  const categoria = route.params?.categoria ?? null;
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [verMeses, setVerMeses] = useState(false);
  const [verTodas, setVerTodas] = useState(false);
  const margenes = useSafeAreaInsets();

  // Cada pedido lleva su número: solo el último pinta (un filtro nuevo no se pisa con la respuesta del anterior).
  const ultimo = useRef(0);
  const cargar = useCallback(() => {
    const numero = ++ultimo.current;
    void listarMovimientos(periodo, categoria).then((respuesta) => {
      if (numero !== ultimo.current) return;
      if (respuesta.ok) setEstado({ fase: 'listo', datos: respuesta.cuerpo });
      else if (!seguirPorAccesoNegado(navigation, respuesta))
        setEstado({ fase: 'error', aviso: avisoDeFallo(respuesta, avisos.errorAlCargarMovimientos) });
    });
  }, [navigation, periodo, categoria]);
  // Al volver de PN-02 o del formulario se pide la lista otra vez: lo corregido o borrado ya cambió.
  useFocusEffect(cargar);

  const filtrar = (nuevoPeriodo: string | null, nuevaCategoria: number | null) => {
    setVerMeses(false);
    setVerTodas(false);
    navigation.setParams({
      periodo: nuevoPeriodo ?? undefined,
      categoria: nuevaCategoria ?? undefined,
    });
  };

  const datos = estado.fase === 'listo' ? estado.datos : null;
  const actual = datos?.periodo_actual ?? '';
  const periodoElegido = periodo ?? actual;
  const visibles = datos?.categorias.filter((c) => !c.oculta) ?? [];
  // Los chips: las tres con más movimientos (sin las ocultas) y, si se eligió otra, esa también.
  const chips = visibles.slice(0, CHIPS_DE_CATEGORIA).map((c) => c.categoria_id);
  if (categoria && !chips.includes(categoria)) chips.push(categoria);
  const periodos = [...new Set([actual, mesAnterior(actual), periodoElegido])];
  const hoy = hoyEnColombia();
  const cuantos = datos ? plural(m.resumen, datos.resumen.movimientos) : '';

  return (
    <View style={estilos.pantalla}>
      <Pantalla conBarra estado={route.params?.aviso}>
        {estado.fase === 'error' && (
          <>
            <Aviso {...estado.aviso} />
            <Boton
              variante="secundario"
              alTocar={() => {
                setEstado({ fase: 'cargando' });
                cargar();
              }}
            >
              {textos.acciones.intentarDeNuevo}
            </Boton>
          </>
        )}
        {datos && (
          <>
            <ChipsDeEleccion
              etiqueta={m.periodo}
              enFila
              opciones={periodos.map((p) => ({ valor: p, etiqueta: mesEnPalabras(p) ?? p }))}
              valor={periodoElegido}
              alElegir={(p) => filtrar(p, categoria)}
            />
            <BotonDeTexto alTocar={() => setVerMeses(true)}>{m.otroMes}</BotonDeTexto>
            <HojaDeElecciones
              visible={verMeses}
              alCerrar={() => setVerMeses(false)}
              opciones={datos.meses.map((mes) => ({ valor: mes, etiqueta: mesEnPalabras(mes, true) ?? mes }))}
              valor={periodoElegido}
              alElegir={(mes) => filtrar(mes, categoria)}
            />
            <ChipsDeEleccion
              etiqueta={textos.registro.categoria.etiqueta}
              enFila
              opciones={[{ valor: TODAS, etiqueta: m.todas }, ...chips.map((id) => ({ valor: id, etiqueta: nombreDeCategoria(id) }))]}
              valor={categoria ?? TODAS}
              alElegir={(id) => filtrar(periodoElegido, id === TODAS ? null : id)}
            />
            <BotonDeTexto alTocar={() => setVerTodas(true)}>{textos.registro.categoria.verTodas}</BotonDeTexto>
            <HojaDeElecciones
              visible={verTodas}
              alCerrar={() => setVerTodas(false)}
              opciones={datos.categorias.map((c) => ({ valor: c.categoria_id, etiqueta: nombreDeCategoria(c.categoria_id) }))}
              valor={categoria}
              alElegir={(id) => filtrar(periodoElegido, id)}
            />
            {datos.resumen.movimientos > 0 && (
              <Texto variante="ayuda">
                {categoria
                  ? formatear(m.resumenDeCategoria, {
                      categoria: nombreDeCategoria(categoria),
                      movimientos: cuantos,
                      total: formatearPesos(BigInt(datos.resumen.total_centavos ?? 0)),
                    })
                  : cuantos}
              </Texto>
            )}
            {porDia(datos.movimientos).map(({ fecha, filas }) => (
              <View key={fecha} style={estilos.dia}>
                <Text accessibilityRole="header" style={estilos.tituloDelDia}>
                  {cifras(tituloDelDia(fecha, hoy))}
                </Text>
                <View style={estilos.tarjeta}>
                  {filas.map((fila) => (
                    <Fila key={fila.id} fila={fila} alTocar={() => navigation.navigate('DetalleDeMovimiento', { movimiento: fila })} />
                  ))}
                </View>
              </View>
            ))}
            {datos.resumen.movimientos === 0 &&
              (datos.meses.length === 0 ? (
                <Tarjeta titulo={m.vacio.sinMovimientos}>
                  <Texto>{m.vacio.registraElPrimero}</Texto>
                </Tarjeta>
              ) : (
                <Tarjeta titulo={m.vacio.sinResultados}>
                  <Texto>{m.vacio.cambiarFiltro}</Texto>
                  <BotonDeTexto alTocar={() => filtrar(null, null)}>{m.vacio.quitarFiltros}</BotonDeTexto>
                </Tarjeta>
              ))}
          </>
        )}
      </Pantalla>
      <View style={[estilos.fijo, { paddingBottom: margenes.bottom + tokens.espacio['4'] }]}>
        <Boton
          alTocar={() => {
            // D-164: cada entrada al formulario desde PN-01 empieza vacía.
            reiniciarBorrador();
            navigation.navigate('FormularioDeRegistro');
          }}
        >
          {m.registrar}
        </Boton>
      </View>
    </View>
  );
}

// Una Fila de lista navegable con valor (E14-SDD 5.20): toda la fila es el área táctil y abre PN-02.
function Fila({ fila, alTocar }: { fila: Movimiento; alTocar: () => void }) {
  const { principal, apoyo } = textosDeFila(fila);
  return (
    <Pressable accessibilityRole="button" onPress={alTocar} style={estilos.fila}>
      <View style={estilos.columna}>
        <Text style={estilos.principal}>{cifras(principal, true)}</Text>
        <Text style={estilos.apoyo}>{cifras(apoyo)}</Text>
        {fila.compartido && <MarcaDePropiedad compartido />}
      </View>
      <Text style={estilos.monto}>{cifras(formatearPesos(BigInt(fila.monto_centavos)))}</Text>
      <IconoSiguiente color={tokens.color.texto.secundario} />
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: tokens.color.fondo.pagina },
  dia: { gap: tokens.espacio['2'] },
  tituloDelDia: { ...estiloDeTipografia('titulo-3'), color: tokens.color.texto.principal },
  // Tarjeta de E14-SDD 5.7 con las filas pegadas al borde: cada fila lleva su propio relleno.
  tarjeta: {
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    borderRadius: tokens.radio.grande,
    backgroundColor: tokens.color.fondo.superficie,
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espacio['3'],
    minHeight: tokens.tamano['tactil-minimo'],
    padding: tokens.espacio['4'],
  },
  columna: { flex: 1, gap: tokens.espacio['1'] },
  principal: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
  apoyo: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  monto: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
  // El Botón Registrar fijo (E14-SDD 5.14): siempre a la vista, bajo la lista que se desplaza.
  fijo: {
    padding: tokens.espacio['4'],
    borderTopWidth: tokens['ancho-borde'].fino,
    borderTopColor: tokens.color.borde.decorativo,
    backgroundColor: tokens.color.fondo.pagina,
  },
});
