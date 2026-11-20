import { hostsEnClaro } from "../plugins/redDeMedicion";

// Límites de las direcciones privadas (RFC 1918) que el perfil de medición acepta para HTTP en claro.
describe("límites RFC 1918 de medición", () => {
  it.each([
    "10.0.0.0",
    "10.255.255.255",
    "172.16.0.0",
    "172.31.255.255",
    "192.168.0.0",
    "192.168.255.255",
  ])("permite %s sin incluir el puerto", (host) => {
    expect(hostsEnClaro(`http://${host}:18090`)).toEqual([host, "localhost"]);
  });

  it.each([
    "172.15.255.255",
    "172.32.0.0",
    "192.169.1.1",
    "11.0.0.0",
    "127.0.0.1",
    "0.0.0.0",
    "[::1]",
    "example.com",
    "10.256.0.1",
  ])("rechaza %s", (host) => {
    expect(() => hostsEnClaro(`http://${host}:18090`)).toThrow();
  });

  it.each([
    ["http://192.168.001.036:18090", "192.168.1.30"],
    ["http://012.0.0.1:18090", "10.0.0.1"],
  ])("valida y emite el host normalizado de %s", (url, host) => {
    expect(hostsEnClaro(url)).toEqual([host, "localhost"]);
  });
});
