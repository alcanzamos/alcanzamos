import excepcionesReales from "../auditoria-excepciones.json";
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

// D-209: excepción de picomatch (GHSA-fc5q-39xc-vjpf, ReDoS alto, sin versión corregida, solo compilación).
describe("excepción de picomatch (D-209)", () => {
  const real = excepcionesReales as Excepcion[];
  const picomatch = real.find((e) => e.ghsa === "GHSA-fc5q-39xc-vjpf")!;
  const urlPicomatch = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
  // Las 3 rutas por @react-native/community-cli-plugin: npm audit las informa en unas corridas (20 caminos) y en otras
  // no (17), con el mismo lockfile (D-209).
  const INTERMITENTES = [
    "react-native > @react-native/community-cli-plugin > metro > jest-worker > jest-util > picomatch",
    "react-native > @react-native/community-cli-plugin > metro > metro-file-map > jest-worker > jest-util > picomatch",
    "react-native > @react-native/community-cli-plugin > metro > metro-file-map > micromatch > picomatch",
  ];

  // Informe de `npm audit` armado desde las rutas de la excepción: cada paquete hereda de los que lo siguen en alguna ruta.
  function informeDeRutas(rutas: string[]): Informe {
    const vulnerabilidades: Record<string, NonNullable<Informe["vulnerabilities"]>[string]> = {};
    for (const ruta of rutas) {
      const nombres = ruta.split(" > ");
      nombres.forEach((nombre, i) => {
        const datos = (vulnerabilidades[nombre] ??= { isDirect: false, effects: [], via: [] });
        if (i === 0) datos.isDirect = true;
        const padre = nombres[i - 1];
        if (padre && !datos.effects!.includes(padre)) datos.effects!.push(padre);
      });
    }
    vulnerabilidades.picomatch.via = [
      { source: 1247710, severity: "high", title: "ReDoS en extglobs repetidos", url: urlPicomatch },
    ];
    return { vulnerabilities: vulnerabilidades };
  }

  it("está completa: 17 rutas exactas, 3 intermitentes, fechas de D-209 y el motivo cita la decisión", () => {
    expect(validarExcepciones(real)).toEqual([]);
    expect(real).toHaveLength(1);
    expect(picomatch.paquete).toBe("picomatch");
    expect(picomatch.rutas).toHaveLength(17);
    expect(new Set(picomatch.rutas).size).toBe(17);
    expect(picomatch.rutas).toEqual([...picomatch.rutas].sort());
    expect(picomatch.rutas.every((r) => r.endsWith(" > picomatch"))).toBe(true);
    expect(picomatch.revisado).toBe("2026-11-18");
    expect(picomatch.revisar_antes_de).toBe("2026-11-23");
    expect(picomatch.motivo).toContain("D-209");
    expect(picomatch.motivo).toContain("Metro");
    expect(picomatch.motivo).toContain("tinyglobby");
    expect(picomatch.rutas_intermitentes).toEqual(INTERMITENTES);
  });

  it("pasa con un informe de 17 caminos (sin community-cli-plugin)", () => {
    const { fallas, aceptados } = revisar(informeDeRutas(picomatch.rutas), real, "2026-11-18");
    expect(fallas).toEqual([]);
    expect(aceptados[0].caminos).toHaveLength(17);
  });

  it("pasa con un informe de 20 caminos (con community-cli-plugin)", () => {
    const informe20 = informeDeRutas([...picomatch.rutas, ...INTERMITENTES]);
    const { fallas, aceptados } = revisar(informe20, real, "2026-11-18");
    expect(fallas).toEqual([]);
    expect(aceptados[0].caminos).toHaveLength(20);
  });

  it("la auditoría pasa con la excepción vigente, hasta el 2026-11-23", () => {
    const informePicomatch = informeDeRutas(picomatch.rutas);
    for (const dia of ["2026-11-18", "2026-11-23"]) {
      const { fallas, aceptados } = revisar(informePicomatch, real, dia);
      expect(fallas).toEqual([]);
      expect(aceptados.map((a) => a.id)).toEqual(["GHSA-fc5q-39xc-vjpf"]);
    }
  });

  it("falla desde el 2026-11-24 y dice qué hacer", () => {
    const { fallas } = revisar(informeDeRutas(picomatch.rutas), real, "2026-11-24");
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain("GHSA-fc5q-39xc-vjpf (picomatch) venció el 2026-11-23");
  });

  it("falla si aparece una ruta que no está en la lista", () => {
    const informeNuevo = informeDeRutas([...picomatch.rutas, "expo-router > nuevo > picomatch"]);
    const { fallas } = revisar(informeNuevo, real, "2026-11-18");
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain("el camino de dependencias cambió");
    expect(fallas[0]).toContain("Nuevos: expo-router > nuevo > picomatch");
  });

  it("falla si, con las 20 rutas, aparece una más fuera de rutas y de rutas_intermitentes", () => {
    const informeNuevo = informeDeRutas([...picomatch.rutas, ...INTERMITENTES, "expo-router > nuevo > picomatch"]);
    const { fallas } = revisar(informeNuevo, real, "2026-11-18");
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain("Nuevos: expo-router > nuevo > picomatch");
  });

  it("falla si falta una ruta de rutas aunque estén las 3 intermitentes", () => {
    const quitadas = picomatch.rutas.filter((r) => r.startsWith("react-native > tinyglobby > "));
    const informeMenos = informeDeRutas([...picomatch.rutas.filter((r) => !quitadas.includes(r)), ...INTERMITENTES]);
    const { fallas } = revisar(informeMenos, real, "2026-11-18");
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain(`Ya no aparecen: ${quitadas.join("; ")}`);
  });

  it("falla si una ruta de la lista ya no aparece", () => {
    // react-native deja de depender de tinyglobby de forma directa; sigue por @react-native/codegen.
    const quitadas = picomatch.rutas.filter((r) => r.startsWith("react-native > tinyglobby > "));
    expect(quitadas).toHaveLength(2);
    const informeMenos = informeDeRutas(picomatch.rutas.filter((r) => !quitadas.includes(r)));
    const { fallas } = revisar(informeMenos, real, "2026-11-18");
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toContain(`Ya no aparecen: ${quitadas.join("; ")}`);
  });

  it("falla y pide quitarla cuando el aviso ya no se reporta", () => {
    const { fallas } = revisar({ vulnerabilities: {} }, real, "2026-11-18");
    expect(fallas).toEqual([
      "la excepción GHSA-fc5q-39xc-vjpf (picomatch) ya no se reporta: quítala de auditoria-excepciones.json",
    ]);
  });

  it("no cubre otro aviso de picomatch", () => {
    const informe = informeDeRutas(picomatch.rutas);
    informe.vulnerabilities!.picomatch.via = [
      { severity: "high", title: "otro", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" },
    ];
    const { fallas } = revisar(informe, real, "2026-11-18");
    expect(fallas.some((f) => f.includes("GHSA-aaaa-bbbb-cccc"))).toBe(true);
  });
});

// Cambio a D-150 (D-209): campo opcional `rutas_intermitentes` de cada excepción.
describe("rutas_intermitentes", () => {
  const intermitente =
    "expo > @expo/cli > intermedio > node-forge";
  const conIntermitente: Excepcion = { ...excepcion, rutas_intermitentes: [intermitente] };
  const informeCon = (extra: string[]): Informe => ({
    vulnerabilities: {
      ...informe.vulnerabilities,
      intermedio: { isDirect: false, effects: ["@expo/cli"], via: ["node-forge"] },
      "node-forge": {
        ...informe.vulnerabilities!["node-forge"],
        effects: [...informe.vulnerabilities!["node-forge"].effects!, ...extra],
      },
    },
  });

  describe("validarExcepciones", () => {
    it("es opcional: sin el campo no hay error", () => {
      expect(validarExcepciones([excepcion])).toEqual([]);
    });

    it("acepta una lista de rutas que no están en rutas", () => {
      expect(validarExcepciones([conIntermitente])).toEqual([]);
    });

    it.each([
      ["una cadena", "expo > a > node-forge"],
      ["null", null],
      ["un objeto", {}],
      ["una lista vacía", []],
      ["una lista con una ruta vacía", [" "]],
      ["una lista con algo que no es texto", [3]],
    ])("falla si no es una lista de rutas: %s", (_nombre, valor) => {
      expect(
        validarExcepciones([{ ...excepcion, rutas_intermitentes: valor }]),
      ).toEqual(["la excepción 1 tiene «rutas_intermitentes» que no es una lista de rutas"]);
    });

    it("falla si repite una ruta", () => {
      expect(
        validarExcepciones([{ ...excepcion, rutas_intermitentes: [intermitente, intermitente] }]),
      ).toEqual([`la excepción 1 repite en «rutas_intermitentes»: ${intermitente}`]);
    });

    it("falla si una ruta ya está en rutas", () => {
      expect(
        validarExcepciones([{ ...excepcion, rutas_intermitentes: [excepcion.rutas[0]] }]),
      ).toEqual([
        `la excepción 1 tiene en «rutas_intermitentes» rutas que ya están en «rutas»: ${excepcion.rutas[0]}`,
      ]);
    });

    it("revisar no mira el informe si el campo está mal formado", () => {
      const { fallas, aceptados } = revisar(informe, [{ ...excepcion, rutas_intermitentes: "x" }], hoy);
      expect(fallas).toEqual(["la excepción 1 tiene «rutas_intermitentes» que no es una lista de rutas"]);
      expect(aceptados).toEqual([]);
    });
  });

  describe("revisar", () => {
    it("pasa sin la ruta intermitente en el informe", () => {
      expect(revisar(informe, [conIntermitente], hoy).fallas).toEqual([]);
    });

    it("pasa con la ruta intermitente en el informe", () => {
      const { fallas, aceptados } = revisar(informeCon(["intermedio"]), [conIntermitente], hoy);
      expect(fallas).toEqual([]);
      expect(aceptados[0].caminos).toContain(intermitente);
    });

    it("falla con una ruta fuera de rutas y de rutas_intermitentes, y la nombra", () => {
      const nuevo: Informe = {
        vulnerabilities: {
          ...informeCon(["intermedio"]).vulnerabilities,
          otro: { isDirect: true, effects: [], via: ["node-forge"] },
          "node-forge": {
            ...informeCon(["intermedio"]).vulnerabilities!["node-forge"],
            effects: ["@expo/cli", "@expo/code-signing-certificates", "intermedio", "otro"],
          },
        },
      };
      const { fallas, aceptados } = revisar(nuevo, [conIntermitente], hoy);
      expect(fallas).toHaveLength(1);
      expect(fallas[0]).toContain("el camino de dependencias cambió");
      expect(fallas[0]).toContain("Nuevos: otro > node-forge.");
      expect(fallas[0]).toContain("Ya no aparecen: ninguno");
      expect(aceptados).toEqual([]);
    });

    it("falla si falta una ruta de rutas aunque la intermitente esté", () => {
      const { fallas } = revisar(
        informeCon(["intermedio"]),
        [{ ...conIntermitente, rutas: [...excepcion.rutas, "expo > x > node-forge"] }],
        hoy,
      );
      expect(fallas).toHaveLength(1);
      expect(fallas[0]).toContain("Ya no aparecen: expo > x > node-forge");
    });

    it("una ruta intermitente no ocupa el lugar de una de rutas", () => {
      // La ruta de rutas desaparece del informe y aparece la intermitente: sigue fallando.
      const sinCamino: Informe = {
        vulnerabilities: {
          ...informeCon(["intermedio"]).vulnerabilities,
          "node-forge": {
            ...informe.vulnerabilities!["node-forge"],
            effects: ["@expo/code-signing-certificates", "intermedio"],
          },
        },
      };
      const { fallas } = revisar(sinCamino, [conIntermitente], hoy);
      expect(fallas).toHaveLength(1);
      expect(fallas[0]).toContain("Ya no aparecen: expo > @expo/cli > node-forge");
    });

    it("vence con revisar_antes_de: con la excepción vencida falla aunque la ruta intermitente esté", () => {
      const { fallas } = revisar(informeCon(["intermedio"]), [conIntermitente], "2026-11-06");
      expect(fallas).toHaveLength(1);
      expect(fallas[0]).toContain("venció el 2026-11-05");
    });

    it("el mismo día de revisar_antes_de todavía pasa", () => {
      expect(revisar(informeCon(["intermedio"]), [conIntermitente], "2026-11-05").fallas).toEqual([]);
    });

    it("una ruta intermitente de otra excepción no cubre esta", () => {
      const otra: Excepcion = {
        ...excepcion,
        ghsa: "GHSA-aaaa-bbbb-cccc",
        paquete: "otro-paquete",
        rutas: ["expo > otro-paquete"],
        rutas_intermitentes: [intermitente],
      };
      const { fallas } = revisar(informeCon(["intermedio"]), [excepcion, otra], hoy);
      expect(fallas.some((f) => f.includes("Nuevos: expo > @expo/cli > intermedio > node-forge"))).toBe(true);
    });
  });
});
