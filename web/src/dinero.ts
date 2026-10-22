// Única función que muestra dinero en la web (D-082, E17-ECO 4.8): los montos son centavos enteros.
// Formato colombiano: punto para los miles, coma para los centavos, y los centavos solo si no son cero.
// Sin Intl ni parseFloat: así el resultado no depende de los datos de idioma del navegador ni de decimales binarios.
export function formatearPesos(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new RangeError("El monto debe ser un entero de centavos");
  }
  const absoluto = Math.abs(centavos);
  const pesos = Math.trunc(absoluto / 100);
  const resto = absoluto % 100;
  const miles = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimales = resto === 0 ? "" : `,${String(resto).padStart(2, "0")}`;
  // Un monto negativo (por ejemplo un saldo en contra) lleva el signo antes del peso: «-$80.000».
  const signo = centavos < 0 ? "-" : "";
  return `${signo}$${miles}${decimales}`;
}
