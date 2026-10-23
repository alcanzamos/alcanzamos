import {
  avisosGraves,
  caminosHasta,
  hoyUtc,
  idDelAviso,
  revisar,
  validarExcepciones,
  type Excepcion,
  type Informe,
} from "../scripts/auditoria-logica.mjs";

const url = "https://github.com/advisories/GHSA-86w9-cpqp-85rv";

// Forma del JSON de `npm audit --json`: node-forge es el vulnerable; @expo/cli y expo lo heredan.
const informe: Informe = {
  vulnerabilities: {
    "node-forge": {
      isDirect: false,
      effects: ["@expo/cli", "@expo/code-signing-certificates"],
      via: [{ source: 1, severity: "high", title: "firmas RSA", url }],
    },
    "@expo/code-signing-certificates": {
      isDirect: false,
      effects: ["@expo/cli"],
      via: ["node-forge"],
    },
    "@expo/cli": { isDirect: false, effects: ["expo"], via: ["node-forge"] },
    expo: { isDirect: true, effects: [], via: ["@expo/cli"] },
  },
};

const excepcion: Excepcion = {
  ghsa: "GHSA-86w9-cpqp-85rv",
  paquete: "node-forge",
  rutas: [
    "expo > @expo/cli > @expo/code-signing-certificates > node-forge",
    "expo > @expo/cli > node-forge",
  ],
  motivo: "Solo lo usa la herramienta de línea de comandos de Expo.",
  revisado: "2026-10-23",
  revisar_antes_de: "2026-11-05",
};
const hoy = "2026-10-23";

describe("idDelAviso", () => {
  it("saca el GHSA de la URL", () => {
    expect(idDelAviso(url)).toBe("GHSA-86w9-cpqp-85rv");
  });

  it("devuelve undefined si no hay GHSA", () => {
    expect(idDelAviso("https://example.com/x")).toBeUndefined();
    expect(idDelAviso(undefined)).toBeUndefined();
  });
});

describe("caminosHasta", () => {
  it("sube por effects hasta las dependencias directas", () => {
    expect(caminosHasta("node-forge", informe.vulnerabilities!)).toEqual([
      "expo > @expo/cli > @expo/code-signing-certificates > node-forge",
      "expo > @expo/cli > node-forge",
    ]);
  });

  it("un paquete directo es su propio camino", () => {
    expect(
      caminosHasta("x", { x: { isDirect: true, effects: [], via: [] } }),
    ).toEqual(["x"]);
  });

  it("no se queda en un ciclo", () => {
    const ciclo = {
      a: { isDirect: false, effects: ["b"], via: [] },
      b: { isDirect: true, effects: ["a"], via: [] },
    };
    expect(caminosHasta("a", ciclo)).toEqual(["b > a"]);
  });
});

describe("avisosGraves", () => {
  it("toma solo los avisos (objetos) altos o críticos, no la propagación", () => {
    const avisos = avisosGraves(informe);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      id: "GHSA-86w9-cpqp-85rv",
      paquete: "node-forge",
      severidad: "high",
    });
  });

  it("ignora los avisos bajos y moderados", () => {
    const moderado: Informe = {
      vulnerabilities: {
        y: {
          isDirect: true,
          via: [{ severity: "moderate", url, title: "t" }],
        },
      },
    };
    expect(avisosGraves(moderado)).toEqual([]);
  });

  it("incluye los críticos", () => {
    const critico: Informe = {
      vulnerabilities: {
        y: { isDirect: true, via: [{ severity: "critical", url, title: "t" }] },
      },
    };
    expect(avisosGraves(critico).map((a) => a.severidad)).toEqual(["critical"]);
  });

  it("un informe sin vulnerabilidades no tiene avisos", () => {
    expect(avisosGraves({})).toEqual([]);
  });
});

describe("validarExcepciones", () => {
  it("acepta una excepción completa", () => {
    expect(validarExcepciones([excepcion])).toEqual([]);
  });

  it("exige todos los campos", () => {
    expect(validarExcepciones([{ ...excepcion, motivo: " " }])).toEqual([
      "la excepción 1 no tiene «motivo»",
    ]);
    expect(validarExcepciones([{ ...excepcion, rutas: [] }])).toHaveLength(1);
    expect(validarExcepciones([{}])).toHaveLength(6);
  });

  it("exige una fecha AAAA-MM-DD", () => {
    expect(
      validarExcepciones([{ ...excepcion, revisado: "23/10/2026" }])[0],
    ).toContain("fecha");
  });

  it("exige una fecha AAAA-MM-DD también en revisar_antes_de", () => {
    expect(
      validarExcepciones([{ ...excepcion, revisar_antes_de: "5/11/2026" }])[0],
    ).toContain("revisar_antes_de");
    expect(
      validarExcepciones([{ ...excepcion, revisar_antes_de: undefined }]),
    ).toEqual(["la excepción 1 no tiene «revisar_antes_de»"]);
  });

  it("exige una lista", () => {
    expect(validarExcepciones({})).toHaveLength(1);
  });
});

describe("revisar", () => {
  it("pasa con la excepción vigente", () => {
    const { fallas, aceptados } = revisar(informe, [excepcion], hoy);
    expect(fallas).toEqual([]);
    expect(aceptados.map((a) => a.id)).toEqual(["GHSA-86w9-cpqp-85rv"]);
  });

  it("falla con un aviso sin excepción y dice el camino", () => {
    const { fallas } = revisar(informe, [], hoy);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain("GHSA-86w9-cpqp-85rv");
    expect(fallas[0]).toContain("expo > @expo/cli > node-forge");
  });

  it("la excepción es por aviso y paquete: otro aviso en el mismo paquete falla", () => {
    const otro: Informe = {
      vulnerabilities: {
        ...informe.vulnerabilities,
        "node-forge": {
          ...informe.vulnerabilities!["node-forge"],
          via: [
            {
              severity: "high",
              title: "otro",
              url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
            },
          ],
        },
      },
    };
    const { fallas } = revisar(otro, [excepcion], hoy);
    expect(fallas.some((f) => f.includes("GHSA-aaaa-bbbb-cccc"))).toBe(true);
    expect(fallas.some((f) => f.includes("ya no se reporta"))).toBe(true);
  });

  it("falla si la excepción quedó obsoleta (el aviso ya no se reporta)", () => {
    const { fallas } = revisar({ vulnerabilities: {} }, [excepcion], hoy);
    expect(fallas).toEqual([
      "la excepción GHSA-86w9-cpqp-85rv (node-forge) ya no se reporta: quítala de auditoria-excepciones.json",
    ]);
  });

  it("falla si aparece un camino nuevo (por ejemplo, una dependencia directa)", () => {
    const nuevo: Informe = {
      vulnerabilities: {
        ...informe.vulnerabilities,
        "node-forge": {
          ...informe.vulnerabilities!["node-forge"],
          isDirect: true,
        },
      },
    };
    const { fallas } = revisar(nuevo, [excepcion], hoy);
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain("el camino de dependencias cambió");
    expect(fallas[0]).toContain("Nuevos: node-forge");
  });

  it("falla si un camino listado ya no aparece", () => {
    const { fallas } = revisar(
      informe,
      [{ ...excepcion, rutas: [...excepcion.rutas, "expo > x > node-forge"] }],
      hoy,
    );
    expect(fallas[0]).toContain("Ya no aparecen: expo > x > node-forge");
  });

  it("una excepción mal formada falla antes de revisar nada", () => {
    const { fallas } = revisar(informe, [{ ...excepcion, revisado: "" }], hoy);
    expect(fallas).toEqual(["la excepción 1 no tiene «revisado»"]);
  });

  it("sin avisos y sin excepciones pasa", () => {
    expect(revisar({ vulnerabilities: {} }, [], hoy).fallas).toEqual([]);
  });

  it("pasa el mismo día de la fecha de revisión", () => {
    expect(revisar(informe, [excepcion], "2026-11-05").fallas).toEqual([]);
  });

  it("falla si la fecha de revisión ya pasó y dice qué hacer", () => {
    const { fallas } = revisar(informe, [excepcion], "2026-11-06");
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain("venció el 2026-11-05");
    expect(fallas[0]).toContain("cierre de la iteración");
    expect(fallas[0]).toContain("Expo");
  });

  it("hoyUtc devuelve una fecha AAAA-MM-DD", () => {
    expect(hoyUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
