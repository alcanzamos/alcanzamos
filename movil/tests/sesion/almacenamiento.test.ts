import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// D-155 (2): el token se guarda solo en el Keystore (expo-secure-store), nunca en AsyncStorage ni en texto plano.
// Esta prueba mira el código: AsyncStorage solo puede aparecer en el módulo que recuerda el resultado de la edad
// (no secreto, D-089), y ninguna escritura a archivos ni a localStorage existe en src/.
const raiz = join(__dirname, '../../src');

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? archivos(join(carpeta, e.name)) : [join(carpeta, e.name)],
  );
}

const codigo = archivos(raiz)
  .filter((a) => /\.(ts|tsx)$/.test(a) && !a.includes('/tokens/'))
  .map((ruta) => ({ ruta: ruta.slice(raiz.length + 1), texto: readFileSync(ruta, 'utf8') }));

describe('dónde se guarda lo de la sesión', () => {
  it('AsyncStorage no aparece fuera del módulo de la edad', () => {
    const usan = codigo.filter((c) => /async-storage|AsyncStorage/.test(c.texto)).map((c) => c.ruta);
    expect(usan.filter((ruta) => !ruta.startsWith('edad/'))).toEqual([]);
  });

  it('el token solo se guarda con expo-secure-store', () => {
    const usanSecureStore = codigo.filter((c) => c.texto.includes('expo-secure-store')).map((c) => c.ruta);
    expect(usanSecureStore).toEqual(['sesion/token.ts']);
  });

  it('no hay otro almacenamiento ni archivos en src/', () => {
    const prohibidos = /localStorage|sessionStorage|expo-file-system|node:fs|MMKV|expo-sqlite/;
    expect(codigo.filter((c) => prohibidos.test(c.texto)).map((c) => c.ruta)).toEqual([]);
  });
});
