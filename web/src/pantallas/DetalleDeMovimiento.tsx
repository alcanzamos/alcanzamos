import { useEffect, useState } from "react";
import { seguirPorAccesoNegado } from "../accesoNegado";
import { borrarMovimiento, type Movimiento } from "../api/movimientos";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { cifras } from "../componentes/Cifras";
import { IconoAtras } from "../componentes/Iconos";
import { MarcaDePropiedad } from "../componentes/MarcaDePropiedad";
import { formatearPesos } from "../dinero";
import { enfocar, useFocoPendiente } from "../enfoque";
import { alTocarEnlace, llegoNavegando } from "../enrutador";
import { hoyEnColombia } from "../fechas";
import {
  avisoDeFallo,
  avisos,
  etiquetasDePeriodicidad,
  type DatosDeAviso,
} from "../textos";
import {
  avisoDeBorrado,
  mediosEnPalabras,
  queSeBorra,
  resumenDelDetalle,
  tituloDelDia,
} from "../textosDeMovimientos";
import { textos } from "../textos/es.generated";
import { FormularioDeMovimiento } from "./Registrar";

type Modo = "detalle" | "corrigiendo" | "borrando";
const d = textos.movimientos.detalle;
const b = textos.movimientos.borrar;

// PN-02 · Detalle de un movimiento: corregir o borrar, variante web (E14-PRR 4.2). Es la columna derecha de PN-01: no
// cambia de página. «Corregir» reemplaza el detalle por los campos del formulario y borrar abre un panel de
// confirmación (la hoja inferior de Android). `alTerminar(aviso)` vuelve a PN-01 con ese aviso; con `null` el
// movimiento ya no existe (el API contestó 404) y PN-01 lo muestra como tal.
export function DetalleDeMovimiento({
  movimiento: m,
  atras,
  alTerminar,
}: {
  movimiento: Movimiento;
  atras: string;
  alTerminar: (aviso: DatosDeAviso | null) => void;
}) {
  const [modo, setModo] = useState<Modo>("detalle");
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [borrando, setBorrando] = useState(false);
  const pedirFoco = useFocoPendiente();
  const hoy = hoyEnColombia();
  // Al abrirlo el foco pasa al título: en el diseño de Android el detalle es una pantalla aparte y la lista se oculta.
  useEffect(() => {
    if (llegoNavegando()) enfocar("titulo-detalle");
  }, []);

  const cambiarModo = (nuevo: Modo) => {
    setModo(nuevo);
    setAviso(null);
    pedirFoco(nuevo === "borrando" ? "titulo-borrar" : "titulo-detalle");
  };

  async function borrar() {
    if (borrando) return;
    setBorrando(true);
    setAviso(null);
    const respuesta = await borrarMovimiento(m.id);
    setBorrando(false);
    if (respuesta.ok) alTerminar(avisoDeBorrado(m));
    else if (respuesta.estado === 404) alTerminar(null);
    else if (!seguirPorAccesoNegado(respuesta)) {
      setAviso(avisoDeFallo(respuesta, avisos.errorAlBorrar));
      pedirFoco("aviso");
    }
  }

  // Un aporte o un retiro se lista y se ve, pero no se corrige ni se borra en la US-52 (D-170).
  const sePuedeCambiar = m.tipo !== "aporte";
  return (
    <section className="detalle" aria-labelledby="titulo-detalle">
      <div className="barra">
        <a
          href={atras}
          className="barra__atras detalle__atras"
          aria-label={textos.pagina.atras}
          onClick={alTocarEnlace(atras)}
        >
          <IconoAtras />
        </a>
        <h2 id="titulo-detalle" tabIndex={-1} className="titulo">
          {modo === "corrigiendo" ? d.corregirTitulo : d.titulo}
        </h2>
      </div>
      {modo === "corrigiendo" ? (
        <FormularioDeMovimiento
          corregir={{
            movimiento: m,
            alTerminar,
            alCancelar: () => cambiarModo("detalle"),
          }}
        />
      ) : (
        <>
          <section className="tarjeta">
            <p className="monto-grande cifra">
              {formatearPesos(BigInt(m.monto_centavos))}
            </p>
            <p>{resumenDelDetalle(m)}</p>
          </section>
          <section className="tarjeta">
            <div className="fila">
              <p className="fila__nombre">{d.fecha}</p>
              <p>{cifras(tituloDelDia(m.fecha, hoy))}</p>
            </div>
            <div className="fila">
              <p className="fila__nombre">{textos.registro.medio.etiqueta}</p>
              <p>{mediosEnPalabras[m.medio]}</p>
            </div>
            <div className="fila">
              <p className="fila__nombre">{textos.registro.quien.etiqueta}</p>
              <MarcaDePropiedad compartido={m.compartido} />
            </div>
            {m.descripcion && (
              <div className="fila">
                <p className="fila__nombre">{d.descripcion}</p>
                <p>{cifras(m.descripcion)}</p>
              </div>
            )}
          </section>
          {m.recurrente && (
            <section className="tarjeta">
              <div className="fila">
                <p className="fila__nombre">
                  {textos.registro.seRepite.etiqueta}
                </p>
                <p>{etiquetasDePeriodicidad[m.recurrente.periodicidad]}</p>
              </div>
            </section>
          )}
          {sePuedeCambiar && (
            <>
              <Boton alTocar={() => cambiarModo("corrigiendo")}>
                {d.corregir}
              </Boton>
              <Boton
                variante="secundario"
                alTocar={() => cambiarModo("borrando")}
              >
                {d.borrar}
              </Boton>
            </>
          )}
          {modo === "borrando" && (
            <section className="tarjeta panel" aria-labelledby="titulo-borrar">
              <h3 id="titulo-borrar" tabIndex={-1} className="titulo-3">
                {b.titulo}
              </h3>
              {aviso && <Aviso {...aviso} />}
              <p>{cifras(queSeBorra(m, hoy))}</p>
              <p>{b.quePasa}</p>
              {m.recurrente?.vuelve_a_pendiente && (
                <p>{d.volveraPorConfirmar}</p>
              )}
              <Boton
                variante="destructivo"
                deshabilitado={borrando}
                alTocar={() => void borrar()}
              >
                {b.confirmar}
              </Boton>
              <Boton
                variante="secundario"
                alTocar={() => cambiarModo("detalle")}
              >
                {d.ahoraNo}
              </Boton>
            </section>
          )}
        </>
      )}
    </section>
  );
}
