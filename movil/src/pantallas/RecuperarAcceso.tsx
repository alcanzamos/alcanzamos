import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';
import { pedirRecuperacion } from '../api/acceso';
import { Aviso } from '../componentes/Aviso';
import { Boton } from '../componentes/Boton';
import { CampoDeTexto } from '../componentes/CampoDeTexto';
import { Pantalla } from '../componentes/Pantalla';
import { Texto } from '../componentes/Texto';
import { estiloDeTipografia } from '../fuentes';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, textoDeErrorDeCampo, type DatosDeAviso } from '../textos';
import { tokens } from '../tokens/tokens.generated';

// PN-61 · Recuperar el acceso: pedir el enlace (E14-PCP 4.4). El resultado es el mismo con o sin cuenta. El enlace del
// correo abre la web en el navegador (D-155): la persona elige allí su contraseña nueva (PN-62), vuelve a la app y entra
// con ella. El título lo pone la barra nativa; Atrás vuelve a PN-60.
export function RecuperarAcceso({ navigation }: NativeStackScreenProps<Rutas, 'RecuperarAcceso'>) {
  const [correo, setCorreo] = useState('');
  const [error, setError] = useState<string>();
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const campoDeCorreo = useRef<TextInput>(null);

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
            Volver a iniciar sesión
          </Boton>
        </>
      ) : (
        <>
          <Texto>Escribe el correo de tu cuenta. Te enviamos un enlace para elegir una contraseña nueva.</Texto>
          {aviso && <Aviso {...aviso} />}
          <CampoDeTexto
            ref={campoDeCorreo}
            etiqueta="Correo electrónico"
            autocompletar="email"
            teclado="email-address"
            valor={correo}
            alCambiar={setCorreo}
            error={error}
          />
          <Boton deshabilitado={enviando} alTocar={() => void enviar()}>
            Enviar el enlace
          </Boton>
          <View style={estilos.tarjeta}>
            <Text style={estilos.notaDelMenor}>
              ¿Entras con nombre de usuario? Pide a tu tutor que restablezca tu acceso.
            </Text>
          </View>
        </>
      )}
    </Pantalla>
  );
}

// «Nota del menor, solo Android» (E14-PCP 4.4, fila 5): una Tarjeta (E14-SDD 5.7) con `tipografia.pequeno`.
const estilos = StyleSheet.create({
  tarjeta: {
    padding: tokens.espacio['4'],
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    borderRadius: tokens.radio.grande,
    backgroundColor: tokens.color.fondo.superficie,
  },
  notaDelMenor: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.principal },
});
