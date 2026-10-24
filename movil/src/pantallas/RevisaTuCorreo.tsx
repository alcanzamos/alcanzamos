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
      reemplazarPila(navigation, 'SinAutorizacion', { llegada: 'correo_confirmado' });
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
      // Con el correo confirmado sigue PN-63 (en la US-49, la pantalla provisional) con «Listo, confirmamos tu correo.»
      if (respuesta.cuerpo.verificada) reemplazarPila(navigation, 'SinAutorizacion', { llegada: 'correo_confirmado' });
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
    <Pantalla titulo="Revisa tu correo">
      <Texto>
        {correo
          ? `Te enviamos un enlace a ${correo}. Ábrelo para confirmar tu cuenta.`
          : 'Te enviamos un enlace a tu correo. Ábrelo para confirmar tu cuenta.'}
      </Texto>
      <Nota>¿No llegó? Mira también en el correo no deseado.</Nota>
      <Texto variante="ayuda">Si no lo confirmas en 7 días, borramos esta cuenta.</Texto>
      {aviso && <Aviso {...aviso} />}
      <Boton deshabilitado={ocupado} alTocar={() => void yaLoConfirme()}>
        Ya lo confirmé
      </Boton>
      <Boton variante="secundario" deshabilitado={enEspera || ocupado} alTocar={() => void reenviar()}>
        Reenviar el correo
      </Boton>
      {enEspera && <Texto variante="ayuda">Puedes pedir otro en un momento.</Texto>}
      {cambiando ? (
        <>
          <CampoDeTexto
            ref={campoDeCorreo}
            etiqueta="Correo electrónico"
            ayuda="Te enviaremos un enlace para confirmarlo."
            autocompletar="email"
            teclado="email-address"
            valor={nuevoCorreo}
            alCambiar={setNuevoCorreo}
            error={errorDeCorreo}
          />
          <Boton deshabilitado={ocupado} alTocar={() => void guardarNuevoCorreo()}>
            Cambiar el correo
          </Boton>
        </>
      ) : (
        <BotonDeTexto alTocar={() => setCambiando(true)}>Cambiar el correo</BotonDeTexto>
      )}
    </Pantalla>
  );
}
