import { useState, type SyntheticEvent } from "react";
import { elegirContrasena } from "../api/acceso";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { CampoDeContrasena } from "../componentes/CampoDeContrasena";
import { Pagina } from "../componentes/Pagina";
import { useFocoPendiente } from "../enfoque";
import { useUbicacion } from "../enrutador";
import { irConAviso } from "../llegada";
import {
  avisoDeFallo,
  avisos,
  textoDeErrorDeCampo,
  textosDeRepeticion,
  type DatosDeAviso,
} from "../textos";
import { textos } from "../textos/es.generated";

// PN-62 · Recuperar el acceso: elegir la contraseña nueva, con el enlace del correo (/recuperar?t=, E14-PCP 4.5).
export function Recuperar() {
  const { parametros } = useUbicacion();
  const token = parametros.get("t") ?? "";
  const [contrasena, setContrasena] = useState("");
  const [repeticion, setRepeticion] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  // Sin token no hay nada que guardar: el enlace ya no sirve.
  const [aviso, setAviso] = useState<DatosDeAviso | null>(
    token ? null : avisos.enlaceVencido,
  );
  const [vencido, setVencido] = useState(!token);
  const [enviando, setEnviando] = useState(false);
  const pedirFoco = useFocoPendiente();

  function mostrarErrores(
    delCampo: Record<string, string>,
    otroAviso: DatosDeAviso | null,
  ) {
    setErrores(delCampo);
    setAviso(otroAviso);
    pedirFoco(
      delCampo.contrasena
        ? "contrasena"
        : delCampo.repeticion
          ? "repeticion"
          : "aviso",
    );
  }

  async function enviar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (enviando) return;
    // La repetición solo existe en la pantalla: que las dos coincidan se comprueba aquí (E14-PCP 4.5).
    // Con una repetición mala no se llama al API: guardaría una contraseña que la persona no confirmó.
    const delCampo: Record<string, string> = {};
    if (contrasena === "")
      delCampo.contrasena =
        textoDeErrorDeCampo("contrasena_vacia", "contrasenaNueva") ?? "";
    if (repeticion === "") delCampo.repeticion = textosDeRepeticion.vacia;
    else if (repeticion !== contrasena)
      delCampo.repeticion = textosDeRepeticion.distinta;
    if (Object.keys(delCampo).length > 0) return mostrarErrores(delCampo, null);

    setEnviando(true);
    const respuesta = await elegirContrasena(token, contrasena);
    setEnviando(false);
    if (respuesta.ok) return irConAviso("/entrar", "contrasena_recuperada");
    if (respuesta.codigo === "enlace_invalido") {
      setVencido(true);
      return mostrarErrores({}, avisos.enlaceVencido);
    }
    const texto =
      respuesta.codigo === "validacion"
        ? textoDeErrorDeCampo(
            respuesta.campos.contrasena ?? "",
            "contrasenaNueva",
          )
        : undefined;
    mostrarErrores(
      texto ? { contrasena: texto } : {},
      texto ? null : avisoDeFallo(respuesta, avisos.errorAlGuardarContrasena),
    );
  }

  return (
    <Pagina titulo={textos.recuperar.titulo}>
      {aviso && <Aviso {...aviso} />}
      {vencido ? (
        <BotonEnlace href="/recuperar-acceso" variante="primario">
          {textos.recuperar.pedirOtro}
        </BotonEnlace>
      ) : (
        <form className="formulario" noValidate onSubmit={enviar}>
          <CampoDeContrasena
            id="contrasena"
            etiqueta={textos.campos.contrasenaNueva.etiqueta}
            ayuda={textos.campos.contrasena.ayuda}
            autocompletar="new-password"
            valor={contrasena}
            alCambiar={setContrasena}
            error={errores.contrasena}
          />
          <CampoDeContrasena
            id="repeticion"
            etiqueta={textos.campos.contrasenaNueva.repeticion}
            autocompletar="new-password"
            valor={repeticion}
            alCambiar={setRepeticion}
            error={errores.repeticion}
          />
          <Boton tipo="submit" deshabilitado={enviando}>
            {textos.acciones.guardarLaContrasena}
          </Boton>
        </form>
      )}
    </Pagina>
  );
}
