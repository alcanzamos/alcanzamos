# Alcanzamos

Alcanzamos es una app de finanzas personales y del hogar para registrar gastos e ingresos escribiendo un mensaje en lenguaje cotidiano, con web y Android.
Este repositorio contiene el código del producto y las decisiones de arquitectura que un colaborador necesita conocer.

> El proyecto está en construcción (iteración I05). Ya hay código en `api/`, `web/` y `movil/`: la cuenta y el acceso de la US-49 (crear la cuenta, verificar el correo, iniciar sesión, recuperar el acceso y cambiar la contraseña). Faltan el motor de reglas y el resto de las historias.

## Estructura

| Carpeta | Contenido |
|---|---|
| [`api/`](api/) | API en Go (monolito modular): cuenta, sesiones y eventos de seguridad |
| [`web/`](web/) | App web en Vite + React + TypeScript: pantallas de cuenta y acceso |
| [`movil/`](movil/) | App en React Native con Expo (SDK 58): pantallas de cuenta y acceso |
| [`reglas/`](reglas/) | Reglas de interpretación y conjuntos de prueba congelados con SHA-256 |
| [`diseno/`](diseno/) | Tokens de diseño, fuentes y textos únicos de la interfaz (`textos/es.json`) |
| [`infra/`](infra/) | Infraestructura como código (OpenTofu) y ambiente local en Docker, sin secretos |
| [`docs/adr/`](docs/adr/) | Registros de decisión arquitectónica (ADR-001 a ADR-006) |
| [`marca/`](marca/) | Nombre, logo, símbolo e ícono: **fuera de la AGPLv3** |
| [`.azure-pipelines/`](.azure-pipelines/) | Seis pipelines: `comun`, `reglas`, `infra`, `api`, `web` y `movil` |

## Licencia y marca

El código y los tokens de diseño van bajo [AGPLv3](LICENSE); el aviso de marca está en [NOTICE](NOTICE). El nombre «Alcanzamos», el logo, el símbolo y el ícono de la app **no** están licenciados bajo la AGPLv3; quien distribuya una versión modificada debe usar otro nombre y otro logo. Detalles en [TRADEMARK.md](TRADEMARK.md).

## Seguridad

Para reportar una vulnerabilidad en privado, lee [SECURITY.md](SECURITY.md).

## Uso de IA

Parte del código y de los documentos de este repositorio se produce con un asistente de IA.

- **El asistente produce:** borradores de código, pruebas y documentos, comparaciones con sus fuentes y las propuestas de decisión.
- **La persona responsable del proyecto decide y revisa:** define los requisitos, elige entre las alternativas, revisa y aprueba cada cambio antes de fusionarlo a `main`, y responde por el resultado.

El uso de IA se declara aquí, a nivel de repositorio, y no por archivo ni por commit. Las decisiones quedan en el registro de decisiones del proyecto.
