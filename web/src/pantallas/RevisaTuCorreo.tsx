import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import {
  cambiarCorreo,
  estadoDeLaCuenta,
  reenviarCorreo,
} from "../api/cuentas";
import { seguirPorAccesoNegado } from "../accesoNegado";
import type { Respuesta } from "../api/cliente";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { cifras } from "../componentes/Cifras";
import { CampoDeTexto } from "../componentes/CampoDeTexto";
import { IconoInformacion } from "../componentes/Iconos";
import { Pagina } from "../componentes/Pagina";
import { guardarCorreo, leerCorreo } from "../correoPendiente";
import { navegar } from "../enrutador";
import { useFocoPendiente } from "../enfoque";
import {
  avisoDeFallo,
  avisos,
  textoDeErrorDeCampo,
  type DatosDeAviso,
} from "../textos";

// Espera corta entre un reenvío y el siguiente (E14-PCP 4.2, D-143). El API la impone; esto solo la muestra.
const ESPERA_MS = 30_000;

// Fallos que no dependen de la acción: la sesión se perdió o la cuenta ya está verificada.
function siguePorFallo(respuesta: Extract<Respuesta<unknown>, { ok: false }>) {
  if (respuesta.codigo === "ya_verificada") {
    navegar("/sin-autorizacion");
    return true;
  }
  return seguirPorAccesoNegado(respuesta);
}

// PN-59 · Verificar el correo (E14-PCP 4.2). La cuenta sigue con su sesión limitada (D-138).
// «Cambiar el correo» abre en la misma pantalla un campo con la etiqueta, la ayuda y los errores de PN-58 (4.16 T3):
// volver a PN-58 crearía otra cuenta (D-141).
export function RevisaTuCorreo() {
  const [correo, setCorreo] = useState(leerCorreo);
  const [cambiando, setCambiando] = useState(false);
  const [nuevoCorreo, setNuevoCorreo] = useState("");
  const [errorDeCorreo, setErrorDeCorreo] = useState<string>();
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enEspera, setEnEspera] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const temporizador = useRef<number>(undefined);
  const pedirFoco = useFocoPendiente();

  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  function esperar() {
    setEnEspera(true);
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(
      () => setEnEspera(false),
      ESPERA_MS,
    );
  }

  function abrirCambioDeCorreo() {
    setCambiando(true);
    pedirFoco("nuevo-correo");
  }

  function mostrar(datos: DatosDeAviso | null) {
    setAviso(datos);
    if (datos) pedirFoco("aviso");
  }

  async function yaLoConfirme() {
    if (ocupado) return;
    setOcupado(true);
    const respuesta = await estadoDeLaCuenta();
    setOcupado(false);
    if (respuesta.ok) {
      if (respuesta.cuerpo.verificada) navegar("/sin-autorizacion");
      else mostrar(avisos.sinConfirmarTodavia);
    } else if (!siguePorFallo(respuesta)) {
      mostrar(avisoDeFallo(respuesta, avisos.errorAlRevisarElCorreo));
    }
  }

  async function reenviar() {
    if (ocupado) return;
    setOcupado(true);
    const respuesta = await reenviarCorreo();
    setOcupado(false);
    if (respuesta.ok) {
      esperar();
      mostrar(avisos.correoReenviado);
    } else if (respuesta.estado === 429) {
      // La espera corta y los límites de la hora comparten texto: «Puedes pedir otro en un momento.»
      esperar();
      setAviso(null);
    } else if (!siguePorFallo(respuesta)) {
      mostrar(avisoDeFallo(respuesta, avisos.errorAlEnviarCorreo));
    }
  }

  async function guardarNuevoCorreo(evento: SyntheticEvent) {
    evento.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    const respuesta = await cambiarCorreo(nuevoCorreo);
    setOcupado(false);
    if (respuesta.ok) {
      guardarCorreo(nuevoCorreo);
      setCorreo(nuevoCorreo);
      setErrorDeCorreo(undefined);
      setCambiando(false);
      esperar();
      mostrar(avisos.correoReenviado);
      return;
    }
    if (siguePorFallo(respuesta)) return;
    const texto =
      respuesta.codigo === "validacion"
        ? textoDeErrorDeCampo(respuesta.campos.correo ?? "", "correo")
        : undefined;
    setErrorDeCorreo(texto);
    setAviso(
      texto ? null : avisoDeFallo(respuesta, avisos.errorAlEnviarCorreo),
    );
    pedirFoco(texto ? "nuevo-correo" : "aviso");
  }

  return (
    <Pagina titulo="Revisa tu correo">
      <p>
        {cifras(
          correo
            ? `Te enviamos un enlace a ${correo}. Ábrelo para confirmar tu cuenta.`
            : "Te enviamos un enlace a tu correo. Ábrelo para confirmar tu cuenta.",
        )}
      </p>
      <p className="nota">
        <IconoInformacion />
        <span>¿No llegó? Mira también en el correo no deseado.</span>
      </p>
      <p className="ayuda">
        {cifras("Si no lo confirmas en 7 días, borramos esta cuenta.")}
      </p>
      {aviso && <Aviso {...aviso} />}
      <Boton alTocar={() => void yaLoConfirme()} deshabilitado={ocupado}>
        Ya lo confirmé
      </Boton>
      <Boton
        variante="secundario"
        alTocar={() => void reenviar()}
        deshabilitado={enEspera || ocupado}
        descritoPor={enEspera ? "espera" : undefined}
      >
        Reenviar el correo
      </Boton>
      {enEspera && (
        <p id="espera" className="ayuda">
          Puedes pedir otro en un momento.
        </p>
      )}
      {cambiando ? (
        <form className="formulario" noValidate onSubmit={guardarNuevoCorreo}>
          <CampoDeTexto
            id="nuevo-correo"
            etiqueta="Correo electrónico"
            ayuda="Te enviaremos un enlace para confirmarlo."
            tipo="email"
            autocompletar="email"
            valor={nuevoCorreo}
            alCambiar={setNuevoCorreo}
            error={errorDeCorreo}
          />
          <Boton tipo="submit" deshabilitado={ocupado}>
            Cambiar el correo
          </Boton>
        </form>
      ) : (
        <Boton variante="texto" alTocar={abrirCambioDeCorreo}>
          Cambiar el correo
        </Boton>
      )}
    </Pagina>
  );
}
