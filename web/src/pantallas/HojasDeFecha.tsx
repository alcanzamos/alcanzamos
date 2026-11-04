import { useState } from "react";
import type { Pendiente } from "../api/repeticiones";
import { Boton } from "../componentes/Boton";
import { CampoDeTexto } from "../componentes/CampoDeTexto";
import { Hoja } from "../componentes/Hoja";
import { formatearPesos, leerMonto } from "../dinero";
import { enfocar } from "../enfoque";
import { textosDeFilaPorConfirmar } from "../textosDePorConfirmar";
import { textoDelMonto } from "../validacionDeRegistro";
import { textos } from "../textos/es.generated";

const h = textos.porConfirmar.hoja;
const ahoraNo = textos.movimientos.detalle.ahoraNo;

export type Opcion = "monto" | "no_paso";

// Las hojas de una fecha por confirmar (E14-PRR 4.1, 5.12): «Más», «No pasó» y «Cambiar el monto». Cada una avisa lo
// que se eligió; quien las abre guarda y devuelve el foco.

/** «Más»: «Cambiar el monto» y «No pasó» (D-092). */
export function HojaDeMas({
  fila,
  alElegir,
  alCerrar,
}: {
  fila: Pendiente;
  alElegir: (opcion: Opcion) => void;
  alCerrar: () => void;
}) {
  const opciones: [Opcion, string][] = [
    ["monto", h.cambiarElMonto],
    ["no_paso", h.noPaso],
  ];
  return (
    <Hoja
      titulo={textosDeFilaPorConfirmar(fila).tituloDeLaHoja}
      alCerrar={alCerrar}
    >
      <ul className="lista-de-filas lista-sin-relleno">
        {opciones.map(([opcion, texto]) => (
          <li key={opcion}>
            <button
              type="button"
              className="fila-navegable"
              onClick={() => alElegir(opcion)}
            >
              {texto}
            </button>
          </li>
        ))}
      </ul>
    </Hoja>
  );
}

/** «¿Esta fecha no pasó?»: sin el Botón destructivo, porque no borra nada y la repetición sigue (RF-006). */
export function HojaDeNoPaso({
  enviando,
  alConfirmar,
  alCerrar,
}: {
  enviando: boolean;
  alConfirmar: () => void;
  alCerrar: () => void;
}) {
  return (
    <Hoja titulo={h.tituloNoPaso} alCerrar={alCerrar}>
      <p>{h.textoNoPaso}</p>
      <Boton deshabilitado={enviando} alTocar={alConfirmar}>
        {h.noPaso}
      </Boton>
      <Boton variante="secundario" alTocar={alCerrar}>
        {ahoraNo}
      </Boton>
    </Hoja>
  );
}

/** «¿Cuánto llegó?» o «¿Cuánto pagaste?», con el monto habitual escrito; los errores son los de E14-PPN 3.1. */
export function HojaDeMonto({
  fila,
  textoDelBoton,
  enviando = false,
  alConfirmar,
  alCerrar,
}: {
  fila: Pendiente;
  textoDelBoton: string;
  enviando?: boolean;
  alConfirmar: (centavos: bigint) => void;
  alCerrar: () => void;
}) {
  const [monto, setMonto] = useState(
    formatearPesos(BigInt(fila.monto_habitual_centavos)),
  );
  const [error, setError] = useState<string>();

  const alSalir = () => {
    const lectura = leerMonto(monto);
    if (lectura.ok) setMonto(formatearPesos(lectura.centavos));
  };
  const confirmar = () => {
    const lectura = leerMonto(monto);
    if (lectura.ok) alConfirmar(lectura.centavos);
    else {
      setError(textoDelMonto(lectura));
      enfocar("monto-de-la-hoja");
    }
  };

  return (
    <Hoja
      titulo={textosDeFilaPorConfirmar(fila).tituloDelMonto}
      alCerrar={alCerrar}
    >
      <CampoDeTexto
        id="monto-de-la-hoja"
        etiqueta={textos.registro.monto.etiqueta}
        modo="decimal"
        cifra
        autocompletar="off"
        valor={monto}
        alCambiar={setMonto}
        alSalir={alSalir}
        error={error}
      />
      <p className="ayuda">{textos.movimientos.detalle.soloEstaFecha}</p>
      <Boton deshabilitado={enviando} alTocar={confirmar}>
        {textoDelBoton}
      </Boton>
      <Boton variante="secundario" alTocar={alCerrar}>
        {ahoraNo}
      </Boton>
    </Hoja>
  );
}
