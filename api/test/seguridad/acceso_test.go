package seguridad_test

import (
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// sinDeclarar es el valor cero de NivelDeAcceso: una ruta que no declara su nivel.
var sinDeclarar seguridad.NivelDeAcceso

func TestSujetoAlcanzaElNivel(t *testing.T) {
	sinCorreo := seguridad.Sujeto{Persona: "p"} // solo un menor, hasta I11
	verificada := seguridad.Sujeto{Persona: "p", Verificada: true}
	autorizada := seguridad.Sujeto{Persona: "p", Verificada: true, Autorizada: true}
	casos := []struct {
		sujeto seguridad.Sujeto
		nivel  seguridad.NivelDeAcceso
		quiere error
	}{
		{sinCorreo, seguridad.Publica, nil},
		{sinCorreo, seguridad.SinAutorizacion, seguridad.ErrVerificacionPendiente}, {sinCorreo, seguridad.RequiereAutorizacion, seguridad.ErrVerificacionPendiente},
		{verificada, seguridad.SinAutorizacion, nil}, {verificada, seguridad.RequiereAutorizacion, seguridad.ErrAutorizacionPendiente},
		{autorizada, seguridad.SinAutorizacion, nil}, {autorizada, seguridad.RequiereAutorizacion, nil},
		{seguridad.Sujeto{Persona: "p", Autorizada: true}, seguridad.RequiereAutorizacion, seguridad.ErrVerificacionPendiente},
		{autorizada, sinDeclarar, seguridad.ErrAutorizacionPendiente},
		{autorizada, seguridad.NivelDeAcceso(99), seguridad.ErrAutorizacionPendiente},
	}
	for _, c := range casos {
		if err := c.sujeto.Alcanza(c.nivel); !errors.Is(err, c.quiere) {
			t.Errorf("%+v alcanza %s: %v, se esperaba %v", c.sujeto, c.nivel, err, c.quiere)
		}
	}
}

// SEG-010 (D-172 (5)): hay tres niveles, no cuatro. No existe un nivel para las cuentas sin verificar.
func TestHayTresNivelesDeAcceso(t *testing.T) {
	nombres := map[seguridad.NivelDeAcceso]string{
		seguridad.Publica: "publica", seguridad.SinAutorizacion: "sin_autorizacion",
		seguridad.RequiereAutorizacion: "requiere_autorizacion", sinDeclarar: "sin_declarar",
	}
	for n, nombre := range nombres {
		if n.String() != nombre {
			t.Errorf("%d se llama %q, se esperaba %q", n, n.String(), nombre)
		}
	}
	var validos []string
	for n := seguridad.NivelDeAcceso(-3); n < 12; n++ {
		if n.Valido() {
			validos = append(validos, n.String())
		}
	}
	if strings.Join(validos, ",") != "publica,sin_autorizacion,requiere_autorizacion" {
		t.Errorf("niveles válidos: %v", validos)
	}
	for _, n := range []seguridad.NivelDeAcceso{sinDeclarar, 4, 99, -1} {
		if n.Valido() {
			t.Errorf("%d no es un nivel", n)
		}
	}
}

// Una ruta no puede declarar `sin_verificar` porque ya no existe en ningún lado del código de producción: ni la
// constante `SinVerificar`, ni el nombre `sin_verificar`, ni el campo `Senuelo` de la sesión de mentira (D-172 (5)).
// Se mira el árbol de sintaxis de src/, sin los comentarios (que cuentan la historia).
func TestElCodigoNoTieneElNivelSinVerificarNiLaSesionDeMentira(t *testing.T) {
	fset := token.NewFileSet()
	revisados := 0
	err := filepath.WalkDir(filepath.Join("..", "..", "src"), func(ruta string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(ruta, ".go") {
			return err
		}
		f, err := parser.ParseFile(fset, ruta, nil, 0)
		if err != nil {
			return err
		}
		revisados++
		ast.Inspect(f, func(n ast.Node) bool {
			switch v := n.(type) {
			case *ast.Ident:
				if v.Name == "SinVerificar" || v.Name == "Senuelo" || v.Name == "Senuelos" || v.Name == "NuevosSenuelos" {
					t.Errorf("%s: el identificador %s ya no existe (D-172 (5))", fset.Position(v.Pos()), v.Name)
				}
			case *ast.BasicLit:
				if v.Kind == token.STRING && (strings.Contains(v.Value, "sin_verificar") || strings.Contains(v.Value, "SESION_SENUELO")) {
					t.Errorf("%s: %s ya no existe (D-172 (5))", fset.Position(v.Pos()), v.Value)
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if revisados < 20 {
		t.Fatalf("solo se revisaron %d archivos de src/: la guarda no está mirando", revisados)
	}
}
