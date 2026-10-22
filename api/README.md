# api/

API de Alcanzamos: monolito modular en Go con la biblioteca estándar (ADR-002). Incluye el motor de reglas en Go (ADR-005), las migraciones en `api/migraciones/` y la web embebida en la imagen (ADR-004).

- Archivo de construcción: `go.mod` en esta carpeta.
- Reglas: estándar de codificación (E17-ECO), pruebas con `go test -race`; las de integración usan `//go:build integration`.
- Estructura del monorepo: ADR-001 en [`docs/adr/`](../docs/adr/ADR-001-estructura-de-repositorios.md).

## Uso

- Un solo binario con subcomandos. Sin subcomando corre el servidor (`api`).
- `GET /salud` responde 200 con `{"estado":"ok"}`.
- El puerto sale de `PUERTO` (por defecto 8080). El registro es JSON por la salida estándar.
- Con `SIGTERM` o `Ctrl+C` el servidor termina las peticiones en curso (plazo de 10 s).

```sh
cd api
go test -race ./...
go run ./cmd/api
docker build -t alcanzamos-api:dev .
docker run --rm -p 127.0.0.1:8080:8080 alcanzamos-api:dev
```

## Imagen

- Dos etapas: `golang:1.27.3-alpine3.24` compila un binario estático; `gcr.io/distroless/static-debian13:nonroot` lo ejecuta, fijada por digest `sha256:d62067879de890a1def9da0e7766b7d20810a5e5555cef8506b752437d7a3e88` (índice multiarquitectura, resuelto el 2026-10-22).
- Distroless no trae shell, así que no hay `HEALTHCHECK` ni comandos en forma de shell; la salud se consulta por `/salud` desde fuera.
- Corre como usuario 65532 (nonroot), sin root. El `ENTRYPOINT` es el binario.
- Go 1.27.3 (go.dev, 2026-10-22; SHA-256 del tarball `65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40`, fijado en `.azure-pipelines/api.yml`).
