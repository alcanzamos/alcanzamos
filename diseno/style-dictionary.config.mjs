// Conversión de tokens para React Native (S1, US-45). Se ejecuta con `npm run tokens` desde movil/.
// El JSON usa la forma de Tokens Studio: conjuntos en la raíz (base/*, modo/*) más $themes y $metadata.
// Sin imports: la configuración vive fuera de movil/ y no ve su node_modules.
const aqui = new URL('.', import.meta.url).pathname;

// Tipos que sabe convertir a valores de React Native. Cualquier otro se informa y se omite.
const comoNumero = new Set(['fontSizes', 'spacing', 'borderRadius', 'borderWidth', 'sizing']);
const soportados = new Set(['color', 'fontFamilies', 'fontWeights', 'typography', ...comoNumero]);

const esToken = (nodo) => nodo !== null && typeof nodo === 'object' && '$value' in nodo;

// Une los conjuntos en un solo árbol para que las referencias ({paleta.monte.base}) se resuelvan sin prefijo de conjunto.
function aplanarConjuntos(tokens) {
  const orden = tokens.$metadata?.tokenSetOrder ?? [];
  const raiz = {};
  const unir = (destino, origen) => {
    for (const [clave, valor] of Object.entries(origen)) {
      if (esToken(valor) || typeof valor !== 'object') destino[clave] = valor;
      else unir((destino[clave] ??= {}), valor);
    }
  };
  for (const conjunto of orden) unir(raiz, tokens[conjunto] ?? {});
  return raiz;
}

function aTypeScript({ dictionary }) {
  const noConvertidos = [];
  const px = (v) => Number(v);
  const convertir = (token) => {
    const tipo = token.$type ?? token.type;
    const v = token.$value;
    if (!soportados.has(tipo)) {
      noConvertidos.push(`${token.path.join('.')} (${tipo})`);
      return undefined;
    }
    if (comoNumero.has(tipo)) return px(v);
    if (tipo === 'typography') {
      const tamano = px(v.fontSizes);
      return {
        fontFamily: v.fontFamilies,
        fontWeight: String(v.fontWeights),
        fontSize: tamano,
        // React Native usa interlineado absoluto: el token es un factor sobre el tamaño.
        lineHeight: Math.round(tamano * Number(v.lineHeight) * 100) / 100,
        letterSpacing: px(v.letterSpacing),
      };
    }
    return String(v);
  };
  const arbol = {};
  for (const token of dictionary.allTokens) {
    const valor = convertir(token);
    if (valor === undefined) continue;
    let nodo = arbol;
    token.path.slice(0, -1).forEach((p) => (nodo = nodo[p] ??= {}));
    nodo[token.path.at(-1)] = valor;
  }
  const cuerpo = `export const tokens = ${JSON.stringify(arbol, null, 2)} as const;`;
  const aviso = noConvertidos.length
    ? `// Tokens sin conversión: ${noConvertidos.join(', ')}\n`
    : '// Tokens sin conversión: ninguno\n';
  return `// Archivo generado por \`npm run tokens\` desde diseno/tokens/alcanzamos.tokens.json. No editar a mano.\n${aviso}\n${cuerpo}\n`;
}

export default {
  source: [`${aqui}tokens/alcanzamos.tokens.json`],
  log: { warnings: 'warn', verbosity: 'default' },
  hooks: {
    preprocessors: { 'tokens-studio-conjuntos': aplanarConjuntos },
    formats: { 'rn/typescript': aTypeScript },
  },
  preprocessors: ['tokens-studio-conjuntos'],
  platforms: {
    movil: {
      transforms: ['name/kebab'], // solo el nombre (único); los valores salen tal cual están en el JSON
      buildPath: 'src/tokens/',
      files: [{ destination: 'tokens.generated.ts', format: 'rn/typescript' }],
    },
  },
};
