import { textos } from "../textos/es.generated";
import { IconoOcultar } from "./Iconos";

// La marca de una categoría que la persona ocultó y el movimiento conserva (E14-PRR 4.2, D-170): ícono y palabra
// juntos, nunca solo color. El espacio de antes separa la palabra del nombre para quien lo lee con un lector de pantalla.
export const MarcaDeOculta = () => (
  <>
    {" "}
    <span className="oculta">
      <IconoOcultar />
      <span>{textos.movimientos.oculta}</span>
    </span>
  </>
);
