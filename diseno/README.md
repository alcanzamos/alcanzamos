# diseno/

Tokens de diseño (JSON en formato W3C) y textos de la interfaz, compartidos por `web/` y `movil/` (ADR-001, ADR-003, ADR-004). Se generan variables CSS y constantes de TypeScript con Style Dictionary.

- Licencia: AGPLv3, igual que el código (ver [`LICENSE`](../LICENSE)).
- No incluye el nombre, el logo, el símbolo ni el ícono: esos están en [`marca/`](../marca/), fuera de la AGPLv3.
- Tipografías (Figtree y Atkinson Hyperlegible Next) con su licencia OFL al lado, en [`fuentes/`](fuentes/).

## Tokens

- [`tokens/alcanzamos.tokens.json`](tokens/alcanzamos.tokens.json): copia byte a byte del archivo de E14 (`docs/adso/proyecto/03-diseno/E14-diseno-de-interfaz/tokens/`, repositorio privado). Si cambia allí, se vuelve a copiar aquí y se actualiza el hash.
- SHA-256 (E14 y esta copia, idénticos, verificados el 2026-10-22): `2fd6eb16f89cf789c62f3c041afffd1981ea3b0f74f8446e323d8ea445bbbc39`.
- Formato: conjuntos de Tokens Studio en la raíz (`base/color`, `base/tipografia`, `base/dimension`, `modo/claro`), más `$themes` y `$metadata`.

## Conversión para React Native (US-45, S1)

[`style-dictionary.config.mjs`](style-dictionary.config.mjs) con Style Dictionary 5.7.0 (fijado en `movil/package.json`). Desde `movil/`:

```
npm run tokens
```

Genera `movil/src/tokens/tokens.generated.ts` (no se edita a mano) con un solo objeto `tokens`.

- Un preprocesador une los conjuntos en un árbol, así que las referencias (`{paleta.monte.base}`) se resuelven sin prefijo de conjunto.
- Tipos convertidos: `color` (texto), `fontFamilies` (texto), `fontWeights` (texto, como pide React Native), `fontSizes`, `spacing`, `borderRadius`, `borderWidth`, `sizing` (números) y `typography` (objeto `fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing`).
- `lineHeight` pasa de factor a píxeles (React Native usa interlineado absoluto): 1,2 sobre 40 da 48.
- Tipos sin conversión: **ninguno** en este archivo. Si aparece uno nuevo, el generador lo omite y lo lista en la segunda línea del archivo generado.
- Solo hay modo claro; el modo oscuro, cuando exista, es un conjunto más en `$metadata.tokenSetOrder`.

## Fuentes

Archivos TTF estáticos, solo los pesos que usa la pantalla de prueba. Los de Google Fonts (`google/fonts`, carpeta `ofl/`) solo traen la fuente variable; los estáticos salen del repositorio de cada diseñador, en el mismo commit que registra Google Fonts en su `METADATA.pb` y `upstream_info.md` (commit `45e3d52` de `google/fonts`, consultado el 2026-10-22).

| Familia | Repositorio | Commit | Archivos | Licencia |
|---|---|---|---|---|
| Figtree 2.001 | [erikdkennedy/figtree](https://github.com/erikdkennedy/figtree) | `032dfa7fe219ef3a02890d6d3add84eacc9aebfe` | `Figtree-SemiBold.ttf`, `Figtree-Bold.ttf` | [`fuentes/figtree/OFL.txt`](fuentes/figtree/OFL.txt) |
| Atkinson Hyperlegible Next 2.001 | [googlefonts/atkinson-hyperlegible-next](https://github.com/googlefonts/atkinson-hyperlegible-next) | `7925f50f649b3813257faf2f4c0b381011f434f1` | `AtkinsonHyperlegibleNext-Regular.ttf`, `-SemiBold.ttf`, `-Bold.ttf` | [`fuentes/atkinson-hyperlegible-next/OFL.txt`](fuentes/atkinson-hyperlegible-next/OFL.txt) |

Los TTF se descargaron de `raw.githubusercontent.com/<repo>/<commit>/fonts/ttf/`; el `OFL.txt` de la raíz de cada repositorio.
