import { useEffect, useState } from "react";
import { seguirPorAccesoNegado } from "../accesoNegado";
import { PERIODICIDADES, obtenerProximas } from "../api/registro";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { CampoDeTexto } from "../componentes/CampoDeTexto";
import { ChipsDeEleccion } from "../componentes/ChipsDeEleccion";
import { cifras } from "../componentes/Cifras";
import { IconoInformacion } from "../componentes/Iconos";
import { Pagina } from "../componentes/Pagina";
import { cambiarBorrador, useBorrador } from "../borradorDeRegistro";
import { useFocoPendiente } from "../enfoque";
import { navegar } from "../enrutador";
import { diaEnPalabras, esFechaDeMovimiento, hoyEnColombia } from "../fechas";
import {
  avisoDeFallo,
  avisos,
  etiquetasDePeriodicidad,
  explicacionesDePeriodicidad,
  type DatosDeAviso,
  type OpcionDePeriodicidad,
} from "../textos";
import { textos } from "../textos/es.generated";

const p = textos.periodicidad;
const NO_SE_REPITE = "no_se_repite";

// En el orden de la tabla de E14-PRR 4.3 (fila 3): «No se repite» y las cinco periodicidades de RF-006.
const OPCIONES: OpcionDePeriodicidad[] = [NO_SE_REPITE, ...PERIODICIDADES];

// Lo que respondió el API para una periodicidad y una fecha de inicio; `clave` dice a cuál pedido corresponde, para no
// mostrar las fechas de una elección anterior mientras llegan las de la nueva.
type Resultado =
  | { clave: string; fase: "listo"; fechas: string[] }
  | { clave: string; fase: "error"; aviso: DatosDeAviso };

// PN-03 · «Se repite», variante web (E14-PRR 4.3): una columna de 560 px, sin «Dejar de repetir» (solo aplica a un
// movimiento que ya se repite, US-52). Las próximas fechas las calcula el API (E15 5.2, E17-ECO 4.7, D-165): la
// pantalla manda la periodicidad y «Empieza el», y muestra lo que recibe. Si el API falla, «Listo» sigue sirviendo.
export function SeRepite() {
  const borrador = useBorrador();
  const [elegida, setElegida] = useState<OpcionDePeriodicidad>(
    borrador.periodicidad ?? NO_SE_REPITE,
  );
  const [error, setError] = useState<string | undefined>();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [intento, setIntento] = useState(0);
  const pedirFoco = useFocoPendiente();

  const hoy = hoyEnColombia();
  // «Empieza el» es la fecha del formulario.
  const inicio = borrador.fecha ?? hoy;
  const empieza = esFechaDeMovimiento(inicio) ? inicio : null;
  const periodicidad = elegida === NO_SE_REPITE ? null : elegida;
  const clave =
    periodicidad && empieza ? `${intento} ${periodicidad} ${empieza}` : null;

  useEffect(() => {
    if (!periodicidad || !empieza || !clave) return;
    let vigente = true;
    void obtenerProximas(periodicidad, empieza).then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) {
        const fechas = respuesta.cuerpo.proximas;
        const validas =
          Array.isArray(fechas) && fechas.every((f) => diaEnPalabras(f));
        setResultado(
          validas
            ? { clave, fase: "listo", fechas }
            : { clave, fase: "error", aviso: avisos.errorAlCargarInformacion },
        );
      } else if (!seguirPorAccesoNegado(respuesta)) {
        setResultado({
          clave,
          fase: "error",
          aviso: avisoDeFallo(respuesta, avisos.errorAlCargarInformacion),
        });
      }
    });
    return () => {
      vigente = false;
    };
  }, [periodicidad, empieza, clave]);

  const actual = resultado?.clave === clave ? resultado : null;

  function listo() {
    if (elegida !== NO_SE_REPITE && !empieza) {
      setError(p.errores.sinFecha);
      pedirFoco("empieza-el");
      return;
    }
    cambiarBorrador({
      periodicidad: elegida === NO_SE_REPITE ? null : elegida,
    });
    navegar("/registrar", true);
  }

  return (
    <Pagina titulo={p.titulo} atras="/registrar">
      <p>{p.intro}</p>
      <ChipsDeEleccion
        id="periodicidad"
        etiqueta={p.etiqueta}
        opciones={OPCIONES.map((valor) => ({
          valor,
          etiqueta: etiquetasDePeriodicidad[valor],
        }))}
        valor={elegida}
        alElegir={(valor) => {
          setElegida(valor);
          setError(undefined);
        }}
      />
      <p className="nota" role="status">
        <IconoInformacion />
        <span>{explicacionesDePeriodicidad[elegida]}</span>
      </p>
      {elegida !== NO_SE_REPITE && (
        <>
          <CampoDeTexto
            id="empieza-el"
            etiqueta={p.empiezaEl}
            cifra
            autocompletar="off"
            valor={empieza ? (diaEnPalabras(empieza) ?? "") : ""}
            error={error}
          />
          <section
            className="tarjeta"
            aria-labelledby="titulo-proximas"
            aria-busy={actual === null}
          >
            <h2 id="titulo-proximas" className="titulo-3">
              {p.proximas}
            </h2>
            {actual?.fase === "listo" &&
              (actual.fechas.length > 0 ? (
                <ul className="lista-de-fechas">
                  {actual.fechas.map((fecha) => (
                    <li key={fecha}>{cifras(diaEnPalabras(fecha) ?? "")}</li>
                  ))}
                </ul>
              ) : (
                <p>{p.sinProximas}</p>
              ))}
            {actual?.fase === "error" && (
              <>
                <Aviso {...actual.aviso} />
                <Boton
                  variante="secundario"
                  alTocar={() => setIntento(intento + 1)}
                >
                  {textos.acciones.intentarDeNuevo}
                </Boton>
              </>
            )}
          </section>
          <p className="ayuda">{p.aclaracion}</p>
        </>
      )}
      <Boton alTocar={listo}>{p.listo}</Boton>
    </Pagina>
  );
}
