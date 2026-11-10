import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { CampoDeTexto } from "../componentes/CampoDeTexto";
import { Hoja } from "../componentes/Hoja";
import { formatearPesos, leerMonto } from "../dinero";
import type { DatosDeAviso } from "../textos";
import { formatear, textos } from "../textos/es.generated";

const t = textos.presupuesto;
const ahoraNo = textos.movimientos.detalle.ahoraNo;

export const ID_DEL_MONTO = "monto-del-presupuesto";
export const ID_DEL_AVISO_DE_LA_HOJA = "aviso-de-la-hoja";

// Las hojas de PN-06 (E14-PPA 4.1, E14-SDD 5.12): en la web, un panel junto al botón que la abre. Solo dibujan: el
// monto escrito, los errores y el envío los lleva la pantalla, que manda al API y devuelve el foco al cerrar.

/** «Poner presupuesto» y «Corregir»: la misma hoja; «Corregir» trae el monto actual escrito. Sin la aclaración de la
 * simulación ni «De quién es» (L3 de la US-77, puntos 2: vuelven con la simulación y con el hogar, en I08). */
export function HojaDeMontoDelPresupuesto({
  titulo,
  mes,
  monto,
  error,
  aviso,
  enviando,
  alCambiar,
  alGuardar,
  alCerrar,
}: {
  titulo: string;
  /** «noviembre»: la etiqueta dice «Monto para noviembre». */
  mes: string;
  monto: string;
  error?: string;
  aviso: DatosDeAviso | null;
  enviando: boolean;
  alCambiar: (monto: string) => void;
  alGuardar: () => void;
  alCerrar: () => void;
}) {
  // Al salir del campo el monto queda con la regla de E14-SDD 5.5, como en el formulario de registro.
  const alSalir = () => {
    const lectura = leerMonto(monto);
    if (lectura.ok) alCambiar(formatearPesos(lectura.centavos));
  };
  return (
    <Hoja titulo={titulo} alCerrar={alCerrar}>
      <CampoDeTexto
        id={ID_DEL_MONTO}
        etiqueta={formatear(t.hoja.monto, { mes })}
        modo="decimal"
        cifra
        autocompletar="off"
        valor={monto}
        alCambiar={alCambiar}
        alSalir={alSalir}
        error={error}
      />
      {aviso && <Aviso id={ID_DEL_AVISO_DE_LA_HOJA} {...aviso} />}
      <Boton deshabilitado={enviando} alTocar={alGuardar}>
        {t.hoja.guardar}
      </Boton>
      <Boton variante="secundario" alTocar={alCerrar}>
        {ahoraNo}
      </Boton>
    </Hoja>
  );
}

/** «¿Quitar el presupuesto de Transporte?»: confirma antes de quitar; lo gastado no cambia (D-094, SC-E21-13). */
export function HojaDeQuitar({
  categoria,
  aviso,
  enviando,
  alQuitar,
  alCerrar,
}: {
  categoria: string;
  aviso: DatosDeAviso | null;
  enviando: boolean;
  alQuitar: () => void;
  alCerrar: () => void;
}) {
  return (
    <Hoja
      titulo={formatear(t.quitar.titulo, { categoria })}
      alCerrar={alCerrar}
    >
      <p>{t.quitar.explicacion}</p>
      {aviso && <Aviso id={ID_DEL_AVISO_DE_LA_HOJA} {...aviso} />}
      <Boton deshabilitado={enviando} alTocar={alQuitar}>
        {t.quitar.confirmar}
      </Boton>
      <Boton variante="secundario" alTocar={alCerrar}>
        {ahoraNo}
      </Boton>
    </Hoja>
  );
}
