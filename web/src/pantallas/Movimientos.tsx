import { useEffect, useState } from "react";
import { seguirPorAccesoNegado } from "../accesoNegado";
import {
  listarMovimientos,
  type Listado,
  type Movimiento,
} from "../api/movimientos";
import { listarPendientes, type Pendientes } from "../api/repeticiones";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { ChipsDeEleccion } from "../componentes/ChipsDeEleccion";
import { cifras } from "../componentes/Cifras";
import { IconoAtras } from "../componentes/Iconos";
import { MarcaDePropiedad } from "../componentes/MarcaDePropiedad";
import { Pagina } from "../componentes/Pagina";
import { formatearPesos } from "../dinero";
import { useFocoPendiente } from "../enfoque";
import { alTocarEnlace, navegar, useUbicacion } from "../enrutador";
import { hoyEnColombia, mesAnterior, mesEnPalabras } from "../fechas";
import { avisoDeLlegada } from "../llegada";
import {
  avisoDeFallo,
  avisos,
  nombresDeCategoria,
  type DatosDeAviso,
} from "../textos";
import { textosDeFila, tituloDelDia } from "../textosDeMovimientos";
import { formatear, plural, textos } from "../textos/es.generated";
import { ConfirmarTodos } from "./ConfirmarTodos";
import { DetalleDeMovimiento } from "./DetalleDeMovimiento";
import { PorConfirmar } from "./PorConfirmar";

type Estado =
  | { fase: "cargando" }
  | { fase: "error"; aviso: DatosDeAviso }
  | { fase: "listo"; datos: Listado; pendientes: Pendientes };

const m = textos.movimientos;
const TODAS = 0;
// Los chips muestran hasta tres categorías; «Ver todas» abre la lista completa (E14-PRR 4.1, fila 4).
const CHIPS_DE_CATEGORIA = 3;

const nombreDe = (id: number) => nombresDeCategoria[`c${id}`] ?? "";

// Los filtros, el movimiento abierto y «Confirmar todos» viven en la dirección: atrás, adelante y recargar los conservan.
function direccion(
  periodo: string | null,
  categoria: number | null,
  movimiento: string | null = null,
  confirmarTodos = false,
) {
  const consulta = new URLSearchParams();
  if (periodo) consulta.set("periodo", periodo);
  if (categoria) consulta.set("categoria", String(categoria));
  if (movimiento) consulta.set("movimiento", movimiento);
  if (confirmarTodos) consulta.set("confirmar", "todos");
  return consulta.size > 0 ? `/movimientos?${consulta}` : "/movimientos";
}

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

// PN-01 · Movimientos: lista y filtros, variante web (E14-PRR 4.1). Dos columnas: la lista a la izquierda y el detalle
// (PN-02) a la derecha, sin cambiar de página. Por debajo de 768 px es una pantalla a la vez, como en Android.
// Con la sección «Por confirmar» (US-60, D-091 a D-093), que abre «Confirmar todos» en la columna derecha. Sin las
// «Horas de vida» (RF-054) ni el contexto «Nuestro hogar».
export function Movimientos() {
  const { parametros } = useUbicacion();
  const periodo = parametros.get("periodo");
  const categoria = Number(parametros.get("categoria")) || null;
  const abierto = parametros.get("movimiento");
  const confirmarTodos = parametros.get("confirmar") === "todos";
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [aviso, setAviso] = useState(avisoDeLlegada);
  const [verMeses, setVerMeses] = useState(false);
  const [verTodas, setVerTodas] = useState(false);
  const pedirFoco = useFocoPendiente();

  useEffect(() => {
    let vigente = true;
    // «Por confirmar» no depende de los filtros (E14-PRR 4.1): se pide junto con la lista.
    void Promise.all([
      listarPendientes(),
      listarMovimientos(periodo, categoria),
    ]).then(([pendientes, lista]) => {
      if (!vigente) return;
      if (lista.ok && pendientes.ok)
        setEstado({
          fase: "listo",
          datos: lista.cuerpo,
          pendientes: pendientes.cuerpo,
        });
      else {
        const fallo = lista.ok ? pendientes : lista;
        if (!fallo.ok && !seguirPorAccesoNegado(fallo))
          setEstado({
            fase: "error",
            aviso: avisoDeFallo(fallo, avisos.errorAlCargarMovimientos),
          });
      }
    });
    return () => {
      vigente = false;
    };
  }, [periodo, categoria, intento]);

  const recargar = () => {
    setEstado({ fase: "cargando" });
    setIntento(intento + 1);
  };
  // Después de confirmar o de «Guardar» se vuelve a pedir lo pendiente y la lista, sin vaciar la pantalla.
  const alTerminarPorConfirmar = (nuevo: DatosDeAviso) => {
    setAviso(nuevo);
    setIntento(intento + 1);
    if (confirmarTodos) navegar(direccion(periodo, categoria), true);
    pedirFoco("titulo-de-pagina");
  };
  const ir = (destino: string) => {
    setVerMeses(false);
    setVerTodas(false);
    navegar(destino);
  };
  // Tras corregir o borrar se vuelve a la lista con el aviso (E14-PRR 4.2); sin aviso, el movimiento ya no existe.
  const terminar = (nuevo: DatosDeAviso | null) => {
    if (nuevo) {
      setAviso(nuevo);
      navegar(direccion(periodo, categoria), true);
    }
    recargar();
  };

  const datos = estado.fase === "listo" ? estado.datos : null;
  const elegido = datos?.movimientos.find((f) => f.id === abierto);
  const hoy = hoyEnColombia();
  // «Confirmar todos» solo se ofrece con más de una fecha (E14-PRR 4.1); con una, la fila trae su propio «Confirmar».
  const pendientes = estado.fase === "listo" ? estado.pendientes : null;
  const todos =
    confirmarTodos && pendientes && pendientes.pendientes.length > 1;

  return (
    <Pagina titulo={m.titulo} estado={aviso} ancha>
      <div
        className={`movimientos${(abierto && datos) || todos ? " movimientos--abierto" : ""}`}
      >
        <div className="movimientos__lista">
          <BotonEnlace href="/registrar" variante="primario">
            {m.registrar}
          </BotonEnlace>
          {estado.fase === "error" && (
            <>
              <Aviso {...estado.aviso} />
              <Boton variante="secundario" alTocar={recargar}>
                {textos.acciones.intentarDeNuevo}
              </Boton>
            </>
          )}
          {pendientes && pendientes.pendientes.length > 0 && !categoria && (
            <PorConfirmar
              datos={pendientes}
              hrefDeTodos={direccion(periodo, categoria, null, true)}
              alEmpezar={() => setAviso(null)}
              alTerminar={alTerminarPorConfirmar}
              refrescar={() => setIntento(intento + 1)}
            />
          )}
          {datos && (
            <Lista
              datos={datos}
              periodoElegido={periodo}
              categoria={categoria}
              abierto={abierto}
              hoy={hoy}
              verMeses={verMeses}
              verTodas={verTodas}
              alternarMeses={() => setVerMeses(!verMeses)}
              alternarTodas={() => setVerTodas(!verTodas)}
              ir={ir}
            />
          )}
        </div>
        <div className="movimientos__detalle">
          {todos ? (
            <ConfirmarTodos
              datos={pendientes}
              atras={direccion(periodo, categoria)}
              alVolver={() => pedirFoco("confirmar-todos")}
              alEmpezar={() => setAviso(null)}
              alTerminar={alTerminarPorConfirmar}
              refrescar={() => setIntento(intento + 1)}
            />
          ) : elegido ? (
            <DetalleDeMovimiento
              key={elegido.id}
              movimiento={elegido}
              atras={direccion(periodo, categoria)}
              alTerminar={terminar}
            />
          ) : datos && abierto ? (
            <>
              <Aviso {...avisos.movimientoNoExiste} />
              <BotonEnlace href={direccion(periodo, categoria)}>
                {textos.movimientos.borrar.irAMovimientos}
              </BotonEnlace>
            </>
          ) : (
            <p className="ayuda">{m.vacio.elegir}</p>
          )}
        </div>
      </div>
    </Pagina>
  );
}

function Lista({
  datos,
  periodoElegido,
  categoria,
  abierto,
  hoy,
  verMeses,
  verTodas,
  alternarMeses,
  alternarTodas,
  ir,
}: {
  datos: Listado;
  /** El de la dirección: el chip elegido sigue al toque, sin esperar a que llegue la lista nueva. */
  periodoElegido: string | null;
  categoria: number | null;
  abierto: string | null;
  hoy: string;
  verMeses: boolean;
  verTodas: boolean;
  alternarMeses: () => void;
  alternarTodas: () => void;
  ir: (destino: string) => void;
}) {
  const { periodo_actual: actual, resumen } = datos;
  const periodo = periodoElegido ?? actual;
  const periodos = [...new Set([actual, mesAnterior(actual), periodo])];
  // Los chips: las tres con más movimientos (sin las ocultas) y, si se eligió otra, esa también.
  const visibles = datos.categorias.filter((c) => !c.oculta);
  const chips = visibles
    .slice(0, CHIPS_DE_CATEGORIA)
    .map((c) => c.categoria_id);
  if (categoria && !chips.includes(categoria)) chips.push(categoria);
  const dias = porDia(datos.movimientos);
  const total = BigInt(resumen.total_centavos ?? 0);
  const cuantos = plural(m.resumen, resumen.movimientos);

  return (
    <>
      <ChipsDeEleccion
        id="filtro-periodo"
        etiqueta={m.periodo}
        enFila
        opciones={periodos.map((p) => ({
          valor: p,
          etiqueta: mesEnPalabras(p) ?? p,
        }))}
        valor={periodo}
        alElegir={(p) => ir(direccion(p, categoria))}
      />
      <div className="grupo">
        <Boton variante="texto" expandido={verMeses} alTocar={alternarMeses}>
          {m.otroMes}
        </Boton>
        {verMeses && (
          <ul className="lista-de-categorias">
            {datos.meses.map((mes) => (
              <li key={mes}>
                <button
                  type="button"
                  aria-pressed={mes === periodo}
                  onClick={() => ir(direccion(mes, categoria))}
                >
                  {mesEnPalabras(mes, true) ?? mes}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ChipsDeEleccion
        id="filtro-categoria"
        etiqueta={textos.registro.categoria.etiqueta}
        enFila
        opciones={[
          { valor: TODAS, etiqueta: m.todas },
          ...chips.map((id) => ({ valor: id, etiqueta: nombreDe(id) })),
        ]}
        valor={categoria ?? TODAS}
        alElegir={(id) => ir(direccion(periodo, id === TODAS ? null : id))}
      />
      <div className="grupo">
        <Boton variante="texto" expandido={verTodas} alTocar={alternarTodas}>
          {textos.registro.categoria.verTodas}
        </Boton>
        {verTodas && (
          <ul className="lista-de-categorias">
            {datos.categorias.map((c) => (
              <li key={c.categoria_id}>
                <button
                  type="button"
                  aria-pressed={c.categoria_id === categoria}
                  onClick={() => ir(direccion(periodo, c.categoria_id))}
                >
                  {nombreDe(c.categoria_id)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {resumen.movimientos > 0 && (
        <p className="ayuda">
          {cifras(
            categoria
              ? formatear(m.resumenDeCategoria, {
                  categoria: nombreDe(categoria),
                  movimientos: cuantos,
                  total: formatearPesos(total),
                })
              : cuantos,
          )}
        </p>
      )}
      {dias.map(({ fecha, filas }) => (
        <section key={fecha} aria-labelledby={`dia-${fecha}`}>
          <h2 id={`dia-${fecha}`} className="titulo-3">
            {cifras(tituloDelDia(fecha, hoy))}
          </h2>
          <ul className="tarjeta lista-de-filas">
            {filas.map((fila) => (
              <Fila
                key={fila.id}
                fila={fila}
                abierto={abierto === fila.id}
                href={direccion(periodo, categoria, fila.id)}
              />
            ))}
          </ul>
        </section>
      ))}
      {resumen.movimientos === 0 && (
        <section className="tarjeta">
          {datos.meses.length === 0 ? (
            <>
              <h2 className="titulo-3">{m.vacio.sinMovimientos}</h2>
              <p>{m.vacio.registraElPrimero}</p>
            </>
          ) : (
            <>
              <h2 className="titulo-3">{m.vacio.sinResultados}</h2>
              <p>{m.vacio.cambiarFiltro}</p>
              <Boton variante="texto" alTocar={() => ir(direccion(null, null))}>
                {m.vacio.quitarFiltros}
              </Boton>
            </>
          )}
        </section>
      )}
    </>
  );
}

// Una Fila de lista navegable con valor (E14-SDD 5.20): toda la fila abre PN-02.
function Fila({
  fila,
  abierto,
  href,
}: {
  fila: Movimiento;
  abierto: boolean;
  href: string;
}) {
  const { principal, apoyo } = textosDeFila(fila);
  return (
    <li>
      <a
        href={href}
        className="fila-navegable"
        aria-current={abierto ? "true" : undefined}
        onClick={alTocarEnlace(href)}
      >
        <span className="fila">
          <span className="fila__nombre">{cifras(principal)}</span>
          <span className="ayuda">{cifras(apoyo)}</span>
          {fila.compartido && <MarcaDePropiedad compartido />}
        </span>
        <span className="cifra">
          {formatearPesos(BigInt(fila.monto_centavos))}
        </span>
        <IconoAtras />
      </a>
    </li>
  );
}
