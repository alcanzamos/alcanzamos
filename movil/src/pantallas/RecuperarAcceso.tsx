import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { pedirRecuperacion } from '../api/acceso';
import { Aviso } from '../componentes/Aviso';
import { Boton } from '../componentes/Boton';
import { CampoDeTexto } from '../componentes/CampoDeTexto';
import { Pantalla } from '../componentes/Pantalla';
import { Texto } from '../componentes/Texto';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, textoDeErrorDeCampo, type DatosDeAviso } from '../textos';
import { textos } from '../textos/es.generated';

// PN-61 · Recuperar el acceso: pedir el enlace (E14-PCP 4.4). El resultado es el mismo con o sin cuenta. El enlace del
// correo abre la web en el navegador (D-155): la persona elige allí su contraseña nueva (PN-62), vuelve a la app y entra
// con ella. El título lo pone la barra nativa; Atrás vuelve a PN-60.
export function RecuperarAcceso({ navigation }: NativeStackScreenProps<Rutas, 'RecuperarAcceso'>) {
  const [correo, setCorreo] = useState('');
  const [error, setError] = useState<string>();
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const campoDeCorreo = useRef<TextInputInstance>(null);

  async function enviar() {
    if (enviando) return;
    setEnviando(true);
    const respuesta = await pedirRecuperacion(correo);
    setEnviando(false);
    if (respuesta.ok) {
      setEnviado(true);
      setAviso(avisos.enlaceDeRecuperacionEnviado);
      return;
    }
    const texto =
      respuesta.codigo === 'validacion' ? textoDeErrorDeCampo(respuesta.campos.correo ?? '', 'correo') : undefined;
    setError(texto);
    setAviso(texto ? null : avisoDeFallo(respuesta, avisos.errorAlEnviarEnlace));
    if (texto) campoDeCorreo.current?.focus();
  }

  return (
    <Pantalla conBarra>
      {enviado ? (
        <>
          {aviso && <Aviso {...aviso} />}
          <Boton variante="secundario" alTocar={() => navigation.goBack()}>
            {textos.recuperarAcceso.volver}
          </Boton>
        </>
      ) : (
        <>
          {/* La fila 5 de E14-PCP 4.4 («¿Entras con nombre de usuario? Pide a tu tutor que restablezca tu acceso.», solo
              Android) no se muestra hasta I11: apunta a un ingreso con nombre de usuario que no existe todavía (D-137, D-156).
              Entra en I11 con la fila 8 de PN-60 y el botón de PN-65. */}
          <Texto>{textos.recuperarAcceso.intro}</Texto>
          {aviso && <Aviso {...aviso} />}
          <CampoDeTexto
            ref={campoDeCorreo}
            etiqueta={textos.campos.correo.etiqueta}
            autocompletar="email"
            teclado="email-address"
            valor={correo}
            alCambiar={setCorreo}
            error={error}
          />
          <Boton deshabilitado={enviando} alTocar={() => void enviar()}>
            {textos.recuperarAcceso.enviar}
          </Boton>
        </>
      )}
    </Pantalla>
  );
}
