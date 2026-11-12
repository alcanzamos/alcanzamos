import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { StyleSheet, Text, View, type HostInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLlevarFoco } from '../anuncios';
import type { Respuesta } from '../api/cliente';
import {
  corregirPresupuesto,
  dejarEnCero,
  leerPresupuesto,
  ponerPresupuesto,
  quitarPresupuesto,
  type CategoriaDelPresupuesto,
  type PresupuestoDelPeriodo,
} from '../api/presupuesto';
import { obtenerCategorias, type CategoriaDelApi } from '../api/registro';
import { cambiarBorrador, reiniciarBorrador } from '../borradorDeRegistro';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { cifras } from '../componentes/Cifras';
import { HojaDeElecciones } from '../componentes/HojaDeElecciones';
import { MarcaDeOculta } from '../componentes/MarcaDeOculta';
import { Pantalla } from '../componentes/Pantalla';
import { Tarjeta } from '../componentes/Tarjeta';
import { Texto } from '../componentes/Texto';
import { formatearPesos } from '../dinero';
import { estiloDeTipografia } from '../fuentes';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, textosDeErrorDeRegistro, type DatosDeAviso } from '../textos';
import {
  avisosDePresupuesto,
  mesEnMinuscula,
  nombreDeCategoria,
  pesos,
  pesosHablados,
  seSumaCuando,
  textosDeCategoria,
} from '../textosDePresupuesto';
import { formatear, textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { HojaDeMontoDelPresupuesto, HojaDeQuitar } from './HojasDePresupuesto';

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; aviso: DatosDeAviso }
  | { fase: 'listo'; datos: PresupuestoDelPeriodo; gasto: CategoriaDelApi[] };

/** La hoja abierta: la de una fila de «Por categoría» o la de una categoría de «Agregar otra categoría». */
type HojaAbierta = {
  tipo: 'monto' | 'quitar';
  /** El mes que se veía al abrirla: «Guardar» pone ahí, nunca en un mes que llegó después (L17 de la US-77, punto 1). */
  periodo: string;
  categoriaId: number;
  presupuesto: CategoriaDelPresupuesto['presupuesto'];
  /** El botón que la abrió: ahí vuelve el foco de TalkBack al cerrarla (L17 de la US-77, punto 3). */
  abridor: RefObject<HostInstance | null>;
};

/** Lo que manda una fila o «Agregar otra categoría» al abrir una hoja; el mes lo pone la pantalla. */
type PedidoDeHoja = Omit<HojaAbierta, 'periodo'>;

type Fallo = Extract<Respuesta<unknown>, { ok: false }>;

const t = textos.presupuesto;

/** Un `422` que solo señala el monto va al campo, con el texto de E14-PPN 3.1; lo demás es un aviso. */
function errorDelMonto(respuesta: Fallo): string | undefined {
  if (respuesta.codigo !== 'datos_invalidos') return undefined;
  const campos = Object.entries(respuesta.campos);
  const [campo, codigo = ''] = campos[0] ?? [];
  return campos.length === 1 && campo === 'monto_centavos' ? textosDeErrorDeRegistro[codigo] : undefined;
}

// Una Fila de lista con valor (E14-SDD 5.15) o la cifra grande (Monto · Grande · Neutro, 5.5: nunca en Atención,
// tampoco en PN-07, RNF-017). TalkBack la lee como un solo elemento, con el monto en pesos (ACC-004, D-187). PN-08
// también la usa.
export function FilaConValor({ etiqueta, centavos, grande = false }: { etiqueta: string; centavos: string; grande?: boolean }) {
  const hablado = [etiqueta, pesosHablados(centavos)].join(', ');
  return (
    <View
      accessible
      accessibilityLabel={hablado}
      accessibilityHint={undefined}
      style={grande ? estilos.cifraGrande : estilos.filaConValor}
    >
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      <Text style={grande ? estilos.montoGrande : estilos.monto}>{cifras(pesos(centavos), true)}</Text>
    </View>
  );
}

// La tarjeta «Tu presupuesto este mes»: la de PN-06 con `normal` y la de PN-07 con un ingreso bajo o nulo (D-094, P-3).
// Describe sin calificar: sin Atención, sin rojo y sin signo menos (RNF-017). «Llega después» y «Por confirmar» son dos
// líneas, cada una solo con su total mayor que cero y leída en pesos (L14 de la US-77, D-187). `refDelTitulo` es para
// llevar el foco de TalkBack a su título después de guardar (L17 de la US-77, punto 3).
function Resumen({
  datos,
  refDelTitulo,
  alVerIngresos,
}: {
  datos: PresupuestoDelPeriodo;
  refDelTitulo: Ref<HostInstance>;
  alVerIngresos: () => void;
}) {
  const r = datos.resumen;
  const llegaDespues = BigInt(r.llega_despues_centavos) > 0n;
  const porConfirmar = BigInt(r.por_confirmar_centavos) > 0n;
  const frase = seSumaCuando(datos.llega_despues);
  const supera = r.asignado_supera_por_centavos;
  const cuenta = [t.resumen.cuentaLoRegistrado, frase].filter(Boolean).join(' ');
  return (
    <Tarjeta titulo={t.resumen.titulo} refDelTitulo={refDelTitulo}>
      <FilaConValor
        etiqueta={t.resumen.ingresoRegistrado}
        centavos={r.ingreso_registrado_centavos}
        grande={r.modo === 'ingreso_nulo'}
      />
      {(r.modo !== 'ingreso_nulo' || BigInt(r.asignado_centavos) > 0n) && (
        <FilaConValor etiqueta={t.resumen.asignado} centavos={r.asignado_centavos} />
      )}
      {r.modo === 'normal' && r.sin_asignar_centavos !== null && (
        <FilaConValor etiqueta={t.resumen.sinAsignar} centavos={r.sin_asignar_centavos} grande />
      )}
      {llegaDespues && (
        <Texto etiqueta={formatear(t.resumen.llegaDespues, { monto: pesosHablados(r.llega_despues_centavos) })}>
          {formatear(t.resumen.llegaDespues, { monto: pesos(r.llega_despues_centavos) })}
        </Texto>
      )}
      {porConfirmar && (
        <Texto etiqueta={formatear(t.resumen.porConfirmar, { monto: pesosHablados(r.por_confirmar_centavos) })}>
          {formatear(t.resumen.porConfirmar, { monto: pesos(r.por_confirmar_centavos) })}
        </Texto>
      )}
      {/* En PN-07 la frase va sola, bajo «Llega después» o «Por confirmar» (L17 de la US-77, punto 4). */}
      {r.modo !== 'normal' && frase && <Texto variante="ayuda">{frase}</Texto>}
      {r.modo === 'normal' && <Texto variante="ayuda">{cuenta}</Texto>}
      {r.modo === 'ingreso_bajo' && supera && (
        <Texto etiqueta={formatear(t.resumen.bajo, { monto: pesosHablados(supera) })}>
          {formatear(t.resumen.bajo, { monto: pesos(supera) })}
        </Texto>
      )}
      {r.modo === 'ingreso_nulo' && <Texto>{t.resumen.nulo}</Texto>}
      <BotonDeTexto alTocar={alVerIngresos}>{t.resumen.verMisIngresos}</BotonDeTexto>
    </Tarjeta>
  );
}

// PN-06 · Presupuesto del periodo por categorías y PN-07 con un ingreso bajo o nulo (E14-PPA 4.1 y 4.2), variante
// Android: una sola pantalla de la pila, apilada sobre PN-71 (su entrada provisional, L3 de la US-77, punto 3, hasta la
// navegación del ítem 290), que cambia la tarjeta de resumen según el modo del API. Siempre el mes en curso (D-094). La
// barra dice «Presupuesto de noviembre» y su Atrás vuelve a PN-71. Con «Registrar» fijo abajo, como PN-01. Sin «Para
// mirar con calma» (L3, punto 1). Al volver del formulario se pide el presupuesto otra vez.
export function Presupuesto({ navigation, route }: NativeStackScreenProps<Rutas, 'PresupuestoDelMes'>) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [hoja, setHoja] = useState<HojaAbierta | null>(null);
  const [avisoDeHoja, setAvisoDeHoja] = useState<DatosDeAviso | null>(null);
  const [avisoDeEnCero, setAvisoDeEnCero] = useState<DatosDeAviso | null>(null);
  const [avisoDePantalla, setAvisoDePantalla] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [verOtras, setVerOtras] = useState(false);
  const margenes = useSafeAreaInsets();
  // A dónde vuelve el foco de TalkBack al cerrar una hoja (L17 de la US-77, punto 3).
  const llevarFoco = useLlevarFoco();
  const tituloDelResumen = useRef<HostInstance>(null);
  const agregarOtra = useRef<HostInstance>(null);
  const refDelAvisoDePantalla = useRef<HostInstance>(null);

  // Cada pedido lleva su número: solo el último pinta.
  const ultimo = useRef(0);
  const cargar = useCallback(() => {
    const numero = ++ultimo.current;
    void Promise.all([leerPresupuesto(), obtenerCategorias()]).then(([presupuesto, categorias]) => {
      if (numero !== ultimo.current) return;
      if (presupuesto.ok && categorias.ok)
        setEstado({ fase: 'listo', datos: presupuesto.cuerpo, gasto: categorias.cuerpo.gasto });
      else {
        const fallo = presupuesto.ok ? categorias : presupuesto;
        if (!fallo.ok && !seguirPorAccesoNegado(navigation, fallo))
          setEstado({ fase: 'error', aviso: avisoDeFallo(fallo, avisosDePresupuesto.errorAlCargar) });
      }
    });
  }, [navigation]);
  useFocusEffect(cargar);

  const datos = estado.fase === 'listo' ? estado.datos : null;
  const periodo = datos?.periodo;
  // El título de la barra sale del mes que manda el API.
  useEffect(() => {
    if (periodo) navigation.setOptions({ title: formatear(t.titulo, { mes: mesEnMinuscula(periodo) }) });
  }, [navigation, periodo]);

  const empezar = () => {
    setAvisoDeHoja(null);
    setAvisoDeEnCero(null);
    setAvisoDePantalla(null);
    navigation.setParams({ aviso: undefined });
    setEnviando(true);
  };
  // Al cancelar (Ahora no, Cerrar, el velo o el Atrás), el foco vuelve al botón que abrió la hoja.
  const cerrar = () => {
    if (hoja) llevarFoco(hoja.abridor);
    setHoja(null);
  };
  // Después de guardar se cierra la hoja, el aviso queda arriba y se vuelve a pedir el presupuesto sin vaciar la pantalla.
  // El foco va al título del resumen: el título de la barra es nativo y no recibe el foco desde la app.
  const terminar = (aviso: DatosDeAviso) => {
    setHoja(null);
    navigation.setParams({ aviso });
    cargar();
    llevarFoco(tituloDelResumen);
  };
  // Un 404 o un 409 dice que la hoja tenía datos viejos: el presupuesto ya no existe, el mes cambió o la categoría tiene
  // uno compartido (L17 de la US-77, punto 1). La hoja se cierra, la pantalla se vuelve a pedir y el aviso queda en ella,
  // arriba de «Por categoría», con el foco de TalkBack, como en la web: repetir exige abrir la hoja otra vez, con lo que
  // entonces se ve. No se anuncia aparte (`viva={false}`): TalkBack lo lee al recibir el foco, como el error de la
  // repetición en Registrar. Otro fallo (500, sin conexión) deja la hoja abierta con lo escrito y el aviso dentro, que
  // se dice por la región viva de la hoja.
  const fallarEnLaHoja = (respuesta: Fallo) => {
    const aviso = avisoDeFallo(respuesta, avisosDePresupuesto.errorAlGuardar());
    if (respuesta.estado === 404 || respuesta.estado === 409) {
      setHoja(null);
      setAvisoDePantalla(aviso);
      cargar();
      llevarFoco(refDelAvisoDePantalla);
      return;
    }
    setAvisoDeHoja(aviso);
  };

  async function guardar(centavos: bigint): Promise<string | undefined> {
    if (!hoja || enviando) return undefined;
    empezar();
    const respuesta = hoja.presupuesto
      ? await corregirPresupuesto(hoja.presupuesto.id, centavos)
      : await ponerPresupuesto(hoja.periodo, hoja.categoriaId, centavos);
    setEnviando(false);
    if (respuesta.ok) {
      terminar(avisosDePresupuesto.guardamos(nombreDeCategoria(hoja.categoriaId)));
      return undefined;
    }
    if (seguirPorAccesoNegado(navigation, respuesta)) return undefined;
    const delCampo = errorDelMonto(respuesta);
    if (!delCampo) fallarEnLaHoja(respuesta);
    return delCampo;
  }

  async function quitar() {
    if (!hoja?.presupuesto || enviando) return;
    empezar();
    const respuesta = await quitarPresupuesto(hoja.presupuesto.id);
    setEnviando(false);
    if (respuesta.ok) terminar(avisosDePresupuesto.quitamos(nombreDeCategoria(hoja.categoriaId)));
    else if (!seguirPorAccesoNegado(navigation, respuesta)) fallarEnLaHoja(respuesta);
  }

  // «Dejar el presupuesto en cero» (CU-10 2a): no es destructivo y no pide confirmación (E14-PPA 4.2).
  async function enCero() {
    if (!datos || enviando) return;
    empezar();
    const respuesta = await dejarEnCero(datos.periodo);
    setEnviando(false);
    if (respuesta.ok) return terminar(avisosDePresupuesto.enCero(datos.periodo));
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
    if (respuesta.estado === 409) cargar();
    setAvisoDeEnCero(avisoDeFallo(respuesta, avisosDePresupuesto.errorAlGuardar()));
  }

  const abrir = (nueva: PedidoDeHoja) => {
    if (!datos) return;
    setAvisoDeHoja(null);
    setHoja({ ...nueva, periodo: datos.periodo });
  };
  // «Registrar» y «Registrar un ingreso» abren el formulario vacío (D-164); el segundo, con Tipo «Ingreso».
  const registrar = (ingreso: boolean) => {
    reiniciarBorrador();
    if (ingreso) cambiarBorrador({ tipo: 'ingreso' });
    navigation.navigate('FormularioDeRegistro');
  };

  const r = datos?.resumen;
  const ofreceEnCero = datos?.editable && r?.modo === 'ingreso_nulo' && BigInt(r.asignado_centavos) === 0n && !r.en_cero;
  const enLaLista = new Set(datos?.categorias.map((c) => c.categoria_id));
  const otras = estado.fase === 'listo' ? estado.gasto.filter((c) => !enLaLista.has(c.id) && nombreDeCategoria(c.id)) : [];
  const categoriaDeLaHoja = hoja ? nombreDeCategoria(hoja.categoriaId) : '';

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
        {datos && r && (
          <>
            <Resumen
              datos={datos}
              refDelTitulo={tituloDelResumen}
              alVerIngresos={() => navigation.navigate('IngresosDelPeriodo')}
            />
            {r.modo !== 'normal' && (
              <Boton variante="secundario" alTocar={() => registrar(true)}>
                {t.registrarUnIngreso}
              </Boton>
            )}
            {avisoDeEnCero && <Aviso {...avisoDeEnCero} />}
            {ofreceEnCero && (
              <BotonDeTexto deshabilitado={enviando} alTocar={() => void enCero()}>
                {t.resumen.dejarEnCero}
              </BotonDeTexto>
            )}
            {avisoDePantalla && <Aviso ref={refDelAvisoDePantalla} {...avisoDePantalla} viva={false} />}
            <PorCategoria datos={datos} alAbrir={abrir} />
            {datos.editable && (
              <Boton ref={agregarOtra} variante="secundario" alTocar={() => setVerOtras(true)}>
                {t.categorias.agregarOtra}
              </Boton>
            )}
          </>
        )}
      </Pantalla>
      <View style={[estilos.fijo, { paddingBottom: margenes.bottom + tokens.espacio['4'] }]}>
        <Boton alTocar={() => registrar(false)}>{textos.movimientos.registrar}</Boton>
      </View>
      {/* «Agregar otra categoría» abre «Ver todas» de E14-PPN 3.1 con las de gasto que la persona ve y que todavía no
          están en «Por categoría». Sin «Elegir cuáles ver»: PN-05 no está construida. */}
      <HojaDeElecciones
        visible={verOtras}
        alCerrar={() => {
          setVerOtras(false);
          llevarFoco(agregarOtra);
        }}
        opciones={otras.map((c) => ({ valor: c.id, etiqueta: nombreDeCategoria(c.id) }))}
        valor={null}
        alElegir={(categoriaId) => {
          setVerOtras(false);
          abrir({ tipo: 'monto', categoriaId, presupuesto: null, abridor: agregarOtra });
        }}
      />
      {hoja?.tipo === 'monto' && (
        <HojaDeMontoDelPresupuesto
          titulo={formatear(hoja.presupuesto ? t.hoja.tituloCorregir : t.hoja.titulo, { categoria: categoriaDeLaHoja })}
          mes={mesEnMinuscula(hoja.periodo)}
          montoInicial={hoja.presupuesto ? formatearPesos(BigInt(hoja.presupuesto.monto_centavos)) : ''}
          aviso={avisoDeHoja}
          enviando={enviando}
          alGuardar={guardar}
          alCerrar={cerrar}
        />
      )}
      {hoja?.tipo === 'quitar' && (
        <HojaDeQuitar
          categoria={categoriaDeLaHoja}
          aviso={avisoDeHoja}
          enviando={enviando}
          alQuitar={() => void quitar()}
          alCerrar={cerrar}
        />
      )}
    </View>
  );
}

// «Por categoría» (E14-PPA 4.1, fila 4): primero las que tienen presupuesto y después las demás, en el orden del API.
function PorCategoria({ datos, alAbrir }: { datos: PresupuestoDelPeriodo; alAbrir: (hoja: PedidoDeHoja) => void }) {
  const sinGastos = datos.resumen.modo === 'ingreso_nulo' && datos.categorias.length === 0;
  const sinPresupuestos = !datos.categorias.some((c) => c.presupuesto);
  return (
    <Tarjeta titulo={t.categorias.titulo}>
      {sinGastos ? (
        <Texto>{t.categorias.sinGastos}</Texto>
      ) : (
        sinPresupuestos && (
          <>
            <Text style={estilos.principal}>{t.categorias.sinPresupuestos}</Text>
            <Texto variante="ayuda">{t.categorias.elige}</Texto>
          </>
        )
      )}
      {datos.categorias.map((c) => (
        <FilaDeCategoria key={c.categoria_id} categoria={c} editable={datos.editable} alAbrir={alAbrir} />
      ))}
    </Tarjeta>
  );
}

// Una fila de «Por categoría»: lo que dice es un solo elemento para TalkBack, con los montos en pesos, y sus botones de
// texto de 48 dp van aparte, con el nombre de la categoría en su nombre accesible (D-094, SC-E21-13). Cada botón guarda su
// referencia: la hoja que abre le devuelve el foco al cerrarse (L17 de la US-77, punto 3).
function FilaDeCategoria({
  categoria: c,
  editable,
  alAbrir,
}: {
  categoria: CategoriaDelPresupuesto;
  editable: boolean;
  alAbrir: (hoja: PedidoDeHoja) => void;
}) {
  const tx = textosDeCategoria(c);
  const poner = useRef<HostInstance>(null);
  const corregir = useRef<HostInstance>(null);
  const quitar = useRef<HostInstance>(null);
  const abrir = (tipo: HojaAbierta['tipo'], abridor: RefObject<HostInstance | null>) =>
    alAbrir({ tipo, categoriaId: c.categoria_id, presupuesto: c.presupuesto, abridor });
  return (
    <View style={estilos.fila}>
      <View accessible accessibilityLabel={tx.etiqueta} accessibilityHint={undefined} style={estilos.columna}>
        <View style={estilos.nombre}>
          <Text style={estilos.principal}>{cifras(tx.categoria, true)}</Text>
          {c.oculta && <MarcaDeOculta color={tokens.color.texto.secundario} />}
        </View>
        <Text style={estilos.apoyo}>{cifras(tx.apoyo)}</Text>
        {tx.estado && <Text style={estilos.estado}>{cifras(tx.estado)}</Text>}
      </View>
      {editable && (
        <View style={estilos.acciones}>
          {c.presupuesto ? (
            <>
              <BotonDeTexto ref={corregir} nombre={tx.nombreDeCorregir} alTocar={() => abrir('monto', corregir)}>
                {t.categorias.corregir}
              </BotonDeTexto>
              <BotonDeTexto ref={quitar} nombre={tx.nombreDeQuitar} alTocar={() => abrir('quitar', quitar)}>
                {t.categorias.quitar}
              </BotonDeTexto>
            </>
          ) : (
            <BotonDeTexto ref={poner} nombre={tx.nombreDePoner} alTocar={() => abrir('monto', poner)}>
              {t.categorias.poner}
            </BotonDeTexto>
          )}
        </View>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: tokens.color.fondo.pagina },
  filaConValor: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espacio['2'],
    minHeight: tokens.tamano['tactil-minimo'],
  },
  cifraGrande: { gap: tokens.espacio['1'] },
  etiqueta: { ...estiloDeTipografia('cuerpo'), color: tokens.color.texto.principal },
  monto: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
  montoGrande: { ...estiloDeTipografia('cifra-grande'), color: tokens.color.texto.principal },
  // Una Fila de lista · Navegable con valor (E14-PRR 7.1) con sus Botones de texto debajo.
  fila: {
    gap: tokens.espacio['1'],
    paddingTop: tokens.espacio['3'],
    borderTopWidth: tokens['ancho-borde'].fino,
    borderTopColor: tokens.color.borde.decorativo,
  },
  columna: { gap: tokens.espacio['1'] },
  nombre: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.espacio['2'] },
  principal: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
  apoyo: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  estado: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.principal },
  acciones: { flexDirection: 'row', alignItems: 'center', gap: tokens.espacio['2'] },
  // El Botón Registrar fijo (E14-SDD 5.14): siempre a la vista, bajo lo que se desplaza.
  fijo: {
    padding: tokens.espacio['4'],
    borderTopWidth: tokens['ancho-borde'].fino,
    borderTopColor: tokens.color.borde.decorativo,
    backgroundColor: tokens.color.fondo.pagina,
  },
});
