import { useEffect, useState, type SyntheticEvent } from "react";
import { seguirPorAccesoNegado } from "../accesoNegado";
import { SIN_CONEXION } from "../api/cliente";
import {
  corregirMovimiento,
  interpretarTexto,
  type Interpretacion,
  type Movimiento,
} from "../api/movimientos";
import {
  guardarMovimiento,
  obtenerCategorias,
  type CatalogoDeCategorias,
  type Medio,
} from "../api/registro";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { IconoInformacion } from "../componentes/Iconos";
import { MarcaDeOculta } from "../componentes/MarcaDeOculta";
import { ChipsDeEleccion } from "../componentes/ChipsDeEleccion";
import { cifras } from "../componentes/Cifras";
import { CampoDeTexto } from "../componentes/CampoDeTexto";
import { Pagina } from "../componentes/Pagina";
import {
  borradorDeMovimiento,
  cambiarBorrador,
  reiniciarBorrador,
  useBorrador,
  type Borrador,
} from "../borradorDeRegistro";
import { formatearPesos, leerMonto } from "../dinero";
import { useFocoPendiente } from "../enfoque";
import { alTocarEnlace, navegar, useUbicacion } from "../enrutador";
import { diaEnPalabras, hoyEnColombia } from "../fechas";
import { irConMensaje } from "../llegada";
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
} from "../textos";
import { fechaEnLaFila } from "../textosDeMovimientos";
import { formatear, textos } from "../textos/es.generated";
import {
  campoDeApi,
  CAMPOS,
  validarRegistro,
  type Campo,
  type Errores,
} from "../validacionDeRegistro";

type Catalogo =
  | { fase: "cargando" }
  | { fase: "error"; aviso: DatosDeAviso }
  | { fase: "listo"; categorias: CatalogoDeCategorias };

// Lo que enfoca cada campo con error (el primero de su grupo de chips, el campo de texto o el enlace «Cambiar»).
const idDeFoco: Record<Campo, string> = {
  tipo: "tipo-gasto",
  monto: "monto",
  fecha: "fecha",
  categoria: "ver-todas",
  medio: "medio-efectivo",
  descripcion: "descripcion",
  repeticion: "cambiar-repeticion",
};

const LARGO_DE_LA_DESCRIPCION = 280;
const SOLO_MIO = "solo_mio";
const r = textos.registro;
const LARGO_DEL_CUADRO = 280;

/** «Corregir» de PN-02: los mismos campos, ya llenos (E14-PRR 4.2). `alTerminar(null)` es que el movimiento ya no existe. */
export type Correccion = {
  movimiento: Movimiento;
  alTerminar: (aviso: DatosDeAviso | null) => void;
  alCancelar: () => void;
};

// Formulario de registro, variante web (E14-PPN 3.1, D-164). Con el cuadro de lenguaje natural (US-62) y su paso
// «Revisa y confirma»; sin el aviso de faltante, «Tarjeta», «Cuotas», PN-04, PN-05 ni «Compartido con el hogar»: esas
// filas no se dibujan (README de web). El cuadro solo llena el formulario: lo que interpretó el sistema no se guarda
// sin «Revisa y confirma» (RN-001), y lo que la persona llena a mano se guarda directo (RF-002).
// Con `corregir` es «Corregir» de PN-02 (E14-PRR 4.2): lleva su propio estado, no el borrador, y no ofrece lo que el
// API no deja cambiar. Una fecha de un recurrente no lleva Fecha (D-168). Si el movimiento tiene una categoría que la
// persona ocultó después, el formulario la incluye ya elegida, con el ícono y la palabra «Oculta» (D-170).
// `alCambiarElPaso` recibe «Volver al formulario» al abrirse el paso y `null` al cerrarse: es el Atrás de la barra.
export function FormularioDeMovimiento({
  corregir,
  alCambiarElPaso,
}: {
  corregir?: Correccion;
  alCambiarElPaso?: (volver: (() => void) | null) => void;
}) {
  const delBorrador = useBorrador();
  const [propio, setPropio] = useState<Borrador>(() =>
    corregir ? borradorDeMovimiento(corregir.movimiento) : delBorrador,
  );
  const borrador = corregir ? propio : delBorrador;
  const cambiar = (cambio: Partial<Borrador>) =>
    corregir ? setPropio({ ...propio, ...cambio }) : cambiarBorrador(cambio);
  const original = corregir?.movimiento;
  const esRecurrente = Boolean(original?.recurrente);
  const [catalogo, setCatalogo] = useState<Catalogo>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enPaso, setEnPaso] = useState(false);
  const [interpretando, setInterpretando] = useState(false);
  const [avisoDelCuadro, setAvisoDelCuadro] = useState<DatosDeAviso | null>(
    null,
  );
  const [errorDelCuadro, setErrorDelCuadro] = useState<string>();
  const pedirFoco = useFocoPendiente();

  useEffect(() => {
    let vigente = true;
    void obtenerCategorias().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok)
        setCatalogo({ fase: "listo", categorias: respuesta.cuerpo });
      else if (!seguirPorAccesoNegado(respuesta))
        setCatalogo({
          fase: "error",
          aviso: avisoDeFallo(respuesta, avisos.errorAlCargarInformacion),
        });
    });
    return () => {
      vigente = false;
    };
  }, [intento]);

  const hoy = hoyEnColombia();
  const fecha = borrador.fecha ?? hoy;
  // Solo las categorías con texto de E14: el API manda el `id` y el texto sale de es.json.
  const delCatalogo =
    catalogo.fase === "listo" ? catalogo.categorias[borrador.tipo] : [];
  const categorias: { id: number; nombre: string; oculta: boolean }[] =
    delCatalogo.flatMap((c) => {
      const nombre = nombresDeCategoria[`c${c.id}`];
      return nombre ? [{ id: c.id, nombre, oculta: false }] : [];
    });
  // La categoría que el movimiento ya tiene y el catálogo no trae es una que la persona ocultó (RN-011): el API la
  // acepta en el PUT. Solo es de su mismo tipo: al cambiar de tipo deja de ofrecerse.
  const actual = original?.categoria_id;
  const nombreOculta = actual ? nombresDeCategoria[`c${actual}`] : undefined;
  if (
    actual &&
    nombreOculta &&
    original.tipo === borrador.tipo &&
    !delCatalogo.some((c) => c.id === actual)
  )
    categorias.push({ id: actual, nombre: nombreOculta, oculta: true });
  categorias.sort((a, b) => a.id - b.id);
  // Con el cuadro la categoría llega sugerida y la persona la cambia; llenando a mano es obligatoria: sin elegir, no hay ninguna (D-193).
  const categoriaId =
    categorias.find((c) => c.id === borrador.categoriaId)?.id ?? null;

  const mostrar = (nuevos: Errores) => {
    setErrores(nuevos);
    const primero = CAMPOS.find((campo) => nuevos[campo]);
    pedirFoco(primero ? idDeFoco[primero] : "aviso");
  };

  // Lo que llenó el cuadro pasa por «Revisa y confirma» antes de guardarse (RN-001): `confirmado` solo es verdadero
  // desde «Confirmar y guardar». «Corregir» y lo llenado a mano guardan directo.
  const conPaso = !corregir && borrador.delCuadro;
  const conTexto = !corregir && borrador.texto.trim() !== "";

  function cambiarPaso(abierto: boolean) {
    setEnPaso(abierto);
    alCambiarElPaso?.(abierto ? volverAlFormulario : null);
  }

  function volverAlFormulario() {
    cambiarPaso(false);
    setAviso(null);
    pedirFoco(`tipo-${borrador.tipo}`);
  }

  async function enviar(evento?: SyntheticEvent, confirmado = false) {
    evento?.preventDefault();
    if (enviando) return;
    const revisado = validarRegistro(borrador, categoriaId, undefined);
    setAviso(null);
    if ("errores" in revisado) {
      cambiarPaso(false);
      mostrar(revisado.errores);
      return;
    }
    setErrores({});
    if (conPaso && !confirmado) {
      cambiarPaso(true);
      pedirFoco("paso-revisa");
      return;
    }
    setEnviando(true);
    const { solicitud } = revisado;
    const respuesta = original
      ? await corregirMovimiento(solicitud, original)
      : await guardarMovimiento(solicitud);
    setEnviando(false);
    if (respuesta.ok && corregir) {
      corregir.alTerminar(avisos.cambiosGuardados);
      return;
    }
    if (respuesta.ok) {
      reiniciarBorrador();
      irConMensaje(
        "/movimientos",
        avisoDeRegistro(
          solicitud.tipo,
          solicitud.fecha,
          respuesta.cuerpo.movimiento_id !== null,
          solicitud.montoCentavos,
        ),
      );
      return;
    }
    if (seguirPorAccesoNegado(respuesta)) return;
    if (corregir && respuesta.estado === 404) {
      corregir.alTerminar(null);
      return;
    }
    const delCampo: Errores = {};
    let sinTexto = false;
    if (respuesta.codigo === "datos_invalidos") {
      for (const [campo, codigo] of Object.entries(respuesta.campos)) {
        const texto = textosDeErrorDeRegistro[codigo];
        const enPantalla = campoDeApi[campo];
        if (texto && enPantalla) delCampo[enPantalla] = texto;
        else sinTexto = true;
      }
    }
    if (Object.keys(delCampo).length > 0 && !sinTexto) {
      cambiarPaso(false);
      mostrar(delCampo);
      return;
    }
    setErrores({});
    setAviso(
      avisoDeFallo(
        respuesta,
        corregir
          ? avisos.errorAlGuardarCambios
          : avisoErrorAlGuardarMovimiento(solicitud.tipo),
      ),
    );
    pedirFoco("aviso");
  }

  function mostrarErrorDelCuadro(texto: string) {
    setErrorDelCuadro(texto);
    pedirFoco("cuadro");
  }

  /** «Llenar el formulario»: el API interpreta con reglas y la pantalla muestra lo que recibe (E17-ECO 4.7). */
  async function llenar() {
    if (interpretando) return;
    setAvisoDelCuadro(null);
    setErrorDelCuadro(undefined);
    if (borrador.texto.trim() === "") {
      mostrarErrorDelCuadro(textosDeErrorDelCuadro.texto_requerido!);
      return;
    }
    setInterpretando(true);
    const respuesta = await interpretarTexto(borrador.texto);
    setInterpretando(false);
    if (!respuesta.ok) {
      if (seguirPorAccesoNegado(respuesta)) return;
      const delTexto = textosDeErrorDelCuadro[respuesta.campos.texto ?? ""];
      if (respuesta.codigo === "datos_invalidos" && delTexto) {
        mostrarErrorDelCuadro(delTexto);
        return;
      }
      setAvisoDelCuadro(
        respuesta.codigo === SIN_CONEXION
          ? avisosDelCuadro.sinConexion
          : avisoDeFallo(respuesta, avisosDelCuadro.errorAlInterpretar),
      );
      pedirFoco("aviso-del-cuadro");
      return;
    }
    const resultado: Interpretacion = respuesta.cuerpo;
    if (
      resultado.resultado !== "propuesta" &&
      resultado.resultado !== "monto_ambiguo"
    ) {
      setAvisoDelCuadro(
        resultado.resultado === "recomendacion"
          ? avisosDelCuadro.recomendacion
          : resultado.resultado === "pregunta"
            ? avisosDelCuadro.pregunta
            : avisosDelCuadro.noEntendido,
      );
      pedirFoco("aviso-del-cuadro");
      return;
    }
    // Lo que el sistema entendió llena el formulario; el medio de pago y la descripción los llena la persona. La
    // categoría llega elegida solo si es una que ella ve (RN-011); un monto ambiguo no se adivina (D-084).
    const ambiguo = resultado.resultado === "monto_ambiguo";
    cambiarBorrador({
      tipo: resultado.tipo,
      monto: ambiguo ? "" : formatearPesos(BigInt(resultado.monto_centavos)),
      fecha: resultado.fecha,
      categoriaId: resultado.categoria?.id ?? null,
      delCuadro: true,
      variosMovimientos: resultado.varios_movimientos,
    });
    cambiarPaso(false);
    if (ambiguo) {
      const pesos = (texto: string) => {
        const lectura = leerMonto(texto);
        return lectura.ok ? formatearPesos(lectura.centavos) : texto;
      };
      setErrores({
        monto: formatear(r.errores.montoAmbiguo, {
          miles: pesos(resultado.lecturas_del_monto.con_punto_de_miles),
          decimal: pesos(resultado.lecturas_del_monto.con_coma_decimal),
        }),
      });
      pedirFoco("monto");
      return;
    }
    setErrores({});
    pedirFoco("aviso-lleno");
  }

  function elegirCategoria(id: number) {
    cambiar({ categoriaId: id });
    setVerTodas(false);
  }

  if (catalogo.fase !== "listo")
    return catalogo.fase === "error" ? (
      <>
        <Aviso {...catalogo.aviso} />
        <Boton
          variante="secundario"
          alTocar={() => {
            setCatalogo({ fase: "cargando" });
            setIntento(intento + 1);
          }}
        >
          {textos.acciones.intentarDeNuevo}
        </Boton>
      </>
    ) : null;

  const medios: { valor: Medio; etiqueta: string }[] = [
    { valor: "efectivo", etiqueta: r.medio.efectivo },
    { valor: "transferencia", etiqueta: r.medio.transferencia },
  ];
  const palabras = fecha === hoy ? r.fecha.hoy : diaEnPalabras(fecha);
  const alSalirDelMonto = () => {
    const lectura = leerMonto(borrador.monto);
    if (lectura.ok) cambiar({ monto: formatearPesos(lectura.centavos) });
  };

  const formulario = (
    <form className="formulario" noValidate onSubmit={enviar}>
      {!corregir && borrador.delCuadro && (
        <Aviso id="aviso-lleno" {...avisosDelCuadro.lleno} />
      )}
      {aviso && <Aviso {...aviso} />}
      {esRecurrente && (
        <p className="nota">
          <IconoInformacion />
          <span>{textos.movimientos.detalle.soloEstaFecha}</span>
        </p>
      )}
      {!esRecurrente && (
        <ChipsDeEleccion
          id="tipo"
          etiqueta={r.tipo.etiqueta}
          opciones={[
            { valor: "gasto", etiqueta: r.tipo.gasto },
            { valor: "ingreso", etiqueta: r.tipo.ingreso },
          ]}
          valor={borrador.tipo}
          alElegir={(tipo) => cambiar({ tipo })}
          error={errores.tipo}
        />
      )}
      <CampoDeTexto
        id="monto"
        etiqueta={r.monto.etiqueta}
        modo="decimal"
        cifra
        autocompletar="off"
        valor={borrador.monto}
        alCambiar={(monto) => cambiar({ monto })}
        alSalir={alSalirDelMonto}
        error={errores.monto}
      />
      {!esRecurrente && (
        <CampoDeTexto
          id="fecha"
          etiqueta={r.fecha.etiqueta}
          tipo="date"
          min="1900-01-01"
          cifra
          autocompletar="off"
          valor={fecha}
          alCambiar={(valor) => cambiar({ fecha: valor })}
          ayuda={palabras ?? undefined}
          error={errores.fecha}
        />
      )}
      <div className="grupo">
        <ChipsDeEleccion
          id="categoria"
          etiqueta={r.categoria.etiqueta}
          enFila
          opciones={categorias.map((c) => ({
            valor: c.id,
            etiqueta: c.nombre,
            oculta: c.oculta,
          }))}
          valor={categoriaId}
          alElegir={elegirCategoria}
          error={errores.categoria}
        />
        <Boton
          id="ver-todas"
          variante="texto"
          expandido={verTodas}
          alTocar={() => setVerTodas(!verTodas)}
        >
          {r.categoria.verTodas}
        </Boton>
        {verTodas && (
          <ul className="lista-de-categorias">
            {categorias.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={c.id === categoriaId}
                  onClick={() => elegirCategoria(c.id)}
                >
                  {c.nombre}
                  {c.oculta && <MarcaDeOculta />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ChipsDeEleccion
        id="medio"
        etiqueta={r.medio.etiqueta}
        opciones={medios}
        valor={borrador.medio}
        alElegir={(medio) => cambiar({ medio })}
        error={errores.medio}
      />
      <ChipsDeEleccion
        id="quien"
        etiqueta={r.quien.etiqueta}
        opciones={[
          {
            valor: SOLO_MIO,
            etiqueta: original?.compartido
              ? textos.movimientos.fila.compartido
              : r.quien.soloMio,
          },
        ]}
        valor={SOLO_MIO}
      />
      <CampoDeTexto
        id="descripcion"
        etiqueta={r.descripcion.etiqueta}
        ayuda={r.descripcion.ayuda}
        maxLength={LARGO_DE_LA_DESCRIPCION}
        autocompletar="off"
        valor={borrador.descripcion}
        alCambiar={(descripcion) => cambiar({ descripcion })}
        error={errores.descripcion}
      />
      {!corregir && (
        <div className="grupo">
          <div className="fila-con-enlace">
            <div className="fila" id="se-repite-valor">
              {borrador.periodicidad ? (
                <p className="fila__nombre">
                  {formatear(r.seRepite.conPeriodicidad, {
                    periodicidad:
                      etiquetasDePeriodicidad[borrador.periodicidad],
                  })}
                </p>
              ) : (
                <>
                  <p className="fila__nombre">{r.seRepite.etiqueta}</p>
                  <p>{etiquetasDePeriodicidad.no_se_repite}</p>
                </>
              )}
            </div>
            <a
              id="cambiar-repeticion"
              href="/registrar/se-repite"
              aria-describedby="se-repite-valor"
              onClick={alTocarEnlace("/registrar/se-repite")}
            >
              {r.seRepite.cambiar}
            </a>
          </div>
          {errores.repeticion && (
            <p className="campo__error">
              <span>{cifras(errores.repeticion)}</span>
            </p>
          )}
        </div>
      )}
      <Boton
        tipo="submit"
        variante={conTexto && !borrador.delCuadro ? "secundario" : "primario"}
        deshabilitado={enviando}
      >
        {corregir
          ? textos.movimientos.detalle.guardarCambios
          : conPaso
            ? r.revisarYGuardar
            : r.guardar}
      </Boton>
      {corregir && (
        <Boton variante="secundario" alTocar={corregir.alCancelar}>
          {textos.movimientos.detalle.ahoraNo}
        </Boton>
      )}
      {aviso && (
        <Boton variante="secundario" alTocar={() => void enviar()}>
          {textos.acciones.intentarDeNuevo}
        </Boton>
      )}
    </form>
  );
  if (corregir) return formulario;

  const solicitud = enPaso ? validarRegistro(borrador, categoriaId) : null;
  const filas =
    solicitud && "solicitud" in solicitud
      ? [
          {
            clave: "tipo",
            etiqueta: r.tipo.etiqueta,
            valor:
              solicitud.solicitud.tipo === "gasto"
                ? r.tipo.gasto
                : r.tipo.ingreso,
            foco: `tipo-${solicitud.solicitud.tipo}`,
          },
          {
            clave: "monto",
            etiqueta: r.monto.etiqueta,
            valor: formatearPesos(solicitud.solicitud.montoCentavos),
            foco: "monto",
          },
          {
            clave: "categoria",
            etiqueta: r.categoria.etiqueta,
            valor: categorias.find((c) => c.id === categoriaId)?.nombre ?? "",
            foco: idDeFoco.categoria,
          },
          {
            clave: "fecha",
            etiqueta: r.fecha.etiqueta,
            valor: fechaEnLaFila(solicitud.solicitud.fecha, hoy),
            foco: "fecha",
          },
          {
            clave: "medio",
            etiqueta: r.medio.etiqueta,
            valor:
              medios.find((m) => m.valor === solicitud.solicitud.medio)
                ?.etiqueta ?? "",
            foco: `medio-${solicitud.solicitud.medio}`,
          },
          {
            clave: "quien",
            etiqueta: r.quien.etiqueta,
            valor: r.quien.soloMio,
            foco: `quien-${SOLO_MIO}`,
          },
        ]
      : null;

  // «Revisa y confirma» (E14-PPN 3.1, RF-004, D-084): reemplaza al formulario, sin cambiar de página. Es lo único que
  // guarda lo que el cuadro llenó (RN-001). «Cambiar», «Volver» y el Atrás de la barra regresan al formulario, sin
  // guardar.
  const paso = filas && (
    <section className="paso" aria-labelledby="paso-revisa">
      <h2 id="paso-revisa" tabIndex={-1} className="titulo">
        {r.revisa.titulo}
      </h2>
      {aviso && <Aviso {...aviso} />}
      {borrador.variosMovimientos && (
        <Aviso id="aviso-varios" {...avisosDelCuadro.variosMovimientos} />
      )}
      <div className="tarjeta">
        <ul className="paso__lista">
          {filas.map((f) => (
            <li key={f.clave} className="paso__fila">
              <div className="fila" id={`paso-${f.clave}`}>
                <p className="fila__nombre">{f.etiqueta}</p>
                <p>{cifras(f.valor)}</p>
              </div>
              <Boton
                variante="texto"
                descritoPor={`paso-${f.clave}`}
                alTocar={() => {
                  cambiarPaso(false);
                  pedirFoco(f.foco);
                }}
              >
                {r.revisa.cambiar}
              </Boton>
            </li>
          ))}
        </ul>
      </div>
      <Boton
        deshabilitado={enviando}
        alTocar={() => void enviar(undefined, true)}
      >
        {r.revisa.confirmar}
      </Boton>
      <Boton variante="secundario" alTocar={volverAlFormulario}>
        {r.revisa.volver}
      </Boton>
      {aviso && (
        <Boton
          variante="secundario"
          alTocar={() => void enviar(undefined, true)}
        >
          {textos.acciones.intentarDeNuevo}
        </Boton>
      )}
    </section>
  );

  // Por debajo de 768 px el paso reemplaza también el cuadro, como en Android (bug 266): lo esconde `componentes.css`.
  return (
    <div className={`registro${paso ? " registro--en-paso" : ""}`}>
      <div className="registro__cuadro">
        <CampoDeTexto
          id="cuadro"
          etiqueta={r.cuadro.etiqueta}
          ayuda={r.cuadro.ayuda}
          lineas={4}
          maxLength={LARGO_DEL_CUADRO}
          autocompletar="off"
          valor={borrador.texto}
          alCambiar={(texto) => cambiarBorrador({ texto })}
          error={errorDelCuadro}
        />
        <p className="nota">
          <IconoInformacion />
          <span>{r.cuadro.privacidad}</span>
        </p>
        <Boton
          variante={conTexto && !borrador.delCuadro ? "primario" : "secundario"}
          deshabilitado={interpretando}
          alTocar={() => void llenar()}
        >
          {r.cuadro.llenar}
        </Boton>
        {avisoDelCuadro && <Aviso id="aviso-del-cuadro" {...avisoDelCuadro} />}
      </div>
      <div className="registro__formulario">{paso ?? formulario}</div>
    </div>
  );
}

// El formulario de registro: se llega desde «Registrar» de PN-01 y vuelve a PN-01 al guardar (D-164). Atrás también
// vuelve a PN-01, salvo con «Revisa y confirma» abierto: ahí es «Volver al formulario», como en Android. «Registrar un
// ingreso» de PN-07 y PN-08 (E14-PPA 4.2 y 4.3) llega con `?tipo=ingreso`: el Tipo queda en «Ingreso» y el parámetro
// sale de la dirección, para que volver de PN-03 no deshaga lo que la persona cambió.
export function Registrar() {
  const [volver, setVolver] = useState<(() => void) | null>(null);
  const { parametros } = useUbicacion();
  const conIngreso = parametros.get("tipo") === "ingreso";
  useEffect(() => {
    if (!conIngreso) return;
    cambiarBorrador({ tipo: "ingreso" });
    navegar("/registrar", true);
  }, [conIngreso]);
  return (
    <Pagina
      titulo={r.titulo}
      atras={volver ?? "/movimientos"}
      registro
      lateral={{ activo: "registrar", registrarSecundario: true }}
    >
      <FormularioDeMovimiento
        alCambiarElPaso={(accion) => setVolver(() => accion)}
      />
    </Pagina>
  );
}
