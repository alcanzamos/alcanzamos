import { formatear, textos } from './textos/es.generated';

// ACC-004 (bug 224, D-187): cómo se dice un monto en voz alta. TalkBack lee «$15.000» como «15 dólares, cero, cero, cero»
// (toma «$» por dólares y el punto de miles por una pausa), así que el nombre accesible de un monto no usa `formatearPesos`:
// dice los dígitos sin separador de miles y la palabra «pesos» («15000 pesos»), que el sintetizador lee igual en cualquier
// idioma del teléfono. El texto que se ve no cambia. Los centavos solo se dicen si no son cero. Sin `Intl` (Hermes) y con
// `bigint`: un monto de 64 bits no cabe exacto en un `number`.
const h = textos.montoHablado;

// El plural es la regla manual del español (D-163): `one` solo para 1.
const cuanto = (n: bigint, formas: typeof h.pesos | typeof h.centavos) =>
  formatear(n === 1n ? formas.one : formas.other, { n: String(n) });

export function montoHablado(centavos: bigint): string {
  const absoluto = centavos < 0n ? -centavos : centavos;
  const pesos = absoluto / 100n;
  const resto = absoluto % 100n;
  const dicho =
    resto === 0n
      ? cuanto(pesos, h.pesos)
      : pesos === 0n
        ? cuanto(resto, h.centavos)
        : formatear(h.conCentavos, { pesos: cuanto(pesos, h.pesos), centavos: cuanto(resto, h.centavos) });
  return `${centavos < 0n ? '-' : ''}${dicho}`;
}
