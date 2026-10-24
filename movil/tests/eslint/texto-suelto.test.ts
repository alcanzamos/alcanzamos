import { execFileSync } from 'child_process';
import * as path from 'path';

// D-162 (US-59, S2): la regla de movil/eslint.config.mjs que impide textos sueltos en JSX hace lo mismo que
// `react/jsx-no-literals` con `noStrings: true` (sin instalar el complemento) y es la misma de web, con las propiedades
// de texto de React Native. Esta prueba corre ESLint de verdad con la configuración del proyecto: lo que DEBE reportar,
// lo que NO debe reportar, y que el código real pasa. ESLint corre en un proceso aparte (tests/ayudas/eslint-nodo.mjs).
const raiz = path.resolve(__dirname, '../..');

type Mensaje = { ruleId: string | null; message: string };
type Salida = { deCodigos: Mensaje[][]; deArchivos: { archivo: string; mensajes: string[] }[] };

function correrEslint(codigos: string[], archivos: string[] = []): Salida {
  const salida = execFileSync(process.execPath, [path.join(raiz, 'tests/ayudas/eslint-nodo.mjs')], {
    cwd: raiz,
    input: JSON.stringify({ codigos, archivos }),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(salida) as Salida;
}

const envolver = (jsx: string) =>
  `export const Ejemplo = ({ cond, x }: { cond: boolean; x: string }) => ${jsx};\n`;

const debeReportar: [string, string][] = [
  ['texto como hijo', '<Text>Hola</Text>'],
  ['texto con tildes y signos', '<Text>¿Olvidaste tu contraseña?</Text>'],
  ['texto junto a otro elemento', '<Text>Hola <Text>{x}</Text></Text>'],
  ['texto en un fragmento', '<>Hola</>'],
  ['texto en varias líneas', '<Text>\n  Hola\n  mundo\n</Text>'],
  ['cadena en una expresión hija', '<Text>{"Hola"}</Text>'],
  ['plantilla en una expresión hija', '<Text>{`Hola ${x}`}</Text>'],
  ['plantilla sin datos en una expresión hija', '<Text>{`Hola`}</Text>'],
  ['cadena en un ternario hijo', '<Text>{cond ? "Sí" : x}</Text>'],
  ['cadena en un && hijo', '<Text>{cond && "Hola"}</Text>'],
  ['texto como hijo de un botón', '<Boton alTocar={x}>Guardar</Boton>'],
  ['accessibilityLabel', '<Pressable accessibilityLabel="Atrás" />'],
  ['accessibilityHint', '<Pressable accessibilityHint="Abre la lista" />'],
  ['aria-label', '<Pressable aria-label="Atrás" />'],
  ['placeholder', '<TextInput placeholder="Correo" />'],
  ['title', '<Button title="Guardar" onPress={x} />'],
  ['titulo de un componente', '<Pantalla titulo="Hola" />'],
  ['etiqueta de un componente', '<CampoDeTexto etiqueta="Correo" />'],
  ['ayuda de un componente', '<CampoDeTexto ayuda="Usa una frase" />'],
  ['pista de un botón', '<Boton pista="Abre la lista" />'],
  ['error de un componente', '<CampoDeTexto error="Falta" />'],
  ['mensaje de un componente', '<Aviso mensaje="Hola" />'],
  ['propiedad con cadena entre llaves', '<Pressable accessibilityLabel={"Atrás"} />'],
  ['propiedad con plantilla', '<Pressable accessibilityLabel={`Atrás ${x}`} />'],
  ['propiedad con ternario', '<Pressable accessibilityLabel={cond ? "Ver" : "Ocultar"} />'],
  ['propiedad con ||', '<Pressable accessibilityHint={x || "Sin pista"} />'],
];

const noDebeReportar: [string, string][] = [
  ['un dato como hijo', '<Text>{x}</Text>'],
  ['espacio en blanco entre elementos', '<View> <Text>{x}</Text> </View>'],
  ['un salto de línea entre elementos', '<View>\n  <Text>{x}</Text>\n</View>'],
  ['un espacio entre llaves', '<Text>{x}{" "}{x}</Text>'],
  ['un número', '<Text>{1}</Text>'],
  ['un comentario JSX', '<View>{/* nota */}</View>'],
  ['una cadena vacía', "<Text>{cond ? x : ''}</Text>"],
  ['un elemento condicional', '<View>{cond && <Text>{x}</Text>}</View>'],
  ['accessibilityRole', '<Pressable accessibilityRole="button" />'],
  ['accessibilityLiveRegion', '<View accessibilityLiveRegion="polite" />'],
  ['importantForAccessibility', '<Text importantForAccessibility="no">{x}</Text>'],
  ['autoComplete y keyboardType', '<TextInput autoComplete="email" keyboardType="email-address" />'],
  ['propiedades del proyecto que no son texto', '<CampoDeTexto autocompletar="email" teclado="email-address" />'],
  ['variante de un componente', '<Boton variante="secundario">{x}</Boton>'],
  ['propiedades de texto con datos', '<Pressable accessibilityLabel={x} accessibilityHint={x} />'],
  ['propiedad con ternario de datos', '<Pressable accessibilityHint={cond ? x : undefined} />'],
  ['propiedad con join', '<Pressable accessibilityLabel={[x, x].join(", ")} />'],
];

describe('regla de textos sueltos en JSX (D-162)', () => {
  const todos = [...debeReportar, ...noDebeReportar];
  const { deCodigos } = correrEslint(todos.map(([, jsx]) => envolver(jsx)));
  const sueltos = (i: number) => (deCodigos[i] ?? []).filter((m) => m.message.startsWith('Texto suelto'));

  describe('reporta', () => {
    it.each(debeReportar.map(([caso], i) => [caso, i] as const))('%s', (_caso, i) => {
      expect(sueltos(i).length).toBeGreaterThan(0);
    });

    it('dice dónde está el texto', () => {
      expect(sueltos(0)[0]?.ruleId).toBe('no-restricted-syntax');
      expect(sueltos(0)[0]?.message).toMatch(/es\.generated\.ts/);
    });
  });

  describe('no reporta', () => {
    it.each(noDebeReportar.map(([caso], i) => [caso, debeReportar.length + i] as const))('%s', (_caso, i) => {
      expect(sueltos(i)).toEqual([]);
      // Un error de sintaxis (ruleId nulo) no cuenta como «no reporta».
      expect((deCodigos[i] ?? []).filter((m) => m.ruleId === null)).toEqual([]);
    });

    it('una cadena fuera de JSX', () => {
      const { deCodigos: fuera } = correrEslint(['export const mensaje = "Hola";\nconsole.info("Hola");\n']);
      expect((fuera[0] ?? []).filter((m) => m.message.startsWith('Texto suelto'))).toEqual([]);
    });
  });

  it('el código real (src/ y App.tsx) pasa ESLint sin hallazgos', () => {
    const { deArchivos } = correrEslint([], ['src/**/*.{ts,tsx}', 'App.tsx']);
    expect(deArchivos.length).toBeGreaterThan(30);
    expect(deArchivos.flatMap((r) => r.mensajes.map((m) => `${path.relative(raiz, r.archivo)}:${m}`))).toEqual([]);
  });
});
