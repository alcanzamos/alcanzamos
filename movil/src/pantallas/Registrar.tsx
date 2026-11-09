import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { StyleSheet, Text, View, type HostInstance, type TextInputInstance } from 'react-native';
import { SIN_CONEXION } from '../api/cliente';
import { corregirMovimiento, interpretarTexto, type Interpretacion, type Movimiento } from '../api/movimientos';
import { guardarMovimiento, obtenerCategorias, type CatalogoDeCategorias, type Medio } from '../api/registro';
import { useAvisarErrores } from '../anuncios';
import { borradorDeMovimiento, cambiarBorrador, reiniciarBorrador, useBorrador, type Borrador } from '../borradorDeRegistro';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { CampoDeFecha } from '../componentes/CampoDeFecha';
import { CampoDeMonto } from '../componentes/CampoDeMonto';
import { CampoDeTexto } from '../componentes/CampoDeTexto';
import { ChipsDeEleccion } from '../componentes/ChipsDeEleccion';
import { HojaDeElecciones } from '../componentes/HojaDeElecciones';
import { Pantalla } from '../componentes/Pantalla';
import { Nota, Texto } from '../componentes/Texto';
import { formatearPesos, leerMonto } from '../dinero';
import { aIso, desdeIso, diaEnPalabras, hoyEnColombia } from '../fechas';
import { estiloDeTipografia } from '../fuentes';
import { montoHablado } from '../montoHablado';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import type { Rutas } from '../navegacion/rutas';
import {
  avisoDeFallo,
  avisoDeRegistro,
  avisoErrorAlGuardarMovimiento,
  avisos,
  avisosDelCuadro,
  etiquetasDePeriodicidad,
  nombresDeCategoria,
  textosDeErrorDeRegistro,
  textosDeErrorDelCuadro,
  type DatosDeAviso,
} from '../textos';
import { fechaEnLaFila } from '../textosDeMovimientos';
import { formatear, textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { campoDeApi, CAMPOS, validarRegistro, type Campo, type Errores } from '../validacionDeRegistro';

type Catalogo =
  | { fase: 'cargando' }
  | { fase: 'error'; aviso: DatosDeAviso }
  | { fase: 'listo'; categorias: CatalogoDeCategorias };

const LARGO_DE_LA_DESCRIPCION = 280;
const SOLO_MIO = 'solo_mio';
const LARGO_DEL_CUADRO = 280;
const r = textos.registro;

// Formulario de registro, variante Android (E14-PPN 3.1, D-164). Mismo flujo, textos y errores del API que la web.
// Con el cuadro de lenguaje natural (US-62) y su paso «Revisa y confirma»; sin el aviso de faltante, «Tarjeta», «Cuotas»,
// PN-04, PN-05 ni «Compartido con el hogar»: esas filas no se dibujan (README de movil). El cuadro solo llena el
// formulario: lo que interpretó el sistema no se guarda sin «Revisa y confirma» (RN-001), y lo que la persona llena a mano
// se guarda directo (RF-002). Al guardar vuelve a PN-01 con el aviso como mensaje de estado.
// Con `corregir` es «Corregir» de PN-02 (E14-PRR 4.2): lleva su propio estado, no el borrador, y no ofrece lo que el API
// no deja cambiar. Una fecha de un recurrente no lleva Fecha ni Tipo (D-168). Si el movimiento tiene una categoría que la
// persona ocultó después, el formulario la incluye ya elegida, con el ícono y la palabra «Oculta» (D-170).
export function FormularioDeMovimiento({
  navigation,
  corregir,
}: {
  navigation: NativeStackNavigationProp<Rutas, 'FormularioDeRegistro'> | NativeStackNavigationProp<Rutas, 'CorregirMovimiento'>;
  corregir?: Movimiento;
}) {
  const delBorrador = useBorrador();
  const [propio, setPropio] = useState<Borrador>(() => (corregir ? borradorDeMovimiento(corregir) : delBorrador));
  const borrador = corregir ? propio : delBorrador;
  const cambiar = (cambio: Partial<Borrador>) =>
    corregir ? setPropio({ ...propio, ...cambio }) : cambiarBorrador(cambio);
  const esRecurrente = Boolean(corregir?.recurrente);
  const [catalogo, setCatalogo] = useState<Catalogo>({ fase: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enPaso, setEnPaso] = useState(false);
  const [interpretando, setInterpretando] = useState(false);
  const [avisoDelCuadro, setAvisoDelCuadro] = useState<DatosDeAviso | null>(null);
  const [errorDelCuadro, setErrorDelCuadro] = useState<string>();
  const campoDelCuadro = useRef<TextInputInstance>(null);
  // «Cambiar» en la fila del monto: el campo existe otra vez cuando el paso se cierra, y ahí se le da el foco.
  const enfocarMonto = useRef(false);
  const campoDeMonto = useRef<TextInputInstance>(null);
  const campoDeDescripcion = useRef<TextInputInstance>(null);
  // Los demás campos, para llevarles el foco de TalkBack cuando el primer error es suyo (ACC-004, bug 226).
  const campoDeTipo = useRef<HostInstance>(null);
  const campoDeFecha = useRef<HostInstance>(null);
  const campoDeCategoria = useRef<HostInstance>(null);
  const campoDeMedio = useRef<HostInstance>(null);
  const avisoDeRepeticion = useRef<HostInstance>(null);
  const avisarErrores = useAvisarErrores();

  useEffect(() => {
    let vigente = true;
    void obtenerCategorias().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) setCatalogo({ fase: 'listo', categorias: respuesta.cuerpo });
      else if (!seguirPorAccesoNegado(navigation, respuesta))
        setCatalogo({ fase: 'error', aviso: avisoDeFallo(respuesta, avisos.errorAlCargarInformacion) });
    });
    return () => {
      vigente = false;
    };
  }, [intento, navigation]);

  const hoy = hoyEnColombia();
  const fecha = borrador.fecha ?? hoy;
  // Solo las categorías con texto de E14: el API manda el `id` y el texto sale de es.json.
  const delCatalogo = catalogo.fase === 'listo' ? catalogo.categorias[borrador.tipo] : [];
  const categorias: { id: number; nombre: string; oculta: boolean }[] = delCatalogo.flatMap((c) => {
    const nombre = nombresDeCategoria[`c${c.id}`];
    return nombre ? [{ id: c.id, nombre, oculta: false }] : [];
  });
  // La categoría que el movimiento ya tiene y el catálogo no trae es una que la persona ocultó (RN-011): el API la
  // acepta en el PUT. Solo es de su mismo tipo: al cambiar de tipo deja de ofrecerse.
  const actual = corregir?.categoria_id;
  const nombreOculta = actual ? nombresDeCategoria[`c${actual}`] : undefined;
  if (actual && nombreOculta && corregir.tipo === borrador.tipo && !delCatalogo.some((c) => c.id === actual))
    categorias.push({ id: actual, nombre: nombreOculta, oculta: true });
  categorias.sort((a, b) => a.id - b.id);
  // La categoría es obligatoria hasta que exista el motor de reglas que la sugiere (D-165): sin elegir, no hay ninguna.
  const categoriaId = categorias.find((c) => c.id === borrador.categoriaId)?.id ?? null;

  useEffect(() => {
    if (!enPaso && enfocarMonto.current) {
      enfocarMonto.current = false;
      campoDeMonto.current?.focus();
    }
  }, [enPaso]);

  // El foco va al primero con error, que TalkBack lee con su error; los demás se leen al recorrer la pantalla (ACC-004).
  const mostrar = (nuevos: Errores) => {
    setErrores(nuevos);
    const campos: Record<Campo, RefObject<HostInstance | null>> = {
      tipo: campoDeTipo,
      monto: campoDeMonto,
      fecha: campoDeFecha,
      categoria: campoDeCategoria,
      medio: campoDeMedio,
      descripcion: campoDeDescripcion,
      repeticion: avisoDeRepeticion,
    };
    avisarErrores(CAMPOS.map((campo) => ({ error: nuevos[campo], campo: campos[campo] })));
  };

  // Lo que llenó el cuadro pasa por «Revisa y confirma» antes de guardarse (RN-001): `confirmado` solo es verdadero
  // desde «Confirmar y guardar». «Corregir» y lo llenado a mano guardan directo.
  const conPaso = !corregir && borrador.delCuadro;
  const conTexto = !corregir && borrador.texto.trim() !== '';

  async function enviar(confirmado = false) {
    if (enviando) return;
    const revisado = validarRegistro(borrador, categoriaId);
    setAviso(null);
    if ('errores' in revisado) {
      setEnPaso(false);
      mostrar(revisado.errores);
      return;
    }
    setErrores({});
    if (conPaso && !confirmado) {
      setEnPaso(true);
      return;
    }
    setEnviando(true);
    const { solicitud } = revisado;
    const respuesta = corregir
      ? await corregirMovimiento(solicitud, corregir)
      : await guardarMovimiento(solicitud);
    setEnviando(false);
    if (respuesta.ok && corregir) {
      // Vuelve a PN-01: PN-02 y «Corregir» salen de la pila, así que el Atrás no vuelve al movimiento corregido.
      // Un aviso nuevo en cada vuelta: PN-01 lo anuncia aunque la vuelta anterior dijera lo mismo (ACC-004).
      navigation.popTo('ListaDeMovimientos', { aviso: { ...avisos.cambiosGuardados } }, { merge: true });
      return;
    }
    if (respuesta.ok) {
      reiniciarBorrador();
      const aviso = avisoDeRegistro(
        solicitud.tipo,
        solicitud.fecha,
        respuesta.cuerpo.movimiento_id !== null,
        solicitud.montoCentavos,
      );
      // Vuelve a PN-01 (D-164) con el aviso y el formulario sale de la pila: el Atrás no vuelve a él.
      navigation.popTo('ListaDeMovimientos', { aviso }, { merge: true });
      return;
    }
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
    if (corregir && respuesta.estado === 404) {
      navigation.popTo('DetalleDeMovimiento', { movimiento: corregir, noExiste: true });
      return;
    }
    const delCampo: Errores = {};
    let sinTexto = false;
    if (respuesta.codigo === 'datos_invalidos') {
      for (const [campo, codigo] of Object.entries(respuesta.campos)) {
        const texto = textosDeErrorDeRegistro[codigo];
        const enPantalla = campoDeApi[campo];
        if (texto && enPantalla) delCampo[enPantalla] = texto;
        else sinTexto = true;
      }
    }
    if (Object.keys(delCampo).length > 0 && !sinTexto) {
      setEnPaso(false);
      mostrar(delCampo);
      return;
    }
    setErrores({});
    setAviso(
      avisoDeFallo(respuesta, corregir ? avisos.errorAlGuardarCambios : avisoErrorAlGuardarMovimiento(solicitud.tipo)),
    );
  }

  function mostrarErrorDelCuadro(texto: string) {
    setErrorDelCuadro(texto);
    avisarErrores([{ error: texto, campo: campoDelCuadro }]);
  }

  /** «Llenar el formulario»: el API interpreta con reglas y la pantalla muestra lo que recibe (E17-ECO 4.7). */
  async function llenar() {
    if (interpretando) return;
    setAvisoDelCuadro(null);
    setErrorDelCuadro(undefined);
    if (borrador.texto.trim() === '') {
      mostrarErrorDelCuadro(textosDeErrorDelCuadro.texto_requerido!);
      return;
    }
    setInterpretando(true);
    const respuesta = await interpretarTexto(borrador.texto);
    setInterpretando(false);
    if (!respuesta.ok) {
      if (seguirPorAccesoNegado(navigation, respuesta)) return;
      const delTexto = textosDeErrorDelCuadro[respuesta.campos.texto ?? ''];
      if (respuesta.codigo === 'datos_invalidos' && delTexto) {
        mostrarErrorDelCuadro(delTexto);
        return;
      }
      setAvisoDelCuadro(
        respuesta.codigo === SIN_CONEXION
          ? avisosDelCuadro.sinConexion
          : avisoDeFallo(respuesta, avisosDelCuadro.errorAlInterpretar),
      );
      return;
    }
    const resultado: Interpretacion = respuesta.cuerpo;
    if (resultado.resultado !== 'propuesta' && resultado.resultado !== 'monto_ambiguo') {
      setAvisoDelCuadro(
        resultado.resultado === 'recomendacion'
          ? avisosDelCuadro.recomendacion
          : resultado.resultado === 'pregunta'
            ? avisosDelCuadro.pregunta
            : avisosDelCuadro.noEntendido,
      );
      return;
    }
    // Lo que el sistema entendió llena el formulario; el medio de pago y la descripción los llena la persona. La
    // categoría llega elegida solo si es una que ella ve (RN-011); un monto ambiguo no se adivina (D-084).
    const ambiguo = resultado.resultado === 'monto_ambiguo';
    cambiarBorrador({
      tipo: resultado.tipo,
      monto: ambiguo ? '' : formatearPesos(BigInt(resultado.monto_centavos)),
      fecha: resultado.fecha,
      categoriaId: resultado.categoria?.id ?? null,
      delCuadro: true,
      variosMovimientos: resultado.varios_movimientos,
    });
    setEnPaso(false);
    if (ambiguo) {
      const pesos = (texto: string) => {
        const lectura = leerMonto(texto);
        return lectura.ok ? formatearPesos(lectura.centavos) : texto;
      };
      mostrar({
        monto: formatear(r.errores.montoAmbiguo, {
          miles: pesos(resultado.lecturas_del_monto.con_punto_de_miles),
          decimal: pesos(resultado.lecturas_del_monto.con_coma_decimal),
        }),
      });
      return;
    }
    setErrores({});
  }

  function elegirCategoria(id: number) {
    cambiar({ categoriaId: id });
    setVerTodas(false);
  }

  if (catalogo.fase !== 'listo')
    return (
      <Pantalla conBarra>
        {catalogo.fase === 'error' && (
          <>
            <Aviso {...catalogo.aviso} />
            <Boton
              variante="secundario"
              alTocar={() => {
                setCatalogo({ fase: 'cargando' });
                setIntento(intento + 1);
              }}
            >
              {textos.acciones.intentarDeNuevo}
            </Boton>
          </>
        )}
      </Pantalla>
    );

  const medios: { valor: Medio; etiqueta: string }[] = [
    { valor: 'efectivo', etiqueta: r.medio.efectivo },
    { valor: 'transferencia', etiqueta: r.medio.transferencia },
  ];
  const periodicidad = borrador.periodicidad && etiquetasDePeriodicidad[borrador.periodicidad];
  const valorDeRepite = periodicidad
    ? formatear(r.seRepite.conPeriodicidad, { periodicidad })
    : etiquetasDePeriodicidad.no_se_repite;

  const solicitud = enPaso ? validarRegistro(borrador, categoriaId) : null;
  if (!corregir && solicitud && 'solicitud' in solicitud) {
    const { tipo, montoCentavos, fecha: fechaDelPaso, medio } = solicitud.solicitud;
    const filas = [
      { clave: 'tipo', etiqueta: r.tipo.etiqueta, valor: tipo === 'gasto' ? r.tipo.gasto : r.tipo.ingreso },
      {
        clave: 'monto',
        etiqueta: r.monto.etiqueta,
        valor: formatearPesos(montoCentavos),
        hablado: montoHablado(montoCentavos),
      },
      {
        clave: 'categoria',
        etiqueta: r.categoria.etiqueta,
        valor: categorias.find((c) => c.id === categoriaId)?.nombre ?? '',
      },
      { clave: 'fecha', etiqueta: r.fecha.etiqueta, valor: fechaEnLaFila(fechaDelPaso, hoy) },
      { clave: 'medio', etiqueta: r.medio.etiqueta, valor: medios.find((m) => m.valor === medio)?.etiqueta ?? '' },
      { clave: 'quien', etiqueta: r.quien.etiqueta, valor: r.quien.soloMio },
    ].map((f) => ({ ...f, pista: [f.etiqueta, 'hablado' in f ? f.hablado : f.valor].join(': ') }));
    // «Revisa y confirma» (E14-PPN 3.1, RF-004, D-084): reemplaza al formulario. Es lo único que guarda lo que el cuadro
    // llenó (RN-001). «Cambiar» y «Volver» regresan al formulario, sin guardar.
    return (
      <Pantalla conBarra titulo={r.revisa.titulo}>
        {aviso && <Aviso {...aviso} />}
        {borrador.variosMovimientos && <Aviso {...avisosDelCuadro.variosMovimientos} />}
        <View style={estilos.resumen}>
          {filas.map((f) => (
            <View key={f.clave} style={estilos.filaDelResumen}>
              <View style={estilos.columna}>
                <Text style={estilos.nombreDeFila}>{f.etiqueta}</Text>
                <Texto etiqueta={f.hablado}>{f.valor}</Texto>
              </View>
              <BotonDeTexto
                pista={f.pista}
                alTocar={() => {
                  enfocarMonto.current = f.clave === 'monto';
                  setEnPaso(false);
                }}
              >
                {r.revisa.cambiar}
              </BotonDeTexto>
            </View>
          ))}
        </View>
        <Boton deshabilitado={enviando} alTocar={() => void enviar(true)}>
          {r.revisa.confirmar}
        </Boton>
        <Boton
          variante="secundario"
          alTocar={() => {
            setEnPaso(false);
            setAviso(null);
          }}
        >
          {r.revisa.volver}
        </Boton>
        {aviso && (
          <Boton variante="secundario" alTocar={() => void enviar(true)}>
            {textos.acciones.intentarDeNuevo}
          </Boton>
        )}
      </Pantalla>
    );
  }

  return (
    <Pantalla conBarra>
      {!corregir && (
        <>
          <CampoDeTexto
            ref={campoDelCuadro}
            etiqueta={r.cuadro.etiqueta}
            ayuda={r.cuadro.ayuda}
            lineas={4}
            maxLength={LARGO_DEL_CUADRO}
            valor={borrador.texto}
            alCambiar={(texto) => cambiarBorrador({ texto })}
            error={errorDelCuadro}
          />
          <Nota>{r.cuadro.privacidad}</Nota>
          <Boton
            variante={conTexto && !borrador.delCuadro ? 'primario' : 'secundario'}
            deshabilitado={interpretando}
            alTocar={() => void llenar()}
          >
            {r.cuadro.llenar}
          </Boton>
          {avisoDelCuadro && <Aviso {...avisoDelCuadro} />}
          {borrador.delCuadro && <Aviso {...avisosDelCuadro.lleno} />}
        </>
      )}
      {aviso && <Aviso {...aviso} />}
      {esRecurrente && <Nota>{textos.movimientos.detalle.soloEstaFecha}</Nota>}
      {!esRecurrente && (
        <ChipsDeEleccion
          ref={campoDeTipo}
          etiqueta={r.tipo.etiqueta}
          opciones={[
            { valor: 'gasto', etiqueta: r.tipo.gasto },
            { valor: 'ingreso', etiqueta: r.tipo.ingreso },
          ]}
          valor={borrador.tipo}
          alElegir={(tipo) => cambiar({ tipo })}
          error={errores.tipo}
        />
      )}
      <CampoDeMonto
        ref={campoDeMonto}
        valor={borrador.monto}
        alCambiar={(monto) => cambiar({ monto })}
        error={errores.monto}
      />
      {!esRecurrente && (
        <CampoDeFecha
          ref={campoDeFecha}
          etiqueta={r.fecha.etiqueta}
          valor={desdeIso(fecha)}
          texto={fecha === hoy ? r.fecha.hoy : (diaEnPalabras(fecha) ?? undefined)}
          alCambiar={(nueva) => cambiar({ fecha: aIso(nueva) })}
          error={errores.fecha}
        />
      )}
      <ChipsDeEleccion
        ref={campoDeCategoria}
        etiqueta={r.categoria.etiqueta}
        enFila
        opciones={categorias.map((c) => ({ valor: c.id, etiqueta: c.nombre, oculta: c.oculta }))}
        valor={categoriaId}
        alElegir={elegirCategoria}
        error={errores.categoria}
      />
      <BotonDeTexto alTocar={() => setVerTodas(true)}>{r.categoria.verTodas}</BotonDeTexto>
      <HojaDeElecciones
        visible={verTodas}
        alCerrar={() => setVerTodas(false)}
        opciones={categorias.map((c) => ({ valor: c.id, etiqueta: c.nombre, oculta: c.oculta }))}
        valor={categoriaId}
        alElegir={elegirCategoria}
      />
      <ChipsDeEleccion
        ref={campoDeMedio}
        etiqueta={r.medio.etiqueta}
        opciones={medios}
        valor={borrador.medio}
        alElegir={(medio) => cambiar({ medio })}
        error={errores.medio}
      />
      <ChipsDeEleccion
        etiqueta={r.quien.etiqueta}
        opciones={[{ valor: SOLO_MIO, etiqueta: corregir?.compartido ? textos.movimientos.fila.compartido : r.quien.soloMio }]}
        valor={SOLO_MIO}
      />
      <CampoDeTexto
        ref={campoDeDescripcion}
        etiqueta={r.descripcion.etiqueta}
        ayuda={r.descripcion.ayuda}
        maxLength={LARGO_DE_LA_DESCRIPCION}
        valor={borrador.descripcion}
        alCambiar={(descripcion) => cambiar({ descripcion })}
        error={errores.descripcion}
      />
      {!corregir && (
        <View style={estilos.filaDeLista}>
          <View style={estilos.columna}>
            {!periodicidad && <Texto>{r.seRepite.etiqueta}</Texto>}
            <Texto variante={periodicidad ? 'cuerpo' : 'ayuda'}>{valorDeRepite}</Texto>
          </View>
          <BotonDeTexto pista={valorDeRepite} alTocar={() => navigation.navigate('SeRepite')}>
            {r.seRepite.cambiar}
          </BotonDeTexto>
        </View>
      )}
      {/* Es un error del formulario: no se anuncia como estado, lo lee TalkBack cuando `avisarErrores` le lleva el foco. */}
      {errores.repeticion && <Aviso ref={avisoDeRepeticion} tipo="atencion" titulo={errores.repeticion} viva={false} />}
      <Boton
        variante={conTexto && !borrador.delCuadro ? 'secundario' : 'primario'}
        deshabilitado={enviando}
        alTocar={() => void enviar()}
      >
        {corregir ? textos.movimientos.detalle.guardarCambios : conPaso ? r.revisarYGuardar : r.guardar}
      </Boton>
      {corregir && (
        <Boton variante="secundario" alTocar={() => navigation.goBack()}>
          {textos.movimientos.detalle.ahoraNo}
        </Boton>
      )}
      {aviso && (
        <Boton variante="secundario" alTocar={() => void enviar()}>
          {textos.acciones.intentarDeNuevo}
        </Boton>
      )}
    </Pantalla>
  );
}

// El formulario de registro: se llega desde «Registrar» de PN-01 y vuelve a PN-01 al guardar (D-164).
export const Registrar = ({ navigation }: NativeStackScreenProps<Rutas, 'FormularioDeRegistro'>) => (
  <FormularioDeMovimiento navigation={navigation} />
);

// «Corregir» de PN-02: los mismos campos, ya llenos; su Atrás vuelve a PN-02 sin guardar.
export const CorregirMovimiento = ({ navigation, route }: NativeStackScreenProps<Rutas, 'CorregirMovimiento'>) => (
  <FormularioDeMovimiento navigation={navigation} corregir={route.params.movimiento} />
);

const estilos = StyleSheet.create({
  filaDeLista: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espacio['2'],
    minHeight: tokens.tamano['tactil-minimo'],
  },
  columna: { flex: 1 },
  // La tarjeta del resumen de E14-PPN 3.1 (Tarjeta de E14-SDD 5.7 sin título): blanca, borde decorativo y `radio.grande`.
  resumen: {
    gap: tokens.espacio['2'],
    padding: tokens.espacio['4'],
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    borderRadius: tokens.radio.grande,
    backgroundColor: tokens.color.fondo.superficie,
  },
  filaDelResumen: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espacio['2'],
    minHeight: tokens.tamano['tactil-minimo'],
  },
  nombreDeFila: { ...estiloDeTipografia('etiqueta'), color: tokens.color.texto.principal },
});
