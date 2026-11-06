import { useState, type SyntheticEvent } from "react";
import { completarCuenta } from "../api/cuentas";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { CampoDeContrasena } from "../componentes/CampoDeContrasena";
import { CampoDeTexto } from "../componentes/CampoDeTexto";
import { Pagina } from "../componentes/Pagina";
import { useFocoPendiente } from "../enfoque";
import { useUbicacion } from "../enrutador";
import { irConAviso } from "../llegada";
import {
  avisoDeFallo,
  avisos,
  textoDeErrorDeCampo,
  type DatosDeAviso,
} from "../textos";
import { textos } from "../textos/es.generated";

// Del cuerpo del pedido al id del control, en el orden de la pantalla (el foco va al primero con error).
const orden = [
  ["contrasena", "contrasena"],
  ["nombre", "nombre"],
] as const;

// PN-74 · Elige tu contraseña (E14-PCP 4.2 ter, D-172, D-192), la entrada del enlace del correo (/verificar?t=).
// Abrir el enlace no gasta nada: la contraseña y el nombre se mandan juntos con el token y solo entonces el correo
// queda verificado y empieza la sesión. Guardada: se va enseguida, sin espera, a PN-63 con «Listo, confirmamos tu
// correo.» como mensaje de estado (4.16 T11, D-153). Un enlace vencido, ya usado o reemplazado (`enlace_invalido`)
// dice cómo pedir otro, como PN-62, nunca un error genérico. La pantalla no muestra el correo ni otra pista de la cuenta.
export function Verificar() {
  const { parametros } = useUbicacion();
  const token = parametros.get("t") ?? "";
  const [contrasena, setContrasena] = useState("");
  const [nombre, setNombre] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  // Sin token no hay nada que guardar: el enlace ya no sirve.
  const [aviso, setAviso] = useState<DatosDeAviso | null>(
    token ? null : avisos.enlaceVencido,
  );
  const [vencido, setVencido] = useState(!token);
  const [enviando, setEnviando] = useState(false);
  const pedirFoco = useFocoPendiente();

  function mostrar(
    delCampo: Record<string, string>,
    otroAviso: DatosDeAviso | null,
  ) {
    setErrores(delCampo);
    setAviso(otroAviso);
    const primero = orden.find(([campo]) => delCampo[campo]);
    pedirFoco(primero ? primero[1] : "aviso");
  }

  async function enviar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true);
    const respuesta = await completarCuenta({ token, contrasena, nombre });
    setEnviando(false);
    if (respuesta.ok) return irConAviso("/privacidad", "correo_confirmado");
    if (respuesta.codigo === "enlace_invalido") {
      setVencido(true);
      return mostrar({}, avisos.enlaceVencido);
    }
    const delCampo: Record<string, string> = {};
    let sinTexto = false;
    if (respuesta.codigo === "validacion") {
      for (const [campo, codigo] of Object.entries(respuesta.campos)) {
        const texto = textoDeErrorDeCampo(codigo, "eligeTuContrasena");
        if (texto) delCampo[campo] = texto;
        else sinTexto = true;
      }
    }
    const hayErroresDeCampo = Object.keys(delCampo).length > 0;
    mostrar(
      delCampo,
      hayErroresDeCampo && !sinTexto
        ? null
        : avisoDeFallo(respuesta, avisos.errorAlGuardarContrasena),
    );
  }

  return (
    <Pagina titulo={textos.eligeTuContrasena.titulo}>
      {aviso && <Aviso {...aviso} />}
      {vencido ? (
        <BotonEnlace href="/crear-cuenta" variante="primario">
          {textos.eligeTuContrasena.pedirOtro}
        </BotonEnlace>
      ) : (
        <>
          <p>{textos.eligeTuContrasena.intro}</p>
          <form className="formulario" noValidate onSubmit={enviar}>
            <CampoDeContrasena
              id="contrasena"
              etiqueta={textos.campos.contrasena.etiqueta}
              ayuda={textos.campos.contrasena.ayuda}
              autocompletar="new-password"
              valor={contrasena}
              alCambiar={setContrasena}
              error={errores.contrasena}
            />
            <CampoDeTexto
              id="nombre"
              etiqueta={textos.campos.nombre.etiqueta}
              ayuda={textos.campos.nombre.ayuda}
              autocompletar="name"
              valor={nombre}
              alCambiar={setNombre}
              error={errores.nombre}
            />
            <Boton tipo="submit" deshabilitado={enviando}>
              {textos.acciones.guardarLaContrasena}
            </Boton>
          </form>
        </>
      )}
    </Pagina>
  );
}
