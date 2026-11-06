import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { reenviarCorreo } from "../api/cuentas";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { cifras } from "../componentes/Cifras";
import { CampoDeTexto } from "../componentes/CampoDeTexto";
import { IconoInformacion } from "../componentes/Iconos";
import { Pagina } from "../componentes/Pagina";
import { guardarCorreo, leerCorreo } from "../correoPendiente";
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

// PN-59 · Revisa tu correo (E14-PCP 4.2, D-172). No tiene sesión: no consulta nada al abrirse y no hay «Ya lo confirmé»,
// porque el enlace abre PN-74 y ahí empieza la sesión. «Reenviar el correo» llama al reenvío público con la dirección
// que PN-58 guardó; si la pantalla no la tiene (se abrió de nuevo o se recargó la página) la pide aquí mismo con el
// campo, la ayuda y los errores de PN-58 (4.16 T3). «Usar otro correo» vuelve a PN-58 con lo escrito.
export function RevisaTuCorreo() {
  const [correo, setCorreo] = useState(leerCorreo);
  const [pidiendoCorreo, setPidiendoCorreo] = useState(false);
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

  function mostrar(datos: DatosDeAviso) {
    setAviso(datos);
    pedirFoco("aviso");
  }

  async function reenviar(direccion: string) {
    if (ocupado) return;
    setOcupado(true);
    const respuesta = await reenviarCorreo(direccion);
    setOcupado(false);
    if (respuesta.ok) {
      guardarCorreo(direccion);
      setCorreo(direccion);
      setPidiendoCorreo(false);
      setErrorDeCorreo(undefined);
      esperar();
      return mostrar(avisos.correoReenviado);
    }
    // La espera de 30 segundos y los límites de la hora dan el mismo 429: «Hiciste muchos intentos…» (4.16 T1) y el
    // botón espera lo corto de todos modos.
    if (respuesta.estado === 429) esperar();
    const texto =
      pidiendoCorreo && respuesta.codigo === "validacion"
        ? textoDeErrorDeCampo(respuesta.campos.correo ?? "", "correo")
        : undefined;
    setErrorDeCorreo(texto);
    if (texto) {
      setAviso(null);
      pedirFoco("nuevo-correo");
    } else mostrar(avisoDeFallo(respuesta, avisos.errorAlEnviarCorreo));
  }

  function alTocarReenviar() {
    if (correo) void reenviar(correo);
    else {
      setPidiendoCorreo(true);
      pedirFoco("nuevo-correo");
    }
  }

  function enviarFormulario(evento: SyntheticEvent) {
    evento.preventDefault();
    void reenviar(nuevoCorreo);
  }

  return (
    <Pagina titulo={textos.revisaTuCorreo.titulo}>
      <p>
        {cifras(
          correo
            ? formatear(textos.revisaTuCorreoSinSesion.enviadoA, { correo })
            : textos.revisaTuCorreoSinSesion.enviado,
        )}
      </p>
      <p className="nota">
        <IconoInformacion />
        <span>{textos.revisaTuCorreo.noLlego}</span>
      </p>
      <p className="ayuda">{cifras(textos.revisaTuCorreo.plazo)}</p>
      {aviso && <Aviso {...aviso} />}
      {pidiendoCorreo ? (
        <form className="formulario" noValidate onSubmit={enviarFormulario}>
          <CampoDeTexto
            id="nuevo-correo"
            etiqueta={textos.campos.correo.etiqueta}
            ayuda={textos.crearCuentaSoloCorreo.ayudaDelCorreo}
            tipo="email"
            autocompletar="email"
            valor={nuevoCorreo}
            alCambiar={setNuevoCorreo}
            error={errorDeCorreo}
          />
          <Boton
            tipo="submit"
            deshabilitado={enEspera || ocupado}
            descritoPor={enEspera ? "espera" : undefined}
          >
            {textos.acciones.reenviarElCorreo}
          </Boton>
        </form>
      ) : (
        <Boton
          variante="secundario"
          alTocar={alTocarReenviar}
          deshabilitado={enEspera || ocupado}
          descritoPor={enEspera ? "espera" : undefined}
        >
          {textos.acciones.reenviarElCorreo}
        </Boton>
      )}
      {enEspera && (
        <p id="espera" className="ayuda">
          {textos.revisaTuCorreo.espera}
        </p>
      )}
      <BotonEnlace href="/crear-cuenta" variante="texto">
        {textos.acciones.usarOtroCorreo}
      </BotonEnlace>
    </Pagina>
  );
}
