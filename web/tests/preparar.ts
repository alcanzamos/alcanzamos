import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { reiniciarBorrador } from "../src/borradorDeRegistro";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // Las pruebas de las hojas de estilo corren en Node, sin ventana.
  if (typeof window === "undefined") return;
  reiniciarBorrador();
  cleanup();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
