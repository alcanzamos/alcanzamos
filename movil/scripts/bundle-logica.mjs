// Lógica pura de la comprobación del paquete de JavaScript (sin dependencias). La usan scripts/comprobar-bundle.mjs y
// tests/bundle.test.ts.
//
// Metro minifica el paquete y no deja las rutas de los módulos, así que además del nombre se buscan cadenas propias de
// cada paquete con excepción de auditoría (D-150, D-154). Verificado el 2026-10-23 con paquetes que sí los importan: las
// cadenas aparecen en el bytecode de Hermes (y en el JavaScript sin bytecode) y no aparecen en el paquete de la app.
// - node-forge: el algoritmo RSASSA-PKCS1-V1_5 y el prefijo de OID 1.2.840.113549.
// - zod: los nombres de clase y los códigos de error (`ZodError`, `invalid_type`, `too_small`, `invalid_enum_value`),
//   que sobreviven a la minificación porque son valores de datos y no identificadores.
export const MARCAS_POR_PAQUETE = {
  "node-forge": ["node_modules/node-forge", "node-forge", "RSASSA-PKCS1-V1_5", "1.2.840.113549"],
  zod: ["node_modules/zod", "ZodError", "invalid_type", "too_small", "invalid_enum_value"],
};

// Se conserva para quien use solo las marcas de node-forge.
export const MARCAS_DE_NODE_FORGE = MARCAS_POR_PAQUETE["node-forge"];

// Marcas de `marcas` que aparecen en `contenido` (bytes o texto).
export function buscarMarcas(contenido, marcas = MARCAS_DE_NODE_FORGE) {
  const buffer = typeof contenido === "string" ? Buffer.from(contenido, "utf8") : Buffer.from(contenido);
  return marcas.filter((marca) => buffer.includes(marca));
}

// Revisa `archivos` ([{ nombre, contenido }]) contra `paquetes` (paquete → marcas). Devuelve { fallas, revisados }; falla
// también si no hay ningún archivo (una exportación vacía no prueba nada).
export function revisarArchivos(archivos, paquetes = MARCAS_POR_PAQUETE) {
  const fallas = [];
  if (archivos.length === 0) {
    fallas.push("la exportación no generó ningún paquete de JavaScript: no hay nada que comprobar");
  }
  for (const { nombre, contenido } of archivos) {
    for (const [paquete, marcas] of Object.entries(paquetes)) {
      const halladas = buscarMarcas(contenido, marcas);
      if (halladas.length > 0) {
        fallas.push(`${nombre} contiene ${paquete} (marcas: ${halladas.join(", ")})`);
      }
    }
  }
  return { fallas, revisados: archivos.length };
}
