import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// E17-ECO 4.5: los componentes usan tokens semánticos (`var(--color-*)`), nunca colores ni medidas sueltas.
// Esta regla cubre el código TypeScript; las hojas CSS las revisa src/estilos/estilos.test.ts.
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

export default tseslint.config(
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
      "no-restricted-syntax": ["error", ...colorOMedidaSuelta],
    },
  },
  {
    files: [
      "**/*.config.{js,ts}",
      "scripts/**",
      "e2e/**",
      "src/**/*.test.{ts,tsx}",
      "src/pruebas/**",
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-restricted-syntax": "off" },
  },
);
