import { useEffect, useRef, useState } from "react";
import { reenviarCorreo, verificarCorreo } from "../api/cuentas";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { Pagina } from "../componentes/Pagina";
import { navegar, useUbicacion } from "../enrutador";
import { irConAviso } from "../llegada";
import { avisoDeFallo, avisos, type DatosDeAviso } from "../textos";
import { textos } from "../textos/es.generated";

// Entrada del enlace del correo (/verificar?t=). Confirmado: se va enseguida, sin espera, y «Listo, confirmamos tu
// correo.» se muestra arriba del destino como mensaje de estado (E14-PCP 4.16 T11, D-153). Sin token o vencido: el
// estado «Enlace vencido» de PN-59.
export function Verificar() {
  const { parametros } = useUbicacion();
  const token = parametros.get("t") ?? "";
  // Sin token no hay nada que pedir: el enlace ya no sirve.
  const [aviso, setAviso] = useState<DatosDeAviso | null>(
    token ? null : avisos.enlaceVencido,
  );
  const [vencido, setVencido] = useState(!token);
  // El token sirve una vez: con StrictMode el efecto corre dos veces y solo uno debe pedir.
  const pedido = useRef(false);

  useEffect(() => {
    if (pedido.current) return;
    pedido.current = true;
    if (!token) return;
    void verificarCorreo(token).then((respuesta) => {
      if (respuesta.ok) {
        // Con sesión, PN-63 (en la US-49, la pantalla provisional que la reemplaza); sin ella, PN-60.
        irConAviso(
          respuesta.cuerpo.con_sesion ? "/sin-autorizacion" : "/entrar",
          "correo_confirmado",
        );
      } else if (respuesta.codigo === "enlace_invalido") {
        setAviso(avisos.enlaceVencido);
        setVencido(true);
      } else {
        setAviso(avisoDeFallo(respuesta, avisos.errorAlConfirmarElCorreo));
      }
    });
  }, [token]);

  // «Reenviar el correo» con la sesión limitada; sin sesión (401) la persona entra y sigue en PN-59 (D-138).
  async function pedirOtro() {
    const respuesta = await reenviarCorreo();
    if (respuesta.ok || respuesta.estado === 429) navegar("/revisa-tu-correo");
    else if (respuesta.estado === 401) navegar("/entrar");
    else setAviso(avisoDeFallo(respuesta, avisos.errorAlEnviarCorreo));
  }

  return (
    <Pagina titulo={textos.revisaTuCorreo.titulo}>
      {aviso && <Aviso {...aviso} />}
      {vencido && (
        <Boton alTocar={() => void pedirOtro()}>
          {textos.acciones.reenviarElCorreo}
        </Boton>
      )}
    </Pagina>
  );
}
