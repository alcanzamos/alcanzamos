import { useState, type SyntheticEvent } from "react";
import { iniciarSesion } from "../api/acceso";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { CampoDeContrasena } from "../componentes/CampoDeContrasena";
import { CampoDeTexto } from "../componentes/CampoDeTexto";
import { Pagina } from "../componentes/Pagina";
import { guardarCorreo } from "../correoPendiente";
import { useFocoPendiente } from "../enfoque";
import { navegar } from "../enrutador";
import { avisoDeLlegada } from "../llegada";
import {
  avisoDeFallo,
  avisos,
  textoDeErrorDeCampo,
  type DatosDeAviso,
} from "../textos";
import { textos } from "../textos/es.generated";

// Del cuerpo del pedido al id del control, en el orden de la pantalla.
const orden = [
  ["identificador", "correo"],
  ["contrasena", "contrasena"],
] as const;

// Pantalla de inicio de la persona con sesión: hasta que haya un Inicio, la seguridad de la cuenta (PN-71).
const DESTINO_ACTIVA = "/cuenta/seguridad";

// PN-60 · Iniciar sesión, variante web (E14-PCP 4.3): solo con correo, sin la entrada del menor (D-137).
export function Entrar() {
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  // «Tu sesión se cerró…» y «Listo, confirmamos tu correo.» (E14-PCP 4.16 T11) llegan como mensaje de estado, arriba.
  const [llegada] = useState(avisoDeLlegada);
  const [enviando, setEnviando] = useState(false);
  const pedirFoco = useFocoPendiente();

  async function enviar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true);
    const respuesta = await iniciarSesion({
      identificador: correo,
      contrasena,
    });
    setEnviando(false);
    if (respuesta.ok) {
      // La cuenta sin verificar tiene una sesión limitada: sigue a PN-59 (D-138). Si no hay autorización,
      // la pantalla de destino lo descubre y sigue a PN-63.
      if (respuesta.cuerpo.estado === "verificacion_pendiente") {
        guardarCorreo(correo);
        navegar("/revisa-tu-correo");
      } else navegar(DESTINO_ACTIVA, true);
      return;
    }
    const delCampo: Record<string, string> = {};
    if (respuesta.codigo === "validacion") {
      for (const [campo, codigo] of Object.entries(respuesta.campos)) {
        const texto = textoDeErrorDeCampo(codigo, "entrar");
        if (texto) delCampo[campo] = texto;
      }
    }
    const hayErroresDeCampo = Object.keys(delCampo).length > 0;
    setErrores(delCampo);
    setAviso(
      hayErroresDeCampo
        ? null
        : avisoDeFallo(
            respuesta,
            // Un error del nuestro lado (5xx) nunca dice que los datos están mal (E14-PCP 4.16 T7, RNF-017).
            respuesta.estado >= 500
              ? avisos.errorAlIniciarSesion
              : avisos.datosNoCoinciden,
          ),
    );
    const primero = orden.find(([campo]) => delCampo[campo]);
    pedirFoco(primero ? primero[1] : "aviso");
  }

  return (
    <Pagina titulo={textos.entrar.titulo} conLogo estado={llegada}>
      <form className="formulario" noValidate onSubmit={enviar}>
        {aviso && <Aviso {...aviso} />}
        <CampoDeTexto
          id="correo"
          etiqueta={textos.campos.correo.etiqueta}
          tipo="email"
          autocompletar="email"
          valor={correo}
          alCambiar={setCorreo}
          error={errores.identificador}
        />
        <CampoDeContrasena
          id="contrasena"
          etiqueta={textos.campos.contrasena.etiqueta}
          autocompletar="current-password"
          valor={contrasena}
          alCambiar={setContrasena}
          error={errores.contrasena}
        />
        <BotonEnlace href="/recuperar-acceso" variante="texto">
          {textos.entrar.olvidaste}
        </BotonEnlace>
        <Boton tipo="submit" deshabilitado={enviando}>
          {textos.entrar.entrar}
        </Boton>
      </form>
      <BotonEnlace href="/crear-cuenta">
        {textos.entrar.crearCuenta}
      </BotonEnlace>
    </Pagina>
  );
}
