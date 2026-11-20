import { hostsEnClaro } from "../plugins/redDeMedicion";

// Con `adb reverse tcp:18090 tcp:18090` el celular habla con el API del portátil por `localhost`: el perfil de
// medición permite HTTP en claro solo hacia ese nombre. Ninguna dirección de la red local ni de loopback por número.
describe("hosts con HTTP en claro en medición", () => {
  it.each(["http://localhost:18090", "http://localhost", "http://LOCALHOST:8080/ruta", "http://localhost:18090/"])(
    "%s permite solo localhost",
    (url) => {
      expect(hostsEnClaro(url)).toEqual(["localhost"]);
    },
  );

  it.each([undefined, "", "   ", "https://api-uat.alcanzamos.co", "https://localhost:18090"])(
    "sin HTTP (%j) deja solo localhost",
    (url) => {
      expect(hostsEnClaro(url)).toEqual(["localhost"]);
    },
  );

  it.each([
    "10.0.0.0",
    "10.255.255.255",
    "172.16.0.0",
    "172.31.255.255",
    "192.168.0.0",
    "192.168.1.36",
    "192.168.255.255",
    "172.15.255.255",
    "172.32.0.0",
    "192.169.1.1",
    "11.0.0.0",
    "127.0.0.1",
    "127.1",
    "2130706433",
    "0.0.0.0",
    "[::1]",
    "example.com",
    "api-uat.alcanzamos.co",
    "localhost.",
    "localhost.example.com",
  ])("rechaza %s y explica adb reverse", (host) => {
    expect(() => hostsEnClaro(`http://${host}:18090`)).toThrow(/adb reverse/);
  });

  it.each(["no es una url", "http://10.256.0.1:18090"])("rechaza %s: no es una URL válida", (url) => {
    expect(() => hostsEnClaro(url)).toThrow(/URL válida/);
  });

  it("rechaza localhost en el usuario de la URL cuando el host real es otro", () => {
    expect(() => hostsEnClaro("http://localhost@192.168.1.36:18090")).toThrow(/adb reverse/);
  });
});
