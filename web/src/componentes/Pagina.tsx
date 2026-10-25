import { useEffect, useRef, type ReactNode } from "react";
import { alTocarEnlace, llegoNavegando } from "../enrutador";
import type { DatosDeAviso } from "../textos";
import { IconoAtras } from "./Iconos";
import { MensajeDeEstado } from "./MensajeDeEstado";
import logo from "../../../marca/logo-horizontal-color.svg";
import { formatear, textos } from "../textos/es.generated";

// Columna centrada de 560 px (E14-PCP 1). El título es el h1.
// - `estado`: el mensaje de estado de la llegada (E14-PCP 4.16 T11); va arriba de todo.
// - `conLogo`: el Logo horizontal en color de 40 px arriba (PN-58 y PN-60).
// - `atras`: la Barra superior de E14-SDD 5.10, con el ícono Atrás de 48 px y su nombre accesible junto al título.
// Al llegar por una navegación el foco pasa al título, para que el lector de pantalla anuncie la pantalla nueva.
export function Pagina({
  titulo,
  conLogo = false,
  atras,
  estado,
  children,
}: {
  titulo: string;
  conLogo?: boolean;
  atras?: string;
  estado?: DatosDeAviso | null;
  children?: ReactNode;
}) {
  const encabezado = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = formatear(textos.pagina.titulo_del_documento, { titulo });
    if (llegoNavegando()) encabezado.current?.focus();
  }, [titulo]);
  const h1 = (
    <h1 ref={encabezado} tabIndex={-1} className="titulo">
      {titulo}
    </h1>
  );
  return (
    <main className="columna">
      {estado && <MensajeDeEstado aviso={estado} />}
      {conLogo && <img src={logo} alt={textos.pagina.logo} className="logo" />}
      {atras ? (
        <header className="barra">
          <a
            href={atras}
            className="barra__atras"
            aria-label={textos.pagina.atras}
            onClick={alTocarEnlace(atras)}
          >
            <IconoAtras />
          </a>
          {h1}
        </header>
      ) : (
        h1
      )}
      {children}
    </main>
  );
}
