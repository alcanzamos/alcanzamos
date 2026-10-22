# Imagen del API (ADR-002): binario estático en una base mínima, sin root.
# Contexto de construcción: esta carpeta (api/). Versiones fijadas a mano.
FROM golang:1.27.3-alpine3.24 AS construccion
WORKDIR /fuente
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /alcanzamos ./cmd/api

# Base de ejecución: distroless static (sin shell ni gestor de paquetes), variante nonroot (uid 65532).
# Etiqueta static-debian13:nonroot, digest del índice multiarquitectura resuelto el 2026-10-22.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:d62067879de890a1def9da0e7766b7d20810a5e5555cef8506b752437d7a3e88
COPY --from=construccion /alcanzamos /alcanzamos
USER 65532:65532
ENV PUERTO=8080
EXPOSE 8080
ENTRYPOINT ["/alcanzamos"]
