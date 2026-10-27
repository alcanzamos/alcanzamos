import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Pagina } from "../../src/componentes/Pagina";

describe("Pagina", () => {
  it("el título es el h1 y también el título del documento", () => {
    render(<Pagina titulo="Crea tu cuenta">contenido</Pagina>);
    expect(
      screen.getByRole("heading", { level: 1, name: "Crea tu cuenta" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Crea tu cuenta · Alcanzamos");
  });

  it("`ancha` quita el ancho máximo de la columna de lectura (PN-01 en la web)", () => {
    const { container, rerender } = render(<Pagina titulo="Hola" />);
    expect(container.querySelector("main")).not.toHaveClass("columna--ancha");
    rerender(<Pagina titulo="Hola" ancha />);
    expect(container.querySelector("main")).toHaveClass("columna--ancha");
  });

  it("el logo es opcional y su texto alternativo es el nombre de la app", () => {
    const { rerender } = render(<Pagina titulo="Hola">contenido</Pagina>);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    rerender(
      <Pagina titulo="Hola" conLogo>
        contenido
      </Pagina>,
    );
    expect(screen.getByRole("img", { name: "Alcanzamos" })).toBeInTheDocument();
  });
});
