import { useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { useAvisarErrores } from '../anuncios';
import { Aviso } from '../componentes/Aviso';
import { Boton } from '../componentes/Boton';
import { CampoDeMonto } from '../componentes/CampoDeMonto';
import { HojaInferior } from '../componentes/HojaInferior';
import { Texto } from '../componentes/Texto';
import { leerMonto } from '../dinero';
import type { DatosDeAviso } from '../textos';
import { formatear, textos } from '../textos/es.generated';
import { textoDelMonto } from '../validacionDeRegistro';

const t = textos.presupuesto;
const ahoraNo = textos.movimientos.detalle.ahoraNo;

// Las hojas de PN-06 (E14-PPA 4.1, E14-SDD 5.12), hojas inferiores con su título y «Cerrar». Solo dibujan y revisan el
// monto escrito: la pantalla manda al API y dice el aviso. Un fallo que no es del campo es un Aviso dentro de la hoja,
// que TalkBack dice por la región viva de la hoja (ACC-004).

/**
 * «Poner presupuesto» y «Corregir»: la misma hoja; «Corregir» trae el monto actual escrito. Sin la aclaración de la
 * simulación ni «De quién es» (L3 de la US-77, punto 2: vuelven con la simulación y con el hogar, en I08). `alGuardar`
 * devuelve el error del campo que mandó el API, si lo hay: el campo lo muestra y recibe el foco (US-63).
 */
export function HojaDeMontoDelPresupuesto({
  titulo,
  mes,
  montoInicial,
  aviso,
  enviando,
  alGuardar,
  alCerrar,
}: {
  titulo: string;
  /** «noviembre»: la etiqueta dice «Monto para noviembre». */
  mes: string;
  montoInicial: string;
  aviso: DatosDeAviso | null;
  enviando: boolean;
  alGuardar: (centavos: bigint) => Promise<string | undefined>;
  alCerrar: () => void;
}) {
  const [monto, setMonto] = useState(montoInicial);
  const [error, setError] = useState<string>();
  const campo = useRef<TextInputInstance>(null);
  const avisarErrores = useAvisarErrores();

  async function guardar() {
    if (enviando) return;
    const lectura = leerMonto(monto);
    const delCampo = lectura.ok ? await alGuardar(lectura.centavos) : textoDelMonto(lectura);
    setError(delCampo);
    if (delCampo) avisarErrores([{ error: delCampo, campo }]);
  }

  return (
    <HojaInferior visible titulo={titulo} alCerrar={alCerrar}>
      <CampoDeMonto
        ref={campo}
        etiqueta={formatear(t.hoja.monto, { mes })}
        nombreAccesible={formatear(t.hoja.montoNombreAccesible, { mes })}
        valor={monto}
        alCambiar={setMonto}
        error={error}
      />
      {aviso && <Aviso {...aviso} />}
      <Boton deshabilitado={enviando} alTocar={() => void guardar()}>
        {t.hoja.guardar}
      </Boton>
      <Boton variante="secundario" alTocar={alCerrar}>
        {ahoraNo}
      </Boton>
    </HojaInferior>
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
    <HojaInferior visible titulo={formatear(t.quitar.titulo, { categoria })} alCerrar={alCerrar}>
      <Texto>{t.quitar.explicacion}</Texto>
      {aviso && <Aviso {...aviso} />}
      <Boton deshabilitado={enviando} alTocar={alQuitar}>
        {t.quitar.confirmar}
      </Boton>
      <Boton variante="secundario" alTocar={alCerrar}>
        {ahoraNo}
      </Boton>
    </HojaInferior>
  );
}
