//go:build integration

package registro_test

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/reloj"
	"github.com/alcanzamos/alcanzamos/api/test/estadistica"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// sinLeerOcultas es el repositorio de producción (pg.Movimientos) con un solo cambio: Guardar no lee las categorías
// ocultas de la persona. Es una copia de pg.Movimientos.Guardar sin la cláusula `NOT EXISTS (… ocultamiento_categoria …)`
// de su regla `visible`; todo lo demás (la transacción, la revisión de la categoría, los dos INSERT y el commit) es igual.
// Los errores de los INSERT no se traducen como en errorDeGuardar: la medición no pasa por ellos. Si Guardar cambia en
// src/pg/movimientos.go, esta copia tiene que cambiar con él: la prueba comprueba que las dos versiones guardan lo mismo.
type sinLeerOcultas struct {
	*pg.Movimientos
	pool *pgxpool.Pool
}

func (s sinLeerOcultas) Guardar(ctx context.Context, g registro.Guardado, ahora time.Time) (registro.Creados, error) {
	pool := s.pool
	var creados registro.Creados
	tx, err := pool.Begin(ctx)
	if err != nil {
		return creados, err
	}
	defer tx.Rollback(ctx)
	var existe, puedeVerla bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM persona WHERE id = $1::uuid),
		        EXISTS (SELECT 1 FROM categoria c JOIN persona p ON p.id = $1::uuid WHERE c.id = $2 AND (p.etapa = 'adulta' OR c.apta_para_menores))`,
		g.Persona, g.CategoriaID).Scan(&existe, &puedeVerla); err != nil {
		return registro.Creados{}, err
	}
	if existe && !puedeVerla {
		return registro.Creados{}, registro.ErrCategoriaInvalida
	}
	var recurrente *string
	if g.Periodicidad != "" {
		if err := tx.QueryRow(ctx,
			`INSERT INTO movimiento_recurrente (persona_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio, creado_en)
			 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
			g.Persona, g.Tipo, g.CategoriaID, string(g.Periodicidad), g.Monto, g.Medio, g.Fecha, ahora).Scan(&creados.RecurrenteID); err != nil {
			return registro.Creados{}, err
		}
		recurrente = &creados.RecurrenteID
	}
	if g.ConMovimiento {
		var programada *time.Time
		if recurrente != nil {
			programada = &g.Fecha
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id, recurrente_id, fecha_programada, creado_en)
			 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10) RETURNING id::text`,
			g.Persona, g.Tipo, g.Monto, g.Fecha, g.Medio, g.Descripcion, g.CategoriaID, recurrente, programada, ahora).Scan(&creados.MovimientoID); err != nil {
			return registro.Creados{}, err
		}
	}
	return creados, tx.Commit(ctx)
}

// Parámetros de la medición de USA-011.
const (
	// repeticionesDeUSA011 son las medidas de cada caso; calentamientoDeUSA011, las de cada caso que se descartan antes.
	repeticionesDeUSA011  = 300
	calentamientoDeUSA011 = 50
	// cotaDeUSA011 es la diferencia de tiempo que se acepta entre los dos casos, en la mediana y en el percentil 90.
	// E18-PPR no fija un número para USA-011 («no empeora el tiempo de RNF-001»): la cota es una centésima de segundo, el
	// 0,1 % de los 10 s de promedio de RNF-001 para registrar un gasto, una diferencia que la persona no puede notar.
	cotaDeUSA011 = 10 * time.Millisecond
)

// percentil devuelve el valor de la posición ⌈p·n⌉ de la muestra ordenada (p entre 0 y 1).
func percentil(v []float64, p float64) float64 {
	c := append([]float64(nil), v...)
	sort.Float64s(c)
	i := int(float64(len(c))*p+0.999999) - 1
	return c[max(0, min(i, len(c)-1))]
}

// USA-011 (RNF-001, T-15; método del dueño, E18-PPR 1.10): la lectura de las categorías ocultas del servicio de registro
// no empeora el tiempo de RNF-001. Mide el servicio de registro (registro.Servicio.Registrar, el mismo que atiende
// `POST /api/v1/movimientos`) sobre PostgreSQL con la lectura de las categorías ocultas (pg.Movimientos, el de producción)
// y sin ella (sinLeerOcultas), con una persona que tiene ocultas todas las categorías de gasto que se pueden ocultar menos
// la que usa. Cada caso: calentamiento, después repeticionesDeUSA011 medidas, intercaladas en un orden al azar con semilla
// fija. Compara la mediana, el percentil 90 y la distribución (Kolmogórov-Smirnov), imprime los números y solo afirma lo
// que dice el criterio: las diferencias de la mediana y del percentil 90 no pasan de cotaDeUSA011.
func TestUSA_011LeerLasCategoriasOcultasNoEmpeoraElTiempoDelRegistro(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	conLectura := registro.NuevoServicio(pg.NuevoMovimientos(pool), reloj.Sistema{})
	sinLectura := registro.NuevoServicio(sinLeerOcultas{pg.NuevoMovimientos(pool), pool}, reloj.Sistema{})

	var persona string
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa) VALUES ('Laura', 'adulta') RETURNING id::text`).Scan(&persona); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, 'laura.usa011@ejemplo.test', true)`, persona); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var usada int
	if err := pool.QueryRow(ctx, `SELECT min(id) FROM categoria WHERE tipo = 'gasto' AND NOT general`).Scan(&usada); err != nil {
		t.Fatal(err)
	}
	etiqueta, err := pool.Exec(ctx,
		`INSERT INTO ocultamiento_categoria (persona_id, categoria_id) SELECT $1::uuid, id FROM categoria WHERE tipo = 'gasto' AND NOT general AND id <> $2`,
		persona, usada)
	if err != nil {
		t.Fatal(err)
	}
	if etiqueta.RowsAffected() == 0 {
		t.Fatal("no quedó ninguna categoría oculta: la lectura no tendría nada que leer")
	}

	descripcion := "mercado de la semana"
	hoy := fechas.HoyEnColombia(time.Now()).Format("2006-01-02")
	registrar := func(s *registro.Servicio) (time.Duration, error) {
		categoria := usada
		sol := registro.Solicitud{Tipo: registro.Gasto, MontoCentavos: []byte("1500000"), Fecha: hoy, CategoriaID: &categoria,
			Medio: registro.Efectivo, Descripcion: &descripcion}
		inicio := time.Now()
		res, err := s.Registrar(ctx, persona, sol)
		d := time.Since(inicio)
		if err == nil && res.MovimientoID == nil {
			err = errors.New("no guardó el movimiento")
		}
		return d, err
	}

	// Las dos versiones hacen lo mismo con una categoría visible y con una oculta, salvo lo que se mide: la de producción
	// rechaza la oculta (RN-011) y la copia sin la lectura la guarda.
	var oculta int
	if err := pool.QueryRow(ctx, `SELECT categoria_id FROM ocultamiento_categoria WHERE persona_id = $1::uuid LIMIT 1`, persona).Scan(&oculta); err != nil {
		t.Fatal(err)
	}
	conOculta := registro.Solicitud{Tipo: registro.Gasto, MontoCentavos: []byte("100"), Fecha: hoy, CategoriaID: &oculta, Medio: registro.Efectivo}
	var invalida *registro.ErrValidacion
	if _, err := conLectura.Registrar(ctx, persona, conOculta); !errors.As(err, &invalida) || invalida.Campos["categoria_id"] != registro.CategoriaInvalida {
		t.Fatalf("con la lectura, una categoría oculta debe dar categoria_invalida: %v", err)
	}
	if _, err := sinLectura.Registrar(ctx, persona, conOculta); err != nil {
		t.Fatalf("sin la lectura, la categoría oculta se guarda: %v", err)
	}

	repeticiones := repeticionesDeUSA011
	if testing.Short() {
		repeticiones = 60
	}
	type medida struct{ con bool }
	orden := make([]medida, 0, 2*(calentamientoDeUSA011+repeticiones))
	for range calentamientoDeUSA011 + repeticiones {
		orden = append(orden, medida{true}, medida{false})
	}
	// El calentamiento va primero (sus 2·calentamiento medidas, también intercaladas) y no cuenta.
	azar := rand.New(rand.NewPCG(11, 1))
	calentamiento, medidas := orden[:2*calentamientoDeUSA011], orden[2*calentamientoDeUSA011:]
	azar.Shuffle(len(calentamiento), func(i, j int) { calentamiento[i], calentamiento[j] = calentamiento[j], calentamiento[i] })
	azar.Shuffle(len(medidas), func(i, j int) { medidas[i], medidas[j] = medidas[j], medidas[i] })

	tiempos := map[bool][]float64{}
	for n, m := range orden {
		if n == len(calentamiento) {
			runtime.GC() // que el recolector no arranque dentro de las medidas por lo que dejó el calentamiento
		}
		s := sinLectura
		if m.con {
			s = conLectura
		}
		d, err := registrar(s)
		if err != nil {
			t.Fatalf("registrar (con la lectura: %v): %v", m.con, err)
		}
		if n >= len(calentamiento) {
			tiempos[m.con] = append(tiempos[m.con], float64(d.Microseconds()))
		}
	}

	con, sin := tiempos[true], tiempos[false]
	medianaCon, medianaSin := percentil(con, 0.5), percentil(sin, 0.5)
	p90Con, p90Sin := percentil(con, 0.9), percentil(sin, 0.9)
	d, p := estadistica.KolmogorovSmirnov(con, sin)
	resumen := fmt.Sprintf("USA-011: %d medidas por caso (GOMAXPROCS=%d). Con la lectura: mediana %.0f µs, p90 %.0f µs. "+
		"Sin la lectura: mediana %.0f µs, p90 %.0f µs. Diferencia: mediana %+.0f µs, p90 %+.0f µs. "+
		"Kolmogórov-Smirnov: D = %.3f, p = %.4f. Cota: %v",
		len(con), runtime.GOMAXPROCS(0), medianaCon, p90Con, medianaSin, p90Sin, medianaCon-medianaSin, p90Con-p90Sin, d, p, cotaDeUSA011)
	t.Log(resumen)
	cota := float64(cotaDeUSA011.Microseconds())
	if medianaCon-medianaSin > cota || p90Con-p90Sin > cota {
		t.Errorf("leer las categorías ocultas empeora el registro más de %v: %s", cotaDeUSA011, resumen)
	}

	// Las dos versiones guardaron lo mismo: un movimiento por medida (más el del calentamiento y el de la oculta).
	var guardados int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid`, persona).Scan(&guardados); err != nil {
		t.Fatal(err)
	}
	if guardados != len(orden)+1 {
		t.Errorf("se guardaron %d movimientos, se esperaban %d", guardados, len(orden)+1)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM (
		SELECT tipo, monto, fecha, medio, descripcion, categoria_id, recurrente_id, fecha_programada FROM movimiento WHERE persona_id = $1::uuid AND categoria_id = $2
		GROUP BY 1, 2, 3, 4, 5, 6, 7, 8) AS distintas`, persona, usada).Scan(&guardados); err != nil {
		t.Fatal(err)
	}
	if guardados != 1 {
		t.Errorf("las dos versiones guardaron filas distintas: %d formas", guardados)
	}
}
