import { useState } from "react";
import { cerrarSesion } from "../api/cuentas";
import { SIN_CONEXION } from "../api/cliente";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { Pagina } from "../componentes/Pagina";
import { navegar } from "../enrutador";
import { avisoDeLlegada } from "../llegada";
import { avisos } from "../textos";
import { textos } from "../textos/es.generated";

// PANTALLA PROVISIONAL (US-49, P1). Hasta que la US-50 construya PN-63 y PN-64, una cuenta verificada
// llega aquí: sin autorización no se usa para nada más. La US-50 la reemplaza por PN-63 y PN-64.
// El texto es el de la nota de PN-64 (E14-PCP 4.7); lo único que se puede hacer es cerrar sesión (4.16 T2). Arriba
// muestra el mensaje de estado de la llegada, «Listo, confirmamos tu correo.» (4.16 T11).
export function SinAutorizacion() {
  const [sinConexion, setSinConexion] = useState(false);

  async function salir() {
    const respuesta = await cerrarSesion();
    // Un 401 es que la sesión ya no existía: igual se sale. Solo la falta de conexión se queda.
    if (!respuesta.ok && respuesta.codigo === SIN_CONEXION)
      setSinConexion(true);
    else navegar("/entrar");
  }

  return (
    <Pagina titulo={textos.sinAutorizacion.titulo} estado={avisoDeLlegada()}>
      {sinConexion && <Aviso {...avisos.sinConexion} />}
      <Boton variante="texto" alTocar={() => void salir()}>
        {textos.acciones.cerrarSesion}
      </Boton>
    </Pagina>
  );
}
