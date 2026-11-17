import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { autorizar, obtenerCatalogo, rechazar } from "../api/autorizaciones";
import { SIN_CONEXION } from "../api/cliente";
import { seguirPorAccesoNegado } from "../accesoNegado";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { cifras } from "../componentes/Cifras";
import { Casilla } from "../componentes/Casilla";
import { IconoInformacion } from "../componentes/Iconos";
import { Pagina } from "../componentes/Pagina";
import { useFocoPendiente } from "../enfoque";
import { navegar } from "../enrutador";
import { diaEnPalabras } from "../fechas";
import { irConAviso } from "../llegada";
import { enlaceALaPolitica } from "../politica";
import {
  avisoDeFallo,
  avisos,
  finalidadesDeE14,
  type DatosDeAviso,
} from "../textos";
import { formatear, textos } from "../textos/es.generated";
import { HojaNoAutorizo } from "./HojaNoAutorizo";

/** La aceptación expresa de la transmisión a los encargados (SC-E21-25): tiene su tarjeta, no una fila de «Lo necesario». */
const TRANSMISION = "transmision_a_encargados";

type Finalidad = { codigo: string; texto: (typeof finalidadesDeE14)[string] };
type Catalogo = {
  version: string;
  fecha: string;
  /** `falta_una_aceptacion`: la cuenta de antes del cambio, a la que solo le falta una necesaria (sección 5). */
  modo: "completo" | "falta_una_aceptacion";
  necesarias: Finalidad[];
  transmision: boolean;
  accesorias: Finalidad[];
};
type Seleccion = {
  necesarias: boolean;
  transmision: boolean;
  elegidas: Record<string, boolean>;
};
type Errores = { necesarias?: string; transmision?: string };

// Lo marcado se guarda al salir hacia «Leer la política completa» (PN-68) y vuelve una sola vez, cuando la persona
// regresa; llegar desde cualquier otra pantalla empieza sin marcar nada (RF-063). Vive en memoria, no en el navegador.
let seleccionGuardada: Seleccion | null = null;
type Estado =
  | { fase: "cargando" }
  | { fase: "error"; aviso: DatosDeAviso }
  | { fase: "listo"; catalogo: Catalogo };

/**
 * Del catálogo del API a lo que se dibuja. Un código que E14 no tiene, un tipo o un modo desconocido o una fecha que no
 * se puede escribir en palabras es un error de carga: no se omite en silencio una finalidad que la persona no vería.
 */
function leerCatalogo(
  cuerpo: Awaited<ReturnType<typeof obtenerCatalogo>> & { ok: true },
): Catalogo | null {
  const { version, modo, finalidades } = cuerpo.cuerpo;
  const fecha = diaEnPalabras(version?.fecha);
  if (!fecha || !version.numero || !Array.isArray(finalidades)) return null;
  if (modo !== "completo" && modo !== "falta_una_aceptacion") return null;
  const catalogo: Catalogo = {
    version: version.numero,
    fecha,
    modo,
    necesarias: [],
    transmision: false,
    accesorias: [],
  };
  for (const { codigo, tipo } of finalidades) {
    if (codigo === TRANSMISION) {
      if (tipo !== "necesaria" || catalogo.transmision) return null;
      catalogo.transmision = true;
      continue;
    }
    const texto = finalidadesDeE14[codigo];
    if (!texto || (tipo !== "necesaria" && tipo !== "accesoria")) return null;
    if (tipo === "accesoria" && !texto.casilla) return null;
    (tipo === "necesaria" ? catalogo.necesarias : catalogo.accesorias).push({
      codigo,
      texto,
    });
  }
  return catalogo.necesarias.length > 0 || catalogo.transmision
    ? catalogo
    : null;
}

// PN-64 · Autorización de datos (E14-PCP 4.7, RF-031, RF-063; SC-E21-25). Ninguna casilla viene marcada. Las necesarias
// van en una tarjeta y una casilla; la aceptación de la transmisión a los encargados, en su tarjeta y su casilla; cada
// accesoria, en la suya, y la de avisos con la frase de los servicios de notificaciones debajo. «Autorizar y continuar»
// sin las casillas necesarias no pide nada: muestra el error de cada una que falta. «Leer la política completa» abre
// PN-68 (D-195). «Autorizar y continuar» lleva a Inicio, que no existe todavía: va a PN-71, como al entrar.
// «No autorizo» borra la cuenta recién creada y va a PN-60. En el modo `falta_una_aceptacion` (la cuenta de antes del
// cambio) solo está la tarjeta que falta y «No autorizo» no llama a ese borrado: abre la hoja de PN-54, donde la persona
// descarga sus datos, borra la cuenta con la contraseña o vuelve y decide (sección 5, paso 3). Lo mismo si el API
// contesta `403 cuenta_con_historial` al rechazo.
export function Autorizacion() {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [inicial] = useState(() => seleccionGuardada);
  const [necesarias, setNecesarias] = useState(inicial?.necesarias ?? false);
  const [transmision, setTransmision] = useState(inicial?.transmision ?? false);
  const [elegidas, setElegidas] = useState<Record<string, boolean>>(
    inicial?.elegidas ?? {},
  );
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [hoja, setHoja] = useState(false);
  const pedirFoco = useFocoPendiente();

  // Lo guardado se usa una sola vez; al salir hacia PN-68 se guarda lo último marcado.
  const marcado = useRef<Seleccion>({ necesarias, transmision, elegidas });
  useEffect(() => {
    marcado.current = { necesarias, transmision, elegidas };
  });
  useEffect(() => {
    seleccionGuardada = null;
    return () => {
      if (window.location.pathname === "/politica")
        seleccionGuardada = marcado.current;
    };
  }, []);

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
    const { catalogo } = estado;
    const faltan: Errores = {};
    if (catalogo.necesarias.length > 0 && !necesarias)
      faltan.necesarias = textos.autorizacion.necesarias.error;
    if (catalogo.transmision && !transmision)
      faltan.transmision = textos.autorizacion.dondeGuardamos.error;
    if (faltan.necesarias || faltan.transmision) {
      setErrores(faltan);
      setAviso(null);
      pedirFoco(faltan.necesarias ? "necesarias" : "transmision");
      return;
    }
    setErrores({});
    setEnviando(true);
    const respuesta = await autorizar(
      [
        ...catalogo.necesarias.map((f) => f.codigo),
        ...(catalogo.transmision ? [TRANSMISION] : []),
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
    // La cuenta de antes del cambio ya tiene historia: no se borra sin preguntar.
    if (
      estado.fase === "listo" &&
      estado.catalogo.modo === "falta_una_aceptacion"
    ) {
      setHoja(true);
      return;
    }
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
    // Autorizó algo antes: el borrado se decide en la hoja, con la contraseña (sección 5, paso 3).
    if (respuesta.codigo === "cuenta_con_historial") {
      setHoja(true);
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
  const completo = catalogo?.modo === "completo";

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
          {completo && <p>{textos.autorizacion.explicacion}</p>}
          {catalogo.necesarias.length > 0 && (
            <>
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
                  if (marcada)
                    setErrores({ ...errores, necesarias: undefined });
                }}
                error={errores.necesarias}
              />
              {completo && (
                <p className="ayuda">{textos.autorizacion.necesarias.nota}</p>
              )}
            </>
          )}
          {catalogo.transmision && (
            <>
              <section className="tarjeta" aria-labelledby="titulo-transmision">
                <h2 id="titulo-transmision" className="titulo-3">
                  {textos.autorizacion.dondeGuardamos.titulo}
                </h2>
                <p>{textos.autorizacion.dondeGuardamos.explicacion}</p>
              </section>
              <Casilla
                id="transmision"
                texto={textos.autorizacion.dondeGuardamos.casilla}
                ayuda={
                  completo
                    ? textos.autorizacion.dondeGuardamos.nota
                    : textos.autorizacion.dondeGuardamos.notaFaltaUnaAceptacion
                }
                marcada={transmision}
                alCambiar={(marcada) => {
                  setTransmision(marcada);
                  if (marcada)
                    setErrores({ ...errores, transmision: undefined });
                }}
                error={errores.transmision}
              />
            </>
          )}
          {catalogo.accesorias.length > 0 && (
            <>
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
                  ayuda={
                    codigo === "avisos"
                      ? textos.autorizacion.fraseDeAvisos
                      : undefined
                  }
                  marcada={elegidas[codigo] ?? false}
                  alCambiar={(marcada) =>
                    setElegidas({ ...elegidas, [codigo]: marcada })
                  }
                />
              ))}
              <p className="ayuda">{textos.autorizacion.opcionales.nota}</p>
            </>
          )}
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
          <BotonEnlace
            href={enlaceALaPolitica("/autorizacion")}
            variante="texto"
          >
            {textos.politica.entradas.leerCompleta}
          </BotonEnlace>
          <Boton tipo="submit" deshabilitado={enviando}>
            {textos.autorizacion.autorizar}
          </Boton>
          <Boton
            id="no-autorizo"
            variante="secundario"
            deshabilitado={enviando}
            alTocar={() => void noAutorizo()}
          >
            {textos.autorizacion.noAutorizo}
          </Boton>
        </form>
      )}
      {hoja && (
        <HojaNoAutorizo
          alCerrar={() => {
            setHoja(false);
            pedirFoco("no-autorizo");
          }}
        />
      )}
    </Pagina>
  );
}
