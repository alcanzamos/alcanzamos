// Fechas en texto, no en formato ISO (D-090), en la hora de Colombia. Solo se usa Intl para pasar a America/Bogota:
// los nombres de los meses y «a. m.»/«p. m.» son propios, para no depender de los datos de idioma del navegador.
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const enBogota = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** «el 1 de noviembre de 2026, a las 9:40 p. m.» a partir de un RFC 3339; `null` si no es una fecha. */
export function fechaEnPalabras(rfc3339: string): string | null {
  const instante = new Date(rfc3339);
  if (Number.isNaN(instante.getTime())) return null;
  const partes = Object.fromEntries(
    enBogota.formatToParts(instante).map((p) => [p.type, Number(p.value)]),
  );
  const hora = partes.hour ?? 0;
  const hora12 = hora % 12 || 12;
  const minutos = String(partes.minute ?? 0).padStart(2, "0");
  const articulo = hora12 === 1 ? "a la" : "a las";
  const jornada = hora < 12 ? "a. m." : "p. m.";
  const mes = MESES[(partes.month ?? 1) - 1];
  return `el ${partes.day} de ${mes} de ${partes.year}, ${articulo} ${hora12}:${minutos} ${jornada}`;
}
