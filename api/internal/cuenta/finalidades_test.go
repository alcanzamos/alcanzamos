package cuenta

import (
	"io/fs"
	"regexp"
	"slices"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/migraciones"
)

// finalidadDelCatalogo es una fila del INSERT INTO finalidad de la migración.
type finalidadDelCatalogo struct {
	codigo, tipo string
	activa       bool
}

// catalogoDeLaMigracion lee las finalidades de `0002_catalogo.sql`, la misma que se aplica a la base. Si el formato del
// INSERT cambia, esta lectura falla en vez de devolver una lista vacía.
func catalogoDeLaMigracion(t *testing.T) []finalidadDelCatalogo {
	t.Helper()
	sql, err := fs.ReadFile(migraciones.SQL, "0002_catalogo.sql")
	if err != nil {
		t.Fatal(err)
	}
	bloque := regexp.MustCompile(`(?s)INSERT INTO finalidad \(codigo, tipo, activa, descripcion\) VALUES(.*?);`).FindSubmatch(sql)
	if bloque == nil {
		t.Fatal("no encontré el INSERT INTO finalidad en 0002_catalogo.sql")
	}
	var filas []finalidadDelCatalogo
	for _, m := range regexp.MustCompile(`\(\s*'([a-z0-9_]+)',\s*'([a-z]+)',\s*(true|false),`).FindAllSubmatch(bloque[1], -1) {
		filas = append(filas, finalidadDelCatalogo{string(m[1]), string(m[2]), string(m[3]) == "true"})
	}
	if len(filas) < 7 {
		t.Fatalf("leí %d finalidades de 0002_catalogo.sql, se esperaban al menos 7", len(filas))
	}
	return filas
}

// Prueba guardiana (SEG-011, D-139): si alguien siembra una finalidad necesaria y activa y la regla no la clasifica,
// esta prueba falla y obliga a decidir a qué etapa le toca.
func TestElCatalogoNoTieneNecesariasSinClasificar(t *testing.T) {
	var r ReglaDeFinalidades
	activasNecesarias := 0
	for _, f := range catalogoDeLaMigracion(t) {
		if f.tipo != "necesaria" || !f.activa {
			continue
		}
		activasNecesarias++
		if !r.Clasificada(f.codigo) {
			t.Errorf("la finalidad necesaria y activa %q no está clasificada en ReglaDeFinalidades (D-139): decide a qué etapa le toca y quién la otorga", f.codigo)
		}
	}
	if activasNecesarias == 0 {
		t.Fatal("el catálogo no tiene finalidades necesarias: la lectura de la migración está fallando")
	}
}

// Lo contrario: la regla no puede exigir un código que el catálogo no tenga como necesario y activo.
func TestLaReglaSoloExigeNecesariasActivasDelCatalogo(t *testing.T) {
	var r ReglaDeFinalidades
	catalogo := map[string]finalidadDelCatalogo{}
	for _, f := range catalogoDeLaMigracion(t) {
		catalogo[f.codigo] = f
	}
	for _, e := range []Etapa{EtapaAdulta, EtapaMenor} {
		for _, f := range r.Necesarias(e) {
			c, ok := catalogo[f.Codigo]
			if !ok || c.tipo != "necesaria" || !c.activa {
				t.Errorf("la regla exige %q a la etapa %s, pero el catálogo no la tiene como necesaria y activa", f.Codigo, e)
			}
		}
	}
}

func TestListasDeCadaEtapa(t *testing.T) {
	var r ReglaDeFinalidades
	casos := []struct {
		etapa  Etapa
		quiere []FinalidadNecesaria
	}{
		{EtapaAdulta, []FinalidadNecesaria{{"cuenta_y_acceso", LaPersona}, {"funciones_financieras", LaPersona}}},
		{EtapaMenor, []FinalidadNecesaria{{"cuenta_del_menor", ElTutor}}},
		{"", nil},
		{"otra", nil},
	}
	for _, c := range casos {
		if got := r.Necesarias(c.etapa); !slices.Equal(got, c.quiere) {
			t.Errorf("Necesarias(%q) = %v, se esperaba %v", c.etapa, got, c.quiere)
		}
	}
	// Las accesorias y la inactiva no entran en ninguna.
	for _, codigo := range []string{"avisos", "horas_de_vida", "correo_del_menor", "transferencia", "no_existe"} {
		if r.Clasificada(codigo) {
			t.Errorf("%q no debe estar clasificada como necesaria", codigo)
		}
	}
	// Quien llama no puede cambiar la regla modificando lo que recibe.
	r.Necesarias(EtapaAdulta)[0].Codigo = "otra"
	if r.Necesarias(EtapaAdulta)[0].Codigo != "cuenta_y_acceso" {
		t.Error("Necesarias devolvió la lista interna")
	}
}

func TestCumple(t *testing.T) {
	var r ReglaDeFinalidades
	const titular, tutor, otra = "t-1", "tu-1", "o-1"
	ad := Otorgamiento{"cuenta_y_acceso", titular}
	fin := Otorgamiento{"funciones_financieras", titular}
	men := Otorgamiento{"cuenta_del_menor", tutor}
	casos := []struct {
		nombre   string
		etapa    Etapa
		vigentes []Otorgamiento
		tutores  []string
		quiere   bool
	}{
		{"adulto con las dos, por sí mismo", EtapaAdulta, []Otorgamiento{ad, fin}, nil, true},
		{"adulto con las dos y una accesoria", EtapaAdulta, []Otorgamiento{ad, fin, {"avisos", titular}}, nil, true},
		{"adulto: no se le pide cuenta_del_menor", EtapaAdulta, []Otorgamiento{ad, fin}, []string{tutor}, true},
		{"adulto sin nada", EtapaAdulta, nil, nil, false},
		{"adulto con una sola", EtapaAdulta, []Otorgamiento{ad}, nil, false},
		{"adulto con solo accesorias", EtapaAdulta, []Otorgamiento{{"avisos", titular}}, nil, false},
		{"adulto: cuenta_del_menor no sustituye a las suyas", EtapaAdulta, []Otorgamiento{men}, []string{tutor}, false},
		{"adulto: otorgada por otra persona no vale", EtapaAdulta, []Otorgamiento{ad, {"funciones_financieras", otra}}, nil, false},
		{"menor con la de su tutor", EtapaMenor, []Otorgamiento{men}, []string{tutor}, true},
		{"menor con la de uno de dos tutores", EtapaMenor, []Otorgamiento{men}, []string{otra, tutor}, true},
		{"menor: otorgada por el propio menor no vale", EtapaMenor, []Otorgamiento{{"cuenta_del_menor", titular}}, []string{tutor}, false},
		{"menor: otorgada por quien no es su tutor no vale", EtapaMenor, []Otorgamiento{{"cuenta_del_menor", otra}}, []string{tutor}, false},
		{"menor sin tutores", EtapaMenor, []Otorgamiento{men}, nil, false},
		{"menor con la lista de adulto no alcanza", EtapaMenor, []Otorgamiento{ad, fin}, []string{tutor}, false},
		{"a los 18: la persona pasa a adulta y necesita las suyas", EtapaAdulta, []Otorgamiento{men}, nil, false},
		{"a los 18: con las suyas, otorgadas por ella, cumple", EtapaAdulta, []Otorgamiento{men, ad, fin}, nil, true},
		{"etapa desconocida", "otra", []Otorgamiento{ad, fin, men}, []string{tutor}, false},
	}
	for _, c := range casos {
		if got := r.Cumple(c.etapa, titular, c.vigentes, c.tutores); got != c.quiere {
			t.Errorf("%s: Cumple = %v, se esperaba %v", c.nombre, got, c.quiere)
		}
	}
	if r.Cumple(EtapaAdulta, "", []Otorgamiento{{"cuenta_y_acceso", ""}, {"funciones_financieras", ""}}, nil) {
		t.Error("sin titular no se cumple, aunque el otorgante también venga vacío")
	}
}
