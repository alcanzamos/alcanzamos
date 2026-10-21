# Alcanzamos

Alcanzamos es una app de finanzas personales y del hogar para registrar gastos e ingresos escribiendo un mensaje en lenguaje cotidiano, con web y Android.
Este repositorio contiene el código del producto y las decisiones de arquitectura que un colaborador necesita conocer.

> El proyecto está en construcción: por ahora hay estructura, licencia, decisiones y conjuntos de prueba, pero todavía no hay código.

## Estructura

| Carpeta | Contenido |
|---|---|
| [`api/`](api/) | API en Go (monolito modular) |
| [`web/`](web/) | App web en Vite + React + TypeScript |
| [`movil/`](movil/) | App en React Native con Expo |
| [`reglas/`](reglas/) | Reglas de interpretación y conjuntos de prueba congelados con SHA-256 |
| [`diseno/`](diseno/) | Tokens de diseño y textos de la interfaz |
| [`infra/`](infra/) | Infraestructura como código, sin secretos |
| [`docs/adr/`](docs/adr/) | Registros de decisión arquitectónica (ADR-001 a ADR-006) |
| [`marca/`](marca/) | Nombre, logo, símbolo e ícono: **fuera de la AGPLv3** |
| [`.azure-pipelines/`](.azure-pipelines/) | Pipelines, uno por carpeta |

## Licencia y marca

El código y los tokens de diseño van bajo [AGPLv3](LICENSE); el aviso de marca está en [NOTICE](NOTICE). El nombre «Alcanzamos», el logo, el símbolo y el ícono de la app **no** están licenciados bajo la AGPLv3; quien distribuya una versión modificada debe usar otro nombre y otro logo. Detalles en [TRADEMARK.md](TRADEMARK.md).

## Seguridad

Para reportar una vulnerabilidad en privado, lee [SECURITY.md](SECURITY.md).

## Uso de IA

Parte del código y de los documentos de este repositorio se produce con un asistente de IA.

- **El asistente produce:** borradores de código, pruebas y documentos, comparaciones con sus fuentes y las propuestas de decisión.
- **La persona responsable del proyecto decide y revisa:** define los requisitos, elige entre las alternativas, revisa y aprueba cada cambio antes de fusionarlo a `main`, y responde por el resultado.

El uso de IA se declara aquí, a nivel de repositorio, y no por archivo ni por commit. Las decisiones quedan en el registro de decisiones del proyecto.
