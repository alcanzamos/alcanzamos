// Configuración en tiempo de ejecución (US-79, E11-INF 2.16): la imagen de la web se compila una vez y sirve a cada
// ambiente, así que el origen del API no se fija al compilar. `ca-web` arma `/config.json` desde `API_URL` y la web
// lo lee antes de montar. Sin configuración cargada las rutas quedan relativas (las pruebas y nada más: `arrancar`
// no monta la app si la carga falla).
let origenDelApi = "";

/** Origen del API sin barra final: `https://api.alcanzamos.co`. Vacío hasta que `cargarConfiguracion` lo lee. */
export const urlDelApi = (ruta: string): string => origenDelApi + ruta;

export const fijarOrigenDelApi = (origen: string): void => {
  origenDelApi = origen;
};

export const reiniciarConfiguracion = (): void => {
  origenDelApi = "";
};

/** Lee `/config.json` (del mismo origen que la web, nunca en caché) y fija el origen del API. Lanza si no puede. */
export async function cargarConfiguracion(): Promise<void> {
  const respuesta = await fetch("/config.json", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!respuesta.ok)
    throw new Error(`/config.json respondió ${respuesta.status}`);
  const cuerpo: unknown = await respuesta.json();
  const url =
    typeof cuerpo === "object" && cuerpo !== null
      ? (cuerpo as { url_api?: unknown }).url_api
      : undefined;
  if (typeof url !== "string") throw new Error("/config.json sin url_api");
  const { protocol, origin } = new URL(url);
  if (protocol !== "https:" && protocol !== "http:")
    throw new Error("url_api no es http(s)");
  fijarOrigenDelApi(origin);
}
