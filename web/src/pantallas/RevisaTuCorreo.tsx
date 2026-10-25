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
import { formatear, textos } from "../textos/es.generated";

// Espera corta entre un reenvío y el siguiente (E14-PCP 4.2, D-143). El API la impone; esto solo la muestra.
const ESPERA_MS = 30_000;

// Fallos que no dependen de la acción: la sesión se perdió o la cuenta ya está verificada.
function siguePorFallo(respuesta: Extract<Respuesta<unknown>, { ok: false }>) {
  if (respuesta.codigo === "ya_verificada") {
    navegar("/privacidad");
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
      if (respuesta.cuerpo.verificada) navegar("/privacidad");
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
    <Pagina titulo={textos.revisaTuCorreo.titulo}>
      <p>
        {cifras(
          correo
            ? formatear(textos.revisaTuCorreo.enviadoA, { correo })
            : textos.revisaTuCorreo.enviado,
        )}
      </p>
      <p className="nota">
        <IconoInformacion />
        <span>{textos.revisaTuCorreo.noLlego}</span>
      </p>
      <p className="ayuda">{cifras(textos.revisaTuCorreo.plazo)}</p>
      {aviso && <Aviso {...aviso} />}
      <Boton alTocar={() => void yaLoConfirme()} deshabilitado={ocupado}>
        {textos.revisaTuCorreo.yaLoConfirme}
      </Boton>
      <Boton
        variante="secundario"
        alTocar={() => void reenviar()}
        deshabilitado={enEspera || ocupado}
        descritoPor={enEspera ? "espera" : undefined}
      >
        {textos.acciones.reenviarElCorreo}
      </Boton>
      {enEspera && (
        <p id="espera" className="ayuda">
          {textos.revisaTuCorreo.espera}
        </p>
      )}
      {cambiando ? (
        <form className="formulario" noValidate onSubmit={guardarNuevoCorreo}>
          <CampoDeTexto
            id="nuevo-correo"
            etiqueta={textos.campos.correo.etiqueta}
            ayuda={textos.campos.correo.ayuda}
            tipo="email"
            autocompletar="email"
            valor={nuevoCorreo}
            alCambiar={setNuevoCorreo}
            error={errorDeCorreo}
          />
          <Boton tipo="submit" deshabilitado={ocupado}>
            {textos.acciones.cambiarElCorreo}
          </Boton>
        </form>
      ) : (
        <Boton variante="texto" alTocar={abrirCambioDeCorreo}>
          {textos.acciones.cambiarElCorreo}
        </Boton>
      )}
    </Pagina>
  );
}
