import { textos } from "../textos/es.generated";
import { IconoCompartido, IconoPropio } from "./Iconos";

// Marca de propiedad (E14-SDD 5.16): ícono y texto juntos, nunca solo color. Es la que dice «Compartido con el hogar»
// (NM-05, SEG-002) o «Solo mío».
export function MarcaDePropiedad({ compartido }: { compartido: boolean }) {
  return (
    <p className="marca">
      {compartido ? <IconoCompartido /> : <IconoPropio />}
      <span>
        {compartido
          ? textos.movimientos.fila.compartido
          : textos.registro.quien.soloMio}
      </span>
    </p>
  );
}
