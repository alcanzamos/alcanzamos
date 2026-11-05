import { montoHablado } from '../src/montoHablado';

// ACC-004 (bug 224, D-187): TalkBack lee «$15.000» como «15 dólares, cero, cero, cero». El monto hablado lleva los dígitos
// sin separador de miles y la palabra «pesos»: así el sintetizador lo lee igual en cualquier idioma del teléfono.
describe('montoHablado (ACC-004)', () => {
  it.each([
    [1500000n, '15000 pesos'],
    [10000000n, '100000 pesos'],
    [120000000n, '1200000 pesos'],
    [8000000n, '80000 pesos'],
  ])('%s centavos se dicen «%s»', (centavos, dicho) => {
    expect(montoHablado(centavos)).toBe(dicho);
    expect(dicho).not.toMatch(/[$.,]/);
  });

  it('un peso va en singular y cero y dos van en plural (la regla manual de D-163)', () => {
    expect(montoHablado(100n)).toBe('1 peso');
    expect(montoHablado(200n)).toBe('2 pesos');
    expect(montoHablado(0n)).toBe('0 pesos');
  });

  it('los centavos distintos de cero se dicen después de los pesos', () => {
    expect(montoHablado(4500050n)).toBe('45000 pesos con 50 centavos');
    expect(montoHablado(101n)).toBe('1 peso con 1 centavo');
    expect(montoHablado(12345678n)).toBe('123456 pesos con 78 centavos');
  });

  it('menos de un peso dice solo los centavos', () => {
    expect(montoHablado(50n)).toBe('50 centavos');
    expect(montoHablado(1n)).toBe('1 centavo');
  });

  it('un monto negativo lleva el signo delante (nunca aparece «$»)', () => {
    expect(montoHablado(-4500050n)).toBe('-45000 pesos con 50 centavos');
  });

  it('un monto de 64 bits se dice exacto, sin pasar por un number', () => {
    expect(montoHablado(9223372036854775807n)).toBe('92233720368547758 pesos con 7 centavos');
  });
});
