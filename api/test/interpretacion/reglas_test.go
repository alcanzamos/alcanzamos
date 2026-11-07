package interpretacion_test

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/interpretacion"
)

// D-075 (4): las reglas D-1.0 se reproducen sin cambios. El archivo de reglas/ y la copia embebida son idénticos y
// tienen el SHA-256 de la versión del prototipo (adso, commit d073baf).
func TestLasReglasSonLasDeD10YLaCopiaEmbebidaEsIdentica(t *testing.T) {
	suma, original := sha256De(t, filepath.Join(carpetaReglas, "reglas.json"))
	if suma != shaReglas {
		t.Errorf("reglas/reglas.json tiene SHA-256 %s, se esperaba %s", suma, shaReglas)
	}
	if !bytes.Equal(original, interpretacion.ReglasIncluidasJSON()) {
		t.Error("la copia embebida (api/src/interpretacion/reglas.json) difiere de reglas/reglas.json: cópiala sin cambios")
	}
	reglas, err := interpretacion.ReglasIncluidas()
	if err != nil {
		t.Fatal(err)
	}
	if reglas.Version() != "D-1.0" {
		t.Errorf("versión de las reglas %q, se esperaba D-1.0", reglas.Version())
	}
}

// La sumas de reglas/SHA256SUMS cubren reglas.json y la referencia (la verifica el pipeline de reglas/).
func TestSHA256SUMSCubreLasReglasYLaReferencia(t *testing.T) {
	_, datos := sha256De(t, filepath.Join(carpetaReglas, "SHA256SUMS"))
	for _, archivo := range []string{"reglas.json", "referencia/referencia-prueba.jsonl", "referencia/referencia-confirmacion.jsonl"} {
		suma, _ := sha256De(t, filepath.Join(carpetaReglas, archivo))
		if !strings.Contains(string(datos), suma+"  "+archivo+"\n") {
			t.Errorf("reglas/SHA256SUMS no tiene la suma vigente de %s", archivo)
		}
	}
}

// RE2 (ADR-005 §5.3, README de la opción D §3): todo patrón expandido compila con `regexp` y está en el subconjunto
// portable.
func TestTodosLosPatronesSonRE2YPortables(t *testing.T) {
	reglas, err := interpretacion.ReglasIncluidas()
	if err != nil {
		t.Fatal(err)
	}
	patrones := reglas.Patrones()
	if len(patrones) != 83 { // los 83 que recorre patrones() de motor.py
		t.Fatalf("%d patrones, el prototipo tiene 83: ¿se recorrieron todas las reglas?", len(patrones))
	}
	for _, p := range patrones {
		if _, err := regexp.Compile(p); err != nil {
			t.Errorf("RE2 no compila %q: %v", p, err)
		}
		if err := interpretacion.EsPortable(p); err != nil {
			t.Errorf("%q sale del subconjunto portable: %v", p, err)
		}
	}
}

func TestElSubconjuntoPortableRechazaLoQueNoPermite(t *testing.T) {
	malos := map[string]string{
		`\bhola`: "límite de palabra", `\w+`: "clase de escape", `\d`: "dígito", `a\sb`: "espacio", `\p{L}`: "clase Unicode",
		`a.b`: "comodín", `a*?`: "perezoso", `a++`: "posesivo", `a+?`: "perezoso", `(?>a)`: "atómico", `(?P<n>a)`: "con nombre",
		`(?=a)`: "lookahead", `(?!a)`: "lookahead negativo", `(?<=a)`: "lookbehind", `(?i)a`: "bandera", `(a)\1`: "referencia",
		`[\d]`: "escape en clase", `[[:alpha:]]`: "clase POSIX", `ñ`: "no ASCII", `a{x}`: "llaves sueltas", `[a-z`: "clase sin cerrar",
		`a\`: "escape al final", `a[]b`: "clase vacía", `a[^]b`: "clase vacía negada", `a*{2}`: "cuantificador doble", `a{}`: "llaves vacías",
		`a{,5}`: "sin mínimo", `a{1,2,3}`: "dos comas", `a{1,,2}`: "dos comas", `(?`: "grupo especial incompleto", `a{1,2`: "llave sin cerrar", `(?:a`: "sin cerrar", `a)`: "paréntesis de más",
	}
	for patron, motivo := range malos {
		if err := interpretacion.EsPortable(patron); err == nil {
			t.Errorf("%q (%s) debió rechazarse", patron, motivo)
		}
	}
	buenos := []string{`(?:^|[^a-z0-9])hola(?:[^a-z0-9]|$)`, `\?[ ]*$`, `[0-9]{1,2}`, `a{2}`, `a{2,}`, `(a|b)+`, `\.`, `[$]`, `([0-9])'([0-9]{3})`}
	for _, patron := range buenos {
		if err := interpretacion.EsPortable(patron); err != nil {
			t.Errorf("%q debió aceptarse: %v", patron, err)
		}
	}
}

// ConjuntoDeReglas.Cargar falla al cargar, no al interpretar (E12 §6.2).
func TestCargarReglasFallaAlArrancarSiUnaReglaEstaMal(t *testing.T) {
	original := string(interpretacion.ReglasIncluidasJSON())
	casos := map[string]string{
		"JSON roto":                       original[:200],
		"JSON vacío":                      ``,
		"patrón fuera del portable":       strings.Replace(original, `"patron": "[$]"`, `"patron": "\\bx"`, 1),
		"patrón que RE2 no compila":       strings.Replace(original, `"patron": "[$]"`, `"patron": "(x"`, 1),
		"macro sin definir":               strings.Replace(original, `"patron": "[$]"`, `"patron": "<<NO_EXISTE>>"`, 1),
		"macro que se llama a sí misma":   strings.Replace(original, `"INI": "(?:^|[^a-z0-9])"`, `"INI": "<<INI>>x"`, 1),
		"sin versión":                     strings.Replace(original, `"version": "D-1.0"`, `"version": ""`, 1),
		"tipo de monto desconocido":       strings.Replace(original, `"clase": "producto"`, `"clase": "rara"`, 1),
		"clase de fecha desconocida":      strings.Replace(original, `"clase": "dia_mes_anio"`, `"clase": "rara"`, 1),
		"mes sin número":                  strings.Replace(original, `"enero": 1,`, `"enero": "uno",`, 1),
		"reemplazo con grupo de más":      strings.Replace(original, `"reemplazo": "$1$2"`, `"reemplazo": "$1$9"`, 1),
		"equivalencias que no son objeto": strings.Replace(original, `"equivalencias": {`, `"equivalencias": [`, 1),
		"tokenizador roto":                strings.Replace(original, `"patron": "[0-9]+(?:\\.[0-9]+)?|[a-z]+"`, `"patron": "("`, 1),
	}
	for nombre, datos := range casos {
		if nombre != "JSON vacío" && nombre != "JSON roto" && datos == original {
			t.Fatalf("%s: la mutación no cambió nada", nombre)
		}
		if _, err := interpretacion.CargarReglas([]byte(datos)); err == nil {
			t.Errorf("%s: CargarReglas debió fallar", nombre)
		}
	}
}

// Casos del contrato: la salida del motor para mensajes conocidos (montos en centavos, D-082).
func TestCargarReglasAceptaUnDolarLiteralYRechazaNoObjetos(t *testing.T) {
	original := string(interpretacion.ReglasIncluidasJSON())
	// «$» que no va seguido de un dígito es un signo de pesos literal, no un grupo.
	if _, err := interpretacion.CargarReglas([]byte(strings.Replace(original, `"reemplazo": "$1$2"`, `"reemplazo": "$1$"`, 1))); err != nil {
		t.Errorf("un reemplazo con «$» literal debió cargar: %v", err)
	}
	for nombre, equivalencias := range map[string]string{"texto": `"x"`, "número": `1`, "valor que no es texto": `{"a": 1}`, "objeto sin cerrar": `{"a": "b"`} {
		datos := strings.Replace(original, `"equivalencias": {`, `"equivalencias": `+equivalencias+`, "otras": {`, 1)
		if _, err := interpretacion.CargarReglas([]byte(datos)); err == nil {
			t.Errorf("equivalencias como %s: CargarReglas debió fallar", nombre)
		}
	}
}

// IAR-003 (E18-PPR, E12 §5.2): el falso cumple el puerto con respuestas fijas, sin leer el texto ni las reglas.
func TestInterpretadorFalsoCumpleElPuertoConRespuestasFijas(t *testing.T) {
	var _ interpretacion.Interpretador = interpretacion.InterpretadorFalso{}

	fija := interpretacion.Interpretacion{Monto: centavos(1250000), Tipo: interpretacion.Gasto, Fecha: dia(2026, 11, 1), Categoria: "Transporte", Intencion: interpretacion.Registro, ReglasVersion: "falso"}
	var falso interpretacion.Interpretador = interpretacion.InterpretadorFalso{Respuesta: fija}
	for _, texto := range []string{"algo", "", strings.Repeat("x", 1000)} {
		res, err := falso.Interpretar(context.Background(), interpretacion.Entrada{Texto: texto, FechaReferencia: fechaReferencia})
		if err != nil || !reflect.DeepEqual(res, fija) {
			t.Errorf("%.10q: %+v, %v", texto, res, err)
		}
	}
	fallo := interpretacion.InterpretadorFalso{Err: interpretacion.ErrTiempoAgotado}
	if res, err := fallo.Interpretar(context.Background(), interpretacion.Entrada{}); !errors.Is(err, interpretacion.ErrTiempoAgotado) || !reflect.DeepEqual(res, interpretacion.Interpretacion{}) {
		t.Errorf("el falso con error: %+v, %v", res, err)
	}
}
