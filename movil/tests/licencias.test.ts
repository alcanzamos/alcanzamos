import {
  esPermitida,
  paquetesDeProduccion,
  revisar,
} from "../scripts/licencias-logica.mjs";

describe("esPermitida", () => {
  it.each(["MIT", "ISC", "Apache-2.0", "BlueOak-1.0.0", "MPL-2.0", "0BSD"])(
    "acepta %s",
    (licencia) => {
      expect(esPermitida(licencia)).toBe(true);
    },
  );

  it.each(["GPL-3.0-only", "SSPL-1.0", "CC-BY-NC-4.0", "UNLICENSED"])(
    "rechaza %s",
    (licencia) => {
      expect(esPermitida(licencia)).toBe(false);
    },
  );

  it("OR pasa si alguna opción está permitida", () => {
    expect(esPermitida("(MIT OR GPL-3.0-only)")).toBe(true);
    expect(esPermitida("GPL-2.0-only OR MIT")).toBe(true);
    expect(esPermitida("GPL-2.0-only OR SSPL-1.0")).toBe(false);
  });

  it("AND pasa solo si todas están permitidas", () => {
    expect(esPermitida("MIT AND ISC")).toBe(true);
    expect(esPermitida("MIT AND GPL-3.0-only")).toBe(false);
  });

  it("AND tiene más precedencia que OR y los paréntesis la cambian", () => {
    expect(esPermitida("GPL-3.0-only AND MIT OR ISC")).toBe(true);
    expect(esPermitida("GPL-3.0-only AND (MIT OR ISC)")).toBe(false);
  });

  it("falla con licencia ausente, vacía, con WITH o mal formada", () => {
    expect(esPermitida(undefined)).toBe(false);
    expect(esPermitida("")).toBe(false);
    expect(esPermitida("MIT WITH Classpath-exception-2.0")).toBe(false);
    expect(esPermitida("SEE LICENSE IN LICENSE.txt")).toBe(false);
    expect(esPermitida("(MIT")).toBe(false);
    expect(esPermitida("MIT OR")).toBe(false);
  });
});

describe("paquetesDeProduccion y revisar", () => {
  const lock = {
    packages: {
      "": { name: "raiz" },
      "node_modules/a": { version: "1.0.0", license: "MIT" },
      "node_modules/a/node_modules/b": {
        version: "2.0.0",
        license: "GPL-3.0-only",
      },
      "node_modules/c": { version: "3.0.0" },
      "node_modules/herramienta": {
        version: "9.0.0",
        license: "GPL-3.0-only",
        dev: true,
      },
    },
  };

  it("ignora la raíz y lo marcado dev, e incluye lo transitivo", () => {
    const nombres = paquetesDeProduccion(lock).map((p) => p.nombre);
    expect(nombres).toEqual(["a", "b", "c"]);
  });

  it("usa el respaldo cuando el lockfile no trae licencia", () => {
    const paquetes = paquetesDeProduccion(lock, (ruta) =>
      ruta === "node_modules/c" ? "ISC" : undefined,
    );
    expect(paquetes.find((p) => p.nombre === "c")?.licencia).toBe("ISC");
  });

  it("cuenta por licencia y lista los infractores", () => {
    const { conteo, infractores } = revisar(paquetesDeProduccion(lock));
    expect(conteo.get("MIT")).toBe(1);
    expect(conteo.get("(sin licencia)")).toBe(1);
    expect(infractores.map((p) => p.nombre)).toEqual(["b", "c"]);
  });
});
