import type { ReactElement } from "react";
import { Boton } from "../componentes/Boton";
import { IconoInformacion, IconoPropio } from "../componentes/Iconos";
import { Pagina } from "../componentes/Pagina";
import { avisoDeLlegada } from "../llegada";
import { navegar } from "../enrutador";
import { textos } from "../textos/es.generated";

const t = textos.privacidad.tarjetas;

// Las ocho tarjetas, en el orden de E14-PCP 4.6 (filas 3 a 9 b); la de «Lo tuyo es solo tuyo» lleva el ícono Propio
// (E14-SDD 5.16) y la de «Cuida lo que escribes», el de Información.
const tarjetas: {
  id: string;
  tarjeta: { titulo: string; cuerpo: string };
  Icono?: () => ReactElement;
}[] = [
  { id: "que-guardamos", tarjeta: t.queGuardamos },
  { id: "para-que", tarjeta: t.paraQue },
  { id: "lo-tuyo", tarjeta: t.loTuyo, Icono: IconoPropio },
  { id: "avisos", tarjeta: t.avisos },
  { id: "cuidado", tarjeta: t.cuidado, Icono: IconoInformacion },
  { id: "derechos", tarjeta: t.derechos },
  { id: "quien-responde", tarjeta: t.quienResponde },
  { id: "donde-se-guardan", tarjeta: t.dondeSeGuardan },
];

// PN-63 · Información de privacidad en el primer uso (E14-PCP 4.6): solo informa, no pide nada. Sin Atrás y con
// «Continuar» a PN-64. Sin «Leer la política completa»: abre PN-68, que no está construida. «Desde el menú» (PN-66)
// tampoco: PN-66 no existe. «Listo, confirmamos tu correo.» llega arriba como mensaje de estado (4.16 T11).
export function Privacidad() {
  return (
    <Pagina titulo={textos.privacidad.titulo} estado={avisoDeLlegada()}>
      <p>{textos.privacidad.intro}</p>
      {tarjetas.map(({ id, tarjeta, Icono }) => (
        <section key={id} className="tarjeta" aria-labelledby={`titulo-${id}`}>
          <h2 id={`titulo-${id}`} className="titulo-3 titulo-tarjeta">
            {Icono && <Icono />}
            {tarjeta.titulo}
          </h2>
          <p>{tarjeta.cuerpo}</p>
        </section>
      ))}
      <Boton alTocar={() => navegar("/autorizacion")}>
        {textos.privacidad.continuar}
      </Boton>
    </Pagina>
  );
}
