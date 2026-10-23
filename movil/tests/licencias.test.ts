import {
  caminosDeProduccion,
  esPermitida,
  hoyUtc,
  paquetesDeProduccion,
  revisar,
  revisarConExcepciones,
  validarExcepciones,
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

type Lock = { packages: Record<string, object> };

describe("caminosDeProduccion", () => {
  const lock: Lock = {
    packages: {
      "": { name: "raiz", dependencies: { expo: "1" } },
      "node_modules/expo": { version: "1", dependencies: { cli: "1", y: "1" } },
      "node_modules/cli": { version: "1", dependencies: { hoja: "1" } },
      "node_modules/y": { version: "1", dependencies: { hoja: "1" } },
      "node_modules/hoja": { version: "1", license: "CC-BY-4.0" },
      "node_modules/y/node_modules/hoja": { version: "2", license: "MIT" },
      "node_modules/herramienta": {
        version: "1",
        dev: true,
        dependencies: { hoja: "1" },
      },
    },
  };

  it("da un camino por cada paquete que depende de él, resolviendo node_modules anidados", () => {
    expect(caminosDeProduccion(lock, "node_modules/hoja")).toEqual([
      "expo > cli > hoja",
    ]);
    expect(caminosDeProduccion(lock, "node_modules/y/node_modules/hoja")).toEqual([
      "expo > y > hoja",
    ]);
  });

  it("no cuenta lo que solo llega por dependencias de desarrollo", () => {
    expect(caminosDeProduccion(lock, "node_modules/herramienta")).toEqual([]);
  });

  it("una dependencia directa es su propio camino", () => {
    const directo = {
      packages: {
        "": { dependencies: { a: "1" } },
        "node_modules/a": { version: "1", license: "X" },
      },
    };
    expect(caminosDeProduccion(directo, "node_modules/a")).toEqual(["a"]);
  });
});

describe("revisarConExcepciones", () => {
  const lock: Lock = {
    packages: {
      "": { dependencies: { expo: "1" } },
      "node_modules/expo": { version: "1", license: "MIT", dependencies: { a: "1", b: "1" } },
      "node_modules/a": { version: "1.0.0", license: "Python-2.0", dependencies: { c: "1" } },
      "node_modules/b": { version: "1.0.0", license: "MIT" },
      "node_modules/c": { version: "1.0.0", license: "CC-BY-4.0" },
    },
  };
  const excepcion = (paquete: string, licencia: string, ruta: string) => ({
    paquete,
    licencia,
    rutas: [ruta],
    motivo: "Herramientas de compilación.",
    revisar_antes_de: "2026-11-05",
  });
  const buenas = [
    excepcion("a", "Python-2.0", "expo > a"),
    excepcion("c", "CC-BY-4.0", "expo > a > c"),
  ];
  const hoy = "2026-10-23";
  const revisarCon = (excepciones: unknown, lk = lock, h = hoy) =>
    revisarConExcepciones(lk, undefined, excepciones, h);

  it("pasa con las excepciones vigentes y cuenta todo", () => {
    const { fallas, aceptados, conteo } = revisarCon(buenas);
    expect(fallas).toEqual([]);
    expect(aceptados.map((p) => p.nombre)).toEqual(["a", "c"]);
    expect(conteo.get("MIT")).toBe(2);
  });

  it("falla con una licencia no permitida sin excepción", () => {
    const { fallas } = revisarCon([buenas[0]]);
    expect(fallas).toEqual([
      "c@1.0.0: CC-BY-4.0 (licencia no permitida y sin excepción)",
    ]);
  });

  it("la lista general no cambia: otro paquete con licencia desconocida falla aunque haya excepciones", () => {
    const otro = {
      packages: {
        ...lock.packages,
        "node_modules/b": { version: "1.0.0", license: "GPL-3.0-only" },
      },
    };
    expect(revisarCon(buenas, otro).fallas).toEqual([
      "b@1.0.0: GPL-3.0-only (licencia no permitida y sin excepción)",
    ]);
  });

  it("falla si cambia la licencia de un paquete con excepción", () => {
    const cambio = {
      packages: {
        ...lock.packages,
        "node_modules/a": { version: "1.0.1", license: "GPL-3.0-only", dependencies: { c: "1" } },
      },
    };
    const { fallas } = revisarCon(buenas, cambio);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain("la licencia cambió");
    expect(fallas[0]).toContain("Python-2.0");
  });

  it("falla si cambia el camino por el que llega", () => {
    const nuevo = {
      packages: {
        ...lock.packages,
        "node_modules/b": { version: "1.0.0", license: "MIT", dependencies: { c: "1" } },
      },
    };
    const { fallas } = revisarCon(buenas, nuevo);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain("el camino de dependencias cambió");
    expect(fallas[0]).toContain("Nuevos: expo > b > c");
  });

  it("falla si un camino listado ya no existe", () => {
    const { fallas } = revisarCon([
      buenas[0],
      { ...buenas[1], rutas: ["expo > a > c", "expo > z > c"] },
    ]);
    expect(fallas[0]).toContain("Ya no aparecen: expo > z > c");
  });

  it("falla si la excepción quedó obsoleta porque el paquete ya no está", () => {
    const sinC: Lock = {
      packages: { ...lock.packages, "node_modules/a": { version: "1.0.0", license: "Python-2.0" } },
    };
    delete sinC.packages["node_modules/c"];
    const { fallas } = revisarCon(buenas, sinC);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain("la excepción de c (CC-BY-4.0) ya no hace falta");
  });

  it("falla si la excepción quedó obsoleta porque la licencia ahora es permitida", () => {
    const mit = {
      packages: { ...lock.packages, "node_modules/c": { version: "2.0.0", license: "MIT" } },
    };
    expect(revisarCon(buenas, mit).fallas[0]).toContain("ya no hace falta");
  });

  it("pasa el día de la fecha de revisión y falla al día siguiente", () => {
    expect(revisarCon(buenas, lock, "2026-11-05").fallas).toEqual([]);
    const { fallas } = revisarCon(buenas, lock, "2026-11-06");
    expect(fallas).toHaveLength(2);
    expect(fallas[0]).toContain("venció el 2026-11-05");
    expect(fallas[0]).toContain("cierre de la iteración");
  });

  it("una excepción mal formada falla antes de revisar", () => {
    expect(revisarCon([{ ...buenas[0], motivo: "" }]).fallas).toEqual([
      "la excepción 1 no tiene «motivo»",
    ]);
    expect(
      validarExcepciones([{ ...buenas[0], revisar_antes_de: "5/11/2026" }])[0],
    ).toContain("fecha");
    expect(validarExcepciones({})).toHaveLength(1);
    expect(hoyUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
