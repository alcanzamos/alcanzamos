import { useEffect, useState } from "react";
import { seguirPorAccesoNegado } from "../accesoNegado";
import {
  listarIngresos,
  type FuenteDeIngreso,
  type IngresoDelPeriodo,
  type IngresosDelPeriodo,
} from "../api/presupuesto";
import type { FechaPorConfirmar } from "../api/repeticiones";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { ChipsDeEleccion } from "../componentes/ChipsDeEleccion";
import { cifras } from "../componentes/Cifras";
import { IconoAtras } from "../componentes/Iconos";
import { MarcaDeOculta } from "../componentes/MarcaDeOculta";
import { Pagina } from "../componentes/Pagina";
import { formatearPesos } from "../dinero";
import { useFocoPendiente } from "../enfoque";
import { alTocarEnlace, navegar, useUbicacion } from "../enrutador";
import { mesAnterior, mesEnPalabras, mesSiguiente } from "../fechas";
import { avisoDeLlegada } from "../llegada";
import { avisoDeFallo, type DatosDeAviso } from "../textos";
import {
  avisoErrorAlCargarIngresos,
  textosDeIngreso,
} from "../textosDeIngresos";
import { nombreDeCategoria } from "../textosDePresupuesto";
import { textos } from "../textos/es.generated";
import { ConfirmarTodos } from "./ConfirmarTodos";
import {
  AccionesPorConfirmar,
  usePorConfirmar,
  type ControlDePorConfirmar,
} from "./PorConfirmar";

type Estado =
  | { fase: "cargando" }
  | { fase: "error"; aviso: DatosDeAviso }
  | { fase: "listo"; datos: IngresosDelPeriodo };

const i = textos.ingresos;

// El periodo y «Confirmar todos» viven en la dirección, como en PN-01: atrás, adelante y recargar los conservan.
function direccion(periodo: string | null, confirmarTodos = false) {
  const consulta = new URLSearchParams();
  if (periodo) consulta.set("periodo", periodo);
  if (confirmarTodos) consulta.set("confirmar", "todos");
  return consulta.size > 0 ? `/ingresos?${consulta}` : "/ingresos";
}

/** Las fechas por confirmar del periodo, con lo que piden «Confirmar», «Más» y «Confirmar todos» de la US-60. */
const porConfirmarDe = (fuente: FuenteDeIngreso, ingreso: IngresoDelPeriodo) =>
  ingreso.marca === "por_confirmar" && ingreso.recurrente_id
    ? {
        recurrente_id: ingreso.recurrente_id,
        fecha: ingreso.fecha,
        tipo: "ingreso" as const,
        categoria_id: fuente.categoria_id,
        medio: ingreso.medio,
        monto_habitual_centavos: ingreso.monto_centavos,
      }
    : null;

// PN-08 · Ingresos del periodo de varias fuentes (E14-PPA 4.3): el periodo, el total, una tarjeta por fuente y
// «Registrar un ingreso». Lo esperado y lo por confirmar son los de la US-60, con sus rutas («Confirmar», «Más» y
// «Confirmar todos»). Variante web: el periodo y el total a la izquierda (5/12) y las fuentes a la derecha (7/12);
// «Confirmar todos» ocupa la columna derecha, como en PN-01. Sin «Prima, cesantías o intereses» (L3 de la US-77, punto 4).
export function Ingresos() {
  const { parametros } = useUbicacion();
  const periodo = parametros.get("periodo");
  const confirmarTodos = parametros.get("confirmar") === "todos";
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [aviso, setAviso] = useState(avisoDeLlegada);
  const [verMeses, setVerMeses] = useState(false);
  const pedirFoco = useFocoPendiente();

  useEffect(() => {
    let vigente = true;
    void listarIngresos(periodo).then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) setEstado({ fase: "listo", datos: respuesta.cuerpo });
      else if (!seguirPorAccesoNegado(respuesta))
        setEstado({
          fase: "error",
          aviso: avisoDeFallo(respuesta, avisoErrorAlCargarIngresos),
        });
    });
    return () => {
      vigente = false;
    };
  }, [periodo, intento]);

  const refrescar = () => setIntento((n) => n + 1);
  // Después de confirmar o de «Guardar» se vuelve a pedir el periodo, sin vaciar la pantalla.
  const alTerminar = (nuevo: DatosDeAviso) => {
    setAviso(nuevo);
    refrescar();
    if (confirmarTodos) navegar(direccion(periodo), true);
    pedirFoco("titulo-de-pagina");
  };
  const control = usePorConfirmar({
    alEmpezar: () => setAviso(null),
    alTerminar,
    refrescar,
    idDelAviso: "aviso-ingresos",
  });
  const ir = (destino: string) => {
    setVerMeses(false);
    navegar(destino);
  };

  const datos = estado.fase === "listo" ? estado.datos : null;
  const pendientes =
    datos?.fuentes.flatMap((f) =>
      f.ingresos.flatMap((ingreso) => porConfirmarDe(f, ingreso) ?? []),
    ) ?? [];
  // «Confirmar todos» solo con dos o más fechas (D-093); con una, la fila trae su «Confirmar».
  const todos = confirmarTodos && pendientes.length > 1;

  return (
    <Pagina titulo={i.titulo} atras="/presupuesto" estado={aviso} registro>
      <div className={`presupuesto${todos ? " presupuesto--abierto" : ""}`}>
        <div className="presupuesto__columna">
          {estado.fase === "error" && (
            <>
              <Aviso {...estado.aviso} />
              <Boton
                variante="secundario"
                alTocar={() => {
                  setEstado({ fase: "cargando" });
                  refrescar();
                }}
              >
                {textos.acciones.intentarDeNuevo}
              </Boton>
            </>
          )}
          {datos && (
            <Periodo
              datos={datos}
              elegido={periodo}
              verMeses={verMeses}
              alternarMeses={() => setVerMeses(!verMeses)}
              ir={ir}
            />
          )}
          {datos && (
            <Total
              datos={datos}
              hrefDeTodos={direccion(periodo, true)}
              conTodos={pendientes.length > 1}
            />
          )}
        </div>
        {datos && (
          <div className="presupuesto__columna presupuesto__detalle">
            {todos ? (
              <ConfirmarTodos
                datos={{ pendientes }}
                atras={direccion(periodo)}
                alVolver={() => pedirFoco("confirmar-todos")}
                alEmpezar={() => setAviso(null)}
                alTerminar={alTerminar}
                refrescar={refrescar}
              />
            ) : (
              <>
                {control.error && (
                  <Aviso id="aviso-ingresos" {...control.error} />
                )}
                {datos.fuentes.length === 0 && (
                  <section className="tarjeta">
                    <p className="fila__nombre">{i.vacio.titulo}</p>
                    <p>{i.vacio.mensaje}</p>
                  </section>
                )}
                {datos.fuentes.map((fuente) => (
                  <Fuente
                    key={fuente.categoria_id}
                    fuente={fuente}
                    periodo={datos.periodo}
                    control={control}
                  />
                ))}
                <BotonEnlace href="/registrar?tipo=ingreso">
                  {textos.presupuesto.registrarUnIngreso}
                </BotonEnlace>
              </>
            )}
          </div>
        )}
      </div>
    </Pagina>
  );
}

// «Periodo» (fila 2): el mes anterior, el actual y el siguiente siempre; «Otro mes», con los meses con ingresos
// registrados (L6 de la US-77, punto 7, como en PN-01). Un mes elegido que no está entre los chips sale como chip.
function Periodo({
  datos,
  elegido,
  verMeses,
  alternarMeses,
  ir,
}: {
  datos: IngresosDelPeriodo;
  elegido: string | null;
  verMeses: boolean;
  alternarMeses: () => void;
  ir: (destino: string) => void;
}) {
  const actual = datos.periodo_actual;
  const periodo = elegido ?? actual;
  const periodos = [
    ...new Set([mesAnterior(actual), actual, mesSiguiente(actual), periodo]),
  ];
  return (
    <>
      <ChipsDeEleccion
        id="periodo-de-ingresos"
        etiqueta={textos.movimientos.periodo}
        enFila
        opciones={periodos.map((p) => ({
          valor: p,
          etiqueta: mesEnPalabras(p) ?? p,
        }))}
        valor={periodo}
        alElegir={(p) => ir(direccion(p))}
      />
      <div className="grupo">
        <Boton variante="texto" expandido={verMeses} alTocar={alternarMeses}>
          {textos.movimientos.otroMes}
        </Boton>
        {verMeses && (
          <ul className="lista-de-categorias">
            {datos.meses.map((mes) => (
              <li key={mes}>
                <button
                  type="button"
                  aria-pressed={mes === periodo}
                  onClick={() => ir(direccion(mes))}
                >
                  {mesEnPalabras(mes, true) ?? mes}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// «Entran este mes» (fila 3): registrado más esperado; si el periodo ya terminó, «Entraron este mes». Sin comparar con
// otro periodo (RNF-017). Con dos o más fechas por confirmar suma el Botón de texto «Confirmar todos» (D-093).
function Total({
  datos,
  hrefDeTodos,
  conTodos,
}: {
  datos: IngresosDelPeriodo;
  hrefDeTodos: string;
  conTodos: boolean;
}) {
  const { total } = datos;
  return (
    <section className="tarjeta" aria-labelledby="titulo-del-total">
      <h2 id="titulo-del-total" className="titulo-3">
        {datos.periodo < datos.periodo_actual
          ? i.total.entraron
          : i.total.entran}
      </h2>
      <p className="monto-grande cifra">
        {formatearPesos(BigInt(total.entran_centavos))}
      </p>
      <p className="fila-con-valor">
        <span>{i.total.yaRegistrado}</span>
        <span className="cifra">
          {formatearPesos(BigInt(total.registrado_centavos))}
        </span>
      </p>
      <p className="fila-con-valor">
        <span>{i.total.esperado}</span>
        <span className="cifra">
          {formatearPesos(BigInt(total.esperado_centavos))}
        </span>
      </p>
      {conTodos && (
        <BotonEnlace id="confirmar-todos" href={hrefDeTodos} variante="texto">
          {textos.porConfirmar.confirmarTodos}
        </BotonEnlace>
      )}
    </section>
  );
}

// Una tarjeta por fuente (fila 4): su nombre y su total, y una fila por fecha. Lo registrado abre PN-02; lo esperado
// no se toca; lo por confirmar lleva «Confirmar» y «Más» de la US-60 (E14-PRR 7.1, propuesta 3).
function Fuente({
  fuente,
  periodo,
  control,
}: {
  fuente: FuenteDeIngreso;
  periodo: string;
  control: ControlDePorConfirmar;
}) {
  const id = `fuente-${fuente.categoria_id}`;
  return (
    <section className="tarjeta" aria-labelledby={id}>
      <div className="fila-con-valor">
        <h2 id={id} className="titulo-3">
          {nombreDeCategoria(fuente.categoria_id)}
          {fuente.oculta && <MarcaDeOculta />}
        </h2>
        <span className="cifra titulo-3">
          {formatearPesos(BigInt(fuente.total_centavos))}
        </span>
      </div>
      <ul className="lista-de-filas lista-sin-relleno">
        {fuente.ingresos.map((ingreso) => (
          <FilaDeIngreso
            key={`${ingreso.fecha}-${ingreso.movimiento_id ?? ingreso.recurrente_id}`}
            ingreso={ingreso}
            porConfirmar={porConfirmarDe(fuente, ingreso)}
            periodo={periodo}
            control={control}
          />
        ))}
      </ul>
    </section>
  );
}

function FilaDeIngreso({
  ingreso,
  porConfirmar,
  periodo,
  control,
}: {
  ingreso: IngresoDelPeriodo;
  porConfirmar: FechaPorConfirmar | null;
  periodo: string;
  control: ControlDePorConfirmar;
}) {
  const t = textosDeIngreso(ingreso);
  const datos = (
    <>
      <span className="fila">
        <span className="fila__nombre">{cifras(t.fecha)}</span>
        <span className="ayuda">{cifras(t.apoyo)}</span>
        <span className="pequeno">{t.marca}</span>
      </span>
      <span className="cifra">
        {formatearPesos(BigInt(ingreso.monto_centavos))}
      </span>
    </>
  );
  if (porConfirmar)
    return (
      <li className="fila-por-confirmar">
        <div className="fila-por-confirmar__datos">{datos}</div>
        <AccionesPorConfirmar fila={porConfirmar} control={control} />
      </li>
    );
  if (ingreso.movimiento_id) {
    const href = `/movimientos?${new URLSearchParams({ periodo, movimiento: ingreso.movimiento_id })}`;
    return (
      <li>
        <a href={href} className="fila-navegable" onClick={alTocarEnlace(href)}>
          {datos}
          <IconoAtras />
        </a>
      </li>
    );
  }
  return (
    <li>
      <div className="fila-con-valor">{datos}</div>
    </li>
  );
}
