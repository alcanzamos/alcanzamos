# Imagen del API con la web embebida (ADR-002, ADR-004): binario estático en una base mínima, sin root.
# Contexto de construcción: la raíz del monorepo (docker build -f api/Dockerfile .). Versiones fijadas a mano.

# Etapa 1: compila web/ (necesita diseno/: los tokens y las fuentes se importan desde ../diseno, y el logo desde
# ../marca; de marca/ entra solo ese SVG, D-152).
# Etiqueta node:24.22.1-alpine3.24 (la misma versión de Node que .azure-pipelines/web.yml),
# digest del índice multiarquitectura resuelto el 2026-10-22.
FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS web
# npm 12.2.1 fijado igual que en los pipelines: tarball del registro con su SHA-512 verificado (dist.integrity de
# https://registry.npmjs.org/npm/12.2.1 pasado a hexadecimal, consultado el 2026-10-24). Cambiar la versión obliga a cambiar
# también esta suma, web.yml, movil.yml y el campo engines de web/package.json.
ARG NPM_VERSION=12.2.1
ARG NPM_SHA512=6ca0a6151553fc107e60f1186d9c10d57508dcde6de31292a54d4cc4e8e8ef3de25b3281274657442d7115d10df930bb3794ddcb0681cdfd9d317189abf7b63d
RUN set -eu; \
    wget -q -O /tmp/npm.tgz "https://registry.npmjs.org/npm/-/npm-${NPM_VERSION}.tgz"; \
    echo "${NPM_SHA512}  /tmp/npm.tgz" | sha512sum -c -; \
    npm install --global /tmp/npm.tgz; \
    rm /tmp/npm.tgz; \
    test "$(npm --version)" = "${NPM_VERSION}"
WORKDIR /fuente/web
# El .npmrc va antes de npm ci: la instalación usa las mismas reglas que en local y en el pipeline.
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN npm ci
COPY diseno /fuente/diseno
COPY marca/logo-horizontal-color.svg /fuente/marca/logo-horizontal-color.svg
COPY web ./
RUN npm run build

# Etapa 2: compila el API y embebe web/dist en src/web/estatico (reemplaza el index.html de relleno).
# Etiqueta golang:1.27.3-alpine3.24, digest del índice multiarquitectura resuelto el 2026-10-22.
FROM golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS construccion
WORKDIR /fuente/api
COPY api/go.mod api/go.sum* ./
RUN go mod download
COPY api ./
COPY --from=web /fuente/web/dist/ ./src/web/estatico/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /alcanzamos ./src/cmd/api

# Base de ejecución: distroless static (sin shell ni gestor de paquetes), variante nonroot (uid 65532).
# Etiqueta static-debian13:nonroot, digest del índice multiarquitectura resuelto el 2026-10-22.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:d62067879de890a1def9da0e7766b7d20810a5e5555cef8506b752437d7a3e88
COPY --from=construccion /alcanzamos /alcanzamos
USER 65532:65532
ENV PUERTO=8080
EXPOSE 8080
ENTRYPOINT ["/alcanzamos"]
