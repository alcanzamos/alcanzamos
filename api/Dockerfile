# Imagen del API con la web embebida (ADR-002, ADR-004): binario estático en una base mínima, sin root.
# Contexto de construcción: la raíz del monorepo (docker build -f api/Dockerfile .). Versiones fijadas a mano.

# Etapa 1: compila web/ (necesita diseno/: los tokens y las fuentes se importan desde ../diseno).
# Etiqueta node:24.22.1-alpine3.24 (la misma versión de Node que .azure-pipelines/web.yml),
# digest del índice multiarquitectura resuelto el 2026-10-22.
FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS web
WORKDIR /fuente/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY diseno /fuente/diseno
COPY web ./
RUN npm run build

# Etapa 2: compila el API y embebe web/dist en internal/web/estatico (reemplaza el index.html de relleno).
FROM golang:1.27.3-alpine3.24 AS construccion
WORKDIR /fuente/api
COPY api/go.mod api/go.sum* ./
RUN go mod download
COPY api ./
COPY --from=web /fuente/web/dist/ ./internal/web/estatico/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /alcanzamos ./cmd/api

# Base de ejecución: distroless static (sin shell ni gestor de paquetes), variante nonroot (uid 65532).
# Etiqueta static-debian13:nonroot, digest del índice multiarquitectura resuelto el 2026-10-22.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:d62067879de890a1def9da0e7766b7d20810a5e5555cef8506b752437d7a3e88
COPY --from=construccion /alcanzamos /alcanzamos
USER 65532:65532
ENV PUERTO=8080
EXPOSE 8080
ENTRYPOINT ["/alcanzamos"]
