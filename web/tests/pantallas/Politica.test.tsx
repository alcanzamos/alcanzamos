import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Politica } from "../../src/pantallas/Politica";
import { enlaceALaPolitica, type Origen } from "../../src/politica";
import { json, porTexto, simularApi } from "../ayudas";

// PN-68 · Política de tratamiento (E14-PCP 4.11, RF-059, RF-060): informa, sin formulario y sin sesión. Los textos son
// de E14-PCP 4.11, SC-E21-25 (la viñeta de los avisos), D-200 (2) y la frase de D-200, primera respuesta.
const ABRIR = enlaceALaPolitica("/entrar");
const abrir = (desde = "/entrar") =>
  window.history.replaceState(null, "", enlaceALaPolitica(desde as Origen));
const tarjeta = (nombre: string) =>
  screen.getByRole("region", { name: nombre });

beforeEach(() => window.history.replaceState(null, "", ABRIR));

describe("PN-68 · lo que dice", () => {
  it("tiene el título, la versión en palabras y cinco tarjetas con sus títulos, en el orden de E14", () => {
    render(<Politica />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Política de tratamiento",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(porTexto("Versión 1.1 del 12 de noviembre de 2026.")),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      "Quién responde por tus datos",
      "Para qué usamos tus datos",
      "Tus derechos",
      "Dónde guardamos tus datos",
      "Cómo hacer una consulta o un reclamo",
    ]);
    expect(screen.getAllByRole("region")).toHaveLength(5);
  });

  it("la fecha de la versión lleva las cifras en Figtree (D-123)", () => {
    const { container } = render(<Politica />);
    expect(
      [...container.querySelectorAll(".cifra")].map((n) => n.textContent),
    ).toContain("2026");
  });

  it("«Quién responde»: la frase propuesta del proyecto primero, después las dos de E14", () => {
    render(<Politica />);
    const parrafos = within(tarjeta("Quién responde por tus datos"))
      .getAllByText(/./)
      .filter((n) => n.tagName === "P")
      .map((n) => n.textContent);
    expect(parrafos).toEqual([
      "Alcanzamos, proyecto de Andrés Jiménez.",
      "Andrés Jiménez, dueño de Alcanzamos.",
      "Correo: privacidad@alcanzamos.co.",
    ]);
  });

  it("«Para qué usamos tus datos»: necesarias y opcionales con su texto, y cierra con la frase de D-200", () => {
    render(<Politica />);
    const t = within(tarjeta("Para qué usamos tus datos"));
    const grupos = t.getAllByRole("group");
    expect(grupos[0]).toHaveAccessibleName("Necesarias");
    expect(grupos[1]).toHaveAccessibleName("Opcionales");
    expect(grupos).toHaveLength(2);
    const nombres = (g: HTMLElement) =>
      within(g)
        .getAllByRole("listitem")
        .map((i) => i.querySelector(".fila__nombre")?.textContent);
    expect(nombres(grupos[0]!)).toEqual([
      "Cuenta y acceso",
      "Funciones financieras",
      "Cuenta de un menor",
    ]);
    expect(nombres(grupos[1]!)).toEqual([
      "Avisos con la app cerrada",
      "Horas de vida",
      "Correo del menor",
    ]);
    for (const texto of [
      "Usamos tu correo, tu contraseña y tu nombre para crear tu cuenta, dejarte entrar y ayudarte a recuperar el acceso.",
      "Usamos lo que registras —movimientos, presupuestos, deudas y metas— para calcular tu plata disponible, avisarte de un faltante y mostrarte tus resúmenes.",
      "Usamos los datos de la cuenta de un niño, niña o adolescente a tu cargo para que pueda usar la app con tu acompañamiento. Tú respondes por esa cuenta porque tienes su tutoría.",
      "Usamos un código de tu teléfono para enviarte avisos aunque la app esté cerrada. El aviso solo dice «Tienes un aviso en Alcanzamos.» y no lleva cifras ni nombres.",
      "Usamos tu ingreso y tus horas de trabajo para mostrarte cuánto tiempo de tu vida cuesta un gasto. Está apagado hasta que lo actives. Es solo para personas adultas.",
      "Si tienes menos de 18 años y estás por cumplirlos, puedes dar un correo, con permiso de tu tutor. Lo usamos solo para que puedas entrar con él cuando cumplas 18.",
    ])
      expect(t.getByText(texto)).toBeInTheDocument();
    const ultima = tarjeta("Para qué usamos tus datos").lastElementChild;
    expect(ultima).toHaveTextContent(
      "No vendemos tus datos ni los usamos para mostrarte publicidad de terceros.",
    );
  });

  it("«Para qué usamos tus datos» no lista la transmisión a los encargados (la cubre «Dónde guardamos tus datos»)", () => {
    render(<Politica />);
    expect(
      within(tarjeta("Para qué usamos tus datos")).queryByText(
        /encargad|Dónde guardamos/,
      ),
    ).not.toBeInTheDocument();
  });

  it("«Tus derechos»: «Puedes:» y las seis viñetas de E14", () => {
    render(<Politica />);
    const t = within(tarjeta("Tus derechos"));
    expect(t.getByText("Puedes:")).toBeInTheDocument();
    expect(t.getAllByRole("listitem").map((i) => i.textContent)).toEqual([
      "conocer qué datos tuyos tenemos y para qué los usamos;",
      "corregir o actualizar tus datos;",
      "pedir que borremos tus datos;",
      "retirar tu autorización cuando quieras;",
      "pedir la prueba de tu autorización: la versión del texto y la fecha;",
      "presentar una queja ante la Superintendencia de Industria y Comercio.",
    ]);
  });

  // SC-E21-25 3.8, criterio 7 (RF-059): cada encargado con su país o con la indicación de que no lo informa.
  it("«Dónde guardamos tus datos» nombra a cada encargado con su país y dice que las empresas de avisos no informan el suyo", () => {
    render(<Politica />);
    const items = within(tarjeta("Dónde guardamos tus datos"))
      .getAllByRole("listitem")
      .map((i) => i.textContent);
    expect(items).toEqual([
      "Tus datos se guardan en Microsoft Azure, en México.",
      "El correo que te enviamos (verificar tu cuenta, recuperar el acceso, avisos a quien tiene una tutoría) sale por Azure Communication Services, que guarda sus datos en Francia.",
      "Lo que escribes a privacidad@alcanzamos.co queda en Zoho Mail, en Estados Unidos.",
      "Estas empresas son encargadas: tratan los datos por cuenta de Alcanzamos, que es el responsable, y solo para lo que les pedimos.",
      "Si activas los avisos con la app cerrada, el código de tu teléfono o de tu navegador y un aviso que solo dice «Tienes un aviso en Alcanzamos.» pasan por el servicio de notificaciones de Google (Firebase Cloud Messaging) en Android, o por el de la empresa que hace tu navegador en la web. Esas empresas no dicen en qué país los procesan.",
    ]);
    expect(items.join(" ")).not.toContain(
      "Todavía no confirmamos en qué país guardan ese código.",
    );
  });

  it("«Cómo hacer una consulta o un reclamo»: qué traer, el menor, y los plazos de E14", () => {
    render(<Politica />);
    const t = within(tarjeta("Cómo hacer una consulta o un reclamo"));
    expect(
      t.getByText(
        "Escribe al correo privacidad@alcanzamos.co. En tu mensaje, cuéntanos:",
      ),
    ).toBeInTheDocument();
    expect(t.getAllByRole("listitem").map((i) => i.textContent)).toEqual([
      "tu nombre y el correo de tu cuenta;",
      "si es una consulta o un reclamo;",
      "qué quieres saber o qué quieres corregir.",
      "Una consulta: máximo 10 días hábiles desde que la recibimos. Si necesitamos más tiempo, te contamos el motivo y la nueva fecha. Serían máximo 5 días hábiles más.",
      "Un reclamo: máximo 15 días hábiles desde el día siguiente a que lo recibimos. Si necesitamos más tiempo, te contamos el motivo y la nueva fecha. Serían máximo 8 días hábiles más.",
      "Si tu reclamo llega incompleto, te lo decimos en los 5 días siguientes para que lo completes. Si pasan 2 meses sin que lo completes, entendemos que ya no lo necesitas.",
    ]);
    expect(
      t.getByText(
        "Si escribes por un menor a tu cargo, dinos su nombre. Si no tienes cuenta y quieres que quitemos tu nombre de una deuda que otra persona registró, escribe al mismo correo.",
      ),
    ).toBeInTheDocument();
    expect(t.getByText("Cuánto tardamos.")).toBeInTheDocument();
  });

  it("«Escribir al correo» abre el correo con la dirección y no hay formulario ni campos", () => {
    render(<Politica />);
    const enlace = screen.getByRole("link", { name: "Escribir al correo" });
    expect(enlace).toHaveAttribute("href", "mailto:privacidad@alcanzamos.co");
    expect(enlace).toHaveClass("boton--secundario");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(document.querySelector("form")).toBeNull();
  });

  it("«Escribir al correo» no navega dentro de la app (lo abre el sistema)", () => {
    render(<Politica />);
    window.history.replaceState(null, "", ABRIR);
    const antes = window.location.href;
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen
      .getByRole("link", { name: "Escribir al correo" })
      .dispatchEvent(clic);
    expect(clic.defaultPrevented).toBe(false);
    expect(window.location.href).toBe(antes);
  });

  it("no pide nada al API: es texto estático, sin sesión", () => {
    const pedidos = simularApi(() => json(200, {}));
    render(<Politica />);
    expect(pedidos).toHaveLength(0);
  });

  it("el título de la pestaña es el de la pantalla", () => {
    render(<Politica />);
    expect(document.title).toBe("Política de tratamiento · Alcanzamos");
  });
});

describe("PN-68 · Atrás y la barra lateral según de dónde se abre", () => {
  it.each([
    ["/entrar", false],
    ["/crear-cuenta", false],
    ["/privacidad", false],
    ["/autorizacion", false],
    ["/cuenta/privacidad", true],
    ["/cuenta/seguridad", true],
  ])("desde %s: Atrás vuelve ahí; barra lateral: %s", (desde, lateral) => {
    abrir(desde);
    render(<Politica />);
    const atras = screen.getByRole("link", { name: "Atrás" });
    expect(atras).toHaveAttribute("href", desde);
    if (lateral)
      expect(
        within(screen.getByRole("navigation")).getByRole("link", {
          name: "Registrar",
        }),
      ).toBeInTheDocument();
    else expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    fireEvent.click(atras);
    expect(window.location.pathname).toBe(desde);
  });

  it("con la barra lateral, sin destino activo", () => {
    abrir("/cuenta/seguridad");
    render(<Politica />);
    for (const enlace of within(screen.getByRole("navigation")).getAllByRole(
      "link",
    ))
      expect(enlace).not.toHaveAttribute("aria-current");
  });

  it.each(["", "?desde=/movimientos", "?desde=https://ejemplo.com"])(
    "sin un origen permitido (%j): Atrás a PN-60 y sin barra lateral",
    (busqueda) => {
      window.history.replaceState(null, "", `/politica${busqueda}`);
      render(<Politica />);
      expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
        "href",
        "/entrar",
      );
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    },
  );
});

describe("PN-68 · sin estado de carga", () => {
  it("no hay mensaje de estado ni «Intentar de nuevo»", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<Politica />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Intentar de nuevo" }),
    ).not.toBeInTheDocument();
  });
});
