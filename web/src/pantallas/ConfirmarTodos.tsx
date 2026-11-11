import { useEffect, useState } from "react";
import { seguirPorAccesoNegado } from "../accesoNegado";
import {
  decidir,
  type Decision,
  type Pendiente,
  type Pendientes,
} from "../api/repeticiones";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { Casilla } from "../componentes/Casilla";
import { cifras } from "../componentes/Cifras";
import { IconoAtras } from "../componentes/Iconos";
import { formatearPesos } from "../dinero";
import { enfocar, useFocoPendiente } from "../enfoque";
import { alTocarEnlace } from "../enrutador";
import { avisoDeFallo, type DatosDeAviso } from "../textos";
import {
  avisoDeGuardado,
  avisosDePorConfirmar,
  textosDeFilaPorConfirmar,
} from "../textosDePorConfirmar";
import { formatear, plural, textos } from "../textos/es.generated";
import { HojaDeMas, HojaDeMonto } from "./HojasDeFecha";
import { claveDe } from "./PorConfirmar";

const t = textos.porConfirmar;

/** Lo que la persona hizo con una fila; lo que no tocó viene marcada, con el monto habitual (D-093). */
type Eleccion = { marcada: boolean; monto: bigint | null; omitida: boolean };
const INICIAL: Eleccion = { marcada: true, monto: null, omitida: false };

// «Confirmar todos» (E14-PRR 4.8, D-093), variante web: un panel de 560 px junto a la lista de PN-01, sin cambiar de
// página. Todo viene marcado y no se guarda nada hasta «Guardar»; Atrás descarta lo cambiado. Solo viajan las filas
// marcadas y las «No pasó»: lo desmarcado sigue pendiente. El API lo guarda todo o nada (una sola transacción).
export function ConfirmarTodos({
  datos,
  atras,
  alVolver,
  alEmpezar,
  alTerminar,
  refrescar,
}: {
  datos: Pendientes;
  atras: string;
  alVolver: () => void;
  alEmpezar: () => void;
  alTerminar: (aviso: DatosDeAviso) => void;
  refrescar: () => void;
}) {
  const [elecciones, setElecciones] = useState<Record<string, Eleccion>>({});
  const [hoja, setHoja] = useState<{
    tipo: "mas" | "monto";
    clave: string;
  } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<DatosDeAviso | null>(null);
  const pedirFoco = useFocoPendiente();
  const { pendientes } = datos;

  useEffect(() => enfocar("titulo-confirmar-todos"), []);

  const de = (fila: Pendiente) => elecciones[claveDe(fila)] ?? INICIAL;
  const cambiar = (fila: Pendiente, cambios: Partial<Eleccion>) =>
    setElecciones({
      ...elecciones,
      [claveDe(fila)]: { ...de(fila), ...cambios },
    });
  const cerrar = (clave: string) => {
    setHoja(null);
    pedirFoco(`mas-todos-${clave}`);
  };

  const marcados = pendientes.filter((f) => de(f).marcada && !de(f).omitida);
  const omitidas = pendientes.filter((f) => de(f).omitida);
  const nadaQueGuardar = marcados.length === 0 && omitidas.length === 0;
  const textoDeGuardar =
    marcados.length === 0 && omitidas.length > 0
      ? t.todos.guardarSoloNoPaso
      : plural(t.todos.guardar, marcados.length);

  async function guardar() {
    if (guardando || nadaQueGuardar) return;
    const decisiones: Decision[] = pendientes.flatMap((fila) => {
      const eleccion = de(fila);
      const base = { recurrenteId: fila.recurrente_id, fecha: fila.fecha };
      if (eleccion.omitida) return [{ ...base, omitida: true }];
      if (!eleccion.marcada) return [];
      return [
        eleccion.monto === null
          ? base
          : { ...base, montoCentavos: eleccion.monto },
      ];
    });
    setGuardando(true);
    setError(null);
    alEmpezar();
    const respuesta = await decidir(decisiones);
    setGuardando(false);
    if (respuesta.ok) {
      const { guardados, omitidas: noPaso } = respuesta.cuerpo.resumen;
      alTerminar(avisoDeGuardado(guardados, noPaso));
      return;
    }
    if (seguirPorAccesoNegado(respuesta)) return;
    // La lista y lo marcado se conservan; con un 409 se pide la lista de nuevo y lo que siga pendiente sigue como estaba.
    if (respuesta.estado === 409) refrescar();
    setError(avisoDeFallo(respuesta, avisosDePorConfirmar.errorAlGuardar));
    pedirFoco("aviso-confirmar-todos");
  }

  return (
    <section className="detalle" aria-labelledby="titulo-confirmar-todos">
      <div className="barra">
        <a
          href={atras}
          className="barra__atras"
          aria-label={textos.pagina.atras}
          onClick={(evento) => {
            alTocarEnlace(atras)(evento);
            alVolver();
          }}
        >
          <IconoAtras />
        </a>
        <h2 id="titulo-confirmar-todos" tabIndex={-1} className="titulo">
          {t.confirmarTodos}
        </h2>
      </div>
      <p>{t.todos.explicacion}</p>
      <p className="ayuda">
        {cifras(
          formatear(t.todos.marcados, {
            marcados: String(marcados.length),
            total: String(pendientes.length),
          }),
        )}
      </p>
      {error && <Aviso id="aviso-confirmar-todos" {...error} />}
      <ul className="tarjeta lista-de-filas">
        {pendientes.map((fila) => {
          const clave = claveDe(fila);
          const eleccion = de(fila);
          const centavos =
            eleccion.monto ?? BigInt(fila.monto_habitual_centavos);
          // ACC-004 (bug 231): «Más» dice el monto que se ve en la fila, también el cambiado.
          const tf = textosDeFilaPorConfirmar(fila, centavos);
          const estado = eleccion.omitida
            ? t.todos.noPaso
            : !eleccion.marcada
              ? t.todos.siguePorConfirmar
              : eleccion.monto !== null
                ? t.todos.montoCambiado
                : null;
          return (
            <li key={clave} className="fila-por-confirmar">
              <div className="fila-por-confirmar__datos">
                <Casilla
                  id={`marcar-${clave}`}
                  marcada={eleccion.marcada && !eleccion.omitida}
                  deshabilitada={eleccion.omitida}
                  alCambiar={(marcada) => cambiar(fila, { marcada })}
                  texto={
                    <>
                      <span className="fila">
                        <span className="fila__nombre">
                          {cifras(tf.principal)}
                        </span>
                        <span className="ayuda">
                          {cifras(tf.apoyoSinMedio)}
                        </span>
                        {estado && <span className="ayuda">{estado}</span>}
                      </span>
                      <span className="cifra">{formatearPesos(centavos)}</span>
                    </>
                  }
                />
                <Boton
                  id={`mas-todos-${clave}`}
                  variante="texto"
                  nombre={tf.nombreDeMas}
                  alTocar={() => setHoja({ tipo: "mas", clave })}
                >
                  {t.mas}
                </Boton>
              </div>
              {hoja?.clave === clave && hoja.tipo === "mas" && (
                <HojaDeMas
                  fila={fila}
                  conIncluir={eleccion.omitida}
                  alCerrar={() => cerrar(clave)}
                  alElegir={(opcion) => {
                    if (opcion === "monto") setHoja({ tipo: "monto", clave });
                    else {
                      cambiar(
                        fila,
                        opcion === "no_paso" ? { omitida: true } : INICIAL,
                      );
                      cerrar(clave);
                    }
                  }}
                />
              )}
              {hoja?.clave === clave && hoja.tipo === "monto" && (
                <HojaDeMonto
                  fila={fila}
                  textoDelBoton={t.hoja.listo}
                  alCerrar={() => cerrar(clave)}
                  alConfirmar={(centavos) => {
                    const habitual = BigInt(fila.monto_habitual_centavos);
                    cambiar(fila, {
                      monto: centavos === habitual ? null : centavos,
                    });
                    cerrar(clave);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="ayuda">{t.todos.aclaracion}</p>
      <div className="pie-fijo">
        <Boton
          deshabilitado={guardando || nadaQueGuardar}
          alTocar={() => void guardar()}
        >
          {textoDeGuardar}
        </Boton>
      </div>
    </section>
  );
}
