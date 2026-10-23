import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { crearCuenta } from '../api/cuentas';
import { Aviso } from '../componentes/Aviso';
import { Boton } from '../componentes/Boton';
import { CampoDeContrasena } from '../componentes/CampoDeContrasena';
import { CampoDeTexto } from '../componentes/CampoDeTexto';
import { Nota, Texto } from '../componentes/Texto';
import { Pantalla } from '../componentes/Pantalla';
import { reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, textoDeErrorDeCampo, type DatosDeAviso } from '../textos';

type Campo = 'correo' | 'contrasena' | 'nombre';
// El orden de la pantalla: el foco va al primer campo con error.
const orden: Campo[] = ['correo', 'contrasena', 'nombre'];

// PN-58 · Crear la cuenta, variante Android (E14-PCP 4.1). Sin casilla de edad: la edad viene de PN-65, a la que solo
// se llega desde PN-60. El API valida todo y devuelve el código de cada campo; aquí solo se muestra su texto.
// `mayor_de_edad: true` se manda porque PN-65 ya se pasó (el tipo de la ruta no deja abrir esta pantalla sin eso).
// La fila «Política de tratamiento de datos» (PN-68) no está: esa pantalla no existe todavía.
export function CrearCuenta({ navigation, route }: NativeStackScreenProps<Rutas, 'CrearCuenta'>) {
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [nombre, setNombre] = useState('');
  const [errores, setErrores] = useState<Partial<Record<Campo, string>>>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campoDeCorreo = useRef<TextInput>(null);
  const campoDeContrasena = useRef<TextInput>(null);
  const campoDeNombre = useRef<TextInput>(null);
  const pasoPN65 = route.params?.mayorDeEdad === true;

  // Sin la edad comprobada no se crea nada: se vuelve al inicio.
  useEffect(() => {
    if (!pasoPN65) reemplazarPila(navigation, 'Entrar');
  }, [pasoPN65, navigation]);

  async function enviar() {
    if (enviando || !pasoPN65) return;
    setEnviando(true);
    const respuesta = await crearCuenta({ correo, contrasena, nombre, mayor_de_edad: true });
    setEnviando(false);
    if (respuesta.ok) {
      reemplazarPila(navigation, 'RevisaTuCorreo', { correo });
      return;
    }
    const delCampo: Partial<Record<Campo, string>> = {};
    let sinTexto = false;
    if (respuesta.codigo === 'validacion') {
      for (const [campo, codigo] of Object.entries(respuesta.campos)) {
        const texto = textoDeErrorDeCampo(codigo);
        if (texto && orden.includes(campo as Campo)) delCampo[campo as Campo] = texto;
        else sinTexto = true;
      }
    }
    const hayErroresDeCampo = Object.keys(delCampo).length > 0;
    setErrores(delCampo);
    setAviso(hayErroresDeCampo && !sinTexto ? null : avisoDeFallo(respuesta, avisos.errorAlCrearCuenta));
    const primero = orden.find((campo) => delCampo[campo]);
    if (primero === 'correo') campoDeCorreo.current?.focus();
    else if (primero === 'contrasena') campoDeContrasena.current?.focus();
    else if (primero === 'nombre') campoDeNombre.current?.focus();
  }

  return (
    <Pantalla conLogo titulo="Crea tu cuenta">
      <Texto>Solo necesitamos tres datos.</Texto>
      {aviso && <Aviso {...aviso} />}
      <CampoDeTexto
        ref={campoDeCorreo}
        etiqueta="Correo electrónico"
        ayuda="Te enviaremos un enlace para confirmarlo."
        autocompletar="email"
        teclado="email-address"
        valor={correo}
        alCambiar={setCorreo}
        error={errores.correo}
      />
      <CampoDeContrasena
        ref={campoDeContrasena}
        etiqueta="Contraseña"
        ayuda="Usa una frase de tres o cuatro palabras."
        autocompletar="new-password"
        valor={contrasena}
        alCambiar={setContrasena}
        error={errores.contrasena}
      />
      <CampoDeTexto
        ref={campoDeNombre}
        etiqueta="Nombre para mostrar"
        ayuda="Es el nombre que verás en la app. Puede ser un apodo."
        autocompletar="name"
        valor={nombre}
        alCambiar={setNombre}
        error={errores.nombre}
      />
      <Boton deshabilitado={enviando} alTocar={() => void enviar()}>
        Crear cuenta
      </Boton>
      {aviso === avisos.errorAlCrearCuenta && (
        <Boton variante="secundario" alTocar={() => void enviar()}>
          Intentar de nuevo
        </Boton>
      )}
      <Boton variante="secundario" alTocar={() => navigation.navigate('Entrar')}>
        Ya tengo una cuenta
      </Boton>
      <Nota>Después de confirmar tu correo verás cómo cuidamos tus datos y decidirás si los autorizas.</Nota>
    </Pantalla>
  );
}
