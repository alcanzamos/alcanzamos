import { useState, type SyntheticEvent } from "react";
import { crearCuenta } from "../api/cuentas";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { CampoDeContrasena } from "../componentes/CampoDeContrasena";
import { CampoDeTexto } from "../componentes/CampoDeTexto";
import { Casilla } from "../componentes/Casilla";
import { IconoInformacion } from "../componentes/Iconos";
import { Pagina } from "../componentes/Pagina";
import { guardarCorreo } from "../correoPendiente";
import { navegar } from "../enrutador";
import { useFocoPendiente } from "../enfoque";
import {
  avisoDeFallo,
  avisos,
  textoDeErrorDeCampo,
  type DatosDeAviso,
} from "../textos";

// Del cuerpo del pedido al id del control, en el orden de la pantalla (el foco va al primero con error).
const orden = [
  ["correo", "correo"],
  ["contrasena", "contrasena"],
  ["nombre", "nombre"],
  ["mayor_de_edad", "mayor-de-edad"],
] as const;

// PN-58 · Crear la cuenta, variante web (E14-PCP 4.1). El API valida todo y devuelve el código de cada campo.
export function CrearCuenta() {
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [nombre, setNombre] = useState("");
  const [mayorDeEdad, setMayorDeEdad] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const pedirFoco = useFocoPendiente();

  async function enviar(evento?: SyntheticEvent) {
    evento?.preventDefault();
    if (enviando) return;
    setEnviando(true);
    const respuesta = await crearCuenta({
      correo,
      contrasena,
      nombre,
      mayor_de_edad: mayorDeEdad,
    });
    setEnviando(false);
    if (respuesta.ok) {
      guardarCorreo(correo);
      navegar("/revisa-tu-correo");
      return;
    }
    const delCampo: Record<string, string> = {};
    let sinTexto = false;
    if (respuesta.codigo === "validacion") {
      for (const [campo, codigo] of Object.entries(respuesta.campos)) {
        const texto = textoDeErrorDeCampo(codigo);
        if (texto) delCampo[campo] = texto;
        else sinTexto = true;
      }
    }
    const hayErroresDeCampo = Object.keys(delCampo).length > 0;
    setErrores(delCampo);
    setAviso(
      hayErroresDeCampo && !sinTexto
        ? null
        : avisoDeFallo(respuesta, avisos.errorAlCrearCuenta),
    );
    const primero = orden.find(([campo]) => delCampo[campo]);
    pedirFoco(primero ? primero[1] : "aviso");
  }

  return (
    <Pagina titulo="Crea tu cuenta" conLogo>
      <p>Solo necesitamos tres datos.</p>
      <form className="formulario" noValidate onSubmit={enviar}>
        {aviso && <Aviso {...aviso} />}
        <CampoDeTexto
          id="correo"
          etiqueta="Correo electrónico"
          ayuda="Te enviaremos un enlace para confirmarlo."
          tipo="email"
          autocompletar="email"
          valor={correo}
          alCambiar={setCorreo}
          error={errores.correo}
        />
        <CampoDeContrasena
          id="contrasena"
          etiqueta="Contraseña"
          ayuda="Usa una frase de tres o cuatro palabras."
          autocompletar="new-password"
          valor={contrasena}
          alCambiar={setContrasena}
          error={errores.contrasena}
        />
        <CampoDeTexto
          id="nombre"
          etiqueta="Nombre para mostrar"
          ayuda="Es el nombre que verás en la app. Puede ser un apodo."
          autocompletar="name"
          valor={nombre}
          alCambiar={setNombre}
          error={errores.nombre}
        />
        <Casilla
          id="mayor-de-edad"
          texto="Soy mayor de edad"
          marcada={mayorDeEdad}
          alCambiar={setMayorDeEdad}
          error={errores.mayor_de_edad}
        />
        <Boton tipo="submit" deshabilitado={enviando}>
          Crear cuenta
        </Boton>
        {aviso === avisos.errorAlCrearCuenta && (
          <Boton variante="secundario" alTocar={() => void enviar()}>
            Intentar de nuevo
          </Boton>
        )}
      </form>
      <BotonEnlace href="/entrar">Ya tengo una cuenta</BotonEnlace>
      <p className="nota">
        <IconoInformacion />
        <span>
          Después de confirmar tu correo verás cómo cuidamos tus datos y
          decidirás si los autorizas.
        </span>
      </p>
    </Pagina>
  );
}
