// Conversión de tokens para la web (US-57, S1). Se ejecuta con `npm run tokens` desde web/.
// Reutiliza la lectura y el aplanado de conjuntos de la configuración de React Native, que queda intacta.
// Genera variables CSS con los tokens semánticos y de componente; la paleta primitiva (`paleta.*`) no se emite,
// así que las hojas de estilo no pueden usarla (E17-ECO 4.5).
import base from './style-dictionary.config.mjs';

const comoPx = new Set(['fontSizes', 'spacing', 'borderRadius', 'borderWidth', 'sizing']);
const soportados = new Set(['color', 'fontFamilies', 'fontWeights', 'typography', ...comoPx]);

const nombreDe = (ruta) => `--${ruta.join('-')}`;

function aCss({ dictionary }) {
  const noConvertidos = [];
  const lineas = [];
  for (const token of dictionary.allTokens) {
    const tipo = token.$type ?? token.type;
    const ruta = token.path;
    if (ruta[0] === 'paleta') continue;
    const v = token.$value;
    if (!soportados.has(tipo)) {
      noConvertidos.push(`${ruta.join('.')} (${tipo})`);
      continue;
    }
    if (tipo === 'typography') {
      lineas.push(
        `  ${nombreDe([...ruta, 'font-family'])}: "${v.fontFamilies}";`,
        `  ${nombreDe([...ruta, 'font-weight'])}: ${v.fontWeights};`,
        `  ${nombreDe([...ruta, 'font-size'])}: ${Number(v.fontSizes)}px;`,
        // En CSS el interlineado se queda como factor sin unidad, igual que en el token.
        `  ${nombreDe([...ruta, 'line-height'])}: ${Number(v.lineHeight)};`,
        `  ${nombreDe([...ruta, 'letter-spacing'])}: ${Number(v.letterSpacing)}px;`,
      );
    } else if (comoPx.has(tipo)) {
      lineas.push(`  ${nombreDe(ruta)}: ${Number(v)}px;`);
    } else if (tipo === 'fontFamilies') {
      lineas.push(`  ${nombreDe(ruta)}: "${v}";`);
    } else {
      lineas.push(`  ${nombreDe(ruta)}: ${v};`);
    }
  }
  const aviso = noConvertidos.length
    ? `/* Tokens sin conversión: ${noConvertidos.join(', ')} */\n`
    : '/* Tokens sin conversión: ninguno */\n';
  return `/* Archivo generado por \`npm run tokens\` desde diseno/tokens/alcanzamos.tokens.json. No editar a mano. */\n${aviso}\n:root {\n${lineas.join('\n')}\n}\n`;
}

export default {
  source: base.source,
  log: base.log,
  hooks: {
    preprocessors: base.hooks.preprocessors,
    formats: { 'css/variables-web': aCss },
  },
  preprocessors: base.preprocessors,
  platforms: {
    web: {
      transforms: ['name/kebab'],
      buildPath: 'src/estilos/',
      files: [{ destination: 'tokens.css', format: 'css/variables-web' }],
    },
  },
};
