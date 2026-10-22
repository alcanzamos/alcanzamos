import { formatearPesos } from "./dinero";

// Cifras inventadas, en centavos: no son datos de nadie.
const cifras = [
  { etiqueta: "Ejemplo de ahorro", centavos: 8000000 },
  { etiqueta: "Ejemplo de meta", centavos: 120000000 },
  { etiqueta: "Ejemplo con centavos", centavos: 12345678 },
];

// Pantalla de prueba de la base web (US-57): solo comprueba tipografía, tokens, foco y accesibilidad.
export function PantallaPrueba() {
  return (
    <main className="pantalla">
      <h1>Alcanzamos</h1>
      <p>
        Esta es una pantalla de prueba. Sirve para comprobar que la tipografía,
        los colores y el foco del teclado funcionan bien. Las cifras son
        inventadas.
      </p>
      <section aria-labelledby="titulo-cifras" id="cifras">
        <h2 id="titulo-cifras">Cifras de ejemplo</h2>
        <dl className="cifras">
          {cifras.map(({ etiqueta, centavos }) => (
            <div className="cifra" key={etiqueta}>
              <dt>{etiqueta}</dt>
              <dd>{formatearPesos(centavos)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <a className="enlace" href="#cifras">
        Ir a las cifras
      </a>
    </main>
  );
}
