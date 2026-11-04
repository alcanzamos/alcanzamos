import { useEffect, useState, type SyntheticEvent } from "react";
import { borrarLaCuenta, resumenDeBorrado } from "../api/cuentas";
import type { ResumenDeBorrado } from "../api/cuentas";
import { seguirPorAccesoNegado } from "../accesoNegado";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { Casilla } from "../componentes/Casilla";
import { CampoDeContrasena } from "../componentes/CampoDeContrasena";
import { Pagina } from "../componentes/Pagina";
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

const t = textos.borrarCuenta;

// La fila 4 de PN-69 cambia con el hogar (E14-PCP 4.12): quien lo administra con otra persona adulta, la única persona
// adulta, o quien es miembro sin el papel.
function textoDelHogar(hogar: NonNullable<ResumenDeBorrado["hogar"]>) {
  const nombre = hogar.nombre ?? t.hogar.sinNombre;
  if (hogar.unica_adulta)
    return formatear(t.hogar.unicaAdulta, { hogar: nombre });
  if (hogar.es_administradora && hogar.nuevo_administrador)
    return formatear(t.hogar.administradora, {
      nombre: hogar.nuevo_administrador,
    });
  return t.hogar.miembro;
}

// PN-69 · Borrar la cuenta (E14-PCP 4.12, RF-032, RN-006, RN-007): la pantalla es la confirmación. Todo lo que cambia
// según el hogar y los menores sale del API antes de mostrar el botón: sin eso no se puede avisar lo que RN-006 pide.
// «Descargar mis datos» (D-102) no está en esta historia.
export function BorrarCuenta() {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [contrasena, setContrasena] = useState("");
  const [confirmaMenores, setConfirmaMenores] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const pedirFoco = useFocoPendiente();

  useEffect(() => {
    let vigente = true;
    void resumenDeBorrado().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) setEstado({ fase: "listo", resumen: respuesta.cuerpo });
      else if (!seguirPorAccesoNegado(respuesta))
        setEstado({
          fase: "error",
          aviso: avisoDeFallo(respuesta, avisos.errorAlCargarLoQueSeBorra),
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
    if (enviando) return;
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
      // Los menores a cargo ya no son los que se mostraron (RN-006): no se borró nada. Se vuelve a leer el resumen y la
      // casilla vuelve a pedirse, ahora con los de verdad.
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
      if (deLaContrasena)
        delCampo.contrasena =
          textoDeErrorDeCampo(deLaContrasena, "borrarCuenta") ?? "";
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
    <Pagina titulo={t.borrarMiCuenta} atras="/cuenta/seguridad">
      {estado.fase === "error" && (
        <>
          <Aviso {...estado.aviso} />
          <Boton
            variante="secundario"
            alTocar={() => {
              setEstado({ fase: "cargando" });
              setIntento(intento + 1);
            }}
          >
            {textos.acciones.intentarDeNuevo}
          </Boton>
          <BotonEnlace href="/cuenta/seguridad">{t.ahoraNo}</BotonEnlace>
        </>
      )}
      {estado.fase === "listo" && (
        <form className="formulario" noValidate onSubmit={enviar}>
          {aviso && <Aviso {...aviso} />}
          <Aviso
            id="aviso-borrar"
            viva={false}
            {...avisos.vasABorrarTuCuenta}
          />
          <section className="tarjeta" aria-labelledby="titulo-que-se-borra">
            <h2 id="titulo-que-se-borra" className="titulo-3">
              {t.loQueSeBorra.titulo}
            </h2>
            <p>{t.loQueSeBorra.detalle}</p>
            <p className="ayuda">{t.loQueSeBorra.prueba}</p>
          </section>
          {estado.resumen.hogar && (
            <section className="tarjeta" aria-labelledby="titulo-hogar">
              <h2 id="titulo-hogar" className="titulo-3">
                {estado.resumen.hogar.nombre ?? t.hogar.sinNombre}
              </h2>
              <p>{textoDelHogar(estado.resumen.hogar)}</p>
            </section>
          )}
          {menores.length > 0 && (
            <>
              <section className="tarjeta" aria-labelledby="titulo-menores">
                <h2 id="titulo-menores" className="titulo-3">
                  {t.menores.titulo}
                </h2>
                <p>{plural(t.menores.dependen, menores.length, { nombres })}</p>
              </section>
              <Casilla
                id="confirma-menores"
                texto={plural(t.menores.casilla, menores.length, { nombres })}
                marcada={confirmaMenores}
                alCambiar={setConfirmaMenores}
                error={errores.confirma_menores}
              />
            </>
          )}
          <CampoDeContrasena
            id="contrasena"
            etiqueta={t.contrasena.etiqueta}
            ayuda={t.contrasena.ayuda}
            autocompletar="current-password"
            valor={contrasena}
            alCambiar={setContrasena}
            error={errores.contrasena}
          />
          <Boton tipo="submit" variante="destructivo" deshabilitado={enviando}>
            {t.borrarMiCuenta}
          </Boton>
          <BotonEnlace href="/cuenta/seguridad">{t.ahoraNo}</BotonEnlace>
        </form>
      )}
    </Pagina>
  );
}
