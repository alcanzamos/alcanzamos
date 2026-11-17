import { useEffect, useState, type SyntheticEvent } from "react";
import { borrarLaCuenta, resumenDeBorrado } from "../api/cuentas";
import type { ResumenDeBorrado } from "../api/cuentas";
import { seguirPorAccesoNegado } from "../accesoNegado";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { CampoDeContrasena } from "../componentes/CampoDeContrasena";
import { Casilla } from "../componentes/Casilla";
import { Hoja } from "../componentes/Hoja";
import { useDescargaDeDatos } from "../descargaDeDatos";
import { useFocoPendiente } from "../enfoque";
import { irConAviso } from "../llegada";
import {
  avisoDeFallo,
  avisos,
  nombresEnFrase,
  textoDeErrorDeCampo,
  type DatosDeAviso,
} from "../textos";
import { formatear, plural, textos } from "../textos/es.generated";

type Estado =
  | { fase: "cargando" }
  | { fase: "error"; aviso: DatosDeAviso }
  | { fase: "listo"; resumen: ResumenDeBorrado };

const t = textos.autorizacion.hojaNoAutorizo;
const borrar = textos.borrarCuenta;

// La hoja «¿No autorizas?» de PN-54 (E14-PME 4.11, D-102, D-103): explica, ofrece «Descargar mis datos», pide la
// contraseña y tiene «Borrar mi cuenta» y «Volver y decidir». La usa PN-64 cuando «No autorizo» no puede borrar de un
// toque: la cuenta de antes del cambio, con historial, a la que solo le falta una aceptación (SC-E21-25, sección 5,
// paso 3). Reutiliza lo de PN-69: el resumen de lo que se borra (los menores que dependen solo de la persona, RN-006),
// el borrado con la contraseña y la descarga. Nunca llama al rechazo que borra sin preguntar.
export function HojaNoAutorizo({ alCerrar }: { alCerrar: () => void }) {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [contrasena, setContrasena] = useState("");
  const [confirmaMenores, setConfirmaMenores] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { descarga, descargar } = useDescargaDeDatos();
  const pedirFoco = useFocoPendiente();

  useEffect(() => {
    let vigente = true;
    void resumenDeBorrado().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) setEstado({ fase: "listo", resumen: respuesta.cuerpo });
      else if (!seguirPorAccesoNegado(respuesta))
        setEstado({
          fase: "error",
          aviso: avisoDeFallo(respuesta, avisos.errorAlCargarTusDatos),
        });
    });
    return () => {
      vigente = false;
    };
  }, [intento]);

  const menores = estado.fase === "listo" ? estado.resumen.menores : [];
  const nombres = nombresEnFrase(menores.map((m) => m.nombre));

  async function enviar(evento: SyntheticEvent) {
    evento.preventDefault();
    if (enviando || estado.fase !== "listo") return;
    if (contrasena === "") {
      setErrores({ contrasena: t.errorContrasena });
      setAviso(null);
      pedirFoco("contrasena");
      return;
    }
    setEnviando(true);
    const respuesta = await borrarLaCuenta({
      contrasena,
      confirma_menores: confirmaMenores,
      menores: menores.map((m) => m.id),
    });
    setEnviando(false);
    if (respuesta.ok) return irConAviso("/entrar", "tu_cuenta_borrada");
    if (seguirPorAccesoNegado(respuesta)) return;
    if (respuesta.codigo === "menores_cambiaron") {
      // Los menores ya no son los que se mostraron: no se borró nada. Se vuelve a leer y la casilla se pide de nuevo.
      setConfirmaMenores(false);
      setErrores({});
      setAviso(avisos.errorAlBorrarLaCuenta);
      setEstado({ fase: "cargando" });
      setIntento(intento + 1);
      return;
    }
    const delCampo: Record<string, string> = {};
    if (respuesta.codigo === "contrasena_incorrecta")
      delCampo.contrasena =
        textoDeErrorDeCampo(respuesta.codigo, "borrarCuenta") ?? "";
    if (respuesta.codigo === "validacion") {
      const { contrasena: deLaContrasena, confirma_menores: deLosMenores } =
        respuesta.campos;
      if (deLaContrasena) delCampo.contrasena = t.errorContrasena;
      if (deLosMenores)
        delCampo.confirma_menores = formatear(
          textos.erroresDeCampo.borrarCuenta.confirmacion_requerida,
          { nombres },
        );
    }
    const conTexto = Object.fromEntries(
      Object.entries(delCampo).filter(([, texto]) => texto),
    );
    setErrores(conTexto);
    setAviso(
      Object.keys(conTexto).length > 0
        ? null
        : avisoDeFallo(respuesta, avisos.errorAlBorrarLaCuenta),
    );
    pedirFoco(
      conTexto.contrasena
        ? "contrasena"
        : conTexto.confirma_menores
          ? "confirma-menores"
          : "aviso",
    );
  }

  return (
    <Hoja titulo={t.titulo} alCerrar={alCerrar}>
      <form className="formulario" noValidate onSubmit={enviar}>
        {descarga.fase === "aviso" && (
          <Aviso id="aviso-descarga" {...descarga.aviso} />
        )}
        {aviso && <Aviso {...aviso} />}
        {estado.fase === "error" && <Aviso {...estado.aviso} />}
        <p>{t.explicacion}</p>
        <p className="ayuda">{t.antesDescarga}</p>
        <Boton
          variante="texto"
          deshabilitado={descarga.fase === "preparando"}
          descritoPor="ayuda-descarga"
          alTocar={() => void descargar()}
        >
          {descarga.fase === "preparando"
            ? textos.descargarMisDatos.preparando
            : textos.descargarMisDatos.boton}
        </Boton>
        <p id="ayuda-descarga" className="ayuda">
          {textos.descargarMisDatos.ayuda}
        </p>
        {menores.length > 0 && (
          <>
            <p>
              {plural(borrar.menores.dependen, menores.length, { nombres })}
            </p>
            <Casilla
              id="confirma-menores"
              texto={plural(borrar.menores.casilla, menores.length, {
                nombres,
              })}
              marcada={confirmaMenores}
              alCambiar={setConfirmaMenores}
              error={errores.confirma_menores}
            />
          </>
        )}
        {estado.fase !== "error" && (
          <CampoDeContrasena
            id="contrasena"
            etiqueta={borrar.contrasena.etiqueta}
            ayuda={borrar.contrasena.ayuda}
            autocompletar="current-password"
            valor={contrasena}
            alCambiar={setContrasena}
            error={errores.contrasena}
          />
        )}
        {estado.fase === "error" && (
          <Boton
            variante="secundario"
            alTocar={() => {
              setEstado({ fase: "cargando" });
              setIntento(intento + 1);
            }}
          >
            {textos.acciones.intentarDeNuevo}
          </Boton>
        )}
        <Boton alTocar={alCerrar}>{t.volver}</Boton>
        {estado.fase === "listo" && (
          <Boton tipo="submit" variante="destructivo" deshabilitado={enviando}>
            {borrar.borrarMiCuenta}
          </Boton>
        )}
      </form>
    </Hoja>
  );
}
