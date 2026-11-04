import { useState } from "react";
import { seguirPorAccesoNegado } from "../accesoNegado";
import type { Respuesta } from "../api/cliente";
import {
  confirmarFecha,
  omitirFecha,
  type Pendiente,
  type Pendientes,
} from "../api/repeticiones";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { cifras } from "../componentes/Cifras";
import { formatearPesos } from "../dinero";
import { useFocoPendiente } from "../enfoque";
import {
  avisoDeFallo,
  resumenPorConfirmar,
  type DatosDeAviso,
} from "../textos";
import {
  avisoDeConfirmado,
  avisosDePorConfirmar,
  textosDeFilaPorConfirmar,
} from "../textosDePorConfirmar";
import { textos } from "../textos/es.generated";
import { HojaDeMas, HojaDeMonto, HojaDeNoPaso } from "./HojasDeFecha";

const p = textos.porConfirmar;

type Hoja = { tipo: "mas" | "monto" | "no_paso"; clave: string };

export const claveDe = (fila: Pendiente) =>
  `${fila.recurrente_id}-${fila.fecha}`;

// La sección «Por confirmar» de PN-01 (E14-PRR 4.1, D-091 a D-093): una fila por fecha que ya llegó, con «Confirmar» a
// la vista y «Más» (D-092) para «Cambiar el monto» y «No pasó». Con más de una fecha, el resumen y «Confirmar todos».
// Qué fechas hay lo decide el API (E17-ECO 4.7): aquí solo se muestran y se mandan las decisiones.
export function PorConfirmar({
  datos,
  hrefDeTodos,
  alEmpezar,
  alTerminar,
  refrescar,
}: {
  datos: Pendientes;
  hrefDeTodos: string;
  alEmpezar: () => void;
  alTerminar: (aviso: DatosDeAviso) => void;
  refrescar: () => void;
}) {
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<DatosDeAviso | null>(null);
  const pedirFoco = useFocoPendiente();
  const { pendientes, resumen } = datos;

  const cerrar = (clave: string) => {
    setHoja(null);
    pedirFoco(`mas-${clave}`);
  };
  // Un fallo no cambia nada: la fecha sigue por confirmar. Un 409 (otra petición la resolvió o hubo un choque en la
  // base) pide la lista de nuevo: el cliente decide con lo que hay ahora (api/README.md, «Concurrencia»).
  const fallar = (
    respuesta: Extract<Respuesta<unknown>, { ok: false }>,
    generico: DatosDeAviso,
  ) => {
    if (seguirPorAccesoNegado(respuesta)) return;
    if (respuesta.estado === 409) refrescar();
    setHoja(null);
    setError(avisoDeFallo(respuesta, generico));
    pedirFoco("aviso-por-confirmar");
  };

  async function confirmar(fila: Pendiente, centavos?: bigint) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    alEmpezar();
    const respuesta = await confirmarFecha(
      fila.recurrente_id,
      fila.fecha,
      centavos,
    );
    setEnviando(false);
    if (!respuesta.ok)
      return fallar(respuesta, avisosDePorConfirmar.errorAlConfirmar);
    setHoja(null);
    alTerminar(avisoDeConfirmado(respuesta.cuerpo));
  }

  async function noPaso(fila: Pendiente) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    alEmpezar();
    const respuesta = await omitirFecha(fila.recurrente_id, fila.fecha);
    setEnviando(false);
    if (!respuesta.ok)
      return fallar(respuesta, avisosDePorConfirmar.errorAlOmitir);
    setHoja(null);
    alTerminar(avisosDePorConfirmar.yaNoContamos);
  }

  return (
    <section className="tarjeta" aria-labelledby="por-confirmar-titulo">
      <h2 id="por-confirmar-titulo" tabIndex={-1} className="titulo-3">
        {p.titulo}
      </h2>
      <p className="ayuda">
        {pendientes.length > 1 ? p.textoVarias : p.textoUna}
      </p>
      {pendientes.length > 1 && (
        <>
          <p className="fila__nombre">
            {cifras(resumenPorConfirmar(resumen.ingresos, resumen.gastos))}
          </p>
          <BotonEnlace id="confirmar-todos" href={hrefDeTodos}>
            {p.confirmarTodos}
          </BotonEnlace>
        </>
      )}
      {error && <Aviso id="aviso-por-confirmar" {...error} />}
      <ul className="lista-de-filas lista-sin-relleno">
        {pendientes.map((fila) => {
          const clave = claveDe(fila);
          const t = textosDeFilaPorConfirmar(fila);
          return (
            <li key={clave} className="fila-por-confirmar">
              <div className="fila-por-confirmar__datos">
                <span className="fila">
                  <span className="fila__nombre">{cifras(t.principal)}</span>
                  <span className="ayuda">{cifras(t.apoyo)}</span>
                  <span className="ayuda">{p.marca}</span>
                </span>
                <span className="cifra">
                  {formatearPesos(BigInt(fila.monto_habitual_centavos))}
                </span>
              </div>
              <div className="fila-por-confirmar__acciones">
                <Boton
                  variante="secundario"
                  nombre={t.nombreDeConfirmar}
                  deshabilitado={enviando}
                  alTocar={() => void confirmar(fila)}
                >
                  {p.confirmar}
                </Boton>
                <Boton
                  id={`mas-${clave}`}
                  variante="texto"
                  nombre={t.nombreDeMas}
                  alTocar={() => setHoja({ tipo: "mas", clave })}
                >
                  {p.mas}
                </Boton>
              </div>
              {hoja?.clave === clave && hoja.tipo === "mas" && (
                <HojaDeMas
                  fila={fila}
                  alCerrar={() => cerrar(clave)}
                  alElegir={(opcion) =>
                    setHoja({
                      tipo: opcion === "monto" ? "monto" : "no_paso",
                      clave,
                    })
                  }
                />
              )}
              {hoja?.clave === clave && hoja.tipo === "monto" && (
                <HojaDeMonto
                  fila={fila}
                  textoDelBoton={p.hoja.confirmar}
                  enviando={enviando}
                  alCerrar={() => cerrar(clave)}
                  alConfirmar={(centavos) => void confirmar(fila, centavos)}
                />
              )}
              {hoja?.clave === clave && hoja.tipo === "no_paso" && (
                <HojaDeNoPaso
                  enviando={enviando}
                  alCerrar={() => cerrar(clave)}
                  alConfirmar={() => void noPaso(fila)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
