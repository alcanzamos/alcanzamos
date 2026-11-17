// La frase de los avisos con la app cerrada: última viñeta de «Dónde guardamos tus datos» en PN-68 y texto normal, sin
// pista de accesibilidad, bajo la casilla de PN-64 (SC-E21-25 3.6 y sección 4).
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Politica } from "../../src/pantallas/Politica";
import { Casilla } from "../../src/componentes/Casilla";
import { textos } from "../../src/textos/es.generated";

const text = (v: unknown): string =>
  typeof v === "string"
    ? v
    : (v as { children: unknown[] }).children.map(text).join("");

it("PN-68: la última de las cinco viñetas de «Dónde guardamos tus datos» es la frase aprobada de los avisos", async () => {
  await render(<Politica />);
  const lists = screen.container.queryAll(
    (v) => v.props.accessibilityRole === "list",
  );
  expect(lists[1]!.children).toHaveLength(5);
  expect(text(lists[1]!.children[4])).toBe(textos.autorizacion.fraseDeAvisos);
  expect(
    screen.queryByText(
      "Todavía no confirmamos en qué país guardan ese código.",
      { exact: false },
    ),
  ).not.toBeOnTheScreen();
});

it.each([undefined, "Falta.", ""])(
  "Casilla: la ayuda se ve como texto normal, sin pista de accesibilidad, con error %j",
  async (error) => {
    const change = jest.fn();
    await render(
      <Casilla
        texto="Acepto"
        ayuda="Ayuda 12 y 17"
        marcada={false}
        deshabilitada
        error={error}
        alCambiar={change}
      />,
    );
    expect(
      screen.getByRole("checkbox").props.accessibilityHint,
    ).toBeUndefined();
    expect(screen.getByText("Ayuda 12 y 17")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Ayuda 12 y 17"));
    await fireEvent.press(screen.getByRole("checkbox"));
    expect(change).not.toHaveBeenCalled();
  },
);
