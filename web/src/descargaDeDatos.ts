import { useState } from "react";
import { descargarMisDatos } from "./api/cuentas";
import { seguirPorAccesoNegado } from "./accesoNegado";
import { avisoDeFallo, avisos, type DatosDeAviso } from "./textos";

export type EstadoDeDescarga =
  | { fase: "libre" }
  | { fase: "preparando" }
  | { fase: "aviso"; aviso: DatosDeAviso };

/**
 * «Descargar mis datos» (RF-032, D-102, D-180), el mismo botón y los mismos estados en PN-69 y en la hoja de «No
 * autorizo» (E14-PME): opcional, no retrasa el borrado ni lo condiciona, y no abre otra pantalla. Baja el ZIP que arma
 * el API al pedirlo; un fallo trae su aviso y un 401 lleva a PN-60.
 */
export function useDescargaDeDatos() {
  const [descarga, setDescarga] = useState<EstadoDeDescarga>({ fase: "libre" });

  async function descargar() {
    if (descarga.fase === "preparando") return;
    setDescarga({ fase: "preparando" });
    const respuesta = await descargarMisDatos();
    if (!respuesta.ok) {
      if (seguirPorAccesoNegado(respuesta)) return;
      setDescarga({
        fase: "aviso",
        aviso: avisoDeFallo(respuesta, avisos.errorAlDescargar),
      });
      return;
    }
    const direccion = URL.createObjectURL(respuesta.cuerpo);
    const enlace = document.createElement("a");
    enlace.href = direccion;
    enlace.download = respuesta.nombre;
    enlace.click();
    URL.revokeObjectURL(direccion);
    setDescarga({ fase: "aviso", aviso: avisos.descargaLista });
  }

  return { descarga, descargar };
}
