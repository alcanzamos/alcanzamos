import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  fechasPorConfirmar,
  listarIngresos,
  porConfirmarDe,
  type FuenteDeIngreso,
  type IngresoDelPeriodo,
  type IngresosDelPeriodo,
} from '../api/presupuesto';
import { cambiarBorrador, reiniciarBorrador } from '../borradorDeRegistro';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { ChipsDeEleccion } from '../componentes/ChipsDeEleccion';
import { cifras } from '../componentes/Cifras';
import { HojaDeElecciones } from '../componentes/HojaDeElecciones';
import { IconoSiguiente } from '../componentes/Iconos';
import { MarcaDeOculta } from '../componentes/MarcaDeOculta';
import { Pantalla } from '../componentes/Pantalla';
import { Tarjeta } from '../componentes/Tarjeta';
import { Texto } from '../componentes/Texto';
import { mesAnterior, mesEnPalabras, mesSiguiente } from '../fechas';
import { estiloDeTipografia } from '../fuentes';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, type DatosDeAviso } from '../textos';
import { avisoErrorAlCargarIngresos, textosDeIngreso } from '../textosDeIngresos';
import { nombreDeCategoria, pesos, pesosHablados } from '../textosDePresupuesto';
import { textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { AccionesPorConfirmar, HojasPorConfirmar, usePorConfirmar, type ControlDePorConfirmar } from './PorConfirmar';
import { FilaConValor } from './Presupuesto';

type Estado = { fase: 'cargando' } | { fase: 'error'; aviso: DatosDeAviso } | { fase: 'listo'; datos: IngresosDelPeriodo };

const i = textos.ingresos;

// PN-08 · Ingresos del periodo de varias fuentes (E14-PPA 4.3), variante Android: una pantalla de la pila con la barra
// «Ingresos», apilada sobre PN-06 («Ver mis ingresos»), y su Atrás vuelve ahí. El periodo, el total, una tarjeta por
// fuente y «Registrar un ingreso». Lo esperado y lo por confirmar son los de la US-60, con sus rutas: «Confirmar», «Más»
// y, con dos o más fechas, «Confirmar todos» (D-093). El periodo vive en la ruta, como los filtros de PN-01. Sin «Prima,
// cesantías o intereses» (L3 de la US-77, punto 4).
export function Ingresos({ navigation, route }: NativeStackScreenProps<Rutas, 'IngresosDelPeriodo'>) {
  const periodo = route.params?.periodo ?? null;
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [verMeses, setVerMeses] = useState(false);

  // Cada pedido lleva su número: solo el último pinta (otro periodo no se pisa con la respuesta del anterior).
  const ultimo = useRef(0);
  const cargar = useCallback(() => {
    const numero = ++ultimo.current;
    void listarIngresos(periodo).then((respuesta) => {
      if (numero !== ultimo.current) return;
      if (respuesta.ok) setEstado({ fase: 'listo', datos: respuesta.cuerpo });
      else if (!seguirPorAccesoNegado(navigation, respuesta))
        setEstado({ fase: 'error', aviso: avisoDeFallo(respuesta, avisoErrorAlCargarIngresos) });
    });
  }, [navigation, periodo]);
  // Al volver de «Confirmar todos», del formulario o de PN-01 se pide el periodo otra vez.
  useFocusEffect(cargar);

  const control = usePorConfirmar({
    navigation,
    alEmpezar: () => navigation.setParams({ aviso: undefined }),
    // Después de confirmar se vuelve a pedir el periodo, sin vaciar la pantalla.
    alTerminar: (aviso) => {
      navigation.setParams({ aviso });
      cargar();
    },
    refrescar: cargar,
  });

  const elegir = (nuevo: string) => {
    setVerMeses(false);
    navigation.setParams({ periodo: nuevo, aviso: undefined });
  };

  const datos = estado.fase === 'listo' ? estado.datos : null;
  const actual = datos?.periodo_actual ?? '';
  const elegido = datos?.periodo ?? periodo ?? actual;
  // El mes anterior, el actual y el siguiente siempre; un mes de «Otro mes» que no está entre ellos sale como chip (L6 (7)).
  const periodos = [...new Set([mesAnterior(actual), actual, mesSiguiente(actual), elegido])];
  const pendientes = datos ? fechasPorConfirmar(datos) : [];

  return (
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
            etiqueta={textos.movimientos.periodo}
            enFila
            opciones={periodos.map((p) => ({ valor: p, etiqueta: mesEnPalabras(p) ?? p }))}
            valor={elegido}
            alElegir={elegir}
          />
          <BotonDeTexto alTocar={() => setVerMeses(true)}>{textos.movimientos.otroMes}</BotonDeTexto>
          <HojaDeElecciones
            visible={verMeses}
            alCerrar={() => setVerMeses(false)}
            opciones={datos.meses.map((mes) => ({ valor: mes, etiqueta: mesEnPalabras(mes, true) ?? mes }))}
            valor={elegido}
            alElegir={elegir}
          />
          <Total
            datos={datos}
            alConfirmarTodos={
              // «Confirmar todos» solo con dos o más fechas (D-093); con una, la fila trae su «Confirmar».
              pendientes.length > 1
                ? () =>
                    navigation.navigate('ConfirmarTodos', { pendientes: { pendientes }, periodoDeIngresos: datos.periodo })
                : undefined
            }
          />
          {control.error && <Aviso {...control.error} />}
          {datos.fuentes.length === 0 && (
            <Tarjeta titulo={i.vacio.titulo}>
              <Texto>{i.vacio.mensaje}</Texto>
            </Tarjeta>
          )}
          {datos.fuentes.map((f) => (
            <Fuente
              key={f.categoria_id}
              fuente={f}
              control={control}
              alAbrir={(movimiento) =>
                navigation.navigate('ListaDeMovimientos', { periodo: datos.periodo, movimiento })
              }
            />
          ))}
          <Boton
            variante="secundario"
            alTocar={() => {
              // Empieza vacío, con Tipo «Ingreso» (D-164, E14-PPA 4.3 fila 5).
              reiniciarBorrador();
              cambiarBorrador({ tipo: 'ingreso' });
              navigation.navigate('FormularioDeRegistro');
            }}
          >
            {textos.presupuesto.registrarUnIngreso}
          </Boton>
          <HojasPorConfirmar control={control} />
        </>
      )}
    </Pantalla>
  );
}

// «Entran este mes» (fila 3): registrado más esperado; si el periodo ya terminó, «Entraron este mes». Sin comparar con
// otro periodo (RNF-017). Con dos o más fechas por confirmar suma el Botón de texto «Confirmar todos» (D-093).
function Total({ datos, alConfirmarTodos }: { datos: IngresosDelPeriodo; alConfirmarTodos?: () => void }) {
  const { total } = datos;
  const titulo = datos.periodo < datos.periodo_actual ? i.total.entraron : i.total.entran;
  const hablado = [titulo, pesosHablados(total.entran_centavos)].join(', ');
  return (
    <Tarjeta titulo={titulo}>
      <Text accessibilityLabel={hablado} accessibilityHint={undefined} style={estilos.montoGrande}>
        {cifras(pesos(total.entran_centavos), true)}
      </Text>
      <FilaConValor etiqueta={i.total.yaRegistrado} centavos={total.registrado_centavos} />
      <FilaConValor etiqueta={i.total.esperado} centavos={total.esperado_centavos} />
      {alConfirmarTodos && <BotonDeTexto alTocar={alConfirmarTodos}>{textos.porConfirmar.confirmarTodos}</BotonDeTexto>}
    </Tarjeta>
  );
}

// Una tarjeta por fuente (fila 4): su nombre y su total como encabezado, y una fila por fecha. Lo registrado abre su
// PN-02; lo esperado no se toca; lo por confirmar lleva «Confirmar» y «Más» de la US-60 (E14-PRR 7.1, propuesta 3).
function Fuente({
  fuente,
  control,
  alAbrir,
}: {
  fuente: FuenteDeIngreso;
  control: ControlDePorConfirmar;
  alAbrir: (movimiento: string) => void;
}) {
  const nombre = nombreDeCategoria(fuente.categoria_id);
  const encabezado = [nombre, fuente.oculta ? textos.movimientos.oculta : null, pesosHablados(fuente.total_centavos)]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={estilos.tarjeta}>
      <View accessible accessibilityRole="header" accessibilityLabel={encabezado} accessibilityHint={undefined} style={estilos.encabezado}>
        <View style={estilos.nombre}>
          <Text style={estilos.titulo}>{nombre}</Text>
          {fuente.oculta && <MarcaDeOculta color={tokens.color.texto.secundario} />}
        </View>
        <Text style={estilos.titulo}>{cifras(pesos(fuente.total_centavos), true)}</Text>
      </View>
      {fuente.ingresos.map((ingreso) => (
        <FilaDeIngreso
          key={`${ingreso.fecha}-${ingreso.movimiento_id ?? ingreso.recurrente_id}`}
          fuente={fuente}
          ingreso={ingreso}
          control={control}
          alAbrir={alAbrir}
        />
      ))}
    </View>
  );
}

// Una fecha: la fecha en palabras, el medio y la descripción, la marca en texto (nunca solo color) y el monto. TalkBack
// la lee como un solo elemento, con el monto en pesos (ACC-004, D-187).
function FilaDeIngreso({
  fuente,
  ingreso,
  control,
  alAbrir,
}: {
  fuente: FuenteDeIngreso;
  ingreso: IngresoDelPeriodo;
  control: ControlDePorConfirmar;
  alAbrir: (movimiento: string) => void;
}) {
  const t = textosDeIngreso(ingreso);
  const porConfirmar = porConfirmarDe(fuente, ingreso);
  const datos = (
    <>
      <View style={estilos.columna}>
        <Text style={estilos.principal}>{cifras(t.fecha, true)}</Text>
        <Text style={estilos.apoyo}>{cifras(t.apoyo)}</Text>
        <Text style={estilos.apoyo}>{t.marca}</Text>
      </View>
      <Text style={estilos.monto}>{cifras(pesos(ingreso.monto_centavos), true)}</Text>
    </>
  );
  const movimiento = ingreso.movimiento_id;
  if (movimiento)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.etiqueta}
        accessibilityHint={undefined}
        onPress={() => alAbrir(movimiento)}
        style={estilos.fila}
      >
        {datos}
        <IconoSiguiente color={tokens.color.texto.secundario} />
      </Pressable>
    );
  return (
    <View style={estilos.conAcciones}>
      <View accessible accessibilityLabel={t.etiqueta} accessibilityHint={undefined} style={estilos.fila}>
        {datos}
      </View>
      {porConfirmar && <AccionesPorConfirmar fila={porConfirmar} control={control} />}
    </View>
  );
}

const estilos = StyleSheet.create({
  montoGrande: { ...estiloDeTipografia('cifra-grande'), color: tokens.color.texto.principal },
  // Tarjeta de E14-SDD 5.7 con el nombre de la fuente y su total como título (`tipografia.titulo-3`).
  tarjeta: {
    gap: tokens.espacio['2'],
    padding: tokens.espacio['4'],
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    borderRadius: tokens.radio.grande,
    backgroundColor: tokens.color.fondo.superficie,
  },
  encabezado: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.espacio['2'] },
  nombre: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.espacio['2'] },
  titulo: { ...estiloDeTipografia('titulo-3'), color: tokens.color.texto.principal },
  // Una Fila de lista · Navegable con valor (E14-PRR 7.1): toda la fila es el área táctil.
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espacio['3'],
    minHeight: tokens.tamano['tactil-minimo'],
    paddingTop: tokens.espacio['3'],
    borderTopWidth: tokens['ancho-borde'].fino,
    borderTopColor: tokens.color.borde.decorativo,
  },
  conAcciones: { gap: tokens.espacio['2'] },
  columna: { flex: 1, gap: tokens.espacio['1'] },
  principal: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
  apoyo: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  monto: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
});
