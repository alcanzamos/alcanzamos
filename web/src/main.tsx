import { arrancar } from "./arranque";
import "./estilos/fuentes.css";
import "./estilos/tokens.css";
import "./estilos/base.css";
import "./estilos/componentes.css";

const raiz = document.getElementById("raiz");
if (!raiz) throw new Error("Falta el elemento #raiz en index.html");

void arrancar(raiz);
