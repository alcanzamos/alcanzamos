import {
  MARCAS_DE_NODE_FORGE,
  buscarMarcas,
  revisarArchivos,
} from "../scripts/bundle-logica.mjs";

describe("buscarMarcas", () => {
  it("no encuentra nada en un paquete sin node-forge", () => {
    expect(buscarMarcas("function a(){return 1}var b='hola'")).toEqual([]);
  });

  it("encuentra el nombre y las cadenas propias, en texto o en bytes", () => {
    const texto = "x node_modules/node-forge/lib/rsa.js y RSASSA-PKCS1-V1_5";
    expect(buscarMarcas(texto)).toEqual([
      "node_modules/node-forge",
      "node-forge",
      "RSASSA-PKCS1-V1_5",
    ]);
    expect(buscarMarcas(new Uint8Array([0, 255, ...new TextEncoder().encode("1.2.840.113549")]))).toEqual([
      "1.2.840.113549",
    ]);
  });

  it("acepta otras marcas", () => {
    expect(buscarMarcas("abc", ["b", "z"])).toEqual(["b"]);
    expect(MARCAS_DE_NODE_FORGE.length).toBeGreaterThan(1);
  });
});

describe("revisarArchivos", () => {
  it("pasa con paquetes limpios", () => {
    const r = revisarArchivos([{ nombre: "index.hbc", contenido: "limpio" }]);
    expect(r).toEqual({ fallas: [], revisados: 1 });
  });

  it("falla y nombra el archivo si aparece node-forge", () => {
    const { fallas } = revisarArchivos([
      { nombre: "a.hbc", contenido: "limpio" },
      { nombre: "b.hbc", contenido: "require('node-forge')" },
    ]);
    expect(fallas).toEqual(["b.hbc contiene node-forge (marcas: node-forge)"]);
  });

  it("falla si no hay ningún paquete", () => {
    expect(revisarArchivos([]).fallas[0]).toContain("no generó ningún paquete");
  });
});
