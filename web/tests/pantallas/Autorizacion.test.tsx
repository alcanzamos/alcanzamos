import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Autorizacion } from "../../src/pantallas/Autorizacion";
import { json, porTexto, simularApi, type Pedido } from "../ayudas";

const finalidad = (codigo: string, tipo: string) => ({
  codigo,
  tipo,
  otorgada: false,
});
const catalogo = (extra: unknown[] = [], fecha = "2026-11-12") => ({
  version: { numero: "1.1", fecha },
  modo: "completo",
  finalidades: [
    finalidad("cuenta_y_acceso", "necesaria"),
    finalidad("funciones_financieras", "necesaria"),
    finalidad("transmision_a_encargados", "necesaria"),
    finalidad("avisos", "accesoria"),
    finalidad("horas_de_vida", "accesoria"),
    ...extra,
  ],
});
// SC-E21-25 sección 5: la cuenta de antes del cambio recibe solo la aceptación que le falta.
const catalogoLimitado = () => ({
  version: { numero: "1.1", fecha: "2026-11-12" },
  modo: "falta_una_aceptacion",
  finalidades: [finalidad("transmision_a_encargados", "necesaria")],
});

const NECESARIAS =
  "Autorizo el uso de mis datos para estas finalidades necesarias.";
const TRANSMISION =
  "Acepto que mis datos se envíen a estos servicios en México, Francia y Estados Unidos para guardarlos y procesarlos como se explica arriba.";
const ERROR_TRANSMISION = "Falta que aceptes dónde guardamos tus datos.";
const ERROR_NECESARIAS = "Falta tu autorización para lo necesario.";
const FRASE_DE_AVISOS =
  "Si activas los avisos con la app cerrada, el código de tu teléfono o de tu navegador y un aviso que solo dice «Tienes un aviso en Alcanzamos.» pasan por el servicio de notificaciones de Google (Firebase Cloud Messaging) en Android, o por el de la empresa que hace tu navegador en la web. Esas empresas no dicen en qué país los procesan.";
const AVISOS = "Autorizo los avisos con la app cerrada.";
const HORAS = "Autorizo mostrar el costo de un gasto en horas de vida.";

/** El API de PN-64: el catálogo y lo demás según `otros`. */
const api = (
  otros: (pedido: Pedido) => Response = () =>
    json(200, { estado: "autorizada" }),
  cat: unknown = catalogo(),
) =>
  simularApi((pedido) =>
    pedido.metodo === "GET" ? json(200, cat) : otros(pedido),
  );

async function cargada() {
  render(<Autorizacion />);
  await screen.findByRole("checkbox", { name: NECESARIAS });
}
const marcar = (nombre: string) =>
  fireEvent.click(screen.getByRole("checkbox", { name: nombre }));
/** Las dos casillas necesarias del modo completo: lo necesario y «Dónde guardamos tus datos». */
const marcarLasNecesarias = () => {
  marcar(NECESARIAS);
  marcar(TRANSMISION);
};
const tocar = (nombre: string) =>
  fireEvent.click(screen.getByRole("button", { name: nombre }));
const tarjeta = (nombre: string) =>
  screen.getByRole("region", { name: nombre });

describe("PN-64 · Autorización de datos", () => {
  describe("lo que se ve", () => {
    it("pide el catálogo y muestra los textos de E14 (filas 1 a 12)", async () => {
      const pedidos = api();
      await cargada();
      expect(pedidos[0]).toMatchObject({
        metodo: "GET",
        ruta: "/api/v1/autorizaciones",
      });
      expect(
        screen.getByRole("heading", { level: 1, name: "Tu autorización" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Necesitamos tu permiso para usar algunos datos. Lee con calma y decide.",
        ),
      ).toBeInTheDocument();
      for (const texto of [
        "Cuenta y acceso",
        "Usamos tu correo, tu contraseña y tu nombre para crear tu cuenta, dejarte entrar y ayudarte a recuperar el acceso.",
        "Funciones financieras",
        "Usamos lo que registras —movimientos, presupuestos, deudas y metas— para calcular tu plata disponible, avisarte de un faltante y mostrarte tus resúmenes.",
        "Avisos con la app cerrada",
        "Usamos un código de tu teléfono para enviarte avisos aunque la app esté cerrada. El aviso solo dice «Tienes un aviso en Alcanzamos.» y no lleva cifras ni nombres.",
        "Horas de vida",
        "Usamos tu ingreso y tus horas de trabajo para mostrarte cuánto tiempo de tu vida cuesta un gasto. Está apagado hasta que lo actives. Es solo para personas adultas.",
        "Sin esta autorización no podemos darte la cuenta. Si no autorizas, borramos al momento el correo que nos diste.",
        "Puedes decir que no. La app funciona igual. Lo cambias cuando quieras en Preferencias.",
      ])
        expect(screen.getByText(texto)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Autorizar y continuar" }),
      ).toHaveClass("boton--primario");
      expect(screen.getByRole("button", { name: "No autorizo" })).toHaveClass(
        "boton--secundario",
      );
    });

    it("lleva tres tarjetas, en el orden de E14: lo necesario, «Dónde guardamos tus datos» y lo que se puede elegir", async () => {
      api();
      await cargada();
      expect(
        screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual([
        "Lo necesario para usar la app",
        "Dónde guardamos tus datos",
        "Lo que puedes elegir",
      ]);
    });

    it("lleva dos tarjetas separadas: lo necesario y lo que se puede elegir", async () => {
      api();
      await cargada();
      const necesario = screen.getByRole("region", {
        name: "Lo necesario para usar la app",
      });
      const opcional = screen.getByRole("region", {
        name: "Lo que puedes elegir",
      });
      expect(necesario).toHaveTextContent("Funciones financieras");
      // La transmisión a los encargados no es una fila de «Lo necesario»: tiene su tarjeta (SC-E21-25 3.6).
      expect(necesario).not.toHaveTextContent("Dónde guardamos");
      expect(necesario).not.toHaveTextContent("Horas de vida");
      expect(opcional).toHaveTextContent("Avisos con la app cerrada");
      expect(opcional).toHaveTextContent("Horas de vida");
      expect(opcional).not.toHaveTextContent("Cuenta y acceso");
    });

    it("ninguna casilla viene marcada (RF-063): lo necesario, la transmisión y una por cada accesoria", async () => {
      api();
      await cargada();
      const casillas = screen.getAllByRole("checkbox");
      expect(casillas.map((c) => c.getAttribute("id"))).toEqual([
        "necesarias",
        "transmision",
        "finalidad-avisos",
        "finalidad-horas_de_vida",
      ]);
      for (const c of casillas) expect(c).not.toBeChecked();
      marcar(NECESARIAS);
      expect(
        screen.getByRole("checkbox", { name: TRANSMISION }),
      ).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: AVISOS })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: HORAS })).not.toBeChecked();
    });

    // SC-E21-25 3.6 (aprobada por el dueño, 2026-11-11): título, explicación, casilla sin marcar, nota y error.
    it("la tarjeta «Dónde guardamos tus datos» lleva la explicación, su casilla y su nota, aprobadas", async () => {
      api();
      await cargada();
      const t = within(tarjeta("Dónde guardamos tus datos"));
      expect(
        t.getByText(
          "Para que la app funcione, tus datos se guardan y se procesan en la nube de otras empresas, que los tratan por cuenta de Alcanzamos y solo para lo que les pedimos: Microsoft Azure, en México, guarda tu cuenta y lo que registras; Azure Communication Services, en Francia, envía los correos de la app; y Zoho Mail, en Estados Unidos, recibe lo que escribes a privacidad@alcanzamos.co. Los detalles están en la política.",
        ),
      ).toBeInTheDocument();
      // Solo Azure, Azure Communication Services y Zoho: los avisos no van en la tarjeta obligatoria (D-202).
      expect(tarjeta("Dónde guardamos tus datos")).not.toHaveTextContent(
        /Firebase|Google|navegador/,
      );
      const casilla = screen.getByRole("checkbox", { name: TRANSMISION });
      expect(casilla).not.toBeChecked();
      expect(casilla).toHaveAccessibleDescription(
        "Sin esta aceptación no podemos darte la cuenta, porque la app guarda tus datos en esos servicios.",
      );
      expect(
        screen.getByText(
          "Sin esta aceptación no podemos darte la cuenta, porque la app guarda tus datos en esos servicios.",
        ),
      ).toHaveClass("ayuda");
    });

    // SC-E21-25 3.6: justo debajo de «Autorizo los avisos con la app cerrada.» y antes de la casilla de horas de vida.
    it("la frase de los avisos con la app cerrada va bajo su casilla, antes de «Horas de vida», y la describe", async () => {
      api();
      await cargada();
      const frase = screen.getByText(FRASE_DE_AVISOS);
      expect(frase).toHaveClass("ayuda");
      const avisos = screen.getByRole("checkbox", { name: AVISOS });
      expect(avisos).toHaveAccessibleDescription(FRASE_DE_AVISOS);
      expect(
        avisos.compareDocumentPosition(frase) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        frase.compareDocumentPosition(
          screen.getByRole("checkbox", { name: HORAS }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // La casilla y su texto no cambian, y la frase no va en la tarjeta de lo necesario ni en la de lo que se elige.
      expect(avisos).not.toBeChecked();
      expect(tarjeta("Lo necesario para usar la app")).not.toHaveTextContent(
        "Firebase",
      );
      expect(tarjeta("Lo que puedes elegir")).not.toHaveTextContent("Firebase");
      expect(screen.getAllByText(FRASE_DE_AVISOS)).toHaveLength(1);
    });

    it("la casilla de horas de vida no lleva frase", async () => {
      api();
      await cargada();
      expect(screen.getByRole("checkbox", { name: HORAS })).not.toHaveAttribute(
        "aria-describedby",
      );
    });

    it("las casillas tienen etiqueta y no traen error al llegar", async () => {
      api();
      await cargada();
      for (const nombre of [NECESARIAS, TRANSMISION, AVISOS, HORAS])
        expect(
          screen.getByRole("checkbox", { name: nombre }),
        ).not.toBeInvalid();
      expect(
        screen.queryByText(/Falta tu autorización/),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(ERROR_TRANSMISION)).not.toBeInTheDocument();
    });

    it("la versión sale del API y la fecha va en palabras, con las cifras en Figtree (D-090, D-123)", async () => {
      const { container } = (api(), render(<Autorizacion />));
      expect(
        await screen.findByText(
          porTexto("Texto versión 1.1 del 12 de noviembre de 2026."),
        ),
      ).toBeInTheDocument();
      expect(
        [...container.querySelectorAll(".cifra")].map((n) => n.textContent),
      ).toContain("2026");
    });

    it("otra versión del API cambia la frase", async () => {
      simularApi(() =>
        json(200, {
          ...catalogo(),
          version: { numero: "2.1", fecha: "2027-01-05" },
        }),
      );
      render(<Autorizacion />);
      expect(
        await screen.findByText(
          porTexto("Texto versión 2.1 del 5 de enero de 2027."),
        ),
      ).toBeInTheDocument();
    });

    it("la barra lleva Atrás a PN-63", async () => {
      api();
      await cargada();
      expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
        "href",
        "/privacidad",
      );
    });
  });

  // E14-PCP 4.7, fila 10 (D-195): «Leer la política completa» abre PN-68 con la versión del texto que se está viendo.
  describe("«Leer la política completa» (PN-68)", () => {
    it("es un botón de texto, después de la versión y antes de «Autorizar y continuar»", async () => {
      api();
      await cargada();
      const enlace = screen.getByRole("link", {
        name: "Leer la política completa",
      });
      expect(enlace).toHaveClass("boton--texto");
      expect(enlace).toHaveAttribute("href", "/politica?desde=%2Fautorizacion");
      const version = screen.getByText(
        porTexto("Texto versión 1.1 del 12 de noviembre de 2026."),
      );
      expect(
        version.compareDocumentPosition(enlace) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        enlace.compareDocumentPosition(
          screen.getByRole("button", { name: "Autorizar y continuar" }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("abre PN-68 y la versión que muestra es la del texto que PN-64 mostraba", async () => {
      api();
      await cargada();
      fireEvent.click(
        screen.getByRole("link", { name: "Leer la política completa" }),
      );
      expect(window.location.pathname).toBe("/politica");
      expect(window.location.search).toBe("?desde=%2Fautorizacion");
    });

    it("al volver de PN-68 las casillas conservan lo que la persona había marcado", async () => {
      api();
      const { unmount } = render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: NECESARIAS });
      marcar(TRANSMISION);
      marcar(AVISOS);
      fireEvent.click(
        screen.getByRole("link", { name: "Leer la política completa" }),
      );
      unmount();
      api();
      render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: NECESARIAS });
      expect(
        screen.getByRole("checkbox", { name: NECESARIAS }),
      ).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: TRANSMISION })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: AVISOS })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: HORAS })).not.toBeChecked();
    });

    it("al llegar de otra pantalla ninguna casilla viene marcada, aunque antes se hubiera marcado alguna", async () => {
      api();
      const { unmount } = render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: NECESARIAS });
      marcar(NECESARIAS);
      window.history.replaceState(null, "", "/privacidad");
      unmount();
      api();
      render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: NECESARIAS });
      for (const c of screen.getAllByRole("checkbox"))
        expect(c).not.toBeChecked();
    });

    it("lo guardado se usa una sola vez: la siguiente llegada empieza sin marcar", async () => {
      api();
      const primera = render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: NECESARIAS });
      marcar(NECESARIAS);
      window.history.replaceState(null, "", "/politica?desde=%2Fautorizacion");
      primera.unmount();
      api();
      const segunda = render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: NECESARIAS });
      expect(screen.getByRole("checkbox", { name: NECESARIAS })).toBeChecked();
      window.history.replaceState(null, "", "/privacidad");
      segunda.unmount();
      api();
      render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: NECESARIAS });
      expect(
        screen.getByRole("checkbox", { name: NECESARIAS }),
      ).not.toBeChecked();
    });
  });

  describe("autorizar", () => {
    it("sin nada marcado muestra los dos errores, cada uno junto a su casilla, con el foco en la primera, y no pide nada", async () => {
      const pedidos = api();
      await cargada();
      tocar("Autorizar y continuar");
      const casilla = screen.getByRole("checkbox", { name: NECESARIAS });
      expect(casilla).toBeInvalid();
      const error = screen.getByText(ERROR_NECESARIAS);
      expect(casilla).toHaveAccessibleDescription(ERROR_NECESARIAS);
      expect(error.closest("p")).toHaveAttribute("id", "necesarias-error");
      const transmision = screen.getByRole("checkbox", { name: TRANSMISION });
      expect(transmision).toBeInvalid();
      expect(screen.getByText(ERROR_TRANSMISION).closest("p")).toHaveAttribute(
        "id",
        "transmision-error",
      );
      // El error va antes de la nota que describe la casilla (SC-E21-25 3.6: el error bajo la casilla).
      expect(transmision).toHaveAccessibleDescription(
        `${ERROR_TRANSMISION} Sin esta aceptación no podemos darte la cuenta, porque la app guarda tus datos en esos servicios.`,
      );
      expect(casilla).toHaveFocus();
      expect(pedidos).toHaveLength(1);
      expect(window.location.pathname).toBe("/");
    });

    // SC-E21-25 3.8, criterio 1: sin marcar la tarjeta, no se guarda ninguna autorización.
    it("con lo necesario marcado y sin «Dónde guardamos tus datos»: solo el error de la transmisión, con el foco ahí, y no se guarda nada", async () => {
      const pedidos = api();
      await cargada();
      marcar(NECESARIAS);
      marcar(AVISOS);
      tocar("Autorizar y continuar");
      expect(screen.getByText(ERROR_TRANSMISION)).toBeInTheDocument();
      expect(screen.queryByText(ERROR_NECESARIAS)).not.toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: TRANSMISION })).toHaveFocus();
      expect(pedidos).toHaveLength(1);
      expect(window.location.pathname).toBe("/");
    });

    it("con «Dónde guardamos tus datos» marcada y sin lo necesario: solo el error de lo necesario", async () => {
      const pedidos = api();
      await cargada();
      marcar(TRANSMISION);
      tocar("Autorizar y continuar");
      expect(screen.getByText(ERROR_NECESARIAS)).toBeInTheDocument();
      expect(screen.queryByText(ERROR_TRANSMISION)).not.toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: NECESARIAS })).toHaveFocus();
      expect(pedidos).toHaveLength(1);
    });

    it("el botón no se deshabilita con el error y cada error se va al marcar su casilla", async () => {
      api();
      await cargada();
      tocar("Autorizar y continuar");
      expect(
        screen.getByRole("button", { name: "Autorizar y continuar" }),
      ).not.toHaveAttribute("aria-disabled");
      marcar(NECESARIAS);
      expect(screen.queryByText(ERROR_NECESARIAS)).not.toBeInTheDocument();
      expect(screen.getByText(ERROR_TRANSMISION)).toBeInTheDocument();
      marcar(TRANSMISION);
      expect(screen.queryByText(ERROR_TRANSMISION)).not.toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: TRANSMISION })).toBeValid();
    });

    it("marcar solo una accesoria no basta: sigue pidiendo lo necesario", async () => {
      const pedidos = api();
      await cargada();
      marcar(AVISOS);
      tocar("Autorizar y continuar");
      expect(screen.getByText(ERROR_NECESARIAS)).toBeInTheDocument();
      expect(pedidos).toHaveLength(1);
    });

    // SC-E21-25 3.8, criterio 2 (L3 de la US-67): la versión es la del catálogo y se mandan las tres necesarias.
    it("con las dos casillas manda las tres necesarias y la versión, sin accesorias, y va a PN-71", async () => {
      const pedidos = api();
      await cargada();
      marcarLasNecesarias();
      tocar("Autorizar y continuar");
      await waitFor(() =>
        expect(window.location.pathname).toBe("/cuenta/seguridad"),
      );
      expect(pedidos[1]).toEqual({
        metodo: "POST",
        ruta: "/api/v1/autorizaciones",
        cuerpo: {
          finalidades: [
            "cuenta_y_acceso",
            "funciones_financieras",
            "transmision_a_encargados",
          ],
          version: "1.1",
        },
      });
    });

    it("suma solo las accesorias que la persona marcó", async () => {
      const pedidos = api();
      await cargada();
      marcarLasNecesarias();
      marcar(AVISOS);
      tocar("Autorizar y continuar");
      await waitFor(() => expect(pedidos).toHaveLength(2));
      expect(pedidos[1]?.cuerpo).toEqual({
        finalidades: [
          "cuenta_y_acceso",
          "funciones_financieras",
          "transmision_a_encargados",
          "avisos",
        ],
        version: "1.1",
      });
    });

    it("una accesoria desmarcada no se manda", async () => {
      const pedidos = api();
      await cargada();
      marcarLasNecesarias();
      marcar(HORAS);
      marcar(HORAS);
      tocar("Autorizar y continuar");
      await waitFor(() => expect(pedidos).toHaveLength(2));
      expect(pedidos[1]?.cuerpo).toEqual({
        finalidades: [
          "cuenta_y_acceso",
          "funciones_financieras",
          "transmision_a_encargados",
        ],
        version: "1.1",
      });
    });

    it("no manda dos veces mientras el pedido está en curso", async () => {
      let soltar: () => void = () => {};
      const pedidos = simularApi((pedido) =>
        pedido.metodo === "GET"
          ? json(200, catalogo())
          : (new Promise<Response>((resolver) => {
              soltar = () => resolver(json(200, { estado: "autorizada" }));
            }) as unknown as Response),
      );
      await cargada();
      marcarLasNecesarias();
      tocar("Autorizar y continuar");
      tocar("Autorizar y continuar");
      await waitFor(() => expect(pedidos).toHaveLength(2));
      soltar();
      await waitFor(() =>
        expect(window.location.pathname).toBe("/cuenta/seguridad"),
      );
      expect(pedidos).toHaveLength(2);
    });
  });

  describe("errores al autorizar", () => {
    const errorDeGuardar = "No pudimos guardar tu autorización.";

    async function enviarConError(respuesta: () => Response) {
      const pedidos = api(respuesta);
      await cargada();
      marcarLasNecesarias();
      marcar(AVISOS);
      tocar("Autorizar y continuar");
      return pedidos;
    }

    it.each([
      [422, { error: "faltan_necesarias" }],
      [422, { error: "finalidad_invalida" }],
      [500, { error: "interno" }],
      [403, { error: "otro" }],
    ])(
      "%i %j: el error de envío de E14, con lo marcado conservado",
      async (estado, cuerpo) => {
        await enviarConError(() => json(estado, cuerpo));
        const aviso = await screen.findByRole("status");
        expect(aviso).toHaveTextContent(errorDeGuardar);
        expect(aviso).toHaveTextContent("Intenta de nuevo.");
        expect(aviso).toHaveFocus();
        expect(
          screen.getByRole("checkbox", { name: NECESARIAS }),
        ).toBeChecked();
        expect(
          screen.getByRole("checkbox", { name: TRANSMISION }),
        ).toBeChecked();
        expect(screen.getByRole("checkbox", { name: AVISOS })).toBeChecked();
        expect(window.location.pathname).toBe("/");
      },
    );

    it("409 version_desactualizada: vuelve a pedir el catálogo y usa la versión nueva", async () => {
      let versión = "1.1";
      let publicada = "2026-11-12";
      const pedidos = simularApi((pedido) => {
        if (pedido.metodo === "GET")
          return json(200, {
            ...catalogo([], publicada),
            version: { numero: versión, fecha: publicada },
          });
        if ((pedido.cuerpo as { version: string }).version === "1.1") {
          versión = "1.2";
          publicada = "2026-11-15";
          return json(409, { error: "version_desactualizada" });
        }
        return json(200, { estado: "autorizada" });
      });
      await cargada();
      marcarLasNecesarias();
      marcar(AVISOS);
      tocar("Autorizar y continuar");
      expect(await screen.findByRole("status")).toHaveTextContent(
        errorDeGuardar,
      );
      expect(
        await screen.findByText(
          porTexto("Texto versión 1.2 del 15 de noviembre de 2026."),
        ),
      ).toBeInTheDocument();
      expect(pedidos.map((p) => p.metodo)).toEqual(["GET", "POST", "GET"]);
      // Lo marcado se conserva y la persona reintenta con la versión nueva.
      expect(screen.getByRole("checkbox", { name: AVISOS })).toBeChecked();
      tocar("Autorizar y continuar");
      await waitFor(() =>
        expect(window.location.pathname).toBe("/cuenta/seguridad"),
      );
      expect(pedidos[3]?.cuerpo).toMatchObject({ version: "1.2" });
    });

    it("sin conexión: el aviso de T10 y las casillas conservan lo marcado", async () => {
      simularApi((pedido) => {
        if (pedido.metodo === "GET") return json(200, catalogo());
        throw new TypeError("sin red");
      });
      await cargada();
      marcarLasNecesarias();
      tocar("Autorizar y continuar");
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      );
      expect(screen.getByRole("checkbox", { name: NECESARIAS })).toBeChecked();
    });

    it("429: demasiados intentos", async () => {
      await enviarConError(() => json(429, { error: "demasiados_intentos" }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      );
    });

    it("401 lleva a PN-60 («Tu sesión se cerró»)", async () => {
      await enviarConError(() => json(401, { error: "sin_sesion" }));
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(window.history.state).toEqual({ llegada: "sesion_cerrada" });
    });
  });

  describe("«No autorizo»", () => {
    const rechazo = { metodo: "POST", ruta: "/api/v1/autorizaciones/rechazo" };

    it("llama al rechazo, sin cuerpo, y va a PN-60 con «Borramos el correo que nos diste.»", async () => {
      const pedidos = api(() => new Response(null, { status: 204 }));
      await cargada();
      tocar("No autorizo");
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(pedidos[1]).toMatchObject({ ...rechazo, cuerpo: undefined });
      expect(window.history.state).toEqual({ llegada: "cuenta_borrada" });
    });

    it("no pide una confirmación extra ni exige marcar nada", async () => {
      const pedidos = api(() => new Response(null, { status: 204 }));
      await cargada();
      tocar("No autorizo");
      await waitFor(() => expect(pedidos).toHaveLength(2));
      expect(
        screen.queryByText("Falta tu autorización para lo necesario."),
      ).not.toBeInTheDocument();
    });

    it.each([
      ["sin conexión", undefined],
      ["error del servidor", json(500, { error: "interno" })],
    ])(
      "%s: dice que todavía no pudo borrar y no sigue",
      async (_caso, respuesta) => {
        simularApi((pedido) => {
          if (pedido.metodo === "GET") return json(200, catalogo());
          if (!respuesta) throw new TypeError("sin red");
          return respuesta;
        });
        await cargada();
        tocar("No autorizo");
        const aviso = await screen.findByRole("status");
        expect(aviso).toHaveTextContent(
          "Todavía no pudimos borrar tu correo. Intenta de nuevo.",
        );
        expect(aviso).toHaveFocus();
        expect(window.location.pathname).toBe("/");
      },
    );

    it("429: demasiados intentos", async () => {
      api(() => json(429, { error: "demasiados_intentos" }));
      await cargada();
      tocar("No autorizo");
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      );
    });

    it("401 lleva a PN-60 («Tu sesión se cerró»)", async () => {
      api(() => json(401, { error: "sin_sesion" }));
      await cargada();
      tocar("No autorizo");
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(window.history.state).toEqual({ llegada: "sesion_cerrada" });
    });

    it("403 ya_autorizada (otra pestaña autorizó): la cuenta sigue y va a PN-71", async () => {
      api(() => json(403, { error: "ya_autorizada" }));
      await cargada();
      tocar("No autorizo");
      await waitFor(() =>
        expect(window.location.pathname).toBe("/cuenta/seguridad"),
      );
    });
  });

  describe("el catálogo no carga o no se entiende", () => {
    const errorDeCarga = "No pudimos cargar la información.";

    it.each([
      ["500", () => json(500, { error: "interno" })],
      [
        "una finalidad que E14 no tiene",
        () => json(200, catalogo([finalidad("otra", "accesoria")])),
      ],
      [
        "un tipo desconocido",
        () => json(200, catalogo([finalidad("avisos", "rara")])),
      ],
      [
        "una accesoria de la que E14 no tiene casilla",
        () => json(200, catalogo([finalidad("cuenta_y_acceso", "accesoria")])),
      ],
      [
        "sin necesarias ni la transmisión",
        () =>
          json(200, {
            version: { numero: "1.1", fecha: "2026-11-12" },
            modo: "completo",
            finalidades: [finalidad("avisos", "accesoria")],
          }),
      ],
      [
        "una finalidad desconocida en el modo falta_una_aceptacion",
        () =>
          json(200, {
            ...catalogoLimitado(),
            finalidades: [finalidad("otra", "necesaria")],
          }),
      ],
      [
        "un modo que no conoce",
        () => json(200, { ...catalogo(), modo: "otro" }),
      ],
      [
        "un catálogo sin modo",
        () => json(200, { version: catalogo().version, finalidades: [] }),
      ],
      [
        "la transmisión como accesoria",
        () =>
          json(200, {
            ...catalogo(),
            finalidades: [
              ...catalogo().finalidades.filter(
                (f) =>
                  (f as { codigo: string }).codigo !==
                  "transmision_a_encargados",
              ),
              finalidad("transmision_a_encargados", "accesoria"),
            ],
          }),
      ],
      ["una fecha que no es fecha", () => json(200, catalogo([], "mañana"))],
      ["sin versión", () => json(200, { modo: "completo", finalidades: [] })],
      [
        "finalidades que no son una lista",
        () =>
          json(200, {
            version: { numero: "1.1", fecha: "2026-11-12" },
            modo: "completo",
            finalidades: "x",
          }),
      ],
    ])("%s: error de carga, sin formulario", async (_caso, respuesta) => {
      simularApi(respuesta);
      render(<Autorizacion />);
      expect(await screen.findByText(errorDeCarga)).toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Intentar de nuevo" }),
      ).toBeInTheDocument();
    });

    it("sin conexión dice T10", async () => {
      simularApi(() => {
        throw new TypeError("sin red");
      });
      render(<Autorizacion />);
      expect(
        await screen.findByText(
          "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
        ),
      ).toBeInTheDocument();
    });

    it("«Intentar de nuevo» vuelve a pedir y muestra el formulario", async () => {
      let intento = 0;
      const pedidos = simularApi(() =>
        ++intento === 1
          ? json(500, { error: "interno" })
          : json(200, catalogo()),
      );
      render(<Autorizacion />);
      await screen.findByText(errorDeCarga);
      tocar("Intentar de nuevo");
      expect(
        await screen.findByRole("checkbox", { name: NECESARIAS }),
      ).not.toBeChecked();
      expect(pedidos).toHaveLength(2);
    });

    it.each([[401, { error: "sin_sesion" }, "/entrar"]])(
      "%i %j lleva a %s",
      async (estado, cuerpo, destino) => {
        simularApi(() => json(estado, cuerpo));
        render(<Autorizacion />);
        await waitFor(() => expect(window.location.pathname).toBe(destino));
      },
    );
  });

  // SC-E21-25 sección 5, paso 2 y 3.8, criterio 6: la cuenta de antes del cambio ve solo la tarjeta que le falta y, al
  // aceptar, llega a Inicio con todos sus datos (hoy PN-71, como al entrar).
  describe("el modo «falta una aceptación»", () => {
    const apiLimitada = (
      otros: (pedido: Pedido) => Response = () =>
        json(200, { estado: "autorizada" }),
    ) =>
      simularApi((pedido) =>
        pedido.metodo === "GET" ? json(200, catalogoLimitado()) : otros(pedido),
      );
    async function cargadaLimitada() {
      render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: TRANSMISION });
    }

    it("muestra solo la tarjeta «Dónde guardamos tus datos», su casilla sin marcar, la versión, la política y los dos botones", async () => {
      apiLimitada();
      await cargadaLimitada();
      expect(
        screen.getByRole("heading", { level: 1, name: "Tu autorización" }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual(["Dónde guardamos tus datos"]);
      const casillas = screen.getAllByRole("checkbox");
      expect(casillas.map((c) => c.getAttribute("id"))).toEqual([
        "transmision",
      ]);
      expect(casillas[0]).not.toBeChecked();
      // Aprobado por el dueño (2026-11-12, E14-PCP 4.7): en este modo la nota es la de la cuenta que ya existe, no la de la cuenta que se crea.
      const nota =
        "Sin esta aceptación no puedes seguir usando la app, porque guarda tus datos en esos servicios.";
      expect(screen.getByText(nota)).toHaveClass("ayuda");
      expect(
        screen.getByRole("checkbox", { name: TRANSMISION }),
      ).toHaveAccessibleDescription(nota);
      expect(
        screen.queryByText(/no podemos darte la cuenta/),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          porTexto("Texto versión 1.1 del 12 de noviembre de 2026."),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Leer la política completa" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Autorizar y continuar" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "No autorizo" }),
      ).toBeInTheDocument();
    });

    it("no vuelve a pedir lo que ya autorizó: ni lo necesario, ni lo opcional, ni la explicación de la pantalla completa", async () => {
      apiLimitada();
      await cargadaLimitada();
      for (const texto of [
        "Lo necesario para usar la app",
        "Lo que puedes elegir",
        "Cuenta y acceso",
        "Funciones financieras",
        "Avisos con la app cerrada",
        "Horas de vida",
        "Necesitamos tu permiso para usar algunos datos. Lee con calma y decide.",
        "Puedes decir que no. La app funciona igual. Lo cambias cuando quieras en Preferencias.",
        // La nota de la pantalla completa habla de borrar el correo: aquí no es cierto.
        "Sin esta autorización no podemos darte la cuenta. Si no autorizas, borramos al momento el correo que nos diste.",
        FRASE_DE_AVISOS,
      ])
        expect(screen.queryByText(texto)).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: AVISOS })).toBeNull();
    });

    it("«Autorizar y continuar» sin marcar da el error de E14 y no guarda nada", async () => {
      const pedidos = apiLimitada();
      await cargadaLimitada();
      tocar("Autorizar y continuar");
      expect(screen.getByRole("checkbox", { name: TRANSMISION })).toBeInvalid();
      expect(screen.getByText(ERROR_TRANSMISION)).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: TRANSMISION }),
      ).toHaveAccessibleDescription(
        `${ERROR_TRANSMISION} Sin esta aceptación no puedes seguir usando la app, porque guarda tus datos en esos servicios.`,
      );
      expect(screen.getByRole("checkbox", { name: TRANSMISION })).toHaveFocus();
      expect(pedidos).toHaveLength(1);
      expect(window.location.pathname).toBe("/");
    });

    it("al aceptar manda solo transmision_a_encargados con la versión del catálogo y llega a Inicio (PN-71)", async () => {
      const pedidos = apiLimitada();
      await cargadaLimitada();
      marcar(TRANSMISION);
      tocar("Autorizar y continuar");
      await waitFor(() =>
        expect(window.location.pathname).toBe("/cuenta/seguridad"),
      );
      expect(pedidos).toEqual([
        { metodo: "GET", ruta: "/api/v1/autorizaciones", cuerpo: undefined },
        {
          metodo: "POST",
          ruta: "/api/v1/autorizaciones",
          cuerpo: {
            finalidades: ["transmision_a_encargados"],
            version: "1.1",
          },
        },
      ]);
    });

    it("409 version_desactualizada: vuelve a pedir el catálogo y conserva la casilla", async () => {
      let version = "1.1";
      const pedidos = simularApi((pedido) => {
        if (pedido.metodo === "GET")
          return json(200, {
            ...catalogoLimitado(),
            version: { numero: version, fecha: "2026-11-15" },
          });
        version = "1.2";
        return json(409, { error: "version_desactualizada" });
      });
      await cargadaLimitada();
      marcar(TRANSMISION);
      tocar("Autorizar y continuar");
      expect(await screen.findByRole("status")).toHaveTextContent(
        "No pudimos guardar tu autorización.",
      );
      await screen.findByText(
        porTexto("Texto versión 1.2 del 15 de noviembre de 2026."),
      );
      expect(pedidos.map((p) => p.metodo)).toEqual(["GET", "POST", "GET"]);
      expect(screen.getByRole("checkbox", { name: TRANSMISION })).toBeChecked();
    });
  });

  // SC-E21-25 sección 5, paso 3: «No autorizo» en el modo limitado no borra sin preguntar. Abre la hoja de PN-54 (D-102,
  // D-103): descargar los datos, borrar la cuenta con la contraseña o volver y decidir.
  describe("la hoja «¿No autorizas?» (PN-54 y modo «falta una aceptación»)", () => {
    const zip = () =>
      new Response(new Uint8Array([80, 75]), {
        status: 200,
        headers: { "Content-Type": "application/zip" },
      });
    let clics: string[];
    beforeEach(() => {
      clics = [];
      URL.createObjectURL = vi.fn(() => "blob:archivo");
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        function (this: HTMLAnchorElement) {
          clics.push(`${this.download}|${this.href}`);
        },
      );
    });

    const sinHogar = { hogar: null, menores: [] };
    type Opciones = {
      resumen?: () => Response;
      borrar?: () => Response;
      datos?: () => Response | Promise<Response>;
      cat?: unknown;
    };
    /** El API de la cuenta de antes: el catálogo del modo limitado, el resumen del borrado, la descarga y el borrado. */
    function apiCuentaDeAntes({
      resumen = () => json(200, sinHogar),
      borrar = () => json(200, { estado: "cuenta_borrada" }),
      datos = zip,
      cat = catalogoLimitado(),
    }: Opciones = {}) {
      return simularApi((pedido) => {
        if (pedido.ruta === "/api/v1/autorizaciones") return json(200, cat);
        if (pedido.ruta === "/api/v1/cuenta/borrado")
          return pedido.metodo === "GET" ? resumen() : borrar();
        if (pedido.ruta === "/api/v1/cuenta/datos") return datos();
        throw new Error(`pedido no previsto: ${pedido.metodo} ${pedido.ruta}`);
      });
    }
    const hoja = () => screen.getByRole("dialog", { name: "¿No autorizas?" });
    const contrasena = () => within(hoja()).getByLabelText("Tu contraseña");
    const borrar = () =>
      within(hoja()).getByRole("button", { name: "Borrar mi cuenta" });
    async function abrirLaHoja(opciones?: Opciones) {
      const pedidos = apiCuentaDeAntes(opciones);
      render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: TRANSMISION });
      tocar("No autorizo");
      await screen.findByRole("dialog", { name: "¿No autorizas?" });
      await waitFor(() =>
        expect(borrar()).not.toHaveAttribute("aria-disabled"),
      );
      return pedidos;
    }

    it("«No autorizo» abre la hoja sin llamar al rechazo que borra", async () => {
      const pedidos = await abrirLaHoja();
      expect(
        pedidos.some((p) => p.ruta === "/api/v1/autorizaciones/rechazo"),
      ).toBe(false);
      expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
        "GET /api/v1/autorizaciones",
        "GET /api/v1/cuenta/borrado",
      ]);
      expect(window.location.pathname).toBe("/");
    });

    it("trae los textos de E14-PME: explicación, aviso de la descarga, contraseña, «Volver y decidir» (Primario) y «Borrar mi cuenta» (Destructivo)", async () => {
      await abrirLaHoja();
      const h = within(hoja());
      expect(
        h.getByText("Si no autorizas, borramos tu cuenta y tu historial."),
      ).toBeInTheDocument();
      expect(
        h.getByText("Antes puedes descargar tus datos."),
      ).toBeInTheDocument();
      expect(
        h.getByRole("button", { name: "Descargar mis datos" }),
      ).toHaveClass("boton--texto");
      expect(
        h.getByText(
          "Un archivo ZIP con tus movimientos, metas, deudas y presupuestos en CSV. Solo trae lo tuyo.",
        ),
      ).toBeInTheDocument();
      expect(contrasena()).toHaveAttribute("type", "password");
      expect(contrasena()).toHaveAttribute("autocomplete", "current-password");
      expect(
        h.getByText("La pedimos para confirmar que eres tú."),
      ).toBeInTheDocument();
      expect(h.getByRole("button", { name: "Volver y decidir" })).toHaveClass(
        "boton--primario",
      );
      expect(borrar()).toHaveClass("boton--destructivo");
    });

    it("el foco entra en la hoja y «Volver y decidir» la cierra con todo como estaba y el foco en «No autorizo»", async () => {
      const pedidos = apiCuentaDeAntes();
      render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: TRANSMISION });
      marcar(TRANSMISION);
      tocar("No autorizo");
      const dialogo = await screen.findByRole("dialog", {
        name: "¿No autorizas?",
      });
      expect(within(dialogo).getByRole("heading", { level: 3 })).toHaveFocus();
      fireEvent.click(
        within(dialogo).getByRole("button", { name: "Volver y decidir" }),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "No autorizo" })).toHaveFocus();
      expect(screen.getByRole("checkbox", { name: TRANSMISION })).toBeChecked();
      expect(window.location.pathname).toBe("/");
      expect(pedidos.every((p) => p.metodo === "GET")).toBe(true);
    });

    it("Escape también la cierra, y se puede abrir otra vez", async () => {
      await abrirLaHoja();
      fireEvent.keyDown(hoja(), { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      tocar("No autorizo");
      expect(
        await screen.findByRole("dialog", { name: "¿No autorizas?" }),
      ).toBeInTheDocument();
    });

    it("«Borrar mi cuenta» manda la contraseña, sin menores que confirmar, y va a PN-60 con «Borramos tu cuenta.»", async () => {
      const pedidos = await abrirLaHoja();
      fireEvent.change(contrasena(), {
        target: { value: "lluvia café tren azul" },
      });
      fireEvent.click(borrar());
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(window.history.state).toEqual({ llegada: "tu_cuenta_borrada" });
      expect(pedidos.at(-1)).toEqual({
        metodo: "POST",
        ruta: "/api/v1/cuenta/borrado",
        cuerpo: {
          contrasena: "lluvia café tren azul",
          confirma_menores: false,
          menores: [],
        },
      });
    });

    it("sin la contraseña dice «Falta tu contraseña para borrar la cuenta.» junto al campo, con el foco ahí, y no pide nada", async () => {
      const pedidos = await abrirLaHoja();
      const antes = pedidos.length;
      fireEvent.click(borrar());
      expect(
        within(hoja()).getByText("Falta tu contraseña para borrar la cuenta."),
      ).toBeInTheDocument();
      expect(contrasena()).toBeInvalid();
      expect(contrasena()).toHaveFocus();
      expect(pedidos).toHaveLength(antes);
    });

    it("una contraseña que no coincide da el texto de PN-69 y la hoja sigue abierta con la cuenta intacta", async () => {
      await abrirLaHoja({
        borrar: () => json(400, { error: "contrasena_incorrecta" }),
      });
      fireEvent.change(contrasena(), { target: { value: "otra" } });
      fireEvent.click(borrar());
      expect(
        await within(hoja()).findByText(
          "No pudimos confirmar tu contraseña. Escríbela de nuevo.",
        ),
      ).toBeInTheDocument();
      expect(contrasena()).toHaveFocus();
      expect(window.location.pathname).toBe("/");
    });

    it.each([
      [
        "500",
        () => json(500, { error: "interno" }),
        "No pudimos borrar tu cuenta.",
      ],
      [
        "sin conexión",
        () => {
          throw new TypeError("sin red");
        },
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ],
      [
        "429",
        () => json(429, { error: "demasiados_intentos" }),
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      ],
    ])(
      "%s: el aviso del error dentro de la hoja y la cuenta sigue",
      async (_caso, borrarRespuesta, texto) => {
        await abrirLaHoja({ borrar: borrarRespuesta });
        fireEvent.change(contrasena(), { target: { value: "x" } });
        fireEvent.click(borrar());
        expect(await within(hoja()).findByRole("status")).toHaveTextContent(
          texto,
        );
        expect(window.location.pathname).toBe("/");
      },
    );

    it("401 al borrar lleva a PN-60 («Tu sesión se cerró»)", async () => {
      await abrirLaHoja({ borrar: () => json(401, { error: "sin_sesion" }) });
      fireEvent.change(contrasena(), { target: { value: "x" } });
      fireEvent.click(borrar());
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(window.history.state).toEqual({ llegada: "sesion_cerrada" });
    });

    it("no manda dos borrados si se toca dos veces mientras envía", async () => {
      let soltar: (r: Response) => void = () => {};
      const pedidos = apiCuentaDeAntes({
        borrar: () =>
          new Promise<Response>((r) => (soltar = r)) as unknown as Response,
      });
      render(<Autorizacion />);
      await screen.findByRole("checkbox", { name: TRANSMISION });
      tocar("No autorizo");
      await waitFor(() =>
        expect(borrar()).not.toHaveAttribute("aria-disabled"),
      );
      fireEvent.change(contrasena(), { target: { value: "x" } });
      fireEvent.click(borrar());
      fireEvent.click(borrar());
      soltar(json(200, { estado: "cuenta_borrada" }));
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(pedidos.filter((p) => p.metodo === "POST")).toHaveLength(1);
    });

    describe("«Descargar mis datos»", () => {
      it("pide GET /api/v1/cuenta/datos, baja el ZIP y avisa dentro de la hoja; no borra ni cierra", async () => {
        const pedidos = await abrirLaHoja();
        fireEvent.click(
          within(hoja()).getByRole("button", { name: "Descargar mis datos" }),
        );
        expect(
          await within(hoja()).findByText("Listo, descargamos tus datos."),
        ).toBeInTheDocument();
        expect(pedidos.at(-1)).toEqual({
          metodo: "GET",
          ruta: "/api/v1/cuenta/datos",
          cuerpo: undefined,
        });
        expect(clics).toEqual(["alcanzamos-mis-datos.zip|blob:archivo"]);
        expect(pedidos.some((p) => p.metodo === "POST")).toBe(false);
        expect(hoja()).toBeInTheDocument();
      });

      it("mientras prepara queda deshabilitado con «Preparando tu archivo…» y «Borrar mi cuenta» sigue disponible", async () => {
        let soltar: (r: Response) => void = () => {};
        await abrirLaHoja({
          datos: () => new Promise<Response>((r) => (soltar = r)),
        });
        fireEvent.click(
          within(hoja()).getByRole("button", { name: "Descargar mis datos" }),
        );
        const preparando = await within(hoja()).findByRole("button", {
          name: "Preparando tu archivo…",
        });
        expect(preparando).toHaveAttribute("aria-disabled", "true");
        expect(borrar()).not.toHaveAttribute("aria-disabled");
        soltar(zip());
        await within(hoja()).findByText("Listo, descargamos tus datos.");
      });

      it("si falla: «No pudimos preparar tu archivo.», «Tu cuenta sigue igual.» y se puede borrar igual", async () => {
        await abrirLaHoja({ datos: () => json(500, { error: "interno" }) });
        fireEvent.click(
          within(hoja()).getByRole("button", { name: "Descargar mis datos" }),
        );
        const aviso = await within(hoja()).findByText(
          "No pudimos preparar tu archivo.",
        );
        expect(aviso).toBeInTheDocument();
        expect(
          within(hoja()).getByText("Tu cuenta sigue igual. Intenta de nuevo."),
        ).toBeInTheDocument();
        expect(borrar()).not.toHaveAttribute("aria-disabled");
      });

      it("401 al descargar lleva a PN-60", async () => {
        await abrirLaHoja({ datos: () => json(401, { error: "sin_sesion" }) });
        fireEvent.click(
          within(hoja()).getByRole("button", { name: "Descargar mis datos" }),
        );
        await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      });
    });

    describe("con menores que dependen solo de la persona (RN-006)", () => {
      const conMenores = (nombres: string[]) => ({
        hogar: null,
        menores: nombres.map((nombre) => ({ id: `id-${nombre}`, nombre })),
      });

      it("pide confirmar lo del menor, como PN-69, y manda su id", async () => {
        const pedidos = await abrirLaHoja({
          resumen: () => json(200, conMenores(["Mateo"])),
        });
        expect(
          within(hoja()).getByText(
            "Mateo depende solo de ti. Su cuenta y sus datos también se borran.",
          ),
        ).toBeInTheDocument();
        const casilla = within(hoja()).getByRole("checkbox", {
          name: "Entiendo que también se borra la cuenta de Mateo.",
        });
        expect(casilla).not.toBeChecked();
        fireEvent.change(contrasena(), { target: { value: "x" } });
        fireEvent.click(casilla);
        fireEvent.click(borrar());
        await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
        expect(pedidos.at(-1)?.cuerpo).toEqual({
          contrasena: "x",
          confirma_menores: true,
          menores: ["id-Mateo"],
        });
      });

      it("sin marcar la casilla, el error de PN-69 y no se borra", async () => {
        const pedidos = await abrirLaHoja({
          resumen: () => json(200, conMenores(["Mateo", "Sofía"])),
          borrar: () =>
            json(422, {
              error: "validacion",
              campos: { confirma_menores: "confirmacion_requerida" },
            }),
        });
        fireEvent.change(contrasena(), { target: { value: "x" } });
        fireEvent.click(borrar());
        expect(
          await within(hoja()).findByText(
            "Falta confirmar lo de Mateo y Sofía.",
          ),
        ).toBeInTheDocument();
        expect(window.location.pathname).toBe("/");
        expect(pedidos.filter((p) => p.metodo === "POST")).toHaveLength(1);
      });

      it("409 menores_cambiaron: vuelve a leer el resumen y pide confirmar de nuevo", async () => {
        let lecturas = 0;
        await abrirLaHoja({
          resumen: () =>
            json(
              200,
              conMenores(++lecturas === 1 ? ["Mateo"] : ["Mateo", "Sofía"]),
            ),
          borrar: () => json(409, { error: "menores_cambiaron" }),
        });
        fireEvent.click(
          within(hoja()).getByRole("checkbox", {
            name: "Entiendo que también se borra la cuenta de Mateo.",
          }),
        );
        fireEvent.change(contrasena(), { target: { value: "x" } });
        fireEvent.click(borrar());
        const nueva = await within(hoja()).findByRole("checkbox", {
          name: "Entiendo que también se borran las cuentas de Mateo y Sofía.",
        });
        expect(nueva).not.toBeChecked();
        expect(window.location.pathname).toBe("/");
      });
    });

    describe("si no se puede leer el resumen del borrado", () => {
      it("dice «No pudimos cargar tus datos.», no deja borrar y «Intentar de nuevo» lo vuelve a pedir", async () => {
        let intento = 0;
        const pedidos = apiCuentaDeAntes({
          resumen: () =>
            ++intento === 1
              ? json(500, { error: "interno" })
              : json(200, sinHogar),
        });
        render(<Autorizacion />);
        await screen.findByRole("checkbox", { name: TRANSMISION });
        tocar("No autorizo");
        expect(
          await within(await screen.findByRole("dialog")).findByText(
            "No pudimos cargar tus datos.",
          ),
        ).toBeInTheDocument();
        expect(
          within(hoja()).queryByRole("button", { name: "Borrar mi cuenta" }),
        ).toBeNull();
        fireEvent.click(
          within(hoja()).getByRole("button", { name: "Intentar de nuevo" }),
        );
        await waitFor(() =>
          expect(borrar()).not.toHaveAttribute("aria-disabled"),
        );
        expect(
          pedidos.filter((p) => p.ruta === "/api/v1/cuenta/borrado"),
        ).toHaveLength(2);
      });

      it("401 lleva a PN-60", async () => {
        apiCuentaDeAntes({ resumen: () => json(401, { error: "sin_sesion" }) });
        render(<Autorizacion />);
        await screen.findByRole("checkbox", { name: TRANSMISION });
        tocar("No autorizo");
        await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      });
    });

    // Con el catálogo completo, el API puede responder 403 cuenta_con_historial si la cuenta autorizó algo entre tanto.
    it("en el modo completo, un 403 cuenta_con_historial del rechazo abre la misma hoja y no borra nada", async () => {
      const pedidos = simularApi((pedido) => {
        if (pedido.ruta === "/api/v1/autorizaciones" && pedido.metodo === "GET")
          return json(200, catalogo());
        if (pedido.ruta === "/api/v1/autorizaciones/rechazo")
          return json(403, { error: "cuenta_con_historial" });
        if (pedido.ruta === "/api/v1/cuenta/borrado")
          return json(200, sinHogar);
        throw new Error(`pedido no previsto: ${pedido.metodo} ${pedido.ruta}`);
      });
      await cargada();
      tocar("No autorizo");
      expect(
        await screen.findByRole("dialog", { name: "¿No autorizas?" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          "Todavía no pudimos borrar tu correo. Intenta de nuevo.",
        ),
      ).not.toBeInTheDocument();
      expect(
        pedidos.filter((p) => p.ruta === "/api/v1/autorizaciones/rechazo"),
      ).toHaveLength(1);
      expect(window.location.pathname).toBe("/");
    });

    it("en el modo completo, sin historial el «No autorizo» sigue sin hoja y sin pedir el resumen", async () => {
      const pedidos = api(() => new Response(null, { status: 204 }));
      await cargada();
      tocar("No autorizo");
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(pedidos.map((p) => p.ruta)).toEqual([
        "/api/v1/autorizaciones",
        "/api/v1/autorizaciones/rechazo",
      ]);
    });
  });
});
