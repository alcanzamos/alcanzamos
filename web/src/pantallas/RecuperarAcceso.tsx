import { useState, type SyntheticEvent } from "react";
import { pedirRecuperacion } from "../api/acceso";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { CampoDeTexto } from "../componentes/CampoDeTexto";
import { Pagina } from "../componentes/Pagina";
import { useFocoPendiente } from "../enfoque";
import {
  avisoDeFallo,
  avisos,
  textoDeErrorDeCampo,
  type DatosDeAviso,
} from "../textos";

// PN-61 · Recuperar el acceso: pedir el enlace (E14-PCP 4.4). El resultado es el mismo con o sin cuenta.
export function RecuperarAcceso() {
  const [correo, setCorreo] = useState("");
  const [error, setError] = useState<string>();
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const pedirFoco = useFocoPendiente();

  async function enviar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true);
    const respuesta = await pedirRecuperacion(correo);
    setEnviando(false);
    if (respuesta.ok) {
      setEnviado(true);
      setAviso(avisos.enlaceDeRecuperacionEnviado);
      pedirFoco("aviso");
      return;
    }
    const texto =
      respuesta.codigo === "validacion"
        ? textoDeErrorDeCampo(respuesta.campos.correo ?? "", "correo")
        : undefined;
    setError(texto);
    setAviso(
      texto ? null : avisoDeFallo(respuesta, avisos.errorAlEnviarEnlace),
    );
    pedirFoco(texto ? "correo" : "aviso");
  }

  return (
    <Pagina titulo="Recuperar el acceso" atras="/entrar">
      {enviado ? (
        <>
          {aviso && <Aviso {...aviso} />}
          <BotonEnlace href="/entrar">Volver a iniciar sesión</BotonEnlace>
        </>
      ) : (
        <>
          <p>
            Escribe el correo de tu cuenta. Te enviamos un enlace para elegir
            una contraseña nueva.
          </p>
          <form className="formulario" noValidate onSubmit={enviar}>
            {aviso && <Aviso {...aviso} />}
            <CampoDeTexto
              id="correo"
              etiqueta="Correo electrónico"
              tipo="email"
              autocompletar="email"
              valor={correo}
              alCambiar={setCorreo}
              error={error}
            />
            <Boton tipo="submit" deshabilitado={enviando}>
              Enviar el enlace
            </Boton>
          </form>
        </>
      )}
    </Pagina>
  );
}
