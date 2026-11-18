import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { defineConfig as defineVitest, mergeConfig } from "vitest/config";

// Content-Security-Policy de ca-web: debe ser idéntica a politicaCSP en web/servidor/internal/servidor/config.go, con el
// origen del API en connect-src. web/e2e/csp.spec.ts comprueba que `vite preview` la envía tal cual.
const politicaCSP = (origenDelApi: string) =>
  `default-src 'self'; connect-src 'self' ${origenDelApi}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;

// La web lee /config.json al arrancar (src/configuracion.ts). En producción lo arma ca-web desde API_URL; aquí lo arman
// `vite dev` y `vite preview` (Playwright) con la misma forma y sin caché. El origen del API es `URL_API` si está
// definida (p. ej. `URL_API=http://localhost:8080 npm run dev` para hablar con el API local; el API tiene que
// permitir el origen de la web con CORS y credenciales) y, si no, el mismo origen de la web: es lo que usa Playwright,
// que simula el API con `page.route`.
function origenDelApi(pedido: IncomingMessage): string {
  const definido = process.env.URL_API?.trim();
  return definido
    ? new URL(definido).origin
    : `http://${pedido.headers.host ?? "localhost"}`;
}

const configEnEjecucion: Plugin = {
  name: "config-en-ejecucion",
  configureServer(servidor) {
    servidor.middlewares.use(servirConfig(false));
  },
  configurePreviewServer(servidor) {
    servidor.middlewares.use(servirConfig(true));
  },
};

function servirConfig(conCSP: boolean) {
  return (
    pedido: IncomingMessage,
    respuesta: ServerResponse,
    siguiente: () => void,
  ) => {
    const origen = origenDelApi(pedido);
    if (conCSP) {
      respuesta.setHeader("Content-Security-Policy", politicaCSP(origen));
    }
    if (new URL(pedido.url ?? "/", "http://x").pathname !== "/config.json") {
      return siguiente();
    }
    respuesta.setHeader("Cache-Control", "no-store");
    respuesta.setHeader("Content-Type", "application/json");
    respuesta.end(`${JSON.stringify({ url_api: origen })}\n`);
  };
}

const diseno = fileURLToPath(new URL("../diseno/", import.meta.url));

// Las fuentes se importan desde diseno/fuentes (única copia). La licencia OFL de cada familia
// viaja en dist/ junto a los archivos de fuente, como exige la licencia.
const licenciasDeFuentes: Plugin = {
  name: "licencias-ofl",
  generateBundle() {
    for (const familia of ["figtree", "atkinson-hyperlegible-next"]) {
      this.emitFile({
        type: "asset",
        fileName: `fuentes/${familia}-OFL.txt`,
        source: readFileSync(`${diseno}fuentes/${familia}/OFL.txt`),
      });
    }
  },
};

export default mergeConfig(
  defineConfig({
    plugins: [react(), licenciasDeFuentes, configEnEjecucion],
    // Los TTF no se incrustan en el CSS: se sirven como archivos propios de la app.
    build: { assetsInlineLimit: 0 },
    server: { fs: { allow: [".."] } },
  }),
  defineVitest({
    test: {
      environment: "jsdom",
      setupFiles: ["tests/preparar.ts"],
      include: ["tests/**/*.test.{ts,tsx}"],
      // Las pruebas de tests/eslint/ corren ESLint 10 dentro de la prueba: con cobertura y la máquina cargada pasan
      // los 5 s por omisión y fallan al azar (pasó en el #73). Una prueba que de verdad se cuelga falla igual a los 15 s.
      testTimeout: 15_000,
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/main.tsx", "src/vite-env.d.ts"],
        reporter: ["text", "text-summary"],
        thresholds: { lines: 60 },
      },
    },
  }),
);
