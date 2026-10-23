package servidor

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

func init() {
	// La imagen final (distroless) no trae tabla de tipos MIME del sistema.
	_ = mime.AddExtensionType(".ttf", "font/ttf")
}

// noEncontradoAPI responde 404 en JSON a cualquier ruta desconocida bajo /api/: nunca index.html.
func noEncontradoAPI(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "no_encontrado"})
}

// aplicacionWeb sirve los archivos de la web. Un archivo existente se entrega tal cual; cualquier
// otra ruta GET o HEAD devuelve index.html (aplicación de una página). Sin lógica de negocio.
func aplicacionWeb(raiz fs.FS) http.Handler {
	archivos := http.FileServerFS(raiz)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}
		nombre := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if info, err := fs.Stat(raiz, nombre); nombre != "" && err == nil && !info.IsDir() && nombre != "index.html" {
			if strings.HasPrefix(nombre, "assets/") {
				// Los nombres llevan el hash del contenido: nunca cambian.
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			archivos.ServeHTTP(w, r)
			return
		}
		indice, err := fs.ReadFile(raiz, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(indice))
	})
}
