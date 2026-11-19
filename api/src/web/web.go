// Package web embebe un index.html de relleno que el API sirve en `/` (ADR-004).
//
// La web ya no va en el binario: la sirve ca-web, con su propia imagen (web/Dockerfile, infra-d205 T13). Este paquete y
// las rutas de la web del API (servidor.go, estatico.go) se quitan en T17; hasta entonces estatico/ solo guarda el
// index.html de relleno, que es lo que embebe la imagen del API.
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
