import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PantallaPrueba } from "./PantallaPrueba";
import "./estilos/fuentes.css";
import "./estilos/tokens.css";
import "./estilos/base.css";

const raiz = document.getElementById("raiz");
if (!raiz) throw new Error("Falta el elemento #raiz en index.html");

createRoot(raiz).render(
  <StrictMode>
    <PantallaPrueba />
  </StrictMode>,
);
