// S3, S5, S6: decisiones L6.2 y L6.4; contrato del navegador e ítem 7 del README.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Politica } from "../../src/pantallas/Politica";
import { Casilla } from "../../src/componentes/Casilla";
import { textos } from "../../src/textos/es.generated";

const movilRoot = resolve(__dirname, "../..");
const text = (v: unknown): string =>
  typeof v === "string"
    ? v
    : (v as { children: unknown[] }).children.map(text).join("");

it("PN-68: avisos es la quinta y última viñeta; no repite PN-64", async () => {
  await render(<Politica />);
  const lists = screen.container.queryAll(
    (v) => v.props.accessibilityRole === "list",
  );
  expect(lists[1]!.children).toHaveLength(5);
  expect(text(lists[1]!.children[4])).toBe(
    textos.politica.dondeGuardamos.items.avisos,
  );
  expect(
    screen.queryByText(textos.autorizacion.fraseDeAvisos),
  ).not.toBeOnTheScreen();
});

it.each([undefined, "Falta.", ""])(
  "Casilla: ayuda visible sin pista, error %s",
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

it("el recorrido del README describe la frase como texto, no como pista", () => {
  const readme = readFileSync(resolve(movilRoot, "README.md"), "utf8");
  expect(readme.includes("la casilla lee su frase como pista")).toBe(false);
  expect(readme).toContain(
    "con TalkBack, la casilla dice solo su nombre y su estado, y la frase se lee una vez, como texto, al llegar a ella",
  );
});

it("la llamada de navegador conserva contrato y solo lleva sus cabeceras", () => {
  const script = readFileSync(
    resolve(movilRoot, "scripts/integracion-api.mjs"),
    "utf8",
  );
  const fn = script.match(
    /const completarEnElNavegador = [\s\S]*?\n {2}\}\);/,
  )![0];
  let call: unknown;
  vm.runInNewContext(fn + "\ncompletarEnElNavegador('t','clave','Ana');", {
    URL_API: "https://example.test",
    fetch: (...args: unknown[]) => {
      call = args;
    },
  });
  expect(call).toEqual([
    "https://example.test/api/v1/cuentas/verificacion",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ token: "t", contrasena: "clave", nombre: "Ana" }),
    },
  ]);
});
