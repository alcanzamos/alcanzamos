import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// E17-ECO 4.5: los componentes usan tokens semánticos (`var(--color-*)`), nunca colores ni medidas sueltas.
// Esta regla cubre el código TypeScript; las hojas CSS las revisa tests/estilos/estilos.test.ts.
const colorOMedidaSuelta = [
  {
    selector:
      "Literal[value=/#[0-9a-fA-F]{3,8}\\b|\\b(rgba?|hsla?)\\(|\\b\\d+(\\.\\d+)?(px|rem|em)\\b/]",
    message:
      "Color o medida suelta: usa un token semántico (var(--color-*), var(--espacio-*)).",
  },
  {
    selector:
      "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\b(rgba?|hsla?)\\(|\\b\\d+(\\.\\d+)?(px|rem|em)\\b/]",
    message:
      "Color o medida suelta: usa un token semántico (var(--color-*), var(--espacio-*)).",
  },
  {
    selector: "Literal[value=/--paleta-/]",
    message:
      "La paleta primitiva no se usa en componentes: usa tokens semánticos (--color-*).",
  },
  {
    selector:
      "Literal[value=/alcanzamos\\.co|localhost|127\\.0\\.0\\.1|^https?:\\/\\//]",
    message:
      "Sin dominio fijo (D-129): el API es del mismo origen, usa rutas relativas como /api/....",
  },
];

// D-162: sin textos sueltos en JSX. Equivale a `react/jsx-no-literals` con `noStrings: true` (el complemento no se
// usa: eslint-plugin-react no publica desde abril de 2025). Los textos salen del módulo generado desde
// diseno/textos/es.json. Se permiten el espacio en blanco, las cadenas vacías (`alt=""`) y los números. En las
// propiedades solo se revisan las que llevan texto que ve o lee la persona: las de HTML (aria-label, title, alt,
// placeholder) y las de los componentes de la app (titulo, etiqueta, ayuda, texto, error, mensaje); className, type,
// id, href, etc. quedan libres. Sin salir de un nivel, también se revisa `cond ? "a" : "b"` y `cond && "a"`.
// tests/eslint/texto-suelto.test.ts prueba lo que debe y lo que no debe reportar.
const textoSuelto =
  "Texto suelto en JSX: usa un texto de src/textos/es.generated.ts (diseno/textos/es.json).";
const hijoDeJsx =
  "JSXExpressionContainer[parent.type=/^JSX(Element|Fragment)$/]";
const propiedadDeTexto =
  "JSXAttribute[name.name=/^(aria-label|title|alt|placeholder|titulo|etiqueta|ayuda|texto|error|mensaje)$/]";
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
    ignores: [
      "dist/",
      "coverage/",
      "playwright-report/",
      "test-results/",
      "src/estilos/tokens.css",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": "allow-with-description", minimumDescriptionLength: 10 },
      ],
      "no-restricted-syntax": [
        "error",
        ...colorOMedidaSuelta,
        ...textoSueltoEnJsx,
      ],
    },
  },
  {
    files: ["**/*.config.{js,ts}", "scripts/**", "e2e/**", "tests/**"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-restricted-syntax": "off" },
  },
);
