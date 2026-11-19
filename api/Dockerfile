# Imagen del API (ADR-002): binario estático en una base mínima, sin root. La web no va aquí: es otra imagen, la de
# ca-web (web/Dockerfile, E11-INF 2.16), y el API no sirve rutas de la web.
# Contexto de construcción: la raíz del monorepo (docker build -f api/Dockerfile .). Versiones fijadas a mano.

# Compila el API.
# Etiqueta golang:1.27.4-alpine3.24, digest del índice multiarquitectura resuelto el 2026-11-11.
FROM golang:1.27.4-alpine3.24@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS construccion
WORKDIR /fuente/api
COPY api/go.mod api/go.sum* ./
RUN go mod download
COPY api ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /alcanzamos ./src/cmd/api

# Base de ejecución: distroless static (sin shell ni gestor de paquetes), variante nonroot (uid 65532).
# Etiqueta static-debian13:nonroot, digest del índice multiarquitectura subido el 2026-10-23 (D-161; cumple 7 días de antigüedad).
FROM gcr.io/distroless/static-debian13:nonroot@sha256:18f4cc26c9ffa7f20a359298be7deadac5c607c8e03a02b8119f1a5fc2f82c99
COPY --from=construccion /alcanzamos /alcanzamos
USER 65532:65532
ENV PUERTO=8080
EXPOSE 8080
ENTRYPOINT ["/alcanzamos"]
