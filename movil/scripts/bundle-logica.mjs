// Lógica pura de la comprobación del paquete de JavaScript (sin dependencias). La usan scripts/comprobar-bundle.mjs y
// tests/bundle.test.ts.
//
// Metro minifica el paquete y no deja las rutas de los módulos, así que además del nombre se buscan cadenas propias de
// node-forge (el algoritmo RSASSA-PKCS1-V1_5 y el prefijo de OID 1.2.840.113549). Verificado el 2026-10-23 con un
// paquete que sí lo importa: esas dos cadenas aparecen en el bytecode de Hermes y en el JavaScript sin bytecode, y no
// aparecen en el paquete de la app.
export const MARCAS_DE_NODE_FORGE = [
  "node_modules/node-forge",
  "node-forge",
  "RSASSA-PKCS1-V1_5",
  "1.2.840.113549",
];

// Marcas de `marcas` que aparecen en `contenido` (bytes o texto).
export function buscarMarcas(contenido, marcas = MARCAS_DE_NODE_FORGE) {
  const buffer = typeof contenido === "string" ? Buffer.from(contenido, "utf8") : Buffer.from(contenido);
  return marcas.filter((marca) => buffer.includes(marca));
}

// Revisa `archivos` ([{ nombre, contenido }]). Devuelve { fallas, revisados }; falla también si no hay ningún
// archivo (una exportación vacía no prueba nada).
export function revisarArchivos(archivos, marcas = MARCAS_DE_NODE_FORGE) {
  const fallas = [];
  if (archivos.length === 0) {
    fallas.push("la exportación no generó ningún paquete de JavaScript: no hay nada que comprobar");
  }
  for (const { nombre, contenido } of archivos) {
    const halladas = buscarMarcas(contenido, marcas);
    if (halladas.length > 0) {
      fallas.push(`${nombre} contiene node-forge (marcas: ${halladas.join(", ")})`);
    }
  }
  return { fallas, revisados: archivos.length };
}
