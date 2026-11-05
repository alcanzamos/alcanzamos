// EXA-006 (D-111, Q-13; D-181): cada id de E15 de un algoritmo ya construido existe como subprueba `t.Run("<id>", …)` en
// api/test, y ninguna subprueba con forma de id de E15 usa un id que E15 no tiene. `ids.json` es una copia de E15 (los
// documentos están en otro repositorio y el pipeline no los ve); se regenera con `generar_ids.py` (README del API).
package e15_test

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

type copiaDeE15 struct {
	Version     string              `json:"version_e15"`
	Construidos []string            `json:"construidos"`
	Ids         map[string][]string `json:"ids"`
}

var formaDeId = regexp.MustCompile(`^[A-Z]{2}-(\d{2,3}|[A-Z])$`)

// subpruebas devuelve los ids de las subpruebas de los archivos de prueba bajo raiz: los literales de `x.Run("<id>", …)` y,
// en un archivo que corre una tabla con `x.Run(c.id, …)`, los de los campos `id: "<id>"` de sus casos.
func subpruebas(t *testing.T, raiz string) map[string]bool {
	t.Helper()
	encontrados := map[string]bool{}
	err := filepath.WalkDir(raiz, func(ruta string, e fs.DirEntry, err error) error {
		if err != nil || e.IsDir() || !strings.HasSuffix(ruta, "_test.go") {
			return err
		}
		arbol, err := parser.ParseFile(token.NewFileSet(), ruta, nil, 0)
		if err != nil {
			return err
		}
		esId := func(e ast.Expr) (string, bool) {
			lit, ok := e.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return "", false
			}
			id, err := strconv.Unquote(lit.Value)
			return id, err == nil && formaDeId.MatchString(id)
		}
		deTabla, enCampos := false, map[string]bool{}
		ast.Inspect(arbol, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.CallExpr:
				if sel, ok := n.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Run" && len(n.Args) == 2 {
					if id, ok := esId(n.Args[0]); ok {
						encontrados[id] = true
					} else if _, literal := n.Args[0].(*ast.BasicLit); !literal {
						deTabla = true
					}
				}
			case *ast.KeyValueExpr:
				if clave, ok := n.Key.(*ast.Ident); ok && clave.Name == "id" {
					if id, ok := esId(n.Value); ok {
						enCampos[id] = true
					}
				}
			}
			return true
		})
		if deTabla {
			for id := range enCampos {
				encontrados[id] = true
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return encontrados
}

func leerCopia(t *testing.T) copiaDeE15 {
	t.Helper()
	crudo, err := os.ReadFile("ids.json")
	if err != nil {
		t.Fatal(err)
	}
	var c copiaDeE15
	if err := json.Unmarshal(crudo, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestEXA_006CadaIdDeE15DeUnAlgoritmoConstruidoTieneSuSubprueba(t *testing.T) {
	c := leerCopia(t)
	hay := subpruebas(t, "..")
	if len(c.Construidos) == 0 {
		t.Fatal("ids.json no declara ningún algoritmo construido")
	}
	for _, prefijo := range c.Construidos {
		ids, ok := c.Ids[prefijo]
		if !ok || len(ids) == 0 {
			t.Errorf("el prefijo construido %q no está en E15 %s", prefijo, c.Version)
		}
		for _, id := range ids {
			if !hay[id] {
				t.Errorf("falta la subprueba t.Run(%q, …) de E15 %s", id, c.Version)
			}
		}
	}
}

func TestEXA_006NingunaSubpruebaUsaUnIdQueE15NoTiene(t *testing.T) {
	c := leerCopia(t)
	conocidos := map[string]bool{}
	total := 0
	for _, ids := range c.Ids {
		for _, id := range ids {
			conocidos[id] = true
			total++
		}
	}
	if total != 286 || len(conocidos) != total {
		t.Fatalf("ids.json trae %d ids (%d únicos); E15 %s tiene 286", total, len(conocidos), c.Version)
	}
	var sobran []string
	for id := range subpruebas(t, "..") {
		if !conocidos[id] {
			sobran = append(sobran, id)
		}
	}
	sort.Strings(sobran)
	if len(sobran) > 0 {
		t.Errorf("subpruebas con un id que no está en E15 %s: %v", c.Version, sobran)
	}
}
