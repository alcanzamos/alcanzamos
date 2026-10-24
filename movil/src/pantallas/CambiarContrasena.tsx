import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { cambiarContrasena } from '../api/acceso';
import { Aviso } from '../componentes/Aviso';
import { Boton } from '../componentes/Boton';
import { CampoDeContrasena } from '../componentes/CampoDeContrasena';
import { Pantalla } from '../componentes/Pantalla';
import { Texto } from '../componentes/Texto';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import { reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, textoDeErrorDeCampo, type DatosDeAviso } from '../textos';

// PN-73 · Cambiar la contraseña con la sesión iniciada (E14-PCP 4.15). Sin la fila del menor (solo si la cuenta es de un
// menor: llega con I11). El título lo pone la barra nativa; Atrás vuelve a PN-71.
export function CambiarContrasena({ navigation }: NativeStackScreenProps<Rutas, 'CambiarContrasena'>) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [errores, setErrores] = useState<{ actual?: string; nueva?: string }>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campoActual = useRef<TextInputInstance>(null);
  const campoNueva = useRef<TextInputInstance>(null);

  async function enviar() {
    if (enviando) return;
    setEnviando(true);
    const respuesta = await cambiarContrasena({ contrasena_actual: actual, contrasena_nueva: nueva });
    setEnviando(false);
    // Las demás sesiones se cierran en el API; esta sigue abierta y el token del Keystore no cambia.
    if (respuesta.ok) return reemplazarPila(navigation, 'SeguridadDeLaCuenta', { llegada: 'contrasena_cambiada' });
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
    const delCampo: { actual?: string; nueva?: string } = {};
    if (respuesta.codigo === 'contrasena_actual_incorrecta')
      delCampo.actual = textoDeErrorDeCampo(respuesta.codigo, 'contrasenaDeAhora');
    if (respuesta.codigo === 'validacion') {
      const { contrasena_actual: deAhora, contrasena_nueva: nuevaCodigo } = respuesta.campos;
      if (deAhora) delCampo.actual = textoDeErrorDeCampo(deAhora, 'contrasenaDeAhora');
      if (nuevaCodigo) delCampo.nueva = textoDeErrorDeCampo(nuevaCodigo, 'contrasenaNueva');
    }
    setErrores(delCampo);
    setAviso(delCampo.actual || delCampo.nueva ? null : avisoDeFallo(respuesta, avisos.errorAlCambiarContrasena));
    if (delCampo.actual) campoActual.current?.focus();
    else if (delCampo.nueva) campoNueva.current?.focus();
  }

  return (
    <Pantalla conBarra>
      <Texto>Escribe tu contraseña de ahora y la nueva.</Texto>
      {aviso && <Aviso {...aviso} />}
      <CampoDeContrasena
        ref={campoActual}
        etiqueta="Tu contraseña de ahora"
        autocompletar="current-password"
        valor={actual}
        alCambiar={setActual}
        error={errores.actual}
      />
      <CampoDeContrasena
        ref={campoNueva}
        etiqueta="Tu contraseña nueva"
        ayuda="Usa una frase de tres o cuatro palabras."
        autocompletar="new-password"
        valor={nueva}
        alCambiar={setNueva}
        error={errores.nueva}
      />
      <Boton deshabilitado={enviando} alTocar={() => void enviar()}>
        Guardar la contraseña
      </Boton>
      <Boton variante="secundario" alTocar={() => navigation.goBack()}>
        Ahora no
      </Boton>
    </Pantalla>
  );
}
