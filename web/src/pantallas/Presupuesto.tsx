import { useEffect, useState, type ReactNode } from "react";
import { seguirPorAccesoNegado } from "../accesoNegado";
import type { Respuesta } from "../api/cliente";
import {
  corregirPresupuesto,
  dejarEnCero,
  leerPresupuesto,
  ponerPresupuesto,
  quitarPresupuesto,
  type CategoriaDelPresupuesto,
  type PresupuestoDelPeriodo,
} from "../api/presupuesto";
import { obtenerCategorias, type CategoriaDelApi } from "../api/registro";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { cifras } from "../componentes/Cifras";
import { MarcaDeOculta } from "../componentes/MarcaDeOculta";
import { Pagina } from "../componentes/Pagina";
import { formatearPesos, leerMonto } from "../dinero";
import { useFocoPendiente } from "../enfoque";
import { hoyEnColombia } from "../fechas";
import { avisoDeLlegada } from "../llegada";
import {
  avisoDeFallo,
  textosDeErrorDeRegistro,
  type DatosDeAviso,
} from "../textos";
import {
  avisosDePresupuesto,
  mesEnMinuscula,
  nombreDeCategoria,
  seSumaCuando,
  textosDeCategoria,
} from "../textosDePresupuesto";
import { formatear, textos } from "../textos/es.generated";
import { textoDelMonto } from "../validacionDeRegistro";
import {
  HojaDeMontoDelPresupuesto,
  HojaDeQuitar,
  ID_DEL_AVISO_DE_LA_HOJA,
  ID_DEL_MONTO,
} from "./HojasDePresupuesto";

type Estado =
  | { fase: "cargando" }
  | { fase: "error"; aviso: DatosDeAviso }
  | { fase: "listo"; datos: PresupuestoDelPeriodo; gasto: CategoriaDelApi[] };

/** La hoja abierta: la de una fila de «Por categoría» o la de una categoría de «Agregar otra categoría». */
type HojaAbierta = {
  tipo: "monto" | "quitar";
  categoriaId: number;
  presupuesto: CategoriaDelPresupuesto["presupuesto"];
  desdeOtra: boolean;
  /** El botón que la abrió: ahí vuelve el foco al cerrarla. */
  abridor: string;
};

type Fallo = Extract<Respuesta<unknown>, { ok: false }>;

const t = textos.presupuesto;

/** Un `422` que solo señala el monto va al campo, con el texto de E14-PPN 3.1; lo demás es un aviso. */
function errorDelMonto(respuesta: Fallo): string | undefined {
  if (respuesta.codigo !== "datos_invalidos") return undefined;
  const campos = Object.entries(respuesta.campos);
  const [campo, codigo = ""] = campos[0] ?? [];
  return campos.length === 1 && campo === "monto_centavos"
    ? textosDeErrorDeRegistro[codigo]
    : undefined;
}

const FilaConValor = ({
  etiqueta,
  centavos,
}: {
  etiqueta: string;
  centavos: string;
}) => (
  <p className="fila-con-valor">
    <span>{etiqueta}</span>
    <span className="cifra">{formatearPesos(BigInt(centavos))}</span>
  </p>
);

// Monto · Grande · Neutro (E14-SDD 5.5): nunca en Atención, tampoco en PN-07 (RNF-017).
const CifraGrande = ({
  etiqueta,
  centavos,
}: {
  etiqueta: string;
  centavos: string;
}) => (
  <p className="cifra-grande">
    <span>{etiqueta}</span>
    <span className="monto-grande cifra">
      {formatearPesos(BigInt(centavos))}
    </span>
  </p>
);

// La tarjeta «Tu presupuesto este mes»: la de PN-06 con `normal` y la de PN-07 con un ingreso bajo o nulo (D-094, P-3).
// Describe sin calificar: sin Atención, sin rojo y sin signo menos (RNF-017). «Llega después» y «Por confirmar» son dos
// líneas, cada una solo con su total mayor que cero (L14 de la US-77).
function Resumen({ datos }: { datos: PresupuestoDelPeriodo }) {
  const r = datos.resumen;
  const asignado = BigInt(r.asignado_centavos);
  const llegaDespues = BigInt(r.llega_despues_centavos);
  const porConfirmar = BigInt(r.por_confirmar_centavos);
  const frase = seSumaCuando(datos.llega_despues);
  return (
    <section className="tarjeta" aria-labelledby="titulo-resumen">
      <h2 id="titulo-resumen" className="titulo-3">
        {t.resumen.titulo}
      </h2>
      {r.modo === "ingreso_nulo" ? (
        <CifraGrande
          etiqueta={t.resumen.ingresoRegistrado}
          centavos={r.ingreso_registrado_centavos}
        />
      ) : (
        <FilaConValor
          etiqueta={t.resumen.ingresoRegistrado}
          centavos={r.ingreso_registrado_centavos}
        />
      )}
      {(r.modo !== "ingreso_nulo" || asignado > 0n) && (
        <FilaConValor
          etiqueta={t.resumen.asignado}
          centavos={r.asignado_centavos}
        />
      )}
      {r.modo === "normal" && r.sin_asignar_centavos !== null && (
        <CifraGrande
          etiqueta={t.resumen.sinAsignar}
          centavos={r.sin_asignar_centavos}
        />
      )}
      {llegaDespues > 0n && (
        <p>
          {cifras(
            formatear(t.resumen.llegaDespues, {
              monto: formatearPesos(llegaDespues),
            }),
          )}
        </p>
      )}
      {porConfirmar > 0n && (
        <p>
          {cifras(
            formatear(t.resumen.porConfirmar, {
              monto: formatearPesos(porConfirmar),
            }),
          )}
        </p>
      )}
      {r.modo === "normal" && (
        <p className="ayuda">
          {t.resumen.cuentaLoRegistrado}
          {frase && <> {cifras(frase)}</>}
        </p>
      )}
      {r.modo === "ingreso_bajo" && r.asignado_supera_por_centavos && (
        <p>
          {cifras(
            formatear(t.resumen.bajo, {
              monto: formatearPesos(BigInt(r.asignado_supera_por_centavos)),
            }),
          )}
        </p>
      )}
      {r.modo === "ingreso_nulo" && <p>{t.resumen.nulo}</p>}
      <BotonEnlace href="/ingresos" variante="texto">
        {t.resumen.verMisIngresos}
      </BotonEnlace>
    </section>
  );
}

// PN-06 · Presupuesto del periodo por categorías y PN-07 con un ingreso bajo o nulo (E14-PPA 4.1 y 4.2): una sola ruta,
// el destino «Presupuesto», que cambia la tarjeta de resumen según el modo del API. Siempre el mes en curso (D-094).
// Variante web: «Registrar» arriba y dos columnas, el resumen (5/12) y «Por categoría» (7/12); por debajo de 768 px, la
// columna de Android. Sin «Para mirar con calma» (L3 de la US-77, punto 1).
export function Presupuesto() {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [aviso, setAviso] = useState(avisoDeLlegada);
  const [hoja, setHoja] = useState<HojaAbierta | null>(null);
  const [monto, setMonto] = useState("");
  const [errorDeMonto, setErrorDeMonto] = useState<string>();
  const [avisoDeHoja, setAvisoDeHoja] = useState<DatosDeAviso | null>(null);
  const [avisoDeEnCero, setAvisoDeEnCero] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [verOtras, setVerOtras] = useState(false);
  const pedirFoco = useFocoPendiente();

  useEffect(() => {
    let vigente = true;
    void Promise.all([leerPresupuesto(), obtenerCategorias()]).then(
      ([presupuesto, categorias]) => {
        if (!vigente) return;
        if (presupuesto.ok && categorias.ok)
          setEstado({
            fase: "listo",
            datos: presupuesto.cuerpo,
            gasto: categorias.cuerpo.gasto,
          });
        else {
          const fallo = presupuesto.ok ? categorias : presupuesto;
          if (!fallo.ok && !seguirPorAccesoNegado(fallo))
            setEstado({
              fase: "error",
              aviso: avisoDeFallo(fallo, avisosDePresupuesto.errorAlCargar),
            });
        }
      },
    );
    return () => {
      vigente = false;
    };
  }, [intento]);

  const datos = estado.fase === "listo" ? estado.datos : null;
  const periodo = datos?.periodo ?? hoyEnColombia().slice(0, 7);
  const mes = mesEnMinuscula(periodo);
  // Después de guardar se vuelve a pedir el presupuesto sin vaciar la pantalla.
  const refrescar = () => setIntento((n) => n + 1);

  const abrir = (nueva: HojaAbierta) => {
    setHoja(nueva);
    setMonto(
      nueva.presupuesto
        ? formatearPesos(BigInt(nueva.presupuesto.monto_centavos))
        : "",
    );
    setErrorDeMonto(undefined);
    setAvisoDeHoja(null);
  };
  const cerrar = () => {
    setHoja(null);
    if (hoja) pedirFoco(hoja.abridor);
  };
  const terminar = (nuevo: DatosDeAviso) => {
    setHoja(null);
    setAviso(nuevo);
    refrescar();
    pedirFoco("titulo-de-pagina");
  };
  const empezar = () => {
    setAvisoDeHoja(null);
    setAvisoDeEnCero(null);
    setAviso(null);
    setEnviando(true);
  };
  // El presupuesto ya no existe (404) o el mes cambió (409): se vuelve a pedir. La hoja sigue abierta con el aviso.
  const fallarEnLaHoja = (respuesta: Fallo) => {
    if (respuesta.estado === 404 || respuesta.estado === 409) refrescar();
    setAvisoDeHoja(avisoDeFallo(respuesta, avisosDePresupuesto.errorAlGuardar));
    pedirFoco(ID_DEL_AVISO_DE_LA_HOJA);
  };

  async function guardar() {
    if (!hoja || !datos || enviando) return;
    const lectura = leerMonto(monto);
    if (!lectura.ok) {
      setErrorDeMonto(textoDelMonto(lectura));
      pedirFoco(ID_DEL_MONTO);
      return;
    }
    setErrorDeMonto(undefined);
    empezar();
    const respuesta = hoja.presupuesto
      ? await corregirPresupuesto(hoja.presupuesto.id, lectura.centavos)
      : await ponerPresupuesto(
          datos.periodo,
          hoja.categoriaId,
          lectura.centavos,
        );
    setEnviando(false);
    if (respuesta.ok)
      return terminar(
        avisosDePresupuesto.guardamos(nombreDeCategoria(hoja.categoriaId)),
      );
    if (seguirPorAccesoNegado(respuesta)) return;
    const delCampo = errorDelMonto(respuesta);
    if (delCampo) {
      setErrorDeMonto(delCampo);
      pedirFoco(ID_DEL_MONTO);
    } else fallarEnLaHoja(respuesta);
  }

  async function quitar() {
    if (!hoja?.presupuesto || enviando) return;
    empezar();
    const respuesta = await quitarPresupuesto(hoja.presupuesto.id);
    setEnviando(false);
    if (respuesta.ok)
      return terminar(
        avisosDePresupuesto.quitamos(nombreDeCategoria(hoja.categoriaId)),
      );
    if (!seguirPorAccesoNegado(respuesta)) fallarEnLaHoja(respuesta);
  }

  // «Dejar el presupuesto en cero» (CU-10 2a): no es destructivo y no pide confirmación (E14-PPA 4.2).
  async function enCero() {
    if (!datos || enviando) return;
    empezar();
    const respuesta = await dejarEnCero(datos.periodo);
    setEnviando(false);
    if (respuesta.ok)
      return terminar(avisosDePresupuesto.enCero(datos.periodo));
    if (seguirPorAccesoNegado(respuesta)) return;
    if (respuesta.estado === 409) refrescar();
    setAvisoDeEnCero(
      avisoDeFallo(respuesta, avisosDePresupuesto.errorAlGuardar),
    );
    pedirFoco("aviso-en-cero");
  }

  const hojaDe = (categoriaId: number, desdeOtra: boolean) => {
    if (hoja?.categoriaId !== categoriaId || hoja.desdeOtra !== desdeOtra)
      return null;
    const categoria = nombreDeCategoria(categoriaId);
    return hoja.tipo === "quitar" ? (
      <HojaDeQuitar
        categoria={categoria}
        aviso={avisoDeHoja}
        enviando={enviando}
        alQuitar={() => void quitar()}
        alCerrar={cerrar}
      />
    ) : (
      <HojaDeMontoDelPresupuesto
        titulo={formatear(
          hoja.presupuesto ? t.hoja.tituloCorregir : t.hoja.titulo,
          { categoria },
        )}
        mes={mes}
        monto={monto}
        error={errorDeMonto}
        aviso={avisoDeHoja}
        enviando={enviando}
        alCambiar={setMonto}
        alGuardar={() => void guardar()}
        alCerrar={cerrar}
      />
    );
  };

  const filaDe = (c: CategoriaDelPresupuesto, editable: boolean) => {
    const id = c.categoria_id;
    const tx = textosDeCategoria(c);
    const abrirDesde = (tipo: HojaAbierta["tipo"], abridor: string) => () =>
      abrir({
        tipo,
        categoriaId: id,
        presupuesto: c.presupuesto,
        desdeOtra: false,
        abridor,
      });
    return (
      <li key={id} className="fila-de-presupuesto">
        <span className="fila">
          <span className="fila__nombre">
            {cifras(tx.categoria)}
            {c.oculta && <MarcaDeOculta />}
          </span>
          <span className="ayuda">{cifras(tx.apoyo)}</span>
          {tx.estado && <span className="pequeno">{cifras(tx.estado)}</span>}
        </span>
        {editable && (
          <div className="fila-de-presupuesto__acciones">
            {c.presupuesto ? (
              <>
                <Boton
                  id={`corregir-${id}`}
                  variante="texto"
                  nombre={tx.nombreDeCorregir}
                  alTocar={abrirDesde("monto", `corregir-${id}`)}
                >
                  {t.categorias.corregir}
                </Boton>
                <Boton
                  id={`quitar-${id}`}
                  variante="texto"
                  nombre={tx.nombreDeQuitar}
                  alTocar={abrirDesde("quitar", `quitar-${id}`)}
                >
                  {t.categorias.quitar}
                </Boton>
              </>
            ) : (
              <Boton
                id={`poner-${id}`}
                variante="texto"
                nombre={tx.nombreDePoner}
                alTocar={abrirDesde("monto", `poner-${id}`)}
              >
                {t.categorias.poner}
              </Boton>
            )}
          </div>
        )}
        {hojaDe(id, false)}
      </li>
    );
  };

  const r = datos?.resumen;
  const ofreceEnCero =
    datos?.editable &&
    r?.modo === "ingreso_nulo" &&
    BigInt(r.asignado_centavos) === 0n &&
    !r.en_cero;

  return (
    <Pagina titulo={formatear(t.titulo, { mes })} estado={aviso} registro>
      <div className="presupuesto">
        <div className="presupuesto__columna">
          <BotonEnlace href="/registrar" variante="primario">
            {textos.movimientos.registrar}
          </BotonEnlace>
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
          {datos && <Resumen datos={datos} />}
          {r && r.modo !== "normal" && (
            <BotonEnlace href="/registrar?tipo=ingreso">
              {t.registrarUnIngreso}
            </BotonEnlace>
          )}
          {avisoDeEnCero && <Aviso id="aviso-en-cero" {...avisoDeEnCero} />}
          {ofreceEnCero && (
            <Boton
              variante="texto"
              deshabilitado={enviando}
              alTocar={() => void enCero()}
            >
              {t.resumen.dejarEnCero}
            </Boton>
          )}
        </div>
        {estado.fase === "listo" && (
          <div className="presupuesto__columna">
            <PorCategoria
              datos={estado.datos}
              filas={estado.datos.categorias.map((c) =>
                filaDe(c, estado.datos.editable),
              )}
            />
            {estado.datos.editable && (
              <AgregarOtra
                datos={estado.datos}
                gasto={estado.gasto}
                abierta={verOtras}
                alternar={() => setVerOtras(!verOtras)}
                alElegir={(categoriaId) => {
                  setVerOtras(false);
                  abrir({
                    tipo: "monto",
                    categoriaId,
                    presupuesto: null,
                    desdeOtra: true,
                    abridor: "agregar-otra",
                  });
                }}
              >
                {hoja?.desdeOtra && hojaDe(hoja.categoriaId, true)}
              </AgregarOtra>
            )}
          </div>
        )}
      </div>
    </Pagina>
  );
}

// «Por categoría» (E14-PPA 4.1, fila 4): primero las que tienen presupuesto y después las demás, en el orden del API.
function PorCategoria({
  datos,
  filas,
}: {
  datos: PresupuestoDelPeriodo;
  filas: ReactNode[];
}) {
  const sinGastos =
    datos.resumen.modo === "ingreso_nulo" && datos.categorias.length === 0;
  const sinPresupuestos = !datos.categorias.some((c) => c.presupuesto);
  return (
    <section className="tarjeta" aria-labelledby="titulo-por-categoria">
      <h2 id="titulo-por-categoria" className="titulo-3">
        {t.categorias.titulo}
      </h2>
      {sinGastos ? (
        <p>{t.categorias.sinGastos}</p>
      ) : (
        sinPresupuestos && (
          <>
            <p className="fila__nombre">{t.categorias.sinPresupuestos}</p>
            <p className="ayuda">{t.categorias.elige}</p>
          </>
        )
      )}
      {filas.length > 0 && (
        <ul className="lista-de-filas lista-sin-relleno">{filas}</ul>
      )}
    </section>
  );
}

// «Agregar otra categoría» (fila 5) abre «Ver todas» de E14-PPN 3.1 con las categorías de gasto que la persona ve y que
// todavía no están en «Por categoría»; en la web es una lista debajo del botón, como en el formulario de registro.
// Sin «Elegir cuáles ver»: PN-05 no está construida.
function AgregarOtra({
  datos,
  gasto,
  abierta,
  alternar,
  alElegir,
  children,
}: {
  datos: PresupuestoDelPeriodo;
  gasto: CategoriaDelApi[];
  abierta: boolean;
  alternar: () => void;
  alElegir: (categoriaId: number) => void;
  children: ReactNode;
}) {
  const enLaLista = new Set(datos.categorias.map((c) => c.categoria_id));
  const otras = gasto.filter(
    (c) => !enLaLista.has(c.id) && nombreDeCategoria(c.id),
  );
  return (
    <div className="grupo">
      <Boton
        id="agregar-otra"
        variante="secundario"
        expandido={abierta}
        alTocar={alternar}
      >
        {t.categorias.agregarOtra}
      </Boton>
      {abierta && (
        <ul
          className="lista-de-categorias"
          aria-label={t.categorias.agregarOtra}
        >
          {otras.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => alElegir(c.id)}>
                {nombreDeCategoria(c.id)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}
