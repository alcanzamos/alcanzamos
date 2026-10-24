import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { iniciarSesion } from '../api/acceso';
import { Aviso } from '../componentes/Aviso';
import { Boton } from '../componentes/Boton';
import { CampoDeContrasena } from '../componentes/CampoDeContrasena';
import { CampoDeTexto } from '../componentes/CampoDeTexto';
import { Pantalla } from '../componentes/Pantalla';
import { avisoDeLlegada, reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, textoDeErrorDeCampo, type DatosDeAviso } from '../textos';

type Campo = 'identificador' | 'contrasena';

// PN-60 · Iniciar sesión, variante Android (E14-PCP 4.3): solo con correo, sin «Entro con mi nombre de usuario» (D-137: queda
// para I11, con el botón «Ya tengo un usuario» de PN-65). Es la primera pantalla de la app. El API recibe un «identificador»
// genérico; por ahora es el correo. Dicho de otra forma: aquí no se decide nada, el API responde y la pantalla muestra.
// La fila «Política de tratamiento y consultas» (PN-68) y «¿Olvidaste tu contraseña?» (PN-61) llegan con sus pantallas.
export function Entrar({ navigation, route }: NativeStackScreenProps<Rutas, 'Entrar'>) {
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [errores, setErrores] = useState<Partial<Record<Campo, string>>>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campoDeCorreo = useRef<TextInput>(null);
  const campoDeContrasena = useRef<TextInput>(null);
  // «Tu sesión se cerró…» y las demás llegadas (E14-PCP 4.3) son un mensaje de estado, arriba de todo.
  const llegada = avisoDeLlegada(route.params?.llegada);

  async function enviar() {
    if (enviando) return;
    setEnviando(true);
    const respuesta = await iniciarSesion({ identificador: correo, contrasena });
    setEnviando(false);
    if (respuesta.ok) {
      // La cuenta sin verificar tiene una sesión limitada: sigue a PN-59 (D-138). Si no hay autorización, la pantalla
      // de destino lo descubre con el API y sigue a la provisional.
      if (respuesta.cuerpo.estado === 'verificacion_pendiente')
        reemplazarPila(navigation, 'RevisaTuCorreo', { correo });
      else reemplazarPila(navigation, 'SeguridadDeLaCuenta');
      return;
    }
    const delCampo: Partial<Record<Campo, string>> = {};
    if (respuesta.codigo === 'validacion') {
      for (const [campo, codigo] of Object.entries(respuesta.campos)) {
        const texto = textoDeErrorDeCampo(codigo, 'entrar');
        if (texto && (campo === 'identificador' || campo === 'contrasena')) delCampo[campo] = texto;
      }
    }
    const hayErroresDeCampo = Object.keys(delCampo).length > 0;
    setErrores(delCampo);
    setAviso(
      hayErroresDeCampo
        ? null
        : avisoDeFallo(
            respuesta,
            // Un error del lado del servidor (5xx) nunca dice que los datos están mal (E14-PCP 4.16 T7, RNF-017).
            respuesta.estado >= 500 ? avisos.errorAlIniciarSesion : avisos.datosNoCoinciden,
          ),
    );
    if (delCampo.identificador) campoDeCorreo.current?.focus();
    else if (delCampo.contrasena) campoDeContrasena.current?.focus();
  }

  return (
    <Pantalla conLogo titulo="Inicia sesión" estado={llegada}>
      {aviso && <Aviso {...aviso} />}
      <CampoDeTexto
        ref={campoDeCorreo}
        etiqueta="Correo electrónico"
        autocompletar="email"
        teclado="email-address"
        valor={correo}
        alCambiar={setCorreo}
        error={errores.identificador}
      />
      <CampoDeContrasena
        ref={campoDeContrasena}
        etiqueta="Contraseña"
        autocompletar="current-password"
        valor={contrasena}
        alCambiar={setContrasena}
        error={errores.contrasena}
      />
      <Boton deshabilitado={enviando} alTocar={() => void enviar()}>
        Iniciar sesión
      </Boton>
      <Boton variante="secundario" alTocar={() => navigation.navigate('Edad')}>
        Crear una cuenta
      </Boton>
    </Pantalla>
  );
}
