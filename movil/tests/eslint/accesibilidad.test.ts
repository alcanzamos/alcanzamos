import { execFileSync } from 'child_process';
import * as path from 'path';

// D-182 (3): ESLint 10 con eslint-plugin-react-native-a11y. Que `npm run lint` pase sin errores no prueba que las
// reglas de accesibilidad sigan vivas, así que esta prueba corre ESLint 10 de verdad (API de Node, en un proceso aparte:
// tests/ayudas/eslint-a11y-nodo.mjs) con la configuración del proyecto y exige que CADA regla activa reporte un error
// en su fixture (tests/eslint/fixtures-a11y/<regla>.jsx). Las reglas activas se leen de la configuración resuelta: una
// regla nueva sin fixture hace fallar la prueba. Los fixtures son .jsx para que tsc no los revise.
const raiz = path.resolve(__dirname, '../..');
const PREFIJO = 'react-native-a11y/';

type Salida = { activas: string[]; resultados: Record<string, string[]> };

const salida = JSON.parse(
  execFileSync(process.execPath, [path.join(raiz, 'tests/ayudas/eslint-a11y-nodo.mjs')], {
    cwd: raiz,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }),
) as Salida;

describe('reglas de accesibilidad de react-native-a11y con ESLint 10 (D-182)', () => {
  it('hay reglas activas', () => {
    expect(salida.activas.length).toBeGreaterThan(10);
  });

  it('cada regla activa tiene su fixture, y cada fixture una regla activa', () => {
    expect(Object.keys(salida.resultados).sort()).toEqual(salida.activas);
  });

  it('el código real de src/ pasa ESLint sin hallazgos', () => {
    const { deArchivos } = JSON.parse(
      execFileSync(process.execPath, [path.join(raiz, 'tests/ayudas/eslint-nodo.mjs')], {
        cwd: raiz,
        input: JSON.stringify({ archivos: ['src/**/*.{ts,tsx}'] }),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      }),
    ) as { deArchivos: { archivo: string; mensajes: string[] }[] };
    expect(deArchivos.length).toBeGreaterThan(20);
    expect(deArchivos.flatMap((r) => r.mensajes.map((m) => `${r.archivo}:${m}`))).toEqual([]);
  }, 60_000);

  it.each(salida.activas)('%s reporta un error en su fixture', (regla) => {
    expect(salida.resultados[regla]).toContain(`${PREFIJO}${regla}`);
  });
});
