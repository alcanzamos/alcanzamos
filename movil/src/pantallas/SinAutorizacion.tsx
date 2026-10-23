import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { cerrarSesion } from '../api/cuentas';
import { Aviso } from '../componentes/Aviso';
import { BotonDeTexto } from '../componentes/Boton';
import { Pantalla } from '../componentes/Pantalla';
import { avisoDeLlegada, reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisos } from '../textos';

// PANTALLA PROVISIONAL (US-49, P1). Hasta que la US-50 construya PN-63 y PN-64, una cuenta verificada llega aquí: sin
// autorización no se usa para nada más. La US-50 la reemplaza por PN-63 y PN-64. El texto es el de la nota de PN-64
// (E14-PCP 4.7, fila 5); lo único que se puede hacer es «Cerrar sesión» (4.16 T2). Arriba muestra el mensaje de
// estado de la llegada, «Listo, confirmamos tu correo.» (4.16 T11, D-153).
export function SinAutorizacion({ navigation, route }: NativeStackScreenProps<Rutas, 'SinAutorizacion'>) {
  const [sinConexion, setSinConexion] = useState(false);

  async function salir() {
    const respuesta = await cerrarSesion();
    // Solo la falta de conexión se queda: cualquier otra respuesta saca a la persona (y borra el token).
    if (!respuesta.ok && respuesta.estado === 0) setSinConexion(true);
    else reemplazarPila(navigation, 'Entrar');
  }

  return (
    <Pantalla titulo="Sin esta autorización no podemos darte la cuenta." estado={avisoDeLlegada(route.params?.llegada)}>
      {sinConexion && <Aviso {...avisos.sinConexion} />}
      <BotonDeTexto alTocar={() => void salir()}>Cerrar sesión</BotonDeTexto>
    </Pantalla>
  );
}
