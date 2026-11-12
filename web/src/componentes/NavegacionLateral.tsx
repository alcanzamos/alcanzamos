import { alTocarEnlace } from "../enrutador";
import { textos } from "../textos/es.generated";
import { IconoAgregar, IconoMovimientos, IconoPresupuesto } from "./Iconos";

/** El lugar de la barra donde está la persona; sin él, la pantalla no es un destino (E14-PTU 4.0). */
export type Lugar = "registrar" | "movimientos" | "presupuesto";

export type Lateral = {
  activo?: Lugar;
  /** Donde la pantalla ya tiene su Botón · Primario, «Registrar» pasa a Secundario (E14-SDD 5.13). */
  registrarSecundario?: boolean;
};

// Los destinos de E14-SDD 5.9, en su orden, que ya existen en la web (nota del 2026-11-10 de 5.13): «Presupuesto» va
// después de «Movimientos» desde la US-77. Inicio y Metas llegan con su pantalla: sin ella serían un enlace muerto.
const destinos = [
  {
    lugar: "movimientos",
    href: "/movimientos",
    nombre: textos.movimientos.titulo,
    Icono: IconoMovimientos,
  },
  {
    lugar: "presupuesto",
    href: "/presupuesto",
    nombre: textos.presupuesto.destino,
    Icono: IconoPresupuesto,
  },
] as const;

// Navegación lateral web (E14-SDD 5.13): 240 px desde 768 px, con «Registrar» arriba de los destinos. Por debajo
// de 768 px no se ve: la web usa el diseño de Android. El activo lleva aria-current y las tres señales de 5.9.
export function NavegacionLateral({
  activo,
  registrarSecundario = false,
}: Lateral) {
  const actual = (lugar: Lugar) => (lugar === activo ? "page" : undefined);
  return (
    <nav className="navegacion-lateral">
      <a
        href="/registrar"
        className={`boton boton--${registrarSecundario ? "secundario" : "primario"}`}
        aria-current={actual("registrar")}
        onClick={alTocarEnlace("/registrar")}
      >
        <IconoAgregar />
        {textos.movimientos.registrar}
      </a>
      <ul className="navegacion-lateral__destinos">
        {destinos.map(({ lugar, href, nombre, Icono }) => (
          <li key={lugar}>
            <a
              href={href}
              className="navegacion-lateral__destino"
              aria-current={actual(lugar)}
              onClick={alTocarEnlace(href)}
            >
              <span className="navegacion-lateral__pildora">
                <Icono />
              </span>
              {nombre}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
