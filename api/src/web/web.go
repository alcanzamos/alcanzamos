// Package web embebe la web compilada (web/dist) para que el API la sirva (ADR-004).
//
// En el repositorio, estatico/ solo guarda un index.html de relleno: así `go build` y `go test`
// funcionan sin compilar la web. La construcción de la imagen (api/Dockerfile) lo sobrescribe con
// el contenido real de web/dist. Una compilación local de la web no toca esta carpeta.
package web

import (
	"embed"
	"io/fs"
)

//go:embed estatico
var embebido embed.FS

// Archivos devuelve la raíz de la web embebida (index.html, assets/, fuentes/).
func Archivos() fs.FS {
	sub, err := fs.Sub(embebido, "estatico")
	if err != nil {
		panic(err) // la carpeta existe en tiempo de compilación; no puede fallar
	}
	return sub
}
