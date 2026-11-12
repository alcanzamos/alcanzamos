import { cifras } from "../componentes/Cifras";
import { IconoInformacion } from "../componentes/Iconos";
import { Pagina } from "../componentes/Pagina";
import { useUbicacion } from "../enrutador";
import { diaEnPalabras } from "../fechas";
import { origenDeLaPolitica, VERSION_DE_LA_POLITICA } from "../politica";
import { finalidadesDeE14 } from "../textos";
import { formatear, textos } from "../textos/es.generated";

const t = textos.politica;
const finalidades = t.finalidades;

type Fila = { codigo: string; nombre: string; descripcion: string };

// Las finalidades de E14-PCP 5 que PN-68 lista (fila 4), separadas en «Necesarias» y «Opcionales». Las de la persona
// adulta salen del mismo texto de PN-64; las del menor son de PN-36 y de la pantalla del menor. La aceptación de la
// transmisión a los encargados no es una fila: la explica la tarjeta «Dónde guardamos tus datos» (fila 5 b).
const fila = (
  codigo: string,
  { nombre, descripcion }: { nombre: string; descripcion: string },
): Fila => ({ codigo, nombre, descripcion });
const necesarias: Fila[] = [
  fila("cuenta_y_acceso", finalidadesDeE14.cuenta_y_acceso!),
  fila("funciones_financieras", finalidadesDeE14.funciones_financieras!),
  fila("cuenta_del_menor", finalidades.cuenta_del_menor),
];
const opcionales: Fila[] = [
  fila("avisos", finalidadesDeE14.avisos!),
  fila("horas_de_vida", finalidadesDeE14.horas_de_vida!),
  fila("correo_del_menor", finalidades.correo_del_menor),
];

function Lista({ items }: { items: Record<string, string> }) {
  return (
    <ul className="vinetas">
      {Object.entries(items).map(([clave, texto]) => (
        <li key={clave}>{texto}</li>
      ))}
    </ul>
  );
}

function Grupo({
  id,
  titulo,
  filas,
}: {
  id: string;
  titulo: string;
  filas: Fila[];
}) {
  return (
    <div role="group" aria-labelledby={id} className="finalidades">
      <h3 id={id} className="fila__nombre">
        {titulo}
      </h3>
      <ul>
        {filas.map(({ codigo, nombre, descripcion }) => (
          <li key={codigo} className="fila">
            <p className="fila__nombre">{nombre}</p>
            <p>{descripcion}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// PN-68 · Política de tratamiento, canal de consultas y de reclamos, y responsable (E14-PCP 4.11, RF-059, RF-060, D-195).
// Informativa y pública: no hay formulario (D-088) ni hace falta una cuenta, y el texto va en la página, así que no
// carga nada ni tiene estado de error de carga. La versión es la del texto vigente (RF-063). De dónde se abre lo dice
// `?desde=` (lista cerrada, `politica.ts`): Atrás vuelve ahí y solo las pantallas con sesión traen la barra lateral.
// Sin la nota del menor (fila 8): la cuenta de un menor es solo de Android.
export function Politica() {
  const { parametros } = useUbicacion();
  const { atras, lateral } = origenDeLaPolitica(parametros);
  const fecha = diaEnPalabras(VERSION_DE_LA_POLITICA.fecha);
  return (
    <Pagina titulo={t.titulo} atras={atras} lateral={lateral ? {} : undefined}>
      <p className="nota">
        <IconoInformacion />
        <span>
          {cifras(
            formatear(t.version, {
              numero: VERSION_DE_LA_POLITICA.numero,
              fecha: fecha ?? VERSION_DE_LA_POLITICA.fecha,
            }),
          )}
        </span>
      </p>
      <section className="tarjeta" aria-labelledby="titulo-responsable">
        <h2 id="titulo-responsable" className="titulo-3">
          {t.responsable.titulo}
        </h2>
        <p>{t.responsable.proyecto}</p>
        <p>{t.responsable.nombre}</p>
        <p>{t.responsable.correo}</p>
      </section>
      <section className="tarjeta" aria-labelledby="titulo-finalidades">
        <h2 id="titulo-finalidades" className="titulo-3">
          {finalidades.titulo}
        </h2>
        <Grupo
          id="titulo-necesarias"
          titulo={finalidades.necesarias}
          filas={necesarias}
        />
        <Grupo
          id="titulo-opcionales"
          titulo={finalidades.opcionales}
          filas={opcionales}
        />
        <p>{finalidades.sinVenta}</p>
      </section>
      <section className="tarjeta" aria-labelledby="titulo-derechos">
        <h2 id="titulo-derechos" className="titulo-3">
          {t.derechos.titulo}
        </h2>
        <p>{t.derechos.intro}</p>
        <Lista items={t.derechos.items} />
      </section>
      <section className="tarjeta" aria-labelledby="titulo-donde-guardamos">
        <h2 id="titulo-donde-guardamos" className="titulo-3">
          {t.dondeGuardamos.titulo}
        </h2>
        <ul className="vinetas">
          {Object.entries(t.dondeGuardamos.items).map(([clave, texto]) => (
            <li key={clave}>{texto}</li>
          ))}
          <li>{textos.autorizacion.fraseDeAvisos}</li>
        </ul>
      </section>
      <section className="tarjeta" aria-labelledby="titulo-consultas">
        <h2 id="titulo-consultas" className="titulo-3">
          {t.consultas.titulo}
        </h2>
        <p>{t.consultas.intro}</p>
        <Lista items={t.consultas.datos} />
        <p>{t.consultas.menor}</p>
        <p className="fila__nombre">{t.consultas.tiempos.titulo}</p>
        <ul className="vinetas">
          <li>{t.consultas.tiempos.consulta}</li>
          <li>{t.consultas.tiempos.reclamo}</li>
          <li>{t.consultas.tiempos.incompleto}</li>
        </ul>
      </section>
      <a
        className="boton boton--secundario"
        href={`mailto:${t.escribir.direccion}`}
      >
        {t.escribir.boton}
      </a>
    </Pagina>
  );
}
