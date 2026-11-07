//go:build integration

// Pruebas de punta a punta de la interpretación de texto (US-62) contra PostgreSQL y el enrutador real, de caja negra.
// Solo datos sintéticos.
package registro_test

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/interpretacion"
)

// RN-001: lo interpretado no se guarda por sí solo. Interpretar no toca la base; guardar es el POST de /movimientos
// con lo que la persona confirmó (aquí, lo que se propuso con el monto corregido), y entonces sí hay una fila.
func TestInterpretarNoGuardaYGuardarEsOtraPeticion(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)

		r := c.llamar("POST", rutaInterpretacion, `{"texto":"gasté 15 mil en almuerzo ayer"}`)
		var p struct {
			Resultado string `json:"resultado"`
			Tipo      string `json:"tipo"`
			Monto     int64  `json:"monto_centavos"`
			Categoria struct {
				ID     int    `json:"id"`
				Nombre string `json:"nombre"`
			} `json:"categoria"`
			Fecha string `json:"fecha"`
		}
		if r.Codigo != 200 || r.Cache != "no-store" || json.Unmarshal([]byte(r.Cuerpo), &p) != nil {
			t.Fatalf("interpretar: %d %s %q", r.Codigo, r.Cuerpo, r.Cache)
		}
		if p.Resultado != "propuesta" || p.Tipo != "gasto" || p.Monto != 1500000 || p.Categoria.Nombre != "Restaurantes y hoteles" || p.Fecha != "2026-10-25" {
			t.Errorf("propuesta: %+v", p)
		}
		var idEnLaBase int
		if err := s.pool.QueryRow(context.Background(), `SELECT id FROM categoria WHERE nombre = $1 AND tipo = 'gasto'`, p.Categoria.Nombre).Scan(&idEnLaBase); err != nil || idEnLaBase != p.Categoria.ID {
			t.Errorf("el id de la categoría propuesta no es el del catálogo: %d, %v", p.Categoria.ID, err)
		}
		for _, tabla := range []string{"movimiento", "movimiento_recurrente", "ocurrencia_omitida"} {
			if n := s.contar(`SELECT count(*) FROM ` + tabla); n != 0 {
				t.Fatalf("interpretar escribió en %s: %d filas", tabla, n)
			}
		}

		// Confirma, corrigiendo el monto: el cliente guarda con la ruta de siempre y lo que la persona confirmó.
		res := s.crear(c, cuerpoDe(p.Tipo, "1800000", p.Fecha, strconv.Itoa(p.Categoria.ID), ""))
		if res.MovimientoID == nil {
			t.Fatalf("no guardó: %+v", res)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid AND monto = 1800000 AND categoria_id = $2`, persona, p.Categoria.ID); n != 1 {
			t.Errorf("tras confirmar debe haber una fila con lo confirmado: %d", n)
		}
	})
}

// RN-011, RF-005: nunca se propone una categoría que la persona ocultó; la propuesta va sin categoría.
func TestInterpretarNuncaProponeUnaCategoriaOculta(t *testing.T) {
	s := nuevoServidor(t)
	c, persona := s.nuevaCuenta("laura@ejemplo.test", false, true)
	const texto = `{"texto":"gasté 15 mil en almuerzo"}`
	if r := c.llamar("POST", rutaInterpretacion, texto); !strings.Contains(r.Cuerpo, `"categoria":{"id":`) {
		t.Fatalf("antes de ocultar la categoría se propone: %s", r.Cuerpo)
	}
	if _, err := s.pool.Exec(context.Background(),
		`INSERT INTO ocultamiento_categoria (persona_id, categoria_id) SELECT $1::uuid, id FROM categoria WHERE nombre = 'Restaurantes y hoteles' AND tipo = 'gasto'`, persona); err != nil {
		t.Fatal(err)
	}
	r := c.llamar("POST", rutaInterpretacion, texto)
	if r.Codigo != 200 || !strings.Contains(r.Cuerpo, `"categoria":null`) || !strings.Contains(r.Cuerpo, `"monto_centavos":1500000`) {
		t.Errorf("con la categoría oculta: %d %s", r.Codigo, r.Cuerpo)
	}
}

// El motor y el catálogo hablan de las mismas categorías: cada nombre de las reglas (D-1.0) existe en E09 con su tipo.
func TestLasCategoriasDeLasReglasExistenEnElCatalogo(t *testing.T) {
	s := nuevoServidor(t)
	var reglas struct {
		Categorias struct {
			PorDefecto map[string]string `json:"por_defecto"`
			Gasto      []struct{ Categoria string }
			Ingreso    []struct{ Categoria string }
		} `json:"categorias"`
	}
	if err := json.Unmarshal(interpretacion.ReglasIncluidasJSON(), &reglas); err != nil {
		t.Fatal(err)
	}
	vistas := 0
	comprobar := func(tipo, nombre string) {
		vistas++
		if n := s.contar(`SELECT count(*) FROM categoria WHERE nombre = $1 AND tipo = $2`, nombre, tipo); n != 1 {
			t.Errorf("la categoría %q (%s) de las reglas no está en el catálogo", nombre, tipo)
		}
	}
	for tipo, nombre := range reglas.Categorias.PorDefecto {
		comprobar(tipo, nombre)
	}
	for _, c := range reglas.Categorias.Gasto {
		comprobar("gasto", c.Categoria)
	}
	for _, c := range reglas.Categorias.Ingreso {
		comprobar("ingreso", c.Categoria)
	}
	if vistas < 10 {
		t.Fatalf("la prueba solo vio %d categorías", vistas)
	}
}

// Nivel `requiere_autorizacion`, como las demás rutas del registro: sin sesión 401, sin autorizar 403, y no llega al motor.
func TestInterpretarExigeSesionYAutorizacion(t *testing.T) {
	espia := &espiaDeInterpretador{t: t}
	s := nuevoServidorCon(t, espia)
	sinSesion := &cliente{s: s}
	if r := sinSesion.llamar("POST", rutaInterpretacion, `{"texto":"hola"}`); r.Codigo != 401 {
		t.Errorf("sin sesión: %d %s", r.Codigo, r.Cuerpo)
	}
	sinAutorizar, _ := s.nuevaCuenta("ana@ejemplo.test", false, false)
	if r := sinAutorizar.llamar("POST", rutaInterpretacion, `{"texto":"hola"}`); r.Codigo != 403 {
		t.Errorf("sin autorizar: %d %s", r.Codigo, r.Cuerpo)
	}
	if espia.llamadas != 0 {
		t.Errorf("el motor recibió %d llamadas sin acceso", espia.llamadas)
	}
}

// RN-005 (RP-016), con todo el Enrutador: se llama a cada ruta que no es la de interpretación, ya con sesión, y el
// Interpretador (un espía que falla si lo llaman) no recibe ninguna llamada: los montos, totales y repeticiones que el
// API calcula no pasan por él.
func TestRN005NingunCalculoDeNingunaRutaPasaPorElInterpretador(t *testing.T) {
	espia := &espiaDeInterpretador{t: t}
	s := nuevoServidorCon(t, espia)
	c, _ := s.nuevaCuenta("laura@ejemplo.test", false, true)
	res := s.crear(c, cuerpoDe("gasto", "65000000", "2026-08-15", "4", arriendo))
	if res.MovimientoID == nil || res.RecurrenteID == nil {
		t.Fatalf("%+v", res)
	}
	cuerpos := map[string]string{
		"POST /api/v1/movimientos":                    cuerpoDe("gasto", "123456789", "2026-10-26", "4", `,"repeticion":{"periodicidad":"quincenal"}`),
		"PUT /api/v1/movimientos/{id}":                cuerpoDe("gasto", "70000000", "2026-08-15", "4", ""),
		"POST /api/v1/repeticiones/{id}/confirmacion": `{"fecha":"2026-09-15"}`,
		"POST /api/v1/repeticiones/{id}/omision":      `{"fecha":"2026-10-15"}`,
		"POST /api/v1/repeticiones/decisiones":        `{"decisiones":[{"recurrente_id":"` + *res.RecurrenteID + `","fecha":"2026-10-15","decision":"omitir"}]}`,
	}
	recorridas := 0
	for _, ruta := range s.rutas {
		if ruta.Patron == "POST "+rutaInterpretacion {
			continue
		}
		metodo, camino, _ := strings.Cut(ruta.Patron, " ")
		id := *res.MovimientoID
		if strings.Contains(camino, "repeticiones") {
			id = *res.RecurrenteID
		}
		camino = strings.ReplaceAll(camino, "{id}", id)
		// El borrado de la cuenta y el cierre de la sesión van al final: acaban con lo que sigue.
		if strings.Contains(camino, "cuenta/borrado") && metodo == "POST" || metodo == "DELETE" && strings.Contains(camino, "sesiones") {
			continue
		}
		c.llamar(metodo, camino, cuerpos[ruta.Patron])
		recorridas++
	}
	c.llamar("GET", "/api/v1/movimientos?periodo=2026-10", "")
	c.llamar("GET", "/api/v1/repeticiones/proximas?periodicidad=mensual&inicio=2026-08-15", "")
	if recorridas < 15 {
		t.Fatalf("la prueba solo recorrió %d rutas", recorridas)
	}
	if espia.llamadas != 0 {
		t.Fatalf("el Interpretador recibió %d llamadas desde rutas que no son la de interpretación", espia.llamadas)
	}
	espia.permitido = true
	if r := c.llamar("POST", rutaInterpretacion, `{"texto":"hola"}`); r.Codigo != 200 || espia.llamadas != 1 {
		t.Errorf("de control: %d %s, llamadas %d", r.Codigo, r.Cuerpo, espia.llamadas)
	}
}
