import { useEffect, useState, type SyntheticEvent } from "react";
import { seguirPorAccesoNegado } from "../accesoNegado";
import { corregirMovimiento, type Movimiento } from "../api/movimientos";
import {
  guardarMovimiento,
  obtenerCategorias,
  type CatalogoDeCategorias,
  type Medio,
} from "../api/registro";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { IconoInformacion } from "../componentes/Iconos";
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
import { alTocarEnlace } from "../enrutador";
import { diaEnPalabras, hoyEnColombia } from "../fechas";
import { irConMensaje } from "../llegada";
import {
  avisoDeFallo,
  avisoDeRegistro,
  avisoErrorAlGuardarMovimiento,
  avisos,
  etiquetasDePeriodicidad,
  nombresDeCategoria,
  textosDeErrorDeRegistro,
  type DatosDeAviso,
} from "../textos";
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

/** «Corregir» de PN-02: los mismos campos, ya llenos (E14-PRR 4.2). `alTerminar(null)` es que el movimiento ya no existe. */
export type Correccion = {
  movimiento: Movimiento;
  alTerminar: (aviso: DatosDeAviso | null) => void;
  alCancelar: () => void;
};

// Formulario de registro, variante web (E14-PPN 3.1, D-164). Sin el cuadro de lenguaje natural, el aviso de
// faltante, «Tarjeta», «Cuotas», PN-04, PN-05 ni «Compartido con el hogar»: esas filas no se dibujan (README de web).
// Con `corregir` es «Corregir» de PN-02 (E14-PRR 4.2): lleva su propio estado, no el borrador, y no ofrece lo que el
// API no deja cambiar. Una fecha de un recurrente no lleva Fecha (D-168) y un aporte no lleva Tipo ni Categoría.
export function FormularioDeMovimiento({
  corregir,
}: {
  corregir?: Correccion;
}) {
  const delBorrador = useBorrador();
  const [propio, setPropio] = useState<Borrador>(() =>
    corregir ? borradorDeMovimiento(corregir.movimiento) : delBorrador,
  );
  const borrador = corregir ? propio : delBorrador;
  const cambiar = (cambio: Partial<Borrador>) =>
    corregir ? setPropio({ ...propio, ...cambio }) : cambiarBorrador(cambio);
  const original = corregir?.movimiento;
  const esAporte = original?.tipo === "aporte";
  const esRecurrente = Boolean(original?.recurrente);
  const [catalogo, setCatalogo] = useState<Catalogo>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [enviando, setEnviando] = useState(false);
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
  const categorias =
    catalogo.fase === "listo"
      ? catalogo.categorias[borrador.tipo].flatMap((c) => {
          const nombre = nombresDeCategoria[`c${c.id}`];
          return nombre ? [{ ...c, nombre }] : [];
        })
      : [];
  // La categoría es obligatoria hasta que exista el motor de reglas que la sugiere (D-165): sin elegir, no hay ninguna.
  const categoriaId =
    categorias.find((c) => c.id === borrador.categoriaId)?.id ?? null;

  const mostrar = (nuevos: Errores) => {
    setErrores(nuevos);
    const primero = CAMPOS.find((campo) => nuevos[campo]);
    pedirFoco(primero ? idDeFoco[primero] : "aviso");
  };

  async function enviar(evento?: SyntheticEvent) {
    evento?.preventDefault();
    if (enviando) return;
    const revisado = validarRegistro(
      borrador,
      categoriaId,
      undefined,
      !esAporte,
    );
    setAviso(null);
    if ("errores" in revisado) {
      mostrar(revisado.errores);
      return;
    }
    setErrores({});
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

  return (
    <form className="formulario" noValidate onSubmit={enviar}>
      {aviso && <Aviso {...aviso} />}
      {esRecurrente && (
        <p className="nota">
          <IconoInformacion />
          <span>{textos.movimientos.detalle.soloEstaFecha}</span>
        </p>
      )}
      {!esAporte && !esRecurrente && (
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
      {!esAporte && (
        <div className="grupo">
          <ChipsDeEleccion
            id="categoria"
            etiqueta={r.categoria.etiqueta}
            enFila
            opciones={categorias.map((c) => ({
              valor: c.id,
              etiqueta: c.nombre,
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
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
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
      <Boton tipo="submit" deshabilitado={enviando}>
        {corregir ? textos.movimientos.detalle.guardarCambios : r.guardar}
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
}

// El formulario de registro: se llega desde «Registrar» de PN-01 y vuelve a PN-01 al guardar (D-164).
export const Registrar = () => (
  <Pagina titulo={r.titulo} atras="/movimientos">
    <FormularioDeMovimiento />
  </Pagina>
);
