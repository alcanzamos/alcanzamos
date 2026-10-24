import { useState } from "react";
import { CampoDeTexto, type PropiedadesDeCampo } from "./CampoDeTexto";
import { IconoOcultar, IconoVer } from "./Iconos";
import { textos } from "../textos/es.generated";

// Campo de contraseña de E14-SDD 5.18: con Ver y Ocultar. Permite pegar (no hay onPaste que lo bloquee).
// `autocompletar` es `current-password` para la que ya existe y `new-password` para la nueva.
export function CampoDeContrasena(
  propiedades: Omit<PropiedadesDeCampo, "tipo">,
) {
  const [visible, setVisible] = useState(false);
  return (
    <CampoDeTexto
      {...propiedades}
      tipo={visible ? "text" : "password"}
      accion={
        <button
          type="button"
          className="campo__ver"
          aria-label={
            visible
              ? textos.campos.contrasena.ocultar
              : textos.campos.contrasena.mostrar
          }
          onClick={() => setVisible(!visible)}
        >
          {visible ? <IconoOcultar /> : <IconoVer />}
        </button>
      }
    />
  );
}
