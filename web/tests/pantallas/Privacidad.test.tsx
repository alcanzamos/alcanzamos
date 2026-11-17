import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { irConAviso } from "../../src/llegada";
import { Privacidad } from "../../src/pantallas/Privacidad";

// E14-PCP 4.6: título, frase de entrada, las ocho tarjetas (filas 3 a 9 b) y «Continuar» (fila 11).
const tarjetas = [
  [
    "Lo que guardamos",
    "Tu correo, tu contraseña y tu nombre para mostrar. Y lo que tú registras: movimientos, metas, deudas y presupuestos.",
  ],
  [
    "Para qué lo usamos",
    "Para mostrarte tu plata disponible, avisarte de un faltante y explicarte por qué.",
  ],
  [
    "Lo tuyo es solo tuyo",
    "Solo se comparte con tu hogar lo que tú marcas como compartido.",
  ],
  [
    "Los avisos no cuentan nada",
    "La notificación solo dice «Tienes un aviso en Alcanzamos.» Las cifras las ves dentro de la app.",
  ],
  [
    "Cuida lo que escribes",
    "No escribas datos de salud, religión ni de otras personas.",
  ],
  [
    "Tus derechos",
    "Puedes conocer, corregir y borrar tus datos, y retirar tu autorización cuando quieras.",
  ],
  [
    "Quién responde",
    "Andrés Jiménez es el responsable. Escríbele a privacidad@alcanzamos.co.",
  ],
  [
    "Dónde se guardan",
    "En Azure, en México. El correo que te enviamos sale por un servicio que guarda sus datos en Francia, y lo que escribes a privacidad@alcanzamos.co queda en Estados Unidos. Los detalles están en la política.",
  ],
];

describe("PN-63 · Información de privacidad (primer uso)", () => {
  it("tiene el título y la frase de entrada de E14", () => {
    render(<Privacidad />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Cómo cuidamos tus datos",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Antes de seguir, esto es lo que hacemos con tu información.",
      ),
    ).toBeInTheDocument();
  });

  it("tiene las ocho tarjetas, en orden, cada una con su título y su texto", () => {
    render(<Privacidad />);
    const secciones = screen.getAllByRole("region");
    expect(secciones).toHaveLength(8);
    secciones.forEach((seccion, i) => {
      const [titulo, texto] = tarjetas[i] as [string, string];
      expect(seccion).toHaveAccessibleName(titulo);
      expect(seccion).toHaveTextContent(texto);
    });
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(tarjetas.map(([titulo]) => titulo));
  });

  it("no pide nada: ni campos ni casillas", () => {
    render(<Privacidad />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("«Continuar» y «Leer la política completa» (fila 10, Secundario, antes de «Continuar»), sin Atrás", () => {
    render(<Privacidad />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByLabelText("Atrás")).not.toBeInTheDocument();
    const enlace = screen.getByRole("link", {
      name: "Leer la política completa",
    });
    expect(enlace).toHaveClass("boton--secundario");
    expect(enlace).toHaveAttribute("href", "/politica?desde=%2Fprivacidad");
    expect(
      enlace.compareDocumentPosition(
        screen.getByRole("button", { name: "Continuar" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("link")).toEqual([enlace]);
  });

  it("«Leer la política completa» abre PN-68 y Atrás vuelve a PN-63", () => {
    render(<Privacidad />);
    fireEvent.click(
      screen.getByRole("link", { name: "Leer la política completa" }),
    );
    expect(window.location.pathname).toBe("/politica");
    expect(window.location.search).toBe("?desde=%2Fprivacidad");
  });

  it("«Continuar» lleva a PN-64", () => {
    render(<Privacidad />);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(window.location.pathname).toBe("/autorizacion");
  });

  // E14-PCP 4.16 T11 (D-153)
  it("tras confirmar el correo muestra arriba «Listo, confirmamos tu correo.» como estado, sin mover el foco", async () => {
    irConAviso("/privacidad", "correo_confirmado");
    render(<Privacidad />);
    const estado = await screen.findByRole("status");
    expect(estado).toHaveTextContent("Listo, confirmamos tu correo.");
    expect(estado).not.toHaveFocus();
    expect(
      estado.compareDocumentPosition(
        screen.getByRole("heading", { level: 1 }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sin llegada por la confirmación no hay mensaje de estado", () => {
    render(<Privacidad />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// E14-PCP 4.6 («Dos modos, una pantalla») y nota del 2026-11-08 (bug 260, USA-003): desde el menú, las mismas tarjetas con
// Atrás y sin «Continuar». Mientras no exista PN-66, se abre desde la entrada provisional de PN-71.
describe("PN-63 · Información de privacidad desde el menú", () => {
  it("tiene el mismo título, la frase de entrada y las ocho tarjetas, en orden", () => {
    render(<Privacidad desdeElMenu />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Cómo cuidamos tus datos",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Antes de seguir, esto es lo que hacemos con tu información.",
      ),
    ).toBeInTheDocument();
    const secciones = screen.getAllByRole("region");
    expect(secciones).toHaveLength(8);
    secciones.forEach((seccion, i) => {
      const [titulo, texto] = tarjetas[i] as [string, string];
      expect(seccion).toHaveAccessibleName(titulo);
      expect(seccion).toHaveTextContent(texto);
    });
  });

  it("lleva Atrás y «Leer la política completa», y no lleva «Continuar» ni otro botón", () => {
    render(<Privacidad desdeElMenu />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Continuar")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("main"))
        .getAllByRole("link")
        .map((e) => e.getAttribute("href")),
    ).toEqual(["/cuenta/seguridad", "/politica?desde=%2Fcuenta%2Fprivacidad"]);
    expect(
      screen.getByRole("link", { name: "Leer la política completa" }),
    ).toHaveClass("boton--secundario");
  });

  it("Atrás vuelve a PN-71", () => {
    render(<Privacidad desdeElMenu />);
    fireEvent.click(screen.getByRole("link", { name: "Atrás" }));
    expect(window.location.pathname).toBe("/cuenta/seguridad");
  });

  it("lleva la Navegación lateral, sin destino activo (E14-PCP 4.6, variante web); el primer uso no la lleva", () => {
    const { unmount } = render(<Privacidad desdeElMenu />);
    const barra = within(screen.getByRole("navigation"));
    expect(barra.getByRole("link", { name: "Registrar" })).toHaveClass(
      "boton--primario",
    );
    for (const enlace of barra.getAllByRole("link"))
      expect(enlace).not.toHaveAttribute("aria-current");
    unmount();
    render(<Privacidad />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
