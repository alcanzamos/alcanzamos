import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DIA_MS,
  diasDelNpmrc,
  obtenerFechas,
  paquetesDelLock,
  revisar,
  urlDelPaquete,
  validarExcepciones,
  type ExcepcionDeAntiguedad,
  type Fechas,
} from "../scripts/antiguedad-logica.mjs";

const R = "https://registry.npmjs.org/";
const ahora = Date.parse("2026-10-24T12:00:00Z");
const haceDias = (d: number) => new Date(ahora - d * DIA_MS).toISOString();

const lock = (packages: Record<string, unknown>) => ({ lockfileVersion: 3, packages });
const entrada = (version: string, extra: Record<string, unknown> = {}) => ({
  version,
  resolved: `${R}x/-/x-${version}.tgz`,
  ...extra,
});

const excepcion = (extra: Partial<ExcepcionDeAntiguedad> = {}): ExcepcionDeAntiguedad => ({
  paquete: "joven",
  version: "1.0.1",
  motivo: "Corrección de seguridad urgente.",
  revisar_antes_de: "2026-10-30",
  ...extra,
});

const fechas = (datos: Record<string, Record<string, string> | Error>): Fechas =>
  new Map(
    Object.entries(datos).map(([n, v]) => [n, v instanceof Error ? { error: v.message } : { time: v }]),
  );

const viejo = { nombre: "viejo", version: "2.0.0" };
const paquetes = [viejo, { nombre: "joven", version: "1.0.1" }];
const fechasBase = fechas({
  viejo: { "2.0.0": haceDias(30) },
  joven: { "1.0.0": haceDias(40), "1.0.1": haceDias(2) },
});

describe("diasDelNpmrc", () => {
  it("lee min-release-age", () => {
    expect(diasDelNpmrc("# comentario\nstrict-allow-scripts=true\nmin-release-age=7\n")).toBe(7);
    expect(diasDelNpmrc("min-release-age = 10\r\n")).toBe(10);
  });

  it("sin la opción o con un valor que no es un entero positivo devuelve undefined", () => {
    expect(diasDelNpmrc("allow-git=none\n")).toBeUndefined();
    for (const valor of ["0", "7.5", "-1", "siete", ""]) {
      expect(diasDelNpmrc(`min-release-age=${valor}`)).toBeUndefined();
    }
  });

  it("no confunde min-release-age-exclude con la opción", () => {
    expect(diasDelNpmrc("min-release-age-exclude[]=x\nmin-release-age=7")).toBe(7);
  });

  it("si se repite, vale la última, como en npm", () => {
    expect(diasDelNpmrc("min-release-age=3\nmin-release-age=7")).toBe(7);
  });

  it("el .npmrc del proyecto pide 7 días", () => {
    expect(diasDelNpmrc(readFileSync(join(__dirname, "..", ".npmrc"), "utf8"))).toBe(7);
  });
});

describe("paquetesDelLock", () => {
  it("salta la raíz, usa el nombre real de un alias, quita repetidos y ordena", () => {
    const { paquetes: lista, errores } = paquetesDelLock(
      lock({
        "": { name: "app", version: "0.0.0" },
        "node_modules/b": entrada("1.0.0"),
        "node_modules/a": entrada("2.0.0"),
        "node_modules/c/node_modules/a": entrada("1.0.0"),
        "node_modules/x/node_modules/b": entrada("1.0.0"),
        "node_modules/alias-cjs": entrada("4.2.3", { name: "@scope/real" }),
      }),
    );
    expect(errores).toEqual([]);
    expect(lista).toEqual([
      { nombre: "@scope/real", version: "4.2.3" },
      { nombre: "a", version: "1.0.0" },
      { nombre: "a", version: "2.0.0" },
      { nombre: "b", version: "1.0.0" },
    ]);
  });

  it("salta los enlaces locales", () => {
    const { paquetes: lista } = paquetesDelLock(
      lock({ "node_modules/a": entrada("1.0.0"), "node_modules/local": { link: true, resolved: "local" } }),
    );
    expect(lista).toEqual([{ nombre: "a", version: "1.0.0" }]);
  });

  it("una entrada que no viene del registro o sin versión es un error", () => {
    const { paquetes: lista, errores } = paquetesDelLock(
      lock({
        "node_modules/git": { version: "1.0.0", resolved: "git+ssh://git@github.com/x/y.git#abc" },
        "node_modules/sin-version": { resolved: `${R}s/-/s.tgz` },
        "node_modules/sin-resolved": { version: "1.0.0" },
      }),
    );
    expect(lista).toEqual([]);
    expect(errores).toHaveLength(3);
    expect(errores[0]).toContain("node_modules/git");
    expect(errores[0]).toContain("git+ssh");
    expect(errores[2]).toContain("ninguno");
  });

  it("un lockfile sin paquetes es un error", () => {
    expect(paquetesDelLock(lock({ "": { name: "app" } })).errores).toEqual(["el lockfile no tiene paquetes"]);
    expect(paquetesDelLock({}).errores).toEqual(["el lockfile no tiene paquetes"]);
  });
});

describe("urlDelPaquete", () => {
  it("codifica la barra de un paquete con ámbito", () => {
    expect(urlDelPaquete("vite")).toBe(`${R}vite`);
    expect(urlDelPaquete("@expo/cli")).toBe(`${R}@expo%2fcli`);
  });
});

describe("obtenerFechas", () => {
  it("guarda el campo time de cada nombre, una sola vez por nombre", async () => {
    const pedidos: string[] = [];
    const resultado = await obtenerFechas(["a", "b", "a"], async (n) => {
      pedidos.push(n);
      return { "1.0.0": "2026-01-01T00:00:00Z" };
    });
    expect(pedidos.sort()).toEqual(["a", "b"]);
    expect(resultado.get("a")).toEqual({ time: { "1.0.0": "2026-01-01T00:00:00Z" } });
  });

  it("un error o una respuesta sin fechas queda anotado y no corta los demás", async () => {
    const resultado = await obtenerFechas(["roto", "vacio", "bien"], async (n) => {
      if (n === "roto") throw new Error("el registro respondió 503");
      if (n === "vacio") return undefined;
      return {};
    });
    expect(resultado.get("roto")).toEqual({ error: "el registro respondió 503" });
    expect(resultado.get("vacio")).toEqual({ error: "el registro no devolvió fechas" });
    expect(resultado.get("bien")).toEqual({ time: {} });
  });

  it("un error que no es Error se convierte en texto", async () => {
    const resultado = await obtenerFechas(["x"], () => Promise.reject("sin red"));
    expect(resultado.get("x")).toEqual({ error: "sin red" });
  });

  it("no hace más pedidos a la vez que la concurrencia", async () => {
    let enCurso = 0;
    let maximo = 0;
    await obtenerFechas(
      Array.from({ length: 10 }, (_, i) => `p${i}`),
      async () => {
        enCurso++;
        maximo = Math.max(maximo, enCurso);
        await new Promise((listo) => setTimeout(listo, 1));
        enCurso--;
        return {};
      },
      3,
    );
    expect(maximo).toBe(3);
  });

  it("sin nombres no pide nada", async () => {
    expect((await obtenerFechas([], async () => ({}))).size).toBe(0);
  });
});

describe("validarExcepciones", () => {
  it("acepta una lista vacía y una excepción completa", () => {
    expect(validarExcepciones([])).toEqual([]);
    expect(validarExcepciones([excepcion()])).toEqual([]);
  });

  it("exige una lista", () => {
    expect(validarExcepciones({})).toEqual(["antiguedad-excepciones.json debe ser una lista"]);
  });

  it("exige paquete, versión, motivo y fecha de vencimiento", () => {
    expect(validarExcepciones([{ paquete: "x", version: " ", motivo: 3 }])).toEqual([
      "la excepción 1 no tiene «version»",
      "la excepción 1 no tiene «motivo»",
      "la excepción 1 no tiene «revisar_antes_de»",
    ]);
    expect(validarExcepciones([null])).toHaveLength(4);
  });

  it("la fecha de vencimiento es AAAA-MM-DD", () => {
    expect(validarExcepciones([excepcion({ revisar_antes_de: "5 de noviembre" })])).toEqual([
      "la excepción 1 tiene «revisar_antes_de» que no es una fecha AAAA-MM-DD",
    ]);
  });
});

describe("revisar", () => {
  const base = { paquetes, fechas: fechasBase, dias: 7, ahora };

  it("pasa si todas las versiones cumplen la edad", () => {
    const r = revisar({ ...base, paquetes: [viejo], excepciones: [] });
    expect(r.fallas).toEqual([]);
    expect(r.masJoven).toEqual({ nombre: "viejo", version: "2.0.0", publicado: Date.parse(haceDias(30)) });
  });

  it("falla con una versión joven sin excepción y dice cuándo se publicó", () => {
    const r = revisar({ ...base, excepciones: [] });
    expect(r.fallas).toEqual([
      `joven@1.0.1 se publicó el ${haceDias(2)} (hace 2 días; el mínimo es 7): ` +
        "espera a que cumpla la edad o agrega una excepción en antiguedad-excepciones.json",
    ]);
    expect(r.masJoven?.nombre).toBe("joven");
  });

  it("una versión publicada justo en el límite cumple la edad", () => {
    const r = revisar({
      ...base,
      paquetes: [{ nombre: "x", version: "1.0.0" }],
      fechas: fechas({ x: { "1.0.0": haceDias(7) } }),
      excepciones: [],
    });
    expect(r.fallas).toEqual([]);
  });

  it("acepta una versión joven con excepción vigente, también el día del vencimiento", () => {
    for (const vence of ["2026-10-30", "2026-10-24"]) {
      const r = revisar({ ...base, excepciones: [excepcion({ revisar_antes_de: vence })] });
      expect(r.fallas).toEqual([]);
      expect(r.aceptados).toEqual([
        {
          nombre: "joven",
          version: "1.0.1",
          fecha: haceDias(2),
          motivo: "Corrección de seguridad urgente.",
          revisarAntesDe: vence,
        },
      ]);
    }
  });

  it("la excepción vale solo para esa versión", () => {
    const r = revisar({ ...base, excepciones: [excepcion({ version: "1.0.0" })] });
    expect(r.fallas).toContain("la excepción de joven@1.0.0 no corresponde a ninguna versión del lockfile: quítala");
    expect(r.fallas.some((f) => f.startsWith("joven@1.0.1 se publicó"))).toBe(true);
  });

  it("falla con una excepción vencida y no acepta la versión", () => {
    const r = revisar({ ...base, excepciones: [excepcion({ revisar_antes_de: "2026-10-23" })] });
    expect(r.fallas).toEqual([
      "la excepción de joven@1.0.1 venció el 2026-10-23: quítala o renuévala con un motivo nuevo",
    ]);
    expect(r.aceptados).toEqual([]);
  });

  it("una excepción vencida falla aunque la versión ya cumpla la edad", () => {
    const r = revisar({
      ...base,
      excepciones: [excepcion({ paquete: "viejo", version: "2.0.0", revisar_antes_de: "2026-10-01" })],
      paquetes: [viejo],
    });
    expect(r.fallas).toEqual([
      "la excepción de viejo@2.0.0 venció el 2026-10-01: quítala o renuévala con un motivo nuevo",
    ]);
  });

  it("una excepción vigente de una versión que ya cumple la edad sobra, pero no falla", () => {
    const r = revisar({
      ...base,
      paquetes: [viejo],
      excepciones: [excepcion({ paquete: "viejo", version: "2.0.0" })],
    });
    expect(r.fallas).toEqual([]);
    expect(r.sobrantes).toEqual([{ nombre: "viejo", version: "2.0.0", fecha: haceDias(30) }]);
  });

  it("falla si no se pudo obtener la fecha: no la da por buena", () => {
    const r = revisar({
      ...base,
      fechas: fechas({ viejo: new Error("el registro respondió 404"), joven: { "1.0.1": haceDias(20) } }),
      excepciones: [],
    });
    expect(r.fallas).toEqual(["no se pudo obtener la fecha de viejo@2.0.0: el registro respondió 404"]);
  });

  it("falla si el paquete no se consultó", () => {
    const r = revisar({ ...base, fechas: fechas({ viejo: { "2.0.0": haceDias(30) } }), excepciones: [] });
    expect(r.fallas).toEqual(["no se pudo obtener la fecha de joven@1.0.1: no se consultó"]);
  });

  it("falla si el registro no tiene fecha válida para esa versión", () => {
    const r = revisar({
      ...base,
      fechas: fechas({ viejo: { "1.0.0": haceDias(30) }, joven: { "1.0.1": "no es una fecha" } }),
      excepciones: [],
    });
    expect(r.fallas).toEqual([
      "el registro no tiene una fecha de publicación válida para viejo@2.0.0",
      "el registro no tiene una fecha de publicación válida para joven@1.0.1",
    ]);
  });

  it("con excepciones mal formadas falla sin revisar nada más", () => {
    const r = revisar({ ...base, excepciones: [{ paquete: "joven" }] });
    expect(r.fallas).toHaveLength(3);
    expect(r.aceptados).toEqual([]);
    expect(r.masJoven).toBeUndefined();
  });
});

describe("antiguedad-excepciones.json del proyecto", () => {
  const raiz = join(__dirname, "..");
  const reales = JSON.parse(readFileSync(join(raiz, "antiguedad-excepciones.json"), "utf8"));
  const { paquetes: delLock, errores } = paquetesDelLock(
    JSON.parse(readFileSync(join(raiz, "package-lock.json"), "utf8")),
  );

  it("tiene la forma correcta y el lockfile se puede revisar", () => {
    expect(validarExcepciones(reales)).toEqual([]);
    expect(errores).toEqual([]);
  });

  it("cada excepción corresponde a una versión del lockfile", () => {
    const enLock = new Set(delLock.map((p) => `${p.nombre}@${p.version}`));
    for (const e of reales as ExcepcionDeAntiguedad[]) {
      expect(enLock.has(`${e.paquete}@${e.version}`)).toBe(true);
    }
  });
});
