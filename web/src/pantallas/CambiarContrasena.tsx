import { useState, type SyntheticEvent } from "react";
import { cambiarContrasena } from "../api/acceso";
import { seguirPorAccesoNegado } from "../accesoNegado";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { CampoDeContrasena } from "../componentes/CampoDeContrasena";
import { Pagina } from "../componentes/Pagina";
import { useFocoPendiente } from "../enfoque";
import { irConAviso } from "../llegada";
import {
  avisoDeFallo,
  avisos,
  textoDeErrorDeCampo,
  type DatosDeAviso,
} from "../textos";
import { textos } from "../textos/es.generated";

// PN-73 · Cambiar la contraseña con la sesión iniciada (E14-PCP 4.15). Sin la fila del menor: es solo Android.
export function CambiarContrasena() {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const pedirFoco = useFocoPendiente();

  async function enviar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true);
    const respuesta = await cambiarContrasena({
      contrasena_actual: actual,
      contrasena_nueva: nueva,
    });
    setEnviando(false);
    if (respuesta.ok)
      return irConAviso("/cuenta/seguridad", "contrasena_cambiada");
    if (seguirPorAccesoNegado(respuesta)) return;
    const delCampo: Record<string, string> = {};
    if (respuesta.codigo === "contrasena_actual_incorrecta")
      delCampo.contrasena_actual =
        textoDeErrorDeCampo(respuesta.codigo, "contrasenaDeAhora") ?? "";
    if (respuesta.codigo === "validacion") {
      const { contrasena_actual: deAhora, contrasena_nueva: nuevaCodigo } =
        respuesta.campos;
      if (deAhora)
        delCampo.contrasena_actual =
          textoDeErrorDeCampo(deAhora, "contrasenaDeAhora") ?? "";
      if (nuevaCodigo)
        delCampo.contrasena_nueva =
          textoDeErrorDeCampo(nuevaCodigo, "contrasenaNueva") ?? "";
    }
    const conTexto = Object.fromEntries(
      Object.entries(delCampo).filter(([, texto]) => texto),
    );
    setErrores(conTexto);
    setAviso(
      Object.keys(conTexto).length > 0
        ? null
        : avisoDeFallo(respuesta, avisos.errorAlCambiarContrasena),
    );
    pedirFoco(
      conTexto.contrasena_actual
        ? "contrasena-actual"
        : conTexto.contrasena_nueva
          ? "contrasena-nueva"
          : "aviso",
    );
  }

  return (
    <Pagina titulo={textos.cambiarContrasena.titulo} atras="/cuenta/seguridad">
      <p>{textos.cambiarContrasena.intro}</p>
      <form className="formulario" noValidate onSubmit={enviar}>
        {aviso && <Aviso {...aviso} />}
        <CampoDeContrasena
          id="contrasena-actual"
          etiqueta={textos.campos.contrasenaDeAhora.etiqueta}
          autocompletar="current-password"
          valor={actual}
          alCambiar={setActual}
          error={errores.contrasena_actual}
        />
        <CampoDeContrasena
          id="contrasena-nueva"
          etiqueta={textos.campos.contrasenaNueva.etiquetaPropia}
          ayuda={textos.campos.contrasena.ayuda}
          autocompletar="new-password"
          valor={nueva}
          alCambiar={setNueva}
          error={errores.contrasena_nueva}
        />
        <Boton tipo="submit" deshabilitado={enviando}>
          {textos.acciones.guardarLaContrasena}
        </Boton>
      </form>
      <BotonEnlace href="/cuenta/seguridad">
        {textos.cambiarContrasena.ahoraNo}
      </BotonEnlace>
    </Pagina>
  );
}
