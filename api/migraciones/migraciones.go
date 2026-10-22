// Package migraciones embebe las migraciones SQL de goose. Los .sql son copia idéntica de E13 (D-122):
// no se editan aquí; cualquier cambio vuelve primero a E13.
package migraciones

import "embed"

// SQL contiene los archivos de migración.
//
//go:embed *.sql
var SQL embed.FS
