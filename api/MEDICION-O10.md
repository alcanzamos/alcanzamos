# Medición de O-10 (US-45)

Fecha: 2026-10-22. Solo datos sintéticos. Sin red de producción.

## Condiciones

- Imagen: la del `Dockerfile` de esta carpeta (`alcanzamos-api:dev`, 22,7 MB, usuario 65532).
- Límites: `docker run --cpus=0.25 --memory=512m`, igual que la meta de O-10 (0,25 vCPU y 0,5 GiB).
- Equipo: Intel Core i9-13900H (20 hilos lógicos), Docker 29.9.1, cgroups v2, Linux 7.2.8. No es una máquina de Azure.
- Los límites valen solo para el contenedor del API. El generador de carga corre sin límite en otro contenedor de la misma máquina.
- Generador de carga: `ghcr.io/hatoo/oha:1.16.0` (sha256:3ec3dbf549ea197793482d47a6324797411406bbf438c2fe8b91f244ec641a2f).

## Método

1. **Reposo:** se inicia el API con los límites, se espera 60 s sin tráfico y se lee `VmRSS` y `VmHWM` de `/proc/1/status` (RSS del proceso) y `docker stats --no-stream`.
2. **20 usuarios:** `oha -z 60s -c 20` contra `GET /salud` por la red de Docker. Cada 5 s se leyó el RSS y el CPU del contenedor.
3. **Argon2id:** se compiló el binario de pruebas del paquete (`CGO_ENABLED=0 go test -c`) y se ejecutó dentro de `alpine:3.24.3` con los mismos límites y sin red: `-test.bench Verificar -test.benchtime 30x`. Una operación es una verificación con los parámetros OWASP (19 MiB, t=2, p=1).
4. **Arranque en frío:** desde antes de `docker run -d` (contenedor nuevo, imagen ya local) hasta el primer 200 en `/salud`, con sondeo cada 5 ms desde el anfitrión. 5 corridas; se reporta la mediana.

## Resultados

| Medida | Resultado |
|---|---|
| Memoria en reposo, tras 60 s (RSS del proceso) | 12,0 MB (11,8 MiB). `docker stats`: 5,2 MiB |
| Memoria con 20 usuarios simultáneos, 60 s (RSS) | máximo 18,2 MB (17,8 MiB), estable entre 17,7 y 18,2 MB |
| Memoria con 20 usuarios (`docker stats`) | entre 13,3 y 16,1 MiB |
| CPU del contenedor con 20 usuarios | 24 a 25 %: el tope de 0,25 vCPU quedó saturado |
| Peticiones atendidas en 60 s | 1.545.644, todas 200 (25.760 por segundo) |
| Latencia con 20 usuarios (p50 / p95 / p99) | 0,09 ms / 0,27 ms / 3,3 ms |
| Latencia con 20 usuarios (p99,9 / máxima) | 88 ms / 114 ms |
| Una verificación de Argon2id (19 MiB, t=2, p=1) | 70,3 ms, 19,9 MB asignados por operación |
| Arranque en frío (5 corridas) | 443, 335, 319, 321 y 322 ms. **Mediana: 322 ms** |

## Cómo leer las cifras

- La carga es de circuito cerrado: 20 conexiones piden sin pausa. Saturan el CPU del contenedor, así que 20 personas reales con pausas pedirían mucho menos. La latencia sirve como cota superior, no como la de una persona usuaria.
- `/salud` no toca la base ni Argon2id. La memoria con carga mide el servidor HTTP, no el producto. La del producto llega en I05.
- La verificación de Argon2id se midió de una en una. Con el tope de 4 simultáneas, cuatro verificaciones juntas comparten 0,25 vCPU y asignan hasta unos 80 MB. Eso **no se midió** aquí.
- El arranque en frío incluye crear el contenedor (`docker run`). El arranque del proceso solo es menor. No hay conexión a la base en `api`.
- El tiempo de Argon2id depende del CPU del equipo. En un vCPU de Azure puede ser distinto.
- Una sola ejecución de cada medida, salvo el arranque. Sirve para el orden de magnitud, no para un contrato.

**Nota del 2026-10-22 (D-123).** Estas cifras se midieron con Go 1.26.10 y la imagen sobre `alpine:3.24.3`. Después la imagen pasó a Go 1.27.3 y `gcr.io/distroless/static-debian13:nonroot`. No se volvió a medir; se mide otra vez si cambia algo del arranque o de la memoria.
