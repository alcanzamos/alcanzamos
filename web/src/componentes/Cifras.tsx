import type { ReactNode } from "react";

// D-123: todo número va en Figtree, también en el texto corrido, con cifras tabulares y sin ss02.
// Parte el texto en sus números (de «15», de «9:40») y los envuelve; el resto sigue en Atkinson.
export function cifras(texto: string): ReactNode[] {
  return texto.split(/(\d+(?::\d+)?)/).map((trozo, i) =>
    i % 2 === 1 ? (
      <span key={i} className="cifra">
        {trozo}
      </span>
    ) : (
      trozo
    ),
  );
}
