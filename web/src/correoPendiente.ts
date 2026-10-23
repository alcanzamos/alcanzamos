// El correo que la persona escribió, solo para mostrarlo en PN-59 («Te enviamos un enlace a …»).
// Vive en sessionStorage de esta pestaña: no se manda a ninguna parte ni se guarda en otro lado.
const CLAVE = "correo-pendiente";

export function guardarCorreo(correo: string) {
  try {
    sessionStorage.setItem(CLAVE, correo);
  } catch {
    // Sin almacenamiento (modo privado estricto): PN-59 usa el texto sin dirección.
  }
}

export function leerCorreo(): string | null {
  try {
    return sessionStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}
