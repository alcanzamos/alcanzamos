import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { defineConfig as defineVitest, mergeConfig } from "vitest/config";

// Content-Security-Policy. Debe ser idéntica a politicaCSP en api/src/servidor/servidor.go
// (Go no puede embeber un archivo fuera de su módulo, así que son dos literales).
// web/e2e/csp.spec.ts comprueba que `vite preview` la envía tal cual.
const politicaCSP =
  "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

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
    plugins: [react(), licenciasDeFuentes],
    // Los TTF no se incrustan en el CSS: se sirven como archivos propios de la app.
    build: { assetsInlineLimit: 0 },
    server: { fs: { allow: [".."] } },
    // Playwright corre contra `vite preview`, no contra el servidor de Go: manda la misma política.
    preview: { headers: { "Content-Security-Policy": politicaCSP } },
  }),
  defineVitest({
    test: {
      environment: "jsdom",
      setupFiles: ["tests/preparar.ts"],
      include: ["tests/**/*.test.{ts,tsx}"],
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
