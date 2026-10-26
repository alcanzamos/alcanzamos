import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import type { Respuesta } from '../api/cliente';
import { cambiarCorreo, estadoDeLaCuenta, reenviarCorreo } from '../api/cuentas';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { CampoDeTexto } from '../componentes/CampoDeTexto';
import { Pantalla } from '../componentes/Pantalla';
import { Nota, Texto } from '../componentes/Texto';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import { reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, textoDeErrorDeCampo, type DatosDeAviso } from '../textos';
import { formatear, textos } from '../textos/es.generated';

// Espera corta entre un reenvío y el siguiente (E14-PCP 4.2, D-143). El API la impone; esto solo la muestra.
export const ESPERA_MS = 30_000;

type Pantalla59 = NativeStackScreenProps<Rutas, 'RevisaTuCorreo'>;

// PN-59 · Verificar el correo (E14-PCP 4.2). La cuenta sigue con su sesión limitada (D-138). El enlace del correo abre la
// web en el navegador del teléfono (D-155): esta pantalla no sabe nada del enlace; la persona vuelve y toca «Ya lo confirmé».
// «Cambiar el correo» abre en la misma pantalla un campo con la etiqueta, la ayuda y los errores de PN-58 (4.16 T3):
// volver a PN-58 crearía otra cuenta (D-141).
export function RevisaTuCorreo({ navigation, route }: Pantalla59) {
  const [correo, setCorreo] = useState(route.params?.correo);
  const [cambiando, setCambiando] = useState(false);
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

  // Fallos que no dependen de la acción: la cuenta ya está verificada o la sesión se perdió.
  function siguePorFallo(respuesta: Extract<Respuesta<unknown>, { ok: false }>) {
    if (respuesta.codigo === 'ya_verificada') {
      reemplazarPila(navigation, 'InformacionDePrivacidad', { llegada: 'correo_confirmado' });
      return true;
    }
    return seguirPorAccesoNegado(navigation, respuesta);
  }

  async function yaLoConfirme() {
    if (ocupado) return;
    setOcupado(true);
    const respuesta = await estadoDeLaCuenta();
    setOcupado(false);
    if (respuesta.ok) {
      // Con el correo confirmado sigue PN-63 con «Listo, confirmamos tu correo.»
      if (respuesta.cuerpo.verificada)
        reemplazarPila(navigation, 'InformacionDePrivacidad', { llegada: 'correo_confirmado' });
      else setAviso(avisos.sinConfirmarTodavia);
    } else if (!siguePorFallo(respuesta)) {
      setAviso(avisoDeFallo(respuesta, avisos.errorAlRevisarElCorreo));
    }
  }

  async function reenviar() {
    if (ocupado) return;
    setOcupado(true);
    const respuesta = await reenviarCorreo();
    setOcupado(false);
    if (respuesta.ok) {
      esperar();
      setAviso(avisos.correoReenviado);
    } else if (respuesta.estado === 429) {
      // La espera corta y los límites de la hora comparten texto: «Puedes pedir otro en un momento.»
      esperar();
      setAviso(null);
    } else if (!siguePorFallo(respuesta)) {
      setAviso(avisoDeFallo(respuesta, avisos.errorAlEnviarCorreo));
    }
  }

  async function guardarNuevoCorreo() {
    if (ocupado) return;
    setOcupado(true);
    const respuesta = await cambiarCorreo(nuevoCorreo);
    setOcupado(false);
    if (respuesta.ok) {
      setCorreo(nuevoCorreo);
      setErrorDeCorreo(undefined);
      setCambiando(false);
      esperar();
      setAviso(avisos.correoReenviado);
      return;
    }
    if (siguePorFallo(respuesta)) return;
    const texto =
      respuesta.codigo === 'validacion' ? textoDeErrorDeCampo(respuesta.campos.correo ?? '', 'correo') : undefined;
    setErrorDeCorreo(texto);
    setAviso(texto ? null : avisoDeFallo(respuesta, avisos.errorAlEnviarCorreo));
    if (texto) campoDeCorreo.current?.focus();
  }

  return (
    <Pantalla titulo={textos.revisaTuCorreo.titulo}>
      <Texto>
        {correo ? formatear(textos.revisaTuCorreo.enviadoA, { correo }) : textos.revisaTuCorreo.enviado}
      </Texto>
      <Nota>{textos.revisaTuCorreo.noLlego}</Nota>
      <Texto variante="ayuda">{textos.revisaTuCorreo.plazo}</Texto>
      {aviso && <Aviso {...aviso} />}
      <Boton deshabilitado={ocupado} alTocar={() => void yaLoConfirme()}>
        {textos.revisaTuCorreo.yaLoConfirme}
      </Boton>
      <Boton variante="secundario" deshabilitado={enEspera || ocupado} alTocar={() => void reenviar()}>
        {textos.acciones.reenviarElCorreo}
      </Boton>
      {enEspera && <Texto variante="ayuda">{textos.revisaTuCorreo.espera}</Texto>}
      {cambiando ? (
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
          <Boton deshabilitado={ocupado} alTocar={() => void guardarNuevoCorreo()}>
            {textos.acciones.cambiarElCorreo}
          </Boton>
        </>
      ) : (
        <BotonDeTexto alTocar={() => setCambiando(true)}>{textos.acciones.cambiarElCorreo}</BotonDeTexto>
      )}
    </Pantalla>
  );
}
