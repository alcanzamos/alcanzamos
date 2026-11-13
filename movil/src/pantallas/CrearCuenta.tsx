import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { crearCuenta } from '../api/cuentas';
import { useAvisarErrores } from '../anuncios';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { CampoDeTexto } from '../componentes/CampoDeTexto';
import { Nota, Texto } from '../componentes/Texto';
import { Pantalla } from '../componentes/Pantalla';
import { reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, textoDeErrorDeCampo, type DatosDeAviso } from '../textos';
import { textos } from '../textos/es.generated';

// PN-58 · Crear la cuenta, variante Android (E14-PCP 4.1, D-172): solo el correo. Nunca da sesión: la contraseña y el
// nombre se piden al abrir el enlace del correo (PN-74), que hasta I08 se abre en el navegador (D-155). Sin casilla de
// edad: la edad viene de PN-65, a la que solo se llega desde PN-60. El API valida y devuelve el código de cada campo;
// aquí solo se muestra su texto. `mayor_de_edad: true` se manda porque PN-65 ya se pasó (el tipo de la ruta no deja
// abrir esta pantalla sin eso). Trae el correo que PN-59 devuelve con «Usar otro correo».
// La fila «Política de tratamiento de datos» (PN-68) no está: esa pantalla no existe todavía.
export function CrearCuenta({ navigation, route }: NativeStackScreenProps<Rutas, 'CrearCuenta'>) {
  const [correo, setCorreo] = useState(route.params?.correo ?? '');
  const [errorDeCorreo, setErrorDeCorreo] = useState<string>();
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campoDeCorreo = useRef<TextInputInstance>(null);
  const avisarErrores = useAvisarErrores();
  const pasoPN65 = route.params?.mayorDeEdad === true;

  // Sin la edad comprobada no se crea nada: se vuelve al inicio.
  useEffect(() => {
    if (!pasoPN65) reemplazarPila(navigation, 'Entrar');
  }, [pasoPN65, navigation]);

  async function enviar() {
    if (enviando || !pasoPN65) return;
    setEnviando(true);
    const respuesta = await crearCuenta({ correo, mayor_de_edad: true });
    setEnviando(false);
    if (respuesta.ok) {
      reemplazarPila(navigation, 'RevisaTuCorreo', { correo });
      return;
    }
    // Un código de campo sin texto, o de un campo que la pantalla no tiene, da el aviso general: no se inventa texto.
    const texto = respuesta.codigo === 'validacion' ? textoDeErrorDeCampo(respuesta.campos.correo ?? '') : undefined;
    const soloElCorreo = Object.keys(respuesta.campos).every((campo) => campo === 'correo');
    setErrorDeCorreo(texto);
    setAviso(texto && soloElCorreo ? null : avisoDeFallo(respuesta, avisos.errorAlCrearCuenta));
    avisarErrores([{ error: texto, campo: campoDeCorreo }]);
  }

  return (
    <Pantalla conLogo titulo={textos.crearCuenta.titulo}>
      <Texto>{textos.crearCuenta.intro}</Texto>
      {aviso && <Aviso {...aviso} />}
      <CampoDeTexto
        ref={campoDeCorreo}
        etiqueta={textos.campos.correo.etiqueta}
        ayuda={textos.campos.correo.ayuda}
        autocompletar="email"
        teclado="email-address"
        valor={correo}
        alCambiar={setCorreo}
        error={errorDeCorreo}
      />
      <Boton deshabilitado={enviando} alTocar={() => void enviar()}>
        {textos.crearCuenta.crear}
      </Boton>
      {aviso === avisos.errorAlCrearCuenta && (
        <Boton variante="secundario" alTocar={() => void enviar()}>
          {textos.acciones.intentarDeNuevo}
        </Boton>
      )}
      <Boton variante="secundario" alTocar={() => navigation.navigate('Entrar')}>
        {textos.crearCuenta.yaTengoCuenta}
      </Boton>
      <BotonDeTexto alTocar={() => navigation.navigate('Politica')}>{textos.politica.entradas.deTratamientoDeDatos}</BotonDeTexto>
      <Nota>{textos.crearCuenta.nota}</Nota>
    </Pantalla>
  );
}
