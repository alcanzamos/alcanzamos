import { useEffect, useId, useRef, type ReactNode } from "react";
import { textos } from "../textos/es.generated";
import { IconoCerrar } from "./Iconos";

const FOCALIZABLES = "button, input, a[href]";

// Hoja inferior de E14-SDD 5.12. En la web (768 px o más) es un panel junto al botón que la abre, sin velo; por debajo,
// la hoja anclada abajo con su velo. Se cierra con «Cerrar», con el velo y con Escape (la tecla de Atrás). El foco entra
// en el título al abrirla y queda dentro mientras está abierta; devolverlo al botón que la abrió lo hace quien la abre.
export function Hoja({
  titulo,
  alCerrar,
  children,
}: {
  titulo: string;
  alCerrar: () => void;
  children: ReactNode;
}) {
  const raiz = useRef<HTMLElement>(null);
  const idDelTitulo = useId();
  // El último `alCerrar`, para que el foco entre una sola vez y el oyente no se rehaga en cada pintado.
  const cerrarAhora = useRef(alCerrar);
  useEffect(() => {
    cerrarAhora.current = alCerrar;
  });
  useEffect(() => {
    const hoja = raiz.current;
    if (!hoja) return;
    hoja.querySelector<HTMLElement>("h3")?.focus();
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        cerrarAhora.current();
        return;
      }
      if (evento.key !== "Tab") return;
      const lista = [...hoja.querySelectorAll<HTMLElement>(FOCALIZABLES)];
      const posicion = lista.indexOf(document.activeElement as HTMLElement);
      if (evento.shiftKey && posicion <= 0) {
        evento.preventDefault();
        lista.at(-1)?.focus();
      } else if (!evento.shiftKey && posicion === lista.length - 1) {
        evento.preventDefault();
        lista[0]?.focus();
      }
    };
    hoja.addEventListener("keydown", alTeclear);
    return () => hoja.removeEventListener("keydown", alTeclear);
  }, []);

  return (
    <div className="hoja-contenedor">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="hoja__velo"
        onClick={alCerrar}
      />
      <section
        ref={raiz}
        role="dialog"
        aria-labelledby={idDelTitulo}
        className="hoja tarjeta"
      >
        <div className="hoja__encabezado">
          <h3 id={idDelTitulo} tabIndex={-1} className="titulo-3">
            {titulo}
          </h3>
          <button
            type="button"
            className="hoja__cerrar"
            aria-label={textos.porConfirmar.cerrar}
            onClick={alCerrar}
          >
            <IconoCerrar />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
