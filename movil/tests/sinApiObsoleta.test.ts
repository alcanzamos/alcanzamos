import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// ACC-004 (L2 y L6 del dueño, 2026-11-08): sin funciones obsoletas de Android. `announceForAccessibility` (y su variante
// con opciones) arma un `TYPE_ANNOUNCEMENT` con `AccessibilityEvent.obtain`, obsoleto desde la API 33;
// `setAccessibilityFocus` está obsoleto en Fabric. Los avisos van por la región viva y el foco con
// `sendAccessibilityEvent`. ESLint también lo revisa (`no-restricted-properties`); esta prueba cubre cualquier forma de
// escribirlo en src/.
const OBSOLETAS = /announceForAccessibility|setAccessibilityFocus/;

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) return archivos(ruta);
    return /\.(ts|tsx)$/.test(entrada.name) ? [ruta] : [];
  });
}

describe('sin API obsoleta de accesibilidad (ACC-004)', () => {
  it('ningún archivo de src/ usa announceForAccessibility ni setAccessibilityFocus', () => {
    const raiz = join(__dirname, '..');
    const conObsoletas = archivos(join(raiz, 'src'))
      .filter((ruta) => OBSOLETAS.test(readFileSync(ruta, 'utf8')))
      .map((ruta) => relative(raiz, ruta));
    expect(conObsoletas).toEqual([]);
  });
});

describe('ESLint rechaza la API obsoleta de accesibilidad (no-restricted-properties)', () => {
  const raiz = join(__dirname, '..');
  const llamadas = [
    "AccessibilityInfo.announceForAccessibility('Listo.');",
    "AccessibilityInfo.announceForAccessibilityWithOptions('Listo.', { queue: true });",
    'AccessibilityInfo.setAccessibilityFocus(1);',
  ];
  const codigo = (llamada: string) => `import { AccessibilityInfo } from 'react-native';\n${llamada}\n`;
  const salida = execFileSync(process.execPath, [join(raiz, 'tests/ayudas/eslint-nodo.mjs')], {
    cwd: raiz,
    input: JSON.stringify({ codigos: [...llamadas, "AccessibilityInfo.sendAccessibilityEvent(null, 'focus');"].map(codigo) }),
    encoding: 'utf8',
  });
  const { deCodigos } = JSON.parse(salida) as { deCodigos: { ruleId: string | null }[][] };
  const restringidas = (i: number) => deCodigos[i]!.filter((m) => m.ruleId === 'no-restricted-properties');

  it.each(llamadas.map((llamada, i) => [llamada, i] as const))('reporta %s', (_llamada, i) => {
    expect(restringidas(i)).toHaveLength(1);
  });

  it('no reporta sendAccessibilityEvent, que no está obsoleto', () => {
    expect(restringidas(llamadas.length)).toEqual([]);
  });
});
