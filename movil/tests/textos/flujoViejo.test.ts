import * as fs from 'fs';
import * as path from 'path';

// US-61 (D-172): Android crea la cuenta verificando primero. Los textos del flujo viejo (PN-58 con tres datos,
// «Ya lo confirmé», «Cambiar el correo», sesión limitada) ya no se usan: esta prueba falla si alguno vuelve a
// es.json, en cualquier sección (comun, solo_web o solo_android). Mira solo los valores `texto`, no las referencias
// `e14`, que pueden citar el texto que reemplazan.

const raiz = path.resolve(__dirname, '../..');
const json = JSON.parse(fs.readFileSync(path.join(raiz, '../diseno/textos/es.json'), 'utf8')) as unknown;

const DEL_FLUJO_VIEJO = [
  'Solo necesitamos tres datos.',
  'Ya lo confirmé',
  'Cambiar el correo',
  'Todavía no confirmaste tu correo.',
  'Abre el enlace que te enviamos.',
  'No pudimos revisar si confirmaste tu correo.',
  'No pudimos confirmar tu correo.',
  'Te enviaremos un enlace para confirmarlo.',
  'Te enviamos un enlace a {correo}. Ábrelo para confirmar tu cuenta.',
  'Te enviamos un enlace a tu correo. Ábrelo para confirmar tu cuenta.',
  'Después de confirmar tu correo verás cómo cuidamos tus datos y decidirás si los autorizas.',
];

function textos(nodo: unknown, ruta: string, salida: [string, string][]): [string, string][] {
  if (nodo === null || typeof nodo !== 'object') return salida;
  for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
    const aqui = ruta ? `${ruta}.${clave}` : clave;
    if (clave === 'texto') {
      if (typeof valor === 'string') salida.push([aqui, valor]);
      else if (valor && typeof valor === 'object')
        for (const [forma, t] of Object.entries(valor as Record<string, unknown>))
          if (typeof t === 'string') salida.push([`${aqui}.${forma}`, t]);
    } else if (clave !== 'e14') {
      textos(valor, aqui, salida);
    }
  }
  return salida;
}

describe('es.json sin los textos del flujo viejo de crear la cuenta (US-61, D-172)', () => {
  const todos = textos(json, '', []);

  it('lee los textos de es.json', () => {
    expect(todos.length).toBeGreaterThan(100);
  });

  it.each(DEL_FLUJO_VIEJO)('no queda «%s»', (viejo) => {
    expect(todos.filter(([, t]) => t === viejo).map(([clave]) => clave)).toEqual([]);
  });
});
