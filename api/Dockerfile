# Imagen del API (ADR-002): binario estático en una base mínima, sin root.
# Contexto de construcción: esta carpeta (api/). Versiones fijadas a mano.
FROM golang:1.26.10-alpine3.24 AS construccion
WORKDIR /fuente
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /alcanzamos ./cmd/api

FROM alpine:3.24.3
RUN addgroup -g 65532 -S alcanzamos && adduser -u 65532 -S -G alcanzamos -H -s /sbin/nologin alcanzamos
COPY --from=construccion /alcanzamos /alcanzamos
USER 65532:65532
ENV PUERTO=8080
EXPOSE 8080
ENTRYPOINT ["/alcanzamos"]
