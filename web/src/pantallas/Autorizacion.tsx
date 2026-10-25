import { useEffect, useState, type SyntheticEvent } from "react";
import { autorizar, obtenerCatalogo, rechazar } from "../api/autorizaciones";
import { SIN_CONEXION } from "../api/cliente";
import { seguirPorAccesoNegado } from "../accesoNegado";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { cifras } from "../componentes/Cifras";
import { Casilla } from "../componentes/Casilla";
import { IconoInformacion } from "../componentes/Iconos";
import { Pagina } from "../componentes/Pagina";
import { useFocoPendiente } from "../enfoque";
import { navegar } from "../enrutador";
import { diaEnPalabras } from "../fechas";
import { irConAviso } from "../llegada";
import {
  avisoDeFallo,
  avisos,
  finalidadesDeE14,
  type DatosDeAviso,
} from "../textos";
import { formatear, textos } from "../textos/es.generated";

type Finalidad = { codigo: string; texto: (typeof finalidadesDeE14)[string] };
type Catalogo = {
  version: string;
  fecha: string;
  necesarias: Finalidad[];
  accesorias: Finalidad[];
};
type Estado =
  | { fase: "cargando" }
  | { fase: "error"; aviso: DatosDeAviso }
  | { fase: "listo"; catalogo: Catalogo };

/**
 * Del catálogo del API a lo que se dibuja. Un código que E14 no tiene, un tipo desconocido o una fecha que no se puede
 * escribir en palabras es un error de carga: no se omite en silencio una finalidad que la persona no vería.
 */
function leerCatalogo(
  cuerpo: Awaited<ReturnType<typeof obtenerCatalogo>> & { ok: true },
): Catalogo | null {
  const { version, finalidades } = cuerpo.cuerpo;
  const fecha = diaEnPalabras(version?.fecha);
  if (!fecha || !version.numero || !Array.isArray(finalidades)) return null;
  const catalogo: Catalogo = {
    version: version.numero,
    fecha,
    necesarias: [],
    accesorias: [],
  };
  for (const { codigo, tipo } of finalidades) {
    const texto = finalidadesDeE14[codigo];
    if (!texto || (tipo !== "necesaria" && tipo !== "accesoria")) return null;
    if (tipo === "accesoria" && !texto.casilla) return null;
    (tipo === "necesaria" ? catalogo.necesarias : catalogo.accesorias).push({
      codigo,
      texto,
    });
  }
  return catalogo.necesarias.length > 0 ? catalogo : null;
}

// PN-64 · Autorización de datos (E14-PCP 4.7, RF-031, RF-063). Ninguna casilla viene marcada. Las necesarias van en una
// tarjeta y una casilla; cada accesoria, en la suya. «Autorizar y continuar» sin lo necesario no pide nada: muestra el
// error. Sin «Leer la política completa»: abre PN-68, que no está construida. «Autorizar y continuar» lleva a Inicio,
// que no existe todavía: va a PN-71, como al entrar. «No autorizo» borra la cuenta recién creada y va a PN-60.
export function Autorizacion() {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [necesarias, setNecesarias] = useState(false);
  const [elegidas, setElegidas] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | undefined>();
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const pedirFoco = useFocoPendiente();

  useEffect(() => {
    let vigente = true;
    void obtenerCatalogo().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) {
        const catalogo = leerCatalogo(respuesta);
        setEstado(
          catalogo
            ? { fase: "listo", catalogo }
            : { fase: "error", aviso: avisos.errorAlCargarInformacion },
        );
      } else if (!seguirPorAccesoNegado(respuesta)) {
        setEstado({
          fase: "error",
          aviso: avisoDeFallo(respuesta, avisos.errorAlCargarInformacion),
        });
      }
    });
    return () => {
      vigente = false;
    };
  }, [intento]);

  async function enviar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (enviando || estado.fase !== "listo") return;
    if (!necesarias) {
      setError(textos.autorizacion.necesarias.error);
      setAviso(null);
      pedirFoco("necesarias");
      return;
    }
    const { catalogo } = estado;
    setError(undefined);
    setEnviando(true);
    const respuesta = await autorizar(
      [
        ...catalogo.necesarias.map((f) => f.codigo),
        ...catalogo.accesorias
          .filter((f) => elegidas[f.codigo])
          .map((f) => f.codigo),
      ],
      catalogo.version,
    );
    setEnviando(false);
    if (respuesta.ok) {
      navegar("/cuenta/seguridad", true);
      return;
    }
    if (seguirPorAccesoNegado(respuesta)) return;
    // Con una versión desactualizada E14 no tiene texto propio: el general, y se vuelve a pedir el catálogo.
    if (respuesta.codigo === "version_desactualizada") setIntento(intento + 1);
    setAviso(avisoDeFallo(respuesta, avisos.errorAlGuardarAutorizacion));
    pedirFoco("aviso");
  }

  async function noAutorizo() {
    if (enviando) return;
    setEnviando(true);
    const respuesta = await rechazar();
    setEnviando(false);
    if (respuesta.ok) {
      irConAviso("/entrar", "cuenta_borrada");
      return;
    }
    if (seguirPorAccesoNegado(respuesta)) return;
    // Ya autorizó (otra pestaña): no hay nada que borrar, la cuenta sigue.
    if (respuesta.codigo === "ya_autorizada") {
      navegar("/cuenta/seguridad", true);
      return;
    }
    // Sin conexión, E14 dice «Todavía no pudimos borrar tu correo.»; con un error del servidor, lo mismo.
    setAviso(
      respuesta.codigo === SIN_CONEXION
        ? avisos.errorAlBorrarElCorreo
        : avisoDeFallo(respuesta, avisos.errorAlBorrarElCorreo),
    );
    pedirFoco("aviso");
  }

  const catalogo = estado.fase === "listo" ? estado.catalogo : null;

  return (
    <Pagina titulo={textos.autorizacion.titulo} atras="/privacidad">
      {estado.fase === "error" && (
        <>
          <Aviso {...estado.aviso} />
          <Boton
            variante="secundario"
            alTocar={() => {
              setEstado({ fase: "cargando" });
              setIntento(intento + 1);
            }}
          >
            {textos.acciones.intentarDeNuevo}
          </Boton>
        </>
      )}
      {catalogo && (
        <form className="formulario" noValidate onSubmit={enviar}>
          {aviso && <Aviso {...aviso} />}
          <p>{textos.autorizacion.explicacion}</p>
          <section className="tarjeta" aria-labelledby="titulo-necesarias">
            <h2 id="titulo-necesarias" className="titulo-3">
              {textos.autorizacion.necesarias.titulo}
            </h2>
            {catalogo.necesarias.map(({ codigo, texto }) => (
              <div key={codigo} className="fila">
                <p className="fila__nombre">{texto.nombre}</p>
                <p>{texto.descripcion}</p>
              </div>
            ))}
          </section>
          <Casilla
            id="necesarias"
            texto={textos.autorizacion.necesarias.casilla}
            marcada={necesarias}
            alCambiar={(marcada) => {
              setNecesarias(marcada);
              if (marcada) setError(undefined);
            }}
            error={error}
          />
          <p className="ayuda">{textos.autorizacion.necesarias.nota}</p>
          <section className="tarjeta" aria-labelledby="titulo-opcionales">
            <h2 id="titulo-opcionales" className="titulo-3">
              {textos.autorizacion.opcionales.titulo}
            </h2>
            {catalogo.accesorias.map(({ codigo, texto }) => (
              <div key={codigo} className="fila">
                <p className="fila__nombre">{texto.nombre}</p>
                <p>{texto.descripcion}</p>
              </div>
            ))}
          </section>
          {catalogo.accesorias.map(({ codigo, texto }) => (
            <Casilla
              key={codigo}
              id={`finalidad-${codigo}`}
              texto={texto.casilla ?? ""}
              marcada={elegidas[codigo] ?? false}
              alCambiar={(marcada) =>
                setElegidas({ ...elegidas, [codigo]: marcada })
              }
            />
          ))}
          <p className="ayuda">{textos.autorizacion.opcionales.nota}</p>
          <p className="nota">
            <IconoInformacion />
            <span>
              {cifras(
                formatear(textos.autorizacion.version, {
                  numero: catalogo.version,
                  fecha: catalogo.fecha,
                }),
              )}
            </span>
          </p>
          <Boton tipo="submit" deshabilitado={enviando}>
            {textos.autorizacion.autorizar}
          </Boton>
          <Boton
            variante="secundario"
            deshabilitado={enviando}
            alTocar={() => void noAutorizo()}
          >
            {textos.autorizacion.noAutorizo}
          </Boton>
        </form>
      )}
    </Pagina>
  );
}
