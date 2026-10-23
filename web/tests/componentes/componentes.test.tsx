import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Aviso } from "../../src/componentes/Aviso";
import { Boton, BotonEnlace } from "../../src/componentes/Boton";
import { CampoDeContrasena } from "../../src/componentes/CampoDeContrasena";
import { CampoDeTexto } from "../../src/componentes/CampoDeTexto";
import { Casilla } from "../../src/componentes/Casilla";
import { cifras } from "../../src/componentes/Cifras";
import { MensajeDeEstado } from "../../src/componentes/MensajeDeEstado";

describe("Aviso", () => {
  it.each(["informacion", "atencion", "logro"] as const)(
    "el tipo %s lleva título, mensaje y un ícono que no se lee",
    (tipo) => {
      const { container } = render(
        <Aviso tipo={tipo} titulo="Título" mensaje="Mensaje" />,
      );
      expect(screen.getByRole("status")).toHaveTextContent("TítuloMensaje");
      expect(container.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    },
  );

  it("el mensaje es opcional y el aviso se puede enfocar", () => {
    render(<Aviso tipo="logro" titulo="Listo" />);
    const aviso = screen.getByRole("status");
    aviso.focus();
    expect(aviso).toHaveFocus();
  });
});

describe("Boton", () => {
  it("llama a alTocar", () => {
    const alTocar = vi.fn();
    render(<Boton alTocar={alTocar}>Aceptar</Boton>);
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
    expect(alTocar).toHaveBeenCalledOnce();
  });

  it("deshabilitado no actúa, conserva el foco y queda ligado a su explicación", () => {
    const alTocar = vi.fn();
    render(
      <Boton deshabilitado alTocar={alTocar} descritoPor="espera">
        Reenviar
      </Boton>,
    );
    const boton = screen.getByRole("button", { name: "Reenviar" });
    boton.focus();
    fireEvent.click(boton);
    expect(alTocar).not.toHaveBeenCalled();
    expect(boton).toHaveFocus();
    expect(boton).toHaveAttribute("aria-disabled", "true");
    expect(boton).toHaveAttribute("aria-describedby", "espera");
  });

  it("un botón de envío deshabilitado no envía el formulario", () => {
    const enviar = vi.fn((e: { preventDefault: () => void }) =>
      e.preventDefault(),
    );
    render(
      <form onSubmit={enviar}>
        <Boton tipo="submit" deshabilitado>
          Enviar
        </Boton>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(enviar).not.toHaveBeenCalled();
  });

  it("BotonEnlace navega sin recargar y respeta Ctrl+clic", () => {
    render(<BotonEnlace href="/entrar">Ir</BotonEnlace>);
    const enlace = screen.getByRole("link", { name: "Ir" });
    // Con Ctrl el navegador abre otra pestaña: jsdom no lo implementa, así que se frena aquí.
    const frenar = (e: Event) => e.preventDefault();
    document.addEventListener("click", frenar);
    fireEvent.click(enlace, { ctrlKey: true });
    document.removeEventListener("click", frenar);
    expect(window.location.pathname).toBe("/");
    fireEvent.click(enlace);
    expect(window.location.pathname).toBe("/entrar");
  });
});

describe("CampoDeTexto", () => {
  const base = {
    id: "correo",
    etiqueta: "Correo electrónico",
    valor: "",
    alCambiar: () => {},
    autocompletar: "email",
  };

  it("tiene etiqueta y su autocompletar", () => {
    render(<CampoDeTexto {...base} />);
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute(
      "autocomplete",
      "email",
    );
  });

  it("liga la ayuda y el error con aria-describedby y marca el campo inválido", () => {
    render(<CampoDeTexto {...base} ayuda="Ayuda" error="Falta algo." />);
    const campo = screen.getByLabelText("Correo electrónico");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAccessibleDescription("Ayuda Falta algo.");
  });

  it("sin error no está inválido ni descrito", () => {
    render(<CampoDeTexto {...base} />);
    const campo = screen.getByLabelText("Correo electrónico");
    expect(campo).not.toHaveAttribute("aria-invalid");
    expect(campo).not.toHaveAttribute("aria-describedby");
  });

  it("avisa lo que se escribe", () => {
    const alCambiar = vi.fn();
    render(<CampoDeTexto {...base} alCambiar={alCambiar} />);
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "a" },
    });
    expect(alCambiar).toHaveBeenCalledWith("a");
  });
});

describe("CampoDeContrasena", () => {
  it("Ver y Ocultar alternan el tipo y cambian de nombre", () => {
    render(
      <CampoDeContrasena
        id="c"
        etiqueta="Contraseña"
        valor="x"
        alCambiar={() => {}}
        autocompletar="new-password"
      />,
    );
    const campo = screen.getByLabelText("Contraseña");
    expect(campo).toHaveAttribute("type", "password");
    expect(campo).toHaveAttribute("autocomplete", "new-password");
    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar la contraseña" }),
    );
    expect(campo).toHaveAttribute("type", "text");
    fireEvent.click(
      screen.getByRole("button", { name: "Ocultar la contraseña" }),
    );
    expect(campo).toHaveAttribute("type", "password");
  });

  it("permite pegar", () => {
    render(
      <CampoDeContrasena
        id="c"
        etiqueta="Contraseña"
        valor=""
        alCambiar={() => {}}
        autocompletar="current-password"
      />,
    );
    const pegar = new Event("paste", { bubbles: true, cancelable: true });
    screen.getByLabelText("Contraseña").dispatchEvent(pegar);
    expect(pegar.defaultPrevented).toBe(false);
  });
});

describe("Casilla", () => {
  it("la marca quien la toca y el texto también la marca", () => {
    const alCambiar = vi.fn();
    render(
      <Casilla
        id="m"
        texto="Soy mayor de edad"
        marcada={false}
        alCambiar={alCambiar}
      />,
    );
    const casilla = screen.getByRole("checkbox", { name: "Soy mayor de edad" });
    expect(casilla).not.toBeChecked();
    fireEvent.click(screen.getByText("Soy mayor de edad"));
    expect(alCambiar).toHaveBeenCalledWith(true);
  });

  it("el error queda ligado a la casilla", () => {
    render(
      <Casilla
        id="m"
        texto="Soy mayor de edad"
        marcada={false}
        alCambiar={() => {}}
        error="Falta marcar."
      />,
    );
    expect(screen.getByRole("checkbox")).toHaveAccessibleDescription(
      "Falta marcar.",
    );
  });
});

describe("MensajeDeEstado (E14-PCP 4.16 T11)", () => {
  it("es una región role=status y el aviso entra después de pintarse, sin tomar el foco", async () => {
    render(
      <MensajeDeEstado
        aviso={{ tipo: "logro", titulo: "Listo, confirmamos tu correo." }}
      />,
    );
    const estado = screen.getByRole("status");
    expect(
      await screen.findByText("Listo, confirmamos tu correo."),
    ).toBeVisible();
    // Una sola región viva: el aviso de dentro no es otro role=status.
    expect(screen.getAllByRole("status")).toEqual([estado]);
    expect(estado).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});

describe("cifras (D-123)", () => {
  it("envuelve cada número, también dentro de una hora, y deja el resto igual", () => {
    const { container } = render(
      <p>{cifras("Dentro de 15 minutos, a las 9:40 p. m.")}</p>,
    );
    expect(container).toHaveTextContent(
      "Dentro de 15 minutos, a las 9:40 p. m.",
    );
    expect(
      [...container.querySelectorAll(".cifra")].map((n) => n.textContent),
    ).toEqual(["15", "9:40"]);
  });

  it("un texto sin números no lleva ninguna", () => {
    const { container } = render(<p>{cifras("Sin números")}</p>);
    expect(container.querySelector(".cifra")).toBeNull();
  });
});
