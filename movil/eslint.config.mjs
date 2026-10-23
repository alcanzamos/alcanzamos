import js from "@eslint/js";
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

export default tseslint.config(
  {
    ignores: ["coverage/", ".expo/", "dist/", "src/tokens/tokens.generated.ts"],
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
      "no-restricted-syntax": ["error", ...colorOMedidaSuelta],
    },
  },
  {
    files: ["*.config.{js,mjs,ts}", "scripts/**", "tests/**"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
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
