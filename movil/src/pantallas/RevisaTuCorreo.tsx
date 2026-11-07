import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { reenviarCorreo } from '../api/cuentas';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { CampoDeTexto } from '../componentes/CampoDeTexto';
import { Pantalla } from '../componentes/Pantalla';
import { Nota, Texto } from '../componentes/Texto';
import { reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, textoDeErrorDeCampo, type DatosDeAviso } from '../textos';
import { formatear, textos } from '../textos/es.generated';

// Espera corta entre un reenvío y el siguiente (E14-PCP 4.2, D-143). El API la impone; esto solo la muestra.
export const ESPERA_MS = 30_000;

type Pantalla59 = NativeStackScreenProps<Rutas, 'RevisaTuCorreo'>;

// PN-59 · Revisa tu correo (E14-PCP 4.2, D-172). No tiene sesión: no consulta nada al abrirse y no hay «Ya lo confirmé»,
// porque el enlace abre PN-74 y ahí empieza la sesión. Hasta I08 (App Links, D-155) ese enlace abre la web en el navegador
// del teléfono, no la app; por eso el botón provisional «Ya elegí mi contraseña» (D-184) abre PN-60 con el correo escrito.
// Está siempre visible y no consulta al API: así no revela si el correo tiene cuenta. «Reenviar el correo» llama al
// reenvío público con la dirección que PN-58 pasó; si la pantalla no la tiene la pide aquí mismo con el campo, la ayuda y
// los errores de PN-58 (4.16 T3). «Usar otro correo» vuelve a PN-58 con lo escrito.
export function RevisaTuCorreo({ navigation, route }: Pantalla59) {
  const [correo, setCorreo] = useState(route.params?.correo);
  const [pidiendoCorreo, setPidiendoCorreo] = useState(false);
  const [nuevoCorreo, setNuevoCorreo] = useState('');
  const [errorDeCorreo, setErrorDeCorreo] = useState<string>();
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enEspera, setEnEspera] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  const campoDeCorreo = useRef<TextInputInstance>(null);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  function esperar() {
    setEnEspera(true);
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setEnEspera(false), ESPERA_MS);
  }

  async function reenviar(direccion: string) {
    if (ocupado) return;
    setOcupado(true);
    const respuesta = await reenviarCorreo(direccion);
    setOcupado(false);
    if (respuesta.ok) {
      setCorreo(direccion);
      setPidiendoCorreo(false);
      setErrorDeCorreo(undefined);
      esperar();
      setAviso(avisos.correoReenviado);
      return;
    }
    // La espera de 30 segundos y los límites de la hora dan el mismo 429: «Hiciste muchos intentos…» (4.16 T1) y el
    // botón espera lo corto de todos modos.
    if (respuesta.estado === 429) esperar();
    const texto =
      pidiendoCorreo && respuesta.codigo === 'validacion'
        ? textoDeErrorDeCampo(respuesta.campos.correo ?? '', 'correo')
        : undefined;
    setErrorDeCorreo(texto);
    setAviso(texto ? null : avisoDeFallo(respuesta, avisos.errorAlEnviarCorreo));
    if (texto) campoDeCorreo.current?.focus();
  }

  function alTocarReenviar() {
    if (correo) void reenviar(correo);
    else setPidiendoCorreo(true);
  }

  const conCorreo = correo ? { correo } : undefined;

  return (
    <Pantalla titulo={textos.revisaTuCorreo.titulo}>
      <Texto>{correo ? formatear(textos.revisaTuCorreo.enviadoA, { correo }) : textos.revisaTuCorreo.enviado}</Texto>
      <Nota>{textos.revisaTuCorreo.noLlego}</Nota>
      <Texto variante="ayuda">{textos.revisaTuCorreo.plazo}</Texto>
      {aviso && <Aviso {...aviso} />}
      {pidiendoCorreo ? (
        <>
          <CampoDeTexto
            ref={campoDeCorreo}
            etiqueta={textos.campos.correo.etiqueta}
            ayuda={textos.campos.correo.ayuda}
            autocompletar="email"
            teclado="email-address"
            valor={nuevoCorreo}
            alCambiar={setNuevoCorreo}
            error={errorDeCorreo}
          />
          <Boton deshabilitado={enEspera || ocupado} alTocar={() => void reenviar(nuevoCorreo)}>
            {textos.acciones.reenviarElCorreo}
          </Boton>
        </>
      ) : (
        <Boton variante="secundario" deshabilitado={enEspera || ocupado} alTocar={alTocarReenviar}>
          {textos.acciones.reenviarElCorreo}
        </Boton>
      )}
      {enEspera && <Texto variante="ayuda">{textos.revisaTuCorreo.espera}</Texto>}
      <BotonDeTexto alTocar={() => reemplazarPila(navigation, 'Entrar', conCorreo)}>
        {textos.revisaTuCorreo.yaEligiMiContrasena}
      </BotonDeTexto>
      <BotonDeTexto alTocar={() => reemplazarPila(navigation, 'CrearCuenta', { mayorDeEdad: true, ...conCorreo })}>
        {textos.acciones.usarOtroCorreo}
      </BotonDeTexto>
    </Pantalla>
  );
}
