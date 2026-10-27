// Único lugar que llama al API (D-129): rutas relativas del mismo origen y la cookie de sesión.
// No decide nada de negocio: devuelve el estado, el código de error y los errores de campo que manda el API.
export type Respuesta<T> =
  | { ok: true; estado: number; cuerpo: T }
  | {
      ok: false;
      estado: number;
      codigo: string;
      campos: Record<string, string>;
    };

/** `estado` 0 y este código: el pedido no llegó (sin internet o el servidor no contestó). */
export const SIN_CONEXION = "sin_conexion";

type Cuerpo = Record<string, unknown>;

async function leerJson(respuesta: Response): Promise<Cuerpo> {
  try {
    const cuerpo: unknown = await respuesta.json();
    return typeof cuerpo === "object" && cuerpo !== null
      ? (cuerpo as Cuerpo)
      : {};
  } catch {
    return {};
  }
}

function camposDe(cuerpo: Cuerpo): Record<string, string> {
  const campos = cuerpo.campos;
  if (typeof campos !== "object" || campos === null) return {};
  return Object.fromEntries(
    Object.entries(campos).filter(
      (par): par is [string, string] => typeof par[1] === "string",
    ),
  );
}

export async function pedir<T = Cuerpo>(
  metodo: "GET" | "POST" | "DELETE",
  ruta: string,
  cuerpo?: Cuerpo | string,
): Promise<Respuesta<T>> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(cuerpo ? { "Content-Type": "application/json" } : {}),
      },
      // Un cuerpo en texto ya es JSON: lo arma quien lleva un entero que no cabe exacto en un `number` (los centavos).
      body:
        typeof cuerpo === "string"
          ? cuerpo
          : cuerpo
            ? JSON.stringify(cuerpo)
            : undefined,
    });
  } catch {
    return { ok: false, estado: 0, codigo: SIN_CONEXION, campos: {} };
  }
  const datos = await leerJson(respuesta);
  if (respuesta.ok)
    return { ok: true, estado: respuesta.status, cuerpo: datos as T };
  return {
    ok: false,
    estado: respuesta.status,
    codigo: typeof datos.error === "string" ? datos.error : "desconocido",
    campos: camposDe(datos),
  };
}
