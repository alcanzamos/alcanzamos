// Lógica pura de la revisión de antigüedad del lockfile (sin dependencias). La usan scripts/antiguedad.mjs y
// tests/antiguedad.test.ts.
//
// `min-release-age` de .npmrc solo frena las resoluciones nuevas: `npm ci` instala lo que diga package-lock.json
// aunque se haya publicado hace minutos (D-158). Esta revisión compara cada versión del lockfile con su fecha de
// publicación en el registro y falla con toda versión más joven que `min-release-age` que no tenga una excepción
// vigente en antiguedad-excepciones.json, con toda fecha que no se pueda obtener y con toda excepción vencida.

export const REGISTRO = "https://registry.npmjs.org/";
export const DIA_MS = 24 * 60 * 60 * 1000;

const CAMPOS = ["paquete", "version", "motivo", "revisar_antes_de"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Días de `min-release-age` en el texto de .npmrc. La regla se lee de ahí para no repetirla. undefined si no está o
// no es un entero positivo.
export function diasDelNpmrc(texto) {
  let dias;
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*min-release-age\s*=\s*(\S+)\s*$/.exec(linea);
    if (m) dias = /^[1-9]\d*$/.test(m[1]) ? Number(m[1]) : undefined;
  }
  return dias;
}

// Paquetes del lockfile (v2 o v3), sin repetir nombre y versión, ordenados. Un alias usa el nombre real (`name`).
// Devuelve { paquetes: [{ nombre, version }], errores }: es error una entrada sin versión o que no viene del registro.
export function paquetesDelLock(lock) {
  const errores = [];
  const unicos = new Map();
  for (const [ruta, datos] of Object.entries(lock?.packages ?? {})) {
    if (ruta === "" || datos.link) continue;
    const nombre = datos.name ?? ruta.split("node_modules/").pop();
    if (!datos.version || !datos.resolved?.startsWith(REGISTRO)) {
      errores.push(
        `${ruta} no viene del registro con una versión fija (resolved: ${datos.resolved ?? "ninguno"})`,
      );
      continue;
    }
    unicos.set(`${nombre}@${datos.version}`, {
      nombre,
      version: datos.version,
    });
  }
  if (unicos.size === 0 && errores.length === 0)
    errores.push("el lockfile no tiene paquetes");
  const paquetes = [...unicos.values()].sort((a, b) =>
    a.nombre === b.nombre
      ? a.version.localeCompare(b.version)
      : a.nombre.localeCompare(b.nombre),
  );
  return { paquetes, errores };
}

// Dirección del documento de un paquete en el registro (un paquete con ámbito lleva la barra codificada).
export const urlDelPaquete = (nombre) =>
  `${REGISTRO}${nombre.replace("/", "%2f")}`;

// Busca el campo `time` de cada nombre con `buscar(nombre)` (una promesa), con `concurrencia` pedidos a la vez.
// Devuelve un Map nombre → { time } o { error }. Un error no corta la revisión: queda anotado y la hace fallar.
export async function obtenerFechas(nombres, buscar, concurrencia = 16) {
  const fechas = new Map();
  const cola = [...new Set(nombres)];
  const trabajador = async () => {
    while (cola.length > 0) {
      const nombre = cola.shift();
      try {
        const time = await buscar(nombre);
        fechas.set(
          nombre,
          time && typeof time === "object"
            ? { time }
            : { error: "el registro no devolvió fechas" },
        );
      } catch (e) {
        fechas.set(nombre, { error: e?.message ?? String(e) });
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrencia, cola.length)) },
      trabajador,
    ),
  );
  return fechas;
}

// Valida la forma de las excepciones y devuelve los errores (vacío si están bien).
export function validarExcepciones(excepciones) {
  if (!Array.isArray(excepciones))
    return ["antiguedad-excepciones.json debe ser una lista"];
  const errores = [];
  excepciones.forEach((e, i) => {
    for (const campo of CAMPOS) {
      const valor = e?.[campo];
      if (typeof valor !== "string" || valor.trim() === "")
        errores.push(`la excepción ${i + 1} no tiene «${campo}»`);
    }
    if (
      typeof e?.revisar_antes_de === "string" &&
      e.revisar_antes_de.trim() !== "" &&
      !FECHA.test(e.revisar_antes_de)
    ) {
      errores.push(
        `la excepción ${i + 1} tiene «revisar_antes_de» que no es una fecha AAAA-MM-DD`,
      );
    }
  });
  return errores;
}

// Días completos entre dos instantes, para los mensajes.
const diasEntre = (desde, hasta) => Math.floor((hasta - desde) / DIA_MS);

// Devuelve { fallas, aceptados, sobrantes, masJoven }.
// - `fallas`: frases para imprimir; si hay alguna, la revisión falla.
// - `aceptados`: versiones jóvenes con excepción vigente.
// - `sobrantes`: excepciones de versiones que ya cumplen la edad (sobran, pero no fallan hasta vencer).
// - `masJoven`: la versión publicada más recientemente, para el informe.
// `ahora` es un instante en milisegundos; una excepción con `revisar_antes_de` anterior a la fecha UTC de `ahora`
// está vencida. Una versión es joven si se publicó después de `ahora - dias`, como hace npm con min-release-age.
export function revisar({ paquetes, fechas, excepciones, dias, ahora }) {
  const fallas = validarExcepciones(excepciones);
  if (fallas.length > 0)
    return { fallas, aceptados: [], sobrantes: [], masJoven: undefined };

  const hoy = new Date(ahora).toISOString().slice(0, 10);
  const limite = ahora - dias * DIA_MS;
  const enLock = new Set(paquetes.map((p) => `${p.nombre}@${p.version}`));
  const aceptados = [];
  const sobrantes = [];
  let masJoven;

  for (const e of excepciones) {
    if (hoy > e.revisar_antes_de) {
      fallas.push(
        `la excepción de ${e.paquete}@${e.version} venció el ${e.revisar_antes_de}: quítala o renuévala con un motivo nuevo`,
      );
    }
    if (!enLock.has(`${e.paquete}@${e.version}`)) {
      fallas.push(
        `la excepción de ${e.paquete}@${e.version} no corresponde a ninguna versión del lockfile: quítala`,
      );
    }
  }

  for (const { nombre, version } of paquetes) {
    const datos = fechas.get(nombre);
    if (!datos || datos.error) {
      fallas.push(
        `no se pudo obtener la fecha de ${nombre}@${version}: ${datos?.error ?? "no se consultó"}`,
      );
      continue;
    }
    const publicado = Date.parse(datos.time[version] ?? "");
    if (Number.isNaN(publicado)) {
      fallas.push(
        `el registro no tiene una fecha de publicación válida para ${nombre}@${version}`,
      );
      continue;
    }
    if (!masJoven || publicado > masJoven.publicado)
      masJoven = { nombre, version, publicado };
    const excepcion = excepciones.find(
      (e) => e.paquete === nombre && e.version === version,
    );
    const fecha = new Date(publicado).toISOString();
    if (publicado <= limite) {
      if (excepcion) sobrantes.push({ nombre, version, fecha });
      continue;
    }
    if (excepcion && hoy <= excepcion.revisar_antes_de) {
      aceptados.push({
        nombre,
        version,
        fecha,
        motivo: excepcion.motivo,
        revisarAntesDe: excepcion.revisar_antes_de,
      });
    } else if (!excepcion) {
      fallas.push(
        `${nombre}@${version} se publicó el ${fecha} (hace ${diasEntre(publicado, ahora)} días; el mínimo es ${dias}): ` +
          "espera a que cumpla la edad o agrega una excepción en antiguedad-excepciones.json",
      );
    }
  }
  return { fallas, aceptados, sobrantes, masJoven };
}
