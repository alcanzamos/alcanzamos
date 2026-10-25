import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactNativeA11y from "eslint-plugin-react-native-a11y";
import globals from "globals";
import tseslint from "typescript-eslint";

// E17-ECO 4.5: los componentes usan tokens semánticos (`tokens.color.*`, `tokens.espacio[...]`), nunca colores ni
// medidas sueltas. En React Native los estilos son objetos, no CSS: la regla mira los literales de texto (colores
// `#`, `rgb(`, `hsl(`, medidas con unidad, la paleta primitiva y dominios fijos) y los números distintos de cero en
// las propiedades de medida de un objeto de estilo (relleno, margen, separación, bordes, tamaños y alturas).
// No puede mirar valores que no sean literales (el resultado de una función o de una variable): esos los revisa el
// dueño con la lista de E17-ECO 6. `flex`, `opacity` y `zIndex` no son medidas y no se revisan.
const propiedadesDeMedida =
  "^(padding|margin|gap|rowGap|columnGap|top|left|right|bottom|start|end|width|height|fontSize|lineHeight|letterSpacing|borderRadius|border(Top|Bottom|Left|Right|Start|End)?Width|border(Top|Bottom)(Left|Right|Start|End)Radius|(min|max)(Width|Height)|(padding|margin)(Top|Bottom|Left|Right|Start|End|Horizontal|Vertical))$";

const colorOMedidaSuelta = [
  {
    selector:
      "Literal[value=/#[0-9a-fA-F]{3,8}\\b|\\b(rgba?|hsla?)\\(|\\b\\d+(\\.\\d+)?(px|rem|em|dp)\\b/]",
    message:
      "Color o medida suelta: usa un token semántico (tokens.color.*, tokens.espacio[...]).",
  },
  {
    selector:
      "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\b(rgba?|hsla?)\\(|\\b\\d+(\\.\\d+)?(px|rem|em|dp)\\b/]",
    message:
      "Color o medida suelta: usa un token semántico (tokens.color.*, tokens.espacio[...]).",
  },
  {
    selector: `Property[key.name=/${propiedadesDeMedida}/] > Literal.value[raw=/^-?(0*[1-9]|0*\\.0*[1-9])/]`,
    message:
      "Medida suelta en un estilo: usa un token (tokens.espacio[...], tokens['tamano-letra'][...], tokens.radio.*) o un valor de tokens.tipografia.",
  },
  {
    selector:
      "Literal[value=/paleta/], MemberExpression[property.name='paleta']",
    message:
      "La paleta primitiva no se usa en componentes: usa tokens semánticos (tokens.color.*).",
  },
  {
    selector:
      "Literal[value=/alcanzamos\\.co|localhost|127\\.0\\.0\\.1|^https?:\\/\\//]",
    message:
      "Sin dominio fijo (D-129): la URL pública del API viene de la configuración, no del código.",
  },
];

// D-162: sin textos sueltos en JSX. Equivale a `react/jsx-no-literals` con `noStrings: true` (el complemento no se
// usa: eslint-plugin-react no publica desde abril de 2025); es la misma regla de web/eslint.config.js. Los textos
// salen del módulo generado desde diseno/textos/es.json. Se permiten el espacio en blanco, las cadenas vacías y los
// números. En las propiedades solo se revisan las que llevan texto que ve o lee la persona: las de React Native
// (accessibilityLabel, accessibilityHint, aria-label, placeholder, title) y las de los componentes de la app (titulo,
// etiqueta, ayuda, pista, texto, error, mensaje); autocompletar, teclado, variante, accessibilityRole, etc. quedan
// libres. Sin salir de un nivel, también se revisa `cond ? "a" : "b"` y `cond && "a"`. Los argumentos de una función
// (`conBarra("...")`) no se ven: los revisa tests/textos/claves.test.ts (ninguna copia de un texto fuera del módulo).
// tests/eslint/texto-suelto.test.ts prueba lo que debe y lo que no debe reportar.
const textoSuelto = "Texto suelto en JSX: usa un texto de src/textos/es.generated.ts (diseno/textos/es.json).";
const hijoDeJsx = "JSXExpressionContainer[parent.type=/^JSX(Element|Fragment)$/]";
const propiedadDeTexto =
  "JSXAttribute[name.name=/^(accessibilityLabel|accessibilityHint|aria-label|placeholder|title|titulo|etiqueta|ayuda|pista|texto|error|mensaje)$/]";
const cadena = "Literal[value=type(string)][value=/\\S/]";
const cadenaOPlantilla = `:matches(${cadena}, TemplateLiteral)`;
const conCondicion = ":matches(ConditionalExpression, LogicalExpression)";
const textoSueltoEnJsx = [
  "JSXText[value=/\\S/]",
  `${hijoDeJsx} > ${cadenaOPlantilla}`,
  `${hijoDeJsx} > ${conCondicion} > ${cadenaOPlantilla}`,
  `${propiedadDeTexto} > ${cadena}`,
  `${propiedadDeTexto} > JSXExpressionContainer > ${cadenaOPlantilla}`,
  `${propiedadDeTexto} > JSXExpressionContainer > ${conCondicion} > ${cadenaOPlantilla}`,
].map((selector) => ({ selector, message: textoSuelto }));

export default defineConfig(
  {
    ignores: ["coverage/", ".expo/", "dist/", "src/tokens/tokens.generated.ts", "src/textos/es.generated.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  {
    // eslint-plugin-react-native-a11y (E17-ECO 4.10, ADR-003 §3): todas sus reglas.
    plugins: { "react-native-a11y": reactNativeA11y },
    rules: reactNativeA11y.configs.all.rules,
  },
  {
    languageOptions: { globals: { ...globals.es2022 } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": "allow-with-description", minimumDescriptionLength: 10 },
      ],
      "no-restricted-syntax": ["error", ...colorOMedidaSuelta, ...textoSueltoEnJsx],
    },
  },
  {
    files: ["*.config.{js,mjs,ts}", "scripts/**", "tests/**"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // D-162 no se aplica a PantallaCifras (siguen la regla de colores y medidas): es la pantalla de prueba de
    // tipografía, con cifras inventadas, y ninguna parte de la app la monta ya. App.tsx vuelve a la regla (D-163).
    files: ["src/PantallaCifras.tsx"],
    rules: { "no-restricted-syntax": ["error", ...colorOMedidaSuelta] },
  },
  {
    // Copia del SVG de la marca (marca/): sus colores son los del logo, no estilos de la app.
    files: ["assets/**"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // Metro y Babel cargan estos archivos con require().
    files: ["*.config.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Metro solo empaqueta las fuentes cargadas con require() estático; no existe un import equivalente.
    files: ["src/fuentes.ts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
