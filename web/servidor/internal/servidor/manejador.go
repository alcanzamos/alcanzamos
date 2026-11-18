package servidor

import (
	"bytes"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

func init() {
	// La imagen final (distroless) no trae tabla de tipos MIME del sistema.
	// Solo falla si la extensión no empieza con punto: es una constante y no hay nada que manejar en tiempo de ejecución.
	mime.AddExtensionType(".ttf", "font/ttf") //nolint:errcheck // ver el comentario de arriba
}

// Manejador sirve la web de raiz: un archivo existente se entrega tal cual; /config.json lo arma cfg; /salud
// responde a las sondas; cualquier otra ruta GET o HEAD devuelve index.html (aplicación de una página).
// Toda respuesta, también los errores, lleva la CSP y X-Content-Type-Options. No registra nada: ni peticiones ni IP.
func Manejador(raiz fs.FS, cfg Config) http.Handler {
	archivos := http.FileServerFS(raiz)
	configuracion := cfg.configJSON()
	csp := cfg.politicaCSP()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cab := w.Header()
		cab.Set("Content-Security-Policy", csp)
		cab.Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			cab.Set("Allow", "GET, HEAD")
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}
		nombre := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		switch nombre {
		case "salud":
			cab.Set("Cache-Control", "no-store")
			cab.Set("Content-Type", "application/json")
			http.ServeContent(w, r, "salud", time.Time{}, strings.NewReader(`{"estado":"ok"}`+"\n"))
			return
		case "config.json":
			// Cambia con el ambiente: nunca se guarda en caché. Tapa a cualquier config.json del directorio.
			cab.Set("Cache-Control", "no-store")
			cab.Set("Content-Type", "application/json")
			http.ServeContent(w, r, "config.json", time.Time{}, bytes.NewReader(configuracion))
			return
		}
		if info, err := fs.Stat(raiz, nombre); nombre != "" && err == nil && !info.IsDir() && nombre != "index.html" {
			if strings.HasPrefix(nombre, "assets/") {
				// Los nombres llevan el hash del contenido: nunca cambian.
				cab.Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				cab.Set("Cache-Control", "no-cache")
			}
			archivos.ServeHTTP(w, r)
			return
		}
		indice, err := fs.ReadFile(raiz, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		cab.Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(indice))
	})
}
