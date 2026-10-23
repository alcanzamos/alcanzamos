// Comando api: un solo binario con subcomandos. Sin subcomando corre el servidor. La lógica está en src/app.
package main

import (
	"os"

	"github.com/alcanzamos/alcanzamos/api/src/app"
)

func main() {
	os.Exit(app.Main(os.Args[1:], os.Stdout))
}
