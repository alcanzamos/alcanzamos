import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type TextInputInstance } from 'react-native';
import { guardarMovimiento, obtenerCategorias, type CatalogoDeCategorias, type Medio } from '../api/registro';
import { cambiarBorrador, reiniciarBorrador, useBorrador } from '../borradorDeRegistro';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { CampoDeFecha } from '../componentes/CampoDeFecha';
import { CampoDeTexto } from '../componentes/CampoDeTexto';
import { ChipsDeEleccion } from '../componentes/ChipsDeEleccion';
import { HojaInferior } from '../componentes/HojaInferior';
import { IconoCheck } from '../componentes/Iconos';
import { Pantalla } from '../componentes/Pantalla';
import { Texto } from '../componentes/Texto';
import { formatearPesos, leerMonto } from '../dinero';
import { aIso, desdeIso, diaEnPalabras, hoyEnColombia } from '../fechas';
import { estiloDeTipografia } from '../fuentes';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import { reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import {
  avisoDeFallo,
  avisoDeRegistro,
  avisoErrorAlGuardarMovimiento,
  avisos,
  etiquetasDePeriodicidad,
  nombresDeCategoria,
  textosDeErrorDeRegistro,
  type DatosDeAviso,
} from '../textos';
import { formatear, textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { campoDeApi, CAMPOS, validarRegistro, type Errores } from '../validacionDeRegistro';

type Catalogo =
  | { fase: 'cargando' }
  | { fase: 'error'; aviso: DatosDeAviso }
  | { fase: 'listo'; categorias: CatalogoDeCategorias };

const LARGO_DE_LA_DESCRIPCION = 280;
const SOLO_MIO = 'solo_mio';
const r = textos.registro;

// PN-01 · Formulario de registro, variante Android (E14-PPN 3.1, D-164). Mismo flujo, textos y errores del API que la web.
// Sin el cuadro de lenguaje natural, el aviso de faltante, «Tarjeta», «Cuotas», PN-04, PN-05 ni «Compartido con el
// hogar»: esas filas no se dibujan (README de movil). Al guardar vuelve a PN-71 con el aviso como mensaje de estado.
export function Registrar({ navigation }: NativeStackScreenProps<Rutas, 'FormularioDeRegistro'>) {
  const borrador = useBorrador();
  const [catalogo, setCatalogo] = useState<Catalogo>({ fase: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const campoDeMonto = useRef<TextInputInstance>(null);
  const campoDeDescripcion = useRef<TextInputInstance>(null);
  const { height } = useWindowDimensions();

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
  const categorias =
    catalogo.fase === 'listo'
      ? catalogo.categorias[borrador.tipo].flatMap((c) => {
          const nombre = nombresDeCategoria[`c${c.id}`];
          return nombre ? [{ ...c, nombre }] : [];
        })
      : [];
  // La categoría es obligatoria hasta que exista el motor de reglas que la sugiere (D-165): sin elegir, no hay ninguna.
  const categoriaId = categorias.find((c) => c.id === borrador.categoriaId)?.id ?? null;

  const mostrar = (nuevos: Errores) => {
    setErrores(nuevos);
    const primero = CAMPOS.find((campo) => nuevos[campo]);
    if (primero === 'monto') campoDeMonto.current?.focus();
    else if (primero === 'descripcion') campoDeDescripcion.current?.focus();
  };

  async function enviar() {
    if (enviando) return;
    const revisado = validarRegistro(borrador, categoriaId);
    setAviso(null);
    if ('errores' in revisado) {
      mostrar(revisado.errores);
      return;
    }
    setErrores({});
    setEnviando(true);
    const respuesta = await guardarMovimiento(revisado.solicitud);
    setEnviando(false);
    const { solicitud } = revisado;
    if (respuesta.ok) {
      reiniciarBorrador();
      const aviso = avisoDeRegistro(
        solicitud.tipo,
        solicitud.fecha,
        respuesta.cuerpo.movimiento_id !== null,
        solicitud.montoCentavos,
      );
      // PN-71 queda como la única pantalla de la pila: el Atrás no vuelve al formulario.
      reemplazarPila(navigation, 'SeguridadDeLaCuenta', { aviso });
      return;
    }
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
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
      mostrar(delCampo);
      return;
    }
    setErrores({});
    setAviso(avisoDeFallo(respuesta, avisoErrorAlGuardarMovimiento(solicitud.tipo)));
  }

  function elegirCategoria(id: number) {
    cambiarBorrador({ categoriaId: id });
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

  return (
    <Pantalla conBarra>
      {aviso && <Aviso {...aviso} />}
      <ChipsDeEleccion
        etiqueta={r.tipo.etiqueta}
        opciones={[
          { valor: 'gasto', etiqueta: r.tipo.gasto },
          { valor: 'ingreso', etiqueta: r.tipo.ingreso },
        ]}
        valor={borrador.tipo}
        alElegir={(tipo) => cambiarBorrador({ tipo })}
        error={errores.tipo}
      />
      <CampoDeTexto
        ref={campoDeMonto}
        etiqueta={r.monto.etiqueta}
        teclado="decimal-pad"
        cifra
        valor={borrador.monto}
        alCambiar={(monto) => cambiarBorrador({ monto })}
        alSalir={() => {
          const lectura = leerMonto(borrador.monto);
          if (lectura.ok) cambiarBorrador({ monto: formatearPesos(lectura.centavos) });
        }}
        error={errores.monto}
      />
      <CampoDeFecha
        etiqueta={r.fecha.etiqueta}
        valor={desdeIso(fecha)}
        texto={fecha === hoy ? r.fecha.hoy : (diaEnPalabras(fecha) ?? undefined)}
        alCambiar={(nueva) => cambiarBorrador({ fecha: aIso(nueva) })}
        error={errores.fecha}
      />
      <ChipsDeEleccion
        etiqueta={r.categoria.etiqueta}
        enFila
        opciones={categorias.map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
        valor={categoriaId}
        alElegir={elegirCategoria}
        error={errores.categoria}
      />
      <BotonDeTexto alTocar={() => setVerTodas(true)}>{r.categoria.verTodas}</BotonDeTexto>
      <HojaInferior visible={verTodas} alCerrar={() => setVerTodas(false)}>
        <ScrollView style={{ maxHeight: height * 0.6 }}>
          <View accessibilityRole="radiogroup">
            {categorias.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: c.id === categoriaId }}
                onPress={() => elegirCategoria(c.id)}
                style={estilos.filaDeLista}
              >
                <Text style={estilos.textoDeFila}>{c.nombre}</Text>
                {c.id === categoriaId && <IconoCheck color={tokens.color.texto.marca} />}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </HojaInferior>
      <ChipsDeEleccion
        etiqueta={r.medio.etiqueta}
        opciones={medios}
        valor={borrador.medio}
        alElegir={(medio) => cambiarBorrador({ medio })}
        error={errores.medio}
      />
      <ChipsDeEleccion etiqueta={r.quien.etiqueta} opciones={[{ valor: SOLO_MIO, etiqueta: r.quien.soloMio }]} valor={SOLO_MIO} />
      <CampoDeTexto
        ref={campoDeDescripcion}
        etiqueta={r.descripcion.etiqueta}
        ayuda={r.descripcion.ayuda}
        maxLength={LARGO_DE_LA_DESCRIPCION}
        valor={borrador.descripcion}
        alCambiar={(descripcion) => cambiarBorrador({ descripcion })}
        error={errores.descripcion}
      />
      <View style={estilos.filaDeLista}>
        <View style={estilos.columna}>
          {!periodicidad && <Texto>{r.seRepite.etiqueta}</Texto>}
          <Texto variante={periodicidad ? 'cuerpo' : 'ayuda'}>{valorDeRepite}</Texto>
        </View>
        <BotonDeTexto pista={valorDeRepite} alTocar={() => navigation.navigate('SeRepite')}>
          {r.seRepite.cambiar}
        </BotonDeTexto>
      </View>
      {errores.repeticion && <Aviso tipo="atencion" titulo={errores.repeticion} />}
      <Boton deshabilitado={enviando} alTocar={() => void enviar()}>
        {r.guardar}
      </Boton>
      {aviso && (
        <Boton variante="secundario" alTocar={() => void enviar()}>
          {textos.acciones.intentarDeNuevo}
        </Boton>
      )}
    </Pantalla>
  );
}

const estilos = StyleSheet.create({
  filaDeLista: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espacio['2'],
    minHeight: tokens.tamano['tactil-minimo'],
  },
  columna: { flex: 1 },
  textoDeFila: { ...estiloDeTipografia('cuerpo'), flex: 1, color: tokens.color.texto.principal },
});
