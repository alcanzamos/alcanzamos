package cuenta_test

import (
	"io/fs"
	"regexp"
	"slices"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/migraciones"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
)

// finalidadDelCatalogo es una fila del INSERT INTO finalidad de la migración.
type finalidadDelCatalogo struct {
	codigo, tipo string
	activa       bool
}

// catalogoDeLasMigraciones lee las finalidades que siembran las migraciones (`0002_catalogo.sql` y las que le suman
// finalidades, como `0005_transmision_a_encargados.sql`), las mismas que se aplican a la base. Si el formato del INSERT
// cambia, esta lectura falla en vez de devolver una lista vacía.
func catalogoDeLasMigraciones(t *testing.T) []finalidadDelCatalogo {
	t.Helper()
	archivos, err := fs.Glob(migraciones.SQL, "*.sql")
	if err != nil {
		t.Fatal(err)
	}
	insert := regexp.MustCompile(`(?s)INSERT INTO finalidad \(codigo, tipo, activa, descripcion\) VALUES(.*?);`)
	fila := regexp.MustCompile(`\(\s*'([a-z0-9_]+)',\s*'([a-z]+)',\s*(true|false),`)
	var filas []finalidadDelCatalogo
	for _, archivo := range archivos {
		sql, err := fs.ReadFile(migraciones.SQL, archivo)
		if err != nil {
			t.Fatal(err)
		}
		for _, bloque := range insert.FindAllSubmatch(sql, -1) {
			for _, m := range fila.FindAllSubmatch(bloque[1], -1) {
				filas = append(filas, finalidadDelCatalogo{string(m[1]), string(m[2]), string(m[3]) == "true"})
			}
		}
	}
	if len(filas) < 8 {
		t.Fatalf("leí %d finalidades de las migraciones, se esperaban al menos 8 (las 7 de 0002 y transmision_a_encargados)", len(filas))
	}
	return filas
}

// Prueba guardiana (SEG-011, D-139): si alguien siembra una finalidad necesaria y activa y la regla no la clasifica,
// esta prueba falla y obliga a decidir a qué etapa le toca.
func TestElCatalogoNoTieneNecesariasSinClasificar(t *testing.T) {
	var r cuenta.ReglaDeFinalidades
	activasNecesarias := 0
	for _, f := range catalogoDeLasMigraciones(t) {
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
	var r cuenta.ReglaDeFinalidades
	catalogo := map[string]finalidadDelCatalogo{}
	for _, f := range catalogoDeLasMigraciones(t) {
		catalogo[f.codigo] = f
	}
	for _, e := range []cuenta.Etapa{cuenta.EtapaAdulta, cuenta.EtapaMenor} {
		for _, f := range r.Necesarias(e) {
			c, ok := catalogo[f.Codigo]
			if !ok || c.tipo != "necesaria" || !c.activa {
				t.Errorf("la regla exige %q a la etapa %s, pero el catálogo no la tiene como necesaria y activa", f.Codigo, e)
			}
		}
	}
}

func TestListasDeCadaEtapa(t *testing.T) {
	var r cuenta.ReglaDeFinalidades
	casos := []struct {
		etapa  cuenta.Etapa
		quiere []cuenta.FinalidadNecesaria
	}{
		{cuenta.EtapaAdulta, []cuenta.FinalidadNecesaria{{Codigo: "cuenta_y_acceso", Otorga: cuenta.LaPersona}, {Codigo: "funciones_financieras", Otorga: cuenta.LaPersona},
			{Codigo: "transmision_a_encargados", Otorga: cuenta.LaPersona}}},
		{cuenta.EtapaMenor, []cuenta.FinalidadNecesaria{{Codigo: "cuenta_del_menor", Otorga: cuenta.ElTutor}, {Codigo: "transmision_a_encargados", Otorga: cuenta.ElTutor}}},
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
	r.Necesarias(cuenta.EtapaAdulta)[0].Codigo = "otra"
	if r.Necesarias(cuenta.EtapaAdulta)[0].Codigo != "cuenta_y_acceso" {
		t.Error("Necesarias devolvió la lista interna")
	}
}

func TestCumple(t *testing.T) {
	var r cuenta.ReglaDeFinalidades
	const titular, tutor, otra = "t-1", "tu-1", "o-1"
	ad := cuenta.Otorgamiento{Finalidad: "cuenta_y_acceso", OtorganteID: titular}
	fin := cuenta.Otorgamiento{Finalidad: "funciones_financieras", OtorganteID: titular}
	men := cuenta.Otorgamiento{Finalidad: "cuenta_del_menor", OtorganteID: tutor}
	tra := cuenta.Otorgamiento{Finalidad: "transmision_a_encargados", OtorganteID: titular}
	traTutor := cuenta.Otorgamiento{Finalidad: "transmision_a_encargados", OtorganteID: tutor}
	casos := []struct {
		nombre   string
		etapa    cuenta.Etapa
		vigentes []cuenta.Otorgamiento
		tutores  []string
		quiere   bool
	}{
		{"adulto con las tres, por sí mismo", cuenta.EtapaAdulta, []cuenta.Otorgamiento{ad, fin, tra}, nil, true},
		{"adulto con las tres y una accesoria", cuenta.EtapaAdulta, []cuenta.Otorgamiento{ad, fin, tra, {Finalidad: "avisos", OtorganteID: titular}}, nil, true},
		{"adulto: no se le pide cuenta_del_menor", cuenta.EtapaAdulta, []cuenta.Otorgamiento{ad, fin, tra}, []string{tutor}, true},
		{"adulto sin nada", cuenta.EtapaAdulta, nil, nil, false},
		{"adulto con una sola", cuenta.EtapaAdulta, []cuenta.Otorgamiento{ad}, nil, false},
		// SC-E21-25 sección 5: la cuenta de antes del cambio tiene las dos viejas y le falta la nueva.
		{"adulto de antes del cambio: sin transmision_a_encargados no cumple", cuenta.EtapaAdulta, []cuenta.Otorgamiento{ad, fin}, nil, false},
		{"adulto con solo transmision_a_encargados", cuenta.EtapaAdulta, []cuenta.Otorgamiento{tra}, nil, false},
		{"adulto: la transmisión dada por su tutor no vale", cuenta.EtapaAdulta, []cuenta.Otorgamiento{ad, fin, traTutor}, []string{tutor}, false},
		{"adulto: la transmisión dada por otra persona no vale", cuenta.EtapaAdulta, []cuenta.Otorgamiento{ad, fin, {Finalidad: "transmision_a_encargados", OtorganteID: otra}}, nil, false},
		{"adulto con solo accesorias", cuenta.EtapaAdulta, []cuenta.Otorgamiento{{Finalidad: "avisos", OtorganteID: titular}}, nil, false},
		{"adulto: cuenta_del_menor no sustituye a las suyas", cuenta.EtapaAdulta, []cuenta.Otorgamiento{men}, []string{tutor}, false},
		{"adulto: otorgada por otra persona no vale", cuenta.EtapaAdulta, []cuenta.Otorgamiento{ad, tra, {Finalidad: "funciones_financieras", OtorganteID: otra}}, nil, false},
		{"menor con las dos de su tutor", cuenta.EtapaMenor, []cuenta.Otorgamiento{men, traTutor}, []string{tutor}, true},
		{"menor con las dos, de uno de dos tutores", cuenta.EtapaMenor, []cuenta.Otorgamiento{men, traTutor}, []string{otra, tutor}, true},
		{"menor con las dos, cada una de un tutor distinto", cuenta.EtapaMenor, []cuenta.Otorgamiento{men, {Finalidad: "transmision_a_encargados", OtorganteID: otra}}, []string{otra, tutor}, true},
		{"menor con solo cuenta_del_menor no cumple: falta la transmisión", cuenta.EtapaMenor, []cuenta.Otorgamiento{men}, []string{tutor}, false},
		{"menor con solo la transmisión no cumple", cuenta.EtapaMenor, []cuenta.Otorgamiento{traTutor}, []string{tutor}, false},
		{"menor: la transmisión dada por el propio menor no vale", cuenta.EtapaMenor, []cuenta.Otorgamiento{men, tra}, []string{tutor}, false},
		{"menor: la transmisión dada por quien no es su tutor no vale", cuenta.EtapaMenor, []cuenta.Otorgamiento{men, {Finalidad: "transmision_a_encargados", OtorganteID: otra}}, []string{tutor}, false},
		{"menor: otorgada por el propio menor no vale", cuenta.EtapaMenor, []cuenta.Otorgamiento{{Finalidad: "cuenta_del_menor", OtorganteID: titular}, traTutor}, []string{tutor}, false},
		{"menor: otorgada por quien no es su tutor no vale", cuenta.EtapaMenor, []cuenta.Otorgamiento{{Finalidad: "cuenta_del_menor", OtorganteID: otra}, traTutor}, []string{tutor}, false},
		{"menor sin tutores", cuenta.EtapaMenor, []cuenta.Otorgamiento{men, traTutor}, nil, false},
		{"menor con la lista de adulto no alcanza", cuenta.EtapaMenor, []cuenta.Otorgamiento{ad, fin, tra}, []string{tutor}, false},
		// A los 18 años (PN-54): la persona pasa a adulta y lo que dio su tutor no cuenta; lo da ella.
		{"a los 18: lo del tutor no alcanza", cuenta.EtapaAdulta, []cuenta.Otorgamiento{men, traTutor}, nil, false},
		{"a los 18: con las suyas, menos la transmisión, no cumple", cuenta.EtapaAdulta, []cuenta.Otorgamiento{men, traTutor, ad, fin}, nil, false},
		{"a los 18: con las tres suyas cumple", cuenta.EtapaAdulta, []cuenta.Otorgamiento{men, traTutor, ad, fin, tra}, nil, true},
		{"etapa desconocida", "otra", []cuenta.Otorgamiento{ad, fin, tra, men, traTutor}, []string{tutor}, false},
	}
	for _, c := range casos {
		if got := r.Cumple(c.etapa, titular, c.vigentes, c.tutores); got != c.quiere {
			t.Errorf("%s: Cumple = %v, se esperaba %v", c.nombre, got, c.quiere)
		}
	}
	if r.Cumple(cuenta.EtapaAdulta, "", []cuenta.Otorgamiento{{Finalidad: "cuenta_y_acceso", OtorganteID: ""}, {Finalidad: "funciones_financieras", OtorganteID: ""}, {Finalidad: "transmision_a_encargados", OtorganteID: ""}}, nil) {
		t.Error("sin titular no se cumple, aunque el otorgante también venga vacío")
	}
}

// Lo que PN-64 ofrece como accesorio (D-139): solo `avisos` y `horas_de_vida`, y solo a la persona adulta.
func TestAccesoriasDeCadaEtapa(t *testing.T) {
	var r cuenta.ReglaDeFinalidades
	if got := r.Accesorias(cuenta.EtapaAdulta); !slices.Equal(got, []string{"avisos", "horas_de_vida"}) {
		t.Errorf("Accesorias(adulta) = %v", got)
	}
	for _, e := range []cuenta.Etapa{cuenta.EtapaMenor, "", "otra"} {
		if got := r.Accesorias(e); got != nil {
			t.Errorf("Accesorias(%q) = %v, se esperaba nada", e, got)
		}
	}
	r.Accesorias(cuenta.EtapaAdulta)[0] = "otra"
	if r.Accesorias(cuenta.EtapaAdulta)[0] != "avisos" {
		t.Error("Accesorias devolvió la lista interna")
	}
}

// La regla no puede ofrecer una accesoria que el catálogo no tenga como accesoria y activa.
func TestLaReglaSoloOfreceAccesoriasActivasDelCatalogo(t *testing.T) {
	var r cuenta.ReglaDeFinalidades
	catalogo := map[string]finalidadDelCatalogo{}
	for _, f := range catalogoDeLasMigraciones(t) {
		catalogo[f.codigo] = f
	}
	for _, codigo := range r.Accesorias(cuenta.EtapaAdulta) {
		if c, ok := catalogo[codigo]; !ok || c.tipo != "accesoria" || !c.activa {
			t.Errorf("la regla ofrece %q, pero el catálogo no la tiene como accesoria y activa", codigo)
		}
	}
}

// Faltantes dice qué necesarias le faltan a cada titular, en el orden de la regla: es lo que PN-64 le pide a una cuenta
// que ya tenía algo autorizado antes del cambio (SC-E21-25, sección 5). Nada de lo que ya dio se vuelve a pedir.
func TestFaltantes(t *testing.T) {
	var r cuenta.ReglaDeFinalidades
	const titular, tutor, otra = "t-1", "tu-1", "o-1"
	de := func(finalidad, quien string) cuenta.Otorgamiento {
		return cuenta.Otorgamiento{Finalidad: finalidad, OtorganteID: quien}
	}
	casos := []struct {
		nombre   string
		etapa    cuenta.Etapa
		vigentes []cuenta.Otorgamiento
		tutores  []string
		quiere   []string
	}{
		{"adulto sin nada", cuenta.EtapaAdulta, nil, nil, []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}},
		{"adulto de antes del cambio", cuenta.EtapaAdulta, []cuenta.Otorgamiento{de("cuenta_y_acceso", titular), de("funciones_financieras", titular)}, nil, []string{"transmision_a_encargados"}},
		{"adulto con todo", cuenta.EtapaAdulta, []cuenta.Otorgamiento{de("cuenta_y_acceso", titular), de("funciones_financieras", titular), de("transmision_a_encargados", titular)}, nil, nil},
		{"adulto: lo dado por otra persona sigue faltando", cuenta.EtapaAdulta, []cuenta.Otorgamiento{de("cuenta_y_acceso", titular), de("funciones_financieras", titular), de("transmision_a_encargados", tutor)}, []string{tutor}, []string{"transmision_a_encargados"}},
		{"adulto: las accesorias no cuentan", cuenta.EtapaAdulta, []cuenta.Otorgamiento{de("avisos", titular)}, nil, []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}},
		{"menor sin nada", cuenta.EtapaMenor, nil, []string{tutor}, []string{"cuenta_del_menor", "transmision_a_encargados"}},
		{"menor con la transmisión de su tutor", cuenta.EtapaMenor, []cuenta.Otorgamiento{de("transmision_a_encargados", tutor)}, []string{tutor}, []string{"cuenta_del_menor"}},
		{"menor con todo, dado por su tutor", cuenta.EtapaMenor, []cuenta.Otorgamiento{de("cuenta_del_menor", tutor), de("transmision_a_encargados", tutor)}, []string{tutor}, nil},
		{"menor: la transmisión dada por el menor sigue faltando", cuenta.EtapaMenor, []cuenta.Otorgamiento{de("cuenta_del_menor", tutor), de("transmision_a_encargados", titular)}, []string{tutor}, []string{"transmision_a_encargados"}},
		{"menor: la de quien no es su tutor sigue faltando", cuenta.EtapaMenor, []cuenta.Otorgamiento{de("cuenta_del_menor", tutor), de("transmision_a_encargados", otra)}, []string{tutor}, []string{"transmision_a_encargados"}},
		{"a los 18 solo falta lo que la persona no dio", cuenta.EtapaAdulta, []cuenta.Otorgamiento{de("cuenta_del_menor", tutor), de("transmision_a_encargados", tutor), de("cuenta_y_acceso", titular)}, nil, []string{"funciones_financieras", "transmision_a_encargados"}},
		{"etapa desconocida", "otra", nil, nil, nil},
	}
	for _, c := range casos {
		if got := r.Faltantes(c.etapa, titular, c.vigentes, c.tutores); !slices.Equal(got, c.quiere) {
			t.Errorf("%s: Faltantes = %v, se esperaba %v", c.nombre, got, c.quiere)
		}
	}
}
