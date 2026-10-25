import * as fs from 'fs';
import * as path from 'path';

// S6 (US-59): al final de la corrida, Jest vuelve a listar el nombre completo de cada prueba que falla («Summary of all
// failing tests»), también con --silent y con pocas suites. Sin `summaryThreshold: 0` Jest solo lo imprime con más de 20
// suites, y una corrida parcial no lo mostraría. Que la opción esté puesta se protege aquí; que el resumen salga se
// comprobó a mano (ver el PR).
describe('configuración de Jest (S6)', () => {
  it('el reporter por defecto imprime el resumen de pruebas que fallan desde la primera suite', () => {
    const paquete = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')) as {
      jest: { reporters: [string, { summaryThreshold: number }][] };
    };
    expect(paquete.jest.reporters).toEqual([['default', { summaryThreshold: 0 }]]);
  });
});
