import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Boton } from "./componentes/Boton";
import { Pagina } from "./componentes/Pagina";
import { cargarConfiguracion } from "./configuracion";
import { avisos } from "./textos";
import { textos } from "./textos/es.generated";

// Sin `/config.json` la web no sabe a qué API hablar: no monta la app y lo dice. El aviso es el de «sin conexión»
// (E14-PCP 4.16 T10): un `config.json` que no llega es una falla de red o del servidor de la web, y la persona solo
// puede intentar de nuevo. Va por la región viva de siempre (`estado` de `Pagina`, `MensajeDeEstado`), que el lector de
// pantalla anuncia sin mover el foco. E14 no tiene título para esta página: el h1 es el nombre de la marca
// (`pagina.logo`), no un texto nuevo.
function ErrorDeConfiguracion({ alReintentar }: { alReintentar: () => void }) {
  return (
    <Pagina titulo={textos.pagina.logo} estado={avisos.sinConexion}>
      <Boton variante="secundario" alTocar={alReintentar}>
        {textos.acciones.intentarDeNuevo}
      </Boton>
    </Pagina>
  );
}

/** Lee la configuración y, solo entonces, monta la app en `raiz`. */
export async function arrancar(raiz: HTMLElement): Promise<void> {
  const arbol = createRoot(raiz);
  const intentar = async (): Promise<void> => {
    try {
      await cargarConfiguracion();
    } catch {
      arbol.render(
        <ErrorDeConfiguracion alReintentar={() => void intentar()} />,
      );
      return;
    }
    arbol.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  };
  await intentar();
}
