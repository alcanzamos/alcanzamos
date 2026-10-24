import { useEffect, useState } from "react";
import { cerrarSesion } from "../api/cuentas";
import { ingresoAnterior } from "../api/acceso";
import { SIN_CONEXION } from "../api/cliente";
import { seguirPorAccesoNegado } from "../accesoNegado";
import { Aviso } from "../componentes/Aviso";
import { Boton, BotonEnlace } from "../componentes/Boton";
import { cifras } from "../componentes/Cifras";
import { Pagina } from "../componentes/Pagina";
import { useFocoPendiente } from "../enfoque";
import { navegar } from "../enrutador";
import { fechaEnPalabras } from "../fechas";
import { avisoDeLlegada } from "../llegada";
import { avisoDeFallo, avisos, type DatosDeAviso } from "../textos";
import { formatear, textos } from "../textos/es.generated";

type Estado =
  | { fase: "cargando" }
  | { fase: "error"; aviso: DatosDeAviso }
  | { fase: "listo"; ingreso: string | null };

// PN-71 · Seguridad de la cuenta: el ingreso anterior, nunca el de ahora (E14-PCP 4.14, RF-062).
// Es la pantalla de inicio provisional de quien entra con autorización, hasta que haya un Inicio.
export function SeguridadDeLaCuenta() {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const [llegada] = useState(avisoDeLlegada);
  const [sinConexion, setSinConexion] = useState(false);
  const pedirFoco = useFocoPendiente();

  useEffect(() => {
    let vigente = true;
    void ingresoAnterior().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) {
        const ingreso = respuesta.cuerpo.ingreso_anterior;
        setEstado(
          ingreso !== null && fechaEnPalabras(ingreso) === null
            ? { fase: "error", aviso: avisos.errorAlCargarIngreso }
            : { fase: "listo", ingreso },
        );
      } else if (!seguirPorAccesoNegado(respuesta)) {
        setEstado({
          fase: "error",
          aviso: avisoDeFallo(respuesta, avisos.errorAlCargarIngreso),
        });
      }
    });
    return () => {
      vigente = false;
    };
  }, [intento]);

  async function salir() {
    const respuesta = await cerrarSesion();
    // Un 401 es que la sesión ya no existía: igual se sale. Solo la falta de conexión se queda.
    if (!respuesta.ok && respuesta.codigo === SIN_CONEXION) {
      setSinConexion(true);
      pedirFoco("aviso");
    } else navegar("/entrar");
  }

  const fecha =
    estado.fase === "listo" && estado.ingreso
      ? fechaEnPalabras(estado.ingreso)
      : null;

  return (
    <Pagina titulo={textos.seguridadDeLaCuenta.titulo} estado={llegada}>
      {sinConexion && <Aviso {...avisos.sinConexion} />}
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
        </>
      )}
      {estado.fase === "listo" && (
        <>
          <section className="tarjeta" aria-labelledby="titulo-ingreso">
            <h2 id="titulo-ingreso" className="titulo-3">
              {textos.seguridadDeLaCuenta.tarjeta}
            </h2>
            {fecha ? (
              <>
                <p>
                  {cifras(
                    formatear(textos.seguridadDeLaCuenta.ingresoAnterior, {
                      fecha,
                    }),
                  )}
                </p>
                <p className="ayuda">
                  {textos.seguridadDeLaCuenta.ingresoAclaracion}
                </p>
              </>
            ) : (
              <p>{textos.seguridadDeLaCuenta.primerIngreso}</p>
            )}
          </section>
          {fecha && (
            <>
              <Aviso id="aviso-ingreso" {...avisos.noReconoceElIngreso} />
              <BotonEnlace href="/cuenta/contrasena">
                {textos.seguridadDeLaCuenta.cambiarContrasena}
              </BotonEnlace>
            </>
          )}
        </>
      )}
      <Boton variante="texto" alTocar={() => void salir()}>
        {textos.acciones.cerrarSesion}
      </Boton>
    </Pagina>
  );
}
