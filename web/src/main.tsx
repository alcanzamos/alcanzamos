import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./estilos/fuentes.css";
import "./estilos/tokens.css";
import "./estilos/base.css";
import "./estilos/componentes.css";

const raiz = document.getElementById("raiz");
if (!raiz) throw new Error("Falta el elemento #raiz en index.html");

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
