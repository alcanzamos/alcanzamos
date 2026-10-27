# Instrucciones para agentes y subagentes

Estas reglas valen para todo agente que trabaje en este repositorio, también los subagentes y los workers que se lanzan en segundo plano. Se suman a las instrucciones de cada tarea.

## Docker: solo lo propio, por nombre o por etiqueta

El equipo del dueño tiene contenedores y volúmenes de otros proyectos. El 2026-10-26 un worker corrió `docker container prune -f` y borró contenedores ajenos, entre ellos una base de datos de otro proyecto.

- **Prohibido** todo comando que actúe sobre todo el equipo: `docker container prune`, `docker system prune`, `docker volume prune`, `docker image prune`, `docker network prune`, y `docker rm`, `docker rmi` o `docker volume rm` sin un nombre o una etiqueta propios.
- **Solo se quita lo que la tarea creó,** por nombre o por etiqueta:
  - un proyecto de compose con nombre propio y único para la tarea (`docker compose -p <nombre-de-la-tarea> … down`; `-v` solo si los volúmenes son de ese proyecto);
  - contenedores e imágenes con un nombre o una etiqueta que la tarea les puso (`docker rm <nombre>`, `docker rmi <imagen>:<etiqueta-propia>`).
- **Antes de borrar, mirar:** listar con un filtro (`docker ps -a --filter label=com.docker.compose.project=<nombre>`) y borrar solo lo listado.
- Si algo ajeno queda afectado, parar, no recrearlo y avisar al dueño con los nombres exactos.

## Procesos: solo los propios, por PID

El 2026-10-27 un verificador detuvo su API con `pkill -f 'go run ./src/cmd/api'`. Ese patrón también habría matado el API de otro agente o del dueño.

- **Prohibido** detener procesos por patrón o por nombre: `pkill`, `killall`, `kill $(pgrep …)`.
- **Solo se detiene lo que la tarea arrancó,** por el PID que guardó al arrancarlo (`proceso & echo $! > pid`; después `kill "$(cat pid)"`).
- Si no se sabe el PID, no se mata nada: se avisa.

## Fuera de este repositorio

No se lee ni se modifica nada fuera del repositorio sin permiso explícito del dueño para esa ruta.
