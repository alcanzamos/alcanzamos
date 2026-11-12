import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavegacionLateral } from "../../src/componentes/NavegacionLateral";
import { Pagina } from "../../src/componentes/Pagina";

const barra = () => within(screen.getByRole("navigation"));
const enlaces = () => barra().getAllByRole("link");

describe("NavegacionLateral (E14-SDD 5.13, bug 233)", () => {
  it("«Registrar» va primero, arriba de los destinos, y abre el formulario", () => {
    render(<NavegacionLateral />);
    const [registrar] = enlaces();
    expect(registrar).toHaveAccessibleName("Registrar");
    expect(registrar).toHaveAttribute("href", "/registrar");
    // El ícono Agregar acompaña al texto y no se lee.
    expect(registrar?.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("solo lleva los destinos que ya existen, en el orden de 5.9: Movimientos y Presupuesto, sin Inicio ni Metas", () => {
    render(<NavegacionLateral />);
    expect(enlaces().map((e) => e.textContent)).toEqual([
      "Registrar",
      "Movimientos",
      "Presupuesto",
    ]);
    expect(barra().getByRole("link", { name: "Movimientos" })).toHaveAttribute(
      "href",
      "/movimientos",
    );
    expect(barra().getByRole("link", { name: "Presupuesto" })).toHaveAttribute(
      "href",
      "/presupuesto",
    );
    for (const destino of ["Inicio", "Metas"])
      expect(barra().queryByText(destino)).not.toBeInTheDocument();
  });

  // «Ícono/Presupuesto» de Penpot (E14-SDD 5.1; L18 de la US-77): caja de 24, trazo de 2 redondeado, un gráfico de torta.
  it("«Presupuesto» lleva el ícono Presupuesto de Penpot, que no se lee", () => {
    render(<NavegacionLateral />);
    const icono = barra()
      .getByRole("link", { name: "Presupuesto" })
      .querySelector("svg");
    expect(icono).toHaveAttribute("aria-hidden", "true");
    expect(icono).toHaveAttribute("viewBox", "0 0 24 24");
    expect(icono).toHaveAttribute("stroke-width", "2");
    expect(icono).toHaveAttribute("stroke-linecap", "round");
    expect(icono).toHaveAttribute("stroke-linejoin", "round");
    const circulo = icono?.querySelector("circle");
    expect(["cx", "cy", "r"].map((a) => circulo?.getAttribute(a))).toEqual([
      "12",
      "12",
      "9",
    ]);
    expect(icono?.querySelector("path")).toHaveAttribute("d", "M12 3v9l8.5 3");
  });

  it("«Registrar» es Primario y pasa a Secundario donde la pantalla ya tiene su Primario", () => {
    const { rerender } = render(<NavegacionLateral />);
    expect(barra().getByRole("link", { name: "Registrar" })).toHaveClass(
      "boton",
      "boton--primario",
    );
    rerender(<NavegacionLateral registrarSecundario />);
    const registrar = barra().getByRole("link", { name: "Registrar" });
    expect(registrar).toHaveClass("boton", "boton--secundario");
    expect(registrar).not.toHaveClass("boton--primario");
  });

  it("marca el destino activo con aria-current y deja los otros sin marcar", () => {
    const { rerender } = render(<NavegacionLateral activo="movimientos" />);
    expect(barra().getByRole("link", { name: "Movimientos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      barra().getByRole("link", { name: "Registrar" }),
    ).not.toHaveAttribute("aria-current");

    rerender(<NavegacionLateral activo="registrar" registrarSecundario />);
    expect(barra().getByRole("link", { name: "Registrar" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      barra().getByRole("link", { name: "Movimientos" }),
    ).not.toHaveAttribute("aria-current");

    rerender(<NavegacionLateral activo="presupuesto" />);
    expect(barra().getByRole("link", { name: "Presupuesto" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const nombre of ["Registrar", "Movimientos"])
      expect(barra().getByRole("link", { name: nombre })).not.toHaveAttribute(
        "aria-current",
      );

    rerender(<NavegacionLateral />);
    for (const enlace of enlaces())
      expect(enlace).not.toHaveAttribute("aria-current");
  });

  it("navega sin recargar la página", () => {
    render(<NavegacionLateral />);
    fireEvent.click(barra().getByRole("link", { name: "Movimientos" }));
    expect(window.location.pathname).toBe("/movimientos");
    fireEvent.click(barra().getByRole("link", { name: "Presupuesto" }));
    expect(window.location.pathname).toBe("/presupuesto");
    fireEvent.click(barra().getByRole("link", { name: "Registrar" }));
    expect(window.location.pathname).toBe("/registrar");
  });
});

describe("Pagina con la Navegación lateral", () => {
  it("sin `lateral` no hay navegación: las pantallas de antes de entrar no la llevan", () => {
    render(<Pagina titulo="Inicia sesión">contenido</Pagina>);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("con `lateral` la barra va antes y fuera del contenido, y recibe el destino activo", () => {
    const { container } = render(
      <Pagina titulo="Movimientos" lateral={{ activo: "movimientos" }}>
        contenido
      </Pagina>,
    );
    const nav = screen.getByRole("navigation");
    const main = screen.getByRole("main");
    expect(main).not.toContainElement(nav);
    expect(
      nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.firstElementChild).toHaveClass("con-navegacion");
    expect(
      within(nav).getByRole("link", { name: "Movimientos" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(main).getByRole("heading", { level: 1, name: "Movimientos" }),
    ).toBeInTheDocument();
  });
});
