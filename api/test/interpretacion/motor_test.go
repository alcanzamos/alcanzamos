package interpretacion_test

import (
	"bytes"
	"context"
	"errors"
	"go/parser"
	"go/token"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/interpretacion"
)

func interpretar(t *testing.T, motor interpretacion.Interpretador, texto string) interpretacion.Interpretacion {
	t.Helper()
	res, err := motor.Interpretar(context.Background(), interpretacion.Entrada{Texto: texto, FechaReferencia: fechaReferencia})
	if err != nil {
		t.Fatalf("%q: %v", texto, err)
	}
	return res
}

// Si a las reglas les falta un dato que sus patrones suponen (un mes, un día de la semana, una unidad), la regla no
// aplica y el motor sigue con la siguiente; nunca entra en pánico.
func TestReglasSinElDatoQueSusPatronesSuponen(t *testing.T) {
	original := string(interpretacion.ReglasIncluidasJSON())
	casos := []struct{ quitar, texto, fecha string }{
		{`"lunes": 0`, "el lunes 5 mil", "2026-11-02"},
		{`"octubre": 10`, "el 20 de octubre 5 mil", "2026-10-20"}, // sigue la regla «el 20», que usa el día
		{`"octubre": 10`, "el 20 de octubre de 2026 5 mil", "2026-10-20"},
		{`"semanas": 7`, "hace 2 semanas 5 mil", "2026-11-02"},
	}
	for _, c := range casos {
		if !strings.Contains(original, c.quitar) {
			t.Fatalf("las reglas no tienen %s", c.quitar)
		}
		reglas, err := interpretacion.CargarReglas([]byte(strings.Replace(original, c.quitar, `"x`+c.quitar[1:], 1)))
		if err != nil {
			t.Fatal(err)
		}
		res := interpretar(t, interpretacion.NuevoPorReglas(reglas), c.texto)
		if res.Fecha == nil || res.Fecha.Format(time.DateOnly) != c.fecha {
			t.Errorf("sin %s, %q dio fecha %v, se esperaba %s", c.quitar, c.texto, res.Fecha, c.fecha)
		}
	}
}

func TestInterpretaMensajesConocidos(t *testing.T) {
	motor := motorReal(t)
	casos := []struct {
		texto string
		monto *int64
		tipo  interpretacion.Tipo
		fecha *time.Time
		cat   string
	}{
		{"pagué la luz ayer, 134.200", centavos(13420000), interpretacion.Gasto, dia(2026, 11, 1), "Servicios públicos"},
		{"me llegó el sueldo 2 millones y medio", centavos(250000000), interpretacion.Ingreso, dia(2026, 11, 2), "Salario"},
		{"almuerzo 15 mil el viernes", centavos(1500000), interpretacion.Gasto, dia(2026, 10, 30), "Restaurantes y hoteles"},
		{"10 cuotas de 180 mil", centavos(180000000), interpretacion.Gasto, dia(2026, 11, 2), "Pagos de deudas"},
		{"gasté 2,5", centavos(200), interpretacion.Gasto, dia(2026, 11, 2), "Otros gastos"}, // round(2.5) de Python = 2
		{"compré algo", nil, interpretacion.Gasto, dia(2026, 11, 2), "Otros gastos"},
		{"café 4500 el 20 de octubre", centavos(450000), interpretacion.Gasto, dia(2026, 10, 20), "Restaurantes y hoteles"},
		{"treinta y cinco mil de arroz", centavos(3500000), interpretacion.Gasto, dia(2026, 11, 2), "Alimentación"},
		{"compré 20 5000", centavos(500000), interpretacion.Gasto, dia(2026, 11, 2), "Otros gastos"},
		{"compré 5 dos mil", centavos(200000), interpretacion.Gasto, dia(2026, 11, 2), "Otros gastos"},
		{"total medio", nil, interpretacion.Gasto, dia(2026, 11, 2), "Otros gastos"},
		{"pagué cuarenta cinco", nil, interpretacion.Gasto, dia(2026, 11, 2), "Otros gastos"},
		{"compré 5 mil 300 y medio", centavos(580000), interpretacion.Gasto, dia(2026, 11, 2), "Otros gastos"},
		{"internet hace 3 dias 90.000", centavos(9000000), interpretacion.Gasto, dia(2026, 10, 30), "Comunicaciones"},
		{"mercado 80 mil el 25/10", centavos(8000000), interpretacion.Gasto, dia(2026, 10, 25), "Alimentación"},
	}
	for _, c := range casos {
		res := interpretar(t, motor, c.texto)
		if res.Intencion != interpretacion.Registro || res.ReglasVersion != "D-1.0" {
			t.Errorf("%q: intención %q, versión %q", c.texto, res.Intencion, res.ReglasVersion)
		}
		if (res.Monto == nil) != (c.monto == nil) || (res.Monto != nil && *res.Monto != *c.monto) {
			t.Errorf("%q: monto %v, se esperaba %v", c.texto, valorDe(res.Monto), valorDe(c.monto))
		}
		if res.Tipo != c.tipo || res.Categoria != c.cat {
			t.Errorf("%q: tipo %q y categoría %q, se esperaba %q y %q", c.texto, res.Tipo, res.Categoria, c.tipo, c.cat)
		}
		if res.Fecha == nil || (c.fecha != nil && !res.Fecha.Equal(*c.fecha)) {
			t.Errorf("%q: fecha %v, se esperaba %v", c.texto, res.Fecha, c.fecha)
		}
	}
}

// Un mensaje que no es registro devuelve todo en null (README de la opción D, intención).
func TestPreguntaYRecomendacionNoTraenCampos(t *testing.T) {
	motor := motorReal(t)
	casos := map[string]interpretacion.Intencion{
		"¿cuánto gasté en comida este mes?":      interpretacion.Pregunta,
		"qué CDT me recomiendas para 5 millones": interpretacion.Recomendacion,
	}
	for texto, intencion := range casos {
		res := interpretar(t, motor, texto)
		if res.Intencion != intencion || res.Monto != nil || res.Tipo != "" || res.Fecha != nil || res.Categoria != "" || res.ReglasVersion != "D-1.0" {
			t.Errorf("%q: %+v", texto, res)
		}
	}
}

// Casos límite que el prototipo no resuelve (lanza una excepción) y el motor tampoco puede representar: el motor no
// entra en pánico y no inventa un monto ni una fecha.
func TestEntradasExtremasNoRompenElMotor(t *testing.T) {
	motor := motorReal(t)
	casos := []struct {
		texto string
		monto *int64
		fecha *time.Time
	}{
		{"gasté 99999999999999999999 pesos", nil, dia(2026, 11, 2)},             // no cabe en centavos de int64
		{"gasté 1" + strings.Repeat("0", 250), nil, dia(2026, 11, 2)},           // mucho mayor que 2^53
		{"compré hace 99999999 dias 5 mil", centavos(500000), dia(2026, 11, 2)}, // la fecha se sale del calendario
		{"pagué el 31 de febrero 5 mil", centavos(500000), dia(2026, 10, 31)},
		{"pagué el 0/13/0000 5 mil", centavos(500000), dia(2026, 11, 2)},
		{"pagué el 31 4 mil", centavos(400000), dia(2026, 10, 31)},
		{"pagué el 31/12/99 5 mil", centavos(500000), dia(2099, 12, 31)},
		{"pagué hace dos semanas 5 mil", centavos(500000), dia(2026, 10, 19)},
		{"pagué el 3 de mayo del 2024 7 mil", centavos(700000), dia(2024, 5, 3)},
		{"pagué el lunes 7 mil", centavos(700000), dia(2026, 10, 26)},
		{"\xff\xfe pagué 7 mil", centavos(700000), dia(2026, 11, 2)}, // UTF-8 inválido
	}
	for _, c := range casos {
		res := interpretar(t, motor, c.texto)
		if (res.Monto == nil) != (c.monto == nil) || (res.Monto != nil && *res.Monto != *c.monto) {
			t.Errorf("%.40q: monto %v, se esperaba %v", c.texto, valorDe(res.Monto), valorDe(c.monto))
		}
		if res.Fecha == nil || !res.Fecha.Equal(*c.fecha) {
			t.Errorf("%.40q: fecha %v, se esperaba %v", c.texto, res.Fecha, c.fecha)
		}
	}
}

// La fecha de referencia es dato de entrada: solo cuenta su día calendario, sea cual sea la hora o la zona.
func TestLaFechaDeReferenciaEsUnDia(t *testing.T) {
	motor := motorReal(t)
	bogota := time.FixedZone("COT", -5*3600)
	for _, ref := range []time.Time{time.Date(2026, 11, 2, 23, 59, 59, 0, bogota), time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)} {
		res, err := motor.Interpretar(context.Background(), interpretacion.Entrada{Texto: "ayer 5 mil", FechaReferencia: ref})
		if err != nil {
			t.Fatal(err)
		}
		if res.Fecha == nil || !res.Fecha.Equal(*dia(2026, 11, 1)) || res.Fecha.Location() != time.UTC {
			t.Errorf("fecha %v con referencia %v", res.Fecha, ref)
		}
	}
}

// D-084 (2): 280 caracteres (no bytes) y texto vacío.
func TestLimiteDe280CaracteresYTextoVacio(t *testing.T) {
	motor := motorReal(t)
	entrada := func(s string) interpretacion.Entrada {
		return interpretacion.Entrada{Texto: s, FechaReferencia: fechaReferencia}
	}
	ok := strings.Repeat("a", 275) + " 5 mil"[:5] // 280 caracteres
	if n := len([]rune(ok)); n != 280 {
		t.Fatalf("la prueba arma %d caracteres", n)
	}
	if _, err := motor.Interpretar(context.Background(), entrada(ok)); err != nil {
		t.Errorf("280 caracteres deben pasar: %v", err)
	}
	// 280 caracteres de 2 bytes cada uno: pasan, porque el límite cuenta caracteres.
	if _, err := motor.Interpretar(context.Background(), entrada(strings.Repeat("ñ", 280))); err != nil {
		t.Errorf("280 caracteres de dos bytes deben pasar: %v", err)
	}
	for _, largo := range []string{strings.Repeat("a", 281), strings.Repeat("ñ", 281)} {
		res, err := motor.Interpretar(context.Background(), entrada(largo))
		if !errors.Is(err, interpretacion.ErrTextoLargo) || !reflect.DeepEqual(res, interpretacion.Interpretacion{}) {
			t.Errorf("281 caracteres: error %v, resultado %+v", err, res)
		}
	}
	for _, vacio := range []string{"", "   ", "\t\n "} {
		res, err := motor.Interpretar(context.Background(), entrada(vacio))
		if !errors.Is(err, interpretacion.ErrTextoVacio) || !reflect.DeepEqual(res, interpretacion.Interpretacion{}) {
			t.Errorf("texto vacío %q: error %v, resultado %+v", vacio, err, res)
		}
	}
}

// D-084 (2), E12 §6.2: 200 ms por texto, con el contexto.
func TestTiempoLimite(t *testing.T) {
	reglas, err := interpretacion.ReglasIncluidas()
	if err != nil {
		t.Fatal(err)
	}
	entrada := interpretacion.Entrada{Texto: "almuerzo 15 mil ayer", FechaReferencia: fechaReferencia}
	if interpretacion.PresupuestoDeTiempo != 200*time.Millisecond || interpretacion.MaxCaracteres != 280 {
		t.Errorf("límites %v y %d, se esperaban 200 ms y 280 (D-084 (2))", interpretacion.PresupuestoDeTiempo, interpretacion.MaxCaracteres)
	}

	// Un presupuesto ya vencido.
	vencido := interpretacion.NuevoPorReglas(reglas, interpretacion.ConPresupuesto(-time.Second))
	res, err := vencido.Interpretar(context.Background(), entrada)
	if !errors.Is(err, interpretacion.ErrTiempoAgotado) || !reflect.DeepEqual(res, interpretacion.Interpretacion{}) {
		t.Errorf("presupuesto vencido: error %v, resultado %+v", err, res)
	}
	// Un contexto ya cancelado o vencido, con el presupuesto normal.
	normal := interpretacion.NuevoPorReglas(reglas)
	cancelado, cancelar := context.WithCancel(context.Background())
	cancelar()
	if _, err := normal.Interpretar(cancelado, entrada); !errors.Is(err, interpretacion.ErrTiempoAgotado) {
		t.Errorf("contexto cancelado: %v", err)
	}
	pasado, cancelarPasado := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancelarPasado()
	if _, err := normal.Interpretar(pasado, entrada); !errors.Is(err, interpretacion.ErrTiempoAgotado) {
		t.Errorf("contexto vencido: %v", err)
	}
	// El plazo se revisa entre una etapa y la siguiente: con un contexto que vence después de N revisiones, N de 0 a 3
	// fallan y desde 4 (las revisiones de un registro) ya no.
	for vence := 0; vence <= 4; vence++ {
		revisiones := 0
		ctx := contextoQueVence{Context: context.Background(), revisiones: &revisiones, vence: vence}
		_, err := normal.Interpretar(ctx, entrada)
		if (vence < 4) != errors.Is(err, interpretacion.ErrTiempoAgotado) {
			t.Errorf("el contexto vence tras %d revisiones: error %v", vence, err)
		}
	}
	// El peor caso de longitud cabe holgado en los 200 ms.
	largo := strings.Repeat("compré arroz 12 mil y ", 13)[:280]
	inicio := time.Now()
	if _, err := normal.Interpretar(context.Background(), interpretacion.Entrada{Texto: largo, FechaReferencia: fechaReferencia}); err != nil {
		t.Errorf("280 caracteres: %v", err)
	}
	if d := time.Since(inicio); d > interpretacion.PresupuestoDeTiempo {
		t.Errorf("280 caracteres tardaron %v", d)
	}
}

// contextoQueVence responde Err() nil las primeras `vence` veces y context.Canceled después.
type contextoQueVence struct {
	context.Context
	revisiones *int
	vence      int
}

func (c contextoQueVence) Err() error {
	*c.revisiones++
	if *c.revisiones > c.vence {
		return context.Canceled
	}
	return nil
}

// capturador recoge todo lo que el proceso registra por slog y por log.
type capturador struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (c *capturador) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.buffer.Write(p)
}

func (c *capturador) String() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.buffer.String()
}

// RN-001, RNF-005: el motor no registra el texto, ni siquiera cuando falla. No guarda nada: es el mismo antes y
// después, y sus errores no llevan el texto.
func TestNoRegistraNiGuardaElTexto(t *testing.T) {
	salida := &capturador{}
	slogAntes, logAntes, banderas := slog.Default(), log.Writer(), log.Flags()
	slog.SetDefault(slog.New(slog.NewJSONHandler(salida, &slog.HandlerOptions{Level: slog.LevelDebug})))
	log.SetOutput(salida)
	defer func() { slog.SetDefault(slogAntes); log.SetOutput(logAntes); log.SetFlags(banderas) }()

	reglas, err := interpretacion.ReglasIncluidas()
	if err != nil {
		t.Fatal(err)
	}
	motor := interpretacion.NuevoPorReglas(reglas)
	vencido := interpretacion.NuevoPorReglas(reglas, interpretacion.ConPresupuesto(-time.Second))
	antes := reflect.ValueOf(*reglas).Interface()

	secreto := "pagué el tratamiento de Zoraida Quintero cédula 1032456789 por 450 mil"
	textos := []string{secreto, strings.Repeat(secreto, 5), "   "}
	var errores []error
	for _, texto := range textos {
		entrada := interpretacion.Entrada{Texto: texto, FechaReferencia: fechaReferencia}
		res, err := motor.Interpretar(context.Background(), entrada)
		errores = append(errores, err)
		if strings.Contains(strings.ToLower(descripcion(res)), "zoraida") {
			t.Error("la interpretación lleva el texto")
		}
		_, err = vencido.Interpretar(context.Background(), entrada)
		errores = append(errores, err)
	}
	for _, err := range errores {
		if err != nil && (strings.Contains(err.Error(), "Zoraida") || strings.Contains(err.Error(), "1032456789")) {
			t.Errorf("un error lleva el texto: %v", err)
		}
	}
	if registrado := salida.String(); registrado != "" {
		t.Errorf("el motor escribió en el registro: %q", registrado)
	}
	if !reflect.DeepEqual(antes, reflect.ValueOf(*reglas).Interface()) {
		t.Error("interpretar cambió el conjunto de reglas")
	}
}

// El paquete no importa nada con lo que pueda registrar, guardar o enviar el texto (E12 §6.2 «Efectos»).
func TestElPaqueteNoImportaRegistroNiRedNiDisco(t *testing.T) {
	prohibidos := map[string]bool{"log": true, "log/slog": true, "os": true, "io/ioutil": true, "net": true, "net/http": true, "database/sql": true}
	archivos, err := filepath.Glob(filepath.Join("..", "..", "src", "interpretacion", "*.go"))
	if err != nil || len(archivos) == 0 {
		t.Fatalf("no se encontraron las fuentes: %v", err)
	}
	for _, archivo := range archivos {
		ast, err := parser.ParseFile(token.NewFileSet(), archivo, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imp := range ast.Imports {
			ruta := strings.Trim(imp.Path.Value, `"`)
			if prohibidos[ruta] || strings.Contains(ruta, "/src/pg") || strings.Contains(ruta, "/src/bd") || strings.Contains(ruta, "pgx") {
				t.Errorf("%s importa %q", filepath.Base(archivo), ruta)
			}
		}
	}
	if _, err := os.Stat(filepath.Join("..", "..", "src", "interpretacion", "reglas.json")); err != nil {
		t.Errorf("falta la copia embebida: %v", err)
	}
}

// Muchas llamadas a la vez dan lo mismo que una sola (el conjunto no tiene estado; corre con -race).
func TestInterpretarEsSeguroEnParalelo(t *testing.T) {
	motor := motorReal(t)
	esperada := interpretar(t, motor, "pagué la luz ayer, 134.200")
	var grupo sync.WaitGroup
	for i := 0; i < 16; i++ {
		grupo.Add(1)
		go func() {
			defer grupo.Done()
			for j := 0; j < 20; j++ {
				res, err := motor.Interpretar(context.Background(), interpretacion.Entrada{Texto: "pagué la luz ayer, 134.200", FechaReferencia: fechaReferencia})
				if err != nil || !reflect.DeepEqual(res, esperada) {
					t.Errorf("resultado distinto en paralelo: %+v, %v", res, err)
					return
				}
			}
		}()
	}
	grupo.Wait()
}

func valorDe(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

// El motor cumple el puerto (E12 §5.2).
func TestInterpretadorPorReglasCumpleElPuerto(t *testing.T) {
	var _ interpretacion.Interpretador = (*interpretacion.InterpretadorPorReglas)(nil)
}
