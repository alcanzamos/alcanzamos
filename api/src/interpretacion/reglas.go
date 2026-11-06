package interpretacion

import (
	"bytes"
	_ "embed" // reglas.json va dentro del binario
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// reglasIncluidas es la copia de reglas/reglas.json (D-1.0). Go no puede embeber archivos de fuera de su módulo ni la
// imagen copia más que api/, así que la copia es idéntica byte a byte y una prueba y el pipeline de reglas/ lo
// comprueban por SHA-256 (ADR-001, ADR-005 §5.3 (1)). Ninguna regla se escribe a mano en el código.
//
//go:embed reglas.json
var reglasIncluidas []byte

// ReglasIncluidasJSON devuelve una copia del reglas.json que va dentro del binario.
func ReglasIncluidasJSON() []byte { return slices.Clone(reglasIncluidas) }

// ReglasIncluidas carga y compila el reglas.json del binario. Se hace una vez al arrancar: si una regla está mal, el
// error se ve en el despliegue y no en el registro de una persona (E12 §6.2).
func ReglasIncluidas() (*ConjuntoDeReglas, error) { return CargarReglas(reglasIncluidas) }

// pares es un objeto JSON de texto a texto que conserva el orden del archivo (las equivalencias se aplican en orden).
type pares [][2]string

func (p *pares) UnmarshalJSON(datos []byte) error {
	d := json.NewDecoder(bytes.NewReader(datos))
	if t, err := d.Token(); err != nil || t != json.Delim('{') {
		return errors.New("se esperaba un objeto")
	}
	for d.More() {
		clave, err := d.Token()
		if err != nil {
			return err
		}
		var valor string
		if err := d.Decode(&valor); err != nil {
			return err
		}
		nombre, _ := clave.(string) // en un objeto, Token devuelve siempre el nombre como texto
		*p = append(*p, [2]string{nombre, valor})
	}
	return nil
}

type reglaDePatron struct {
	Clase  string  `json:"clase"`
	Patron string  `json:"patron"`
	Dias   int     `json:"dias"`
	Minimo float64 `json:"minimo"`
}

type listaDePatrones struct {
	Patrones []string `json:"patrones"`
}

type entradaDeCategoria struct {
	Categoria string   `json:"categoria"`
	Patrones  []string `json:"patrones"`
}

// archivoDeReglas es la forma de reglas.json. Solo lleva lo que el motor usa; las notas y los identificadores se ignoran.
type archivoDeReglas struct {
	Version       string            `json:"version"`
	Definiciones  map[string]string `json:"definiciones"`
	Normalizacion struct {
		Equivalencias pares `json:"equivalencias"`
		Sustituciones []struct {
			Patron    string `json:"patron"`
			Reemplazo string `json:"reemplazo"`
			Repetir   bool   `json:"repetir"`
		} `json:"sustituciones"`
	} `json:"normalizacion"`
	Numeros struct {
		Tokenizador struct {
			Patron string `json:"patron"`
		} `json:"tokenizador"`
		Palabras           map[string]float64 `json:"palabras"`
		Escalas            map[string]float64 `json:"escalas"`
		Mitades            []string           `json:"mitades"`
		Conectores         []string           `json:"conectores"`
		MinimoRestoDigitos float64            `json:"minimo_resto_digitos"`
	} `json:"numeros"`
	Monto struct {
		MinimoFuerte float64         `json:"minimo_fuerte"`
		Reglas       []reglaDePatron `json:"reglas"`
		Ignorar      listaDePatrones `json:"ignorar"`
		Candidatas   struct {
			Patron string `json:"patron"`
		} `json:"candidatas"`
	} `json:"monto"`
	Fecha struct {
		Meses        map[string]int  `json:"meses"`
		DiasSemana   map[string]int  `json:"dias_semana"`
		UnidadesDias map[string]int  `json:"unidades_dias"`
		Reglas       []reglaDePatron `json:"reglas"`
	} `json:"fecha"`
	Tipo struct {
		PorDefecto string          `json:"por_defecto"`
		Ingreso    listaDePatrones `json:"ingreso"`
	} `json:"tipo"`
	Categorias struct {
		PorDefecto map[string]string    `json:"por_defecto"`
		Gasto      []entradaDeCategoria `json:"gasto"`
		Ingreso    []entradaDeCategoria `json:"ingreso"`
	} `json:"categorias"`
	Intencion struct {
		PorDefecto string `json:"por_defecto"`
		Reglas     []struct {
			Intencion string   `json:"intencion"`
			Patrones  []string `json:"patrones"`
		} `json:"reglas"`
	} `json:"intencion"`
}

// Las clases de las reglas de monto y de fecha que el motor sabe aplicar.
const (
	claseUltimo   = "ultimo"
	claseProducto = "producto"
)

var clasesDeFecha = []string{"desplazamiento", "desplazamiento_n", "dia_semana", "dia_mes", "dia_y_mes", "dia_mes_anio", "dd_mm"}

type sustitucion struct {
	re        *regexp.Regexp
	reemplazo string // en la forma de regexp.Expand: ${1}${2}
	repetir   bool
}

type reglaDeMonto struct {
	re     *regexp.Regexp
	clase  string
	minimo float64
}

type reglaDeFecha struct {
	re    *regexp.Regexp
	clase string
	dias  int
}

type categoriaCompilada struct {
	nombre   string
	patrones []*regexp.Regexp
}

type reglaDeIntencion struct {
	intencion Intencion
	patrones  []*regexp.Regexp
}

// ConjuntoDeReglas son las reglas ya leídas y con los patrones compilados (E12 §5.2). No tiene estado que cambie: se
// comparte entre llamadas y entre goroutines.
type ConjuntoDeReglas struct {
	version  string
	patrones []string // los patrones expandidos, en el orden en que se compilaron

	equivalencias pares
	sustituciones []sustitucion

	tokenizador *regexp.Regexp
	palabras    map[string]float64
	escalas     map[string]float64
	mitades     map[string]bool
	conectores  map[string]bool
	minimoResto float64

	montoReglas   []reglaDeMonto
	montoIgnorar  []*regexp.Regexp
	montoCandidas *regexp.Regexp
	minimoFuerte  float64

	meses, diasSemana, unidadesDias map[string]int
	fechaReglas                     []reglaDeFecha

	tipoIngreso    []*regexp.Regexp
	tipoPorDefecto Tipo

	categorias   map[Tipo][]categoriaCompilada
	categoriaPor map[Tipo]string

	intenciones     []reglaDeIntencion
	intencionPorDef Intencion
}

// Version es la versión de las reglas («D-1.0»).
func (c *ConjuntoDeReglas) Version() string { return c.version }

// Patrones devuelve todos los patrones ya expandidos, en el orden en que se compilaron.
func (c *ConjuntoDeReglas) Patrones() []string { return slices.Clone(c.patrones) }

var marcador = regexp.MustCompile(`<<([A-Z_0-9]+)>>`)

// CargarReglas lee un reglas.json, expande las macros `<<NOMBRE>>` y compila cada patrón con RE2. Falla si el archivo
// no es válido, si falta una macro, si un patrón sale del subconjunto portable o no compila, o si una clase de regla
// es desconocida.
func CargarReglas(datos []byte) (*ConjuntoDeReglas, error) {
	var a archivoDeReglas
	if err := json.Unmarshal(datos, &a); err != nil {
		return nil, fmt.Errorf("reglas: %w", err)
	}
	if a.Version == "" {
		return nil, errors.New("reglas: falta la versión")
	}
	c := &ConjuntoDeReglas{
		version: a.Version, equivalencias: a.Normalizacion.Equivalencias,
		palabras: a.Numeros.Palabras, escalas: a.Numeros.Escalas, minimoResto: a.Numeros.MinimoRestoDigitos,
		mitades: conjuntoDe(a.Numeros.Mitades), conectores: conjuntoDe(a.Numeros.Conectores),
		minimoFuerte: a.Monto.MinimoFuerte, meses: a.Fecha.Meses, diasSemana: a.Fecha.DiasSemana, unidadesDias: a.Fecha.UnidadesDias,
		tipoPorDefecto: Tipo(a.Tipo.PorDefecto), intencionPorDef: Intencion(a.Intencion.PorDefecto),
		categorias: map[Tipo][]categoriaCompilada{}, categoriaPor: map[Tipo]string{},
	}
	k := &compilador{definiciones: a.Definiciones, conjunto: c}
	for _, s := range a.Normalizacion.Sustituciones {
		re := k.compilar(s.Patron)
		reemplazo, err := plantilla(s.Reemplazo, k.err, re)
		if err != nil {
			return nil, fmt.Errorf("reglas: %w", err)
		}
		c.sustituciones = append(c.sustituciones, sustitucion{re: re, reemplazo: reemplazo, repetir: s.Repetir})
	}
	c.tokenizador = k.compilar(a.Numeros.Tokenizador.Patron)
	for _, r := range a.Monto.Reglas {
		if r.Clase != claseUltimo && r.Clase != claseProducto {
			return nil, fmt.Errorf("reglas: clase de monto desconocida %q", r.Clase)
		}
		c.montoReglas = append(c.montoReglas, reglaDeMonto{re: k.compilar(r.Patron), clase: r.Clase, minimo: r.Minimo})
	}
	c.montoIgnorar = k.compilarTodos(a.Monto.Ignorar.Patrones)
	c.montoCandidas = k.compilar(a.Monto.Candidatas.Patron)
	for _, r := range a.Fecha.Reglas {
		if !slices.Contains(clasesDeFecha, r.Clase) {
			return nil, fmt.Errorf("reglas: clase de fecha desconocida %q", r.Clase)
		}
		c.fechaReglas = append(c.fechaReglas, reglaDeFecha{re: k.compilar(r.Patron), clase: r.Clase, dias: r.Dias})
	}
	c.tipoIngreso = k.compilarTodos(a.Tipo.Ingreso.Patrones)
	for tipo, lista := range map[Tipo][]entradaDeCategoria{Gasto: a.Categorias.Gasto, Ingreso: a.Categorias.Ingreso} {
		for _, e := range lista {
			c.categorias[tipo] = append(c.categorias[tipo], categoriaCompilada{nombre: e.Categoria, patrones: k.compilarTodos(e.Patrones)})
		}
		c.categoriaPor[tipo] = a.Categorias.PorDefecto[string(tipo)]
	}
	for _, r := range a.Intencion.Reglas {
		c.intenciones = append(c.intenciones, reglaDeIntencion{intencion: Intencion(r.Intencion), patrones: k.compilarTodos(r.Patrones)})
	}
	if k.err != nil {
		return nil, fmt.Errorf("reglas: %w", k.err)
	}
	return c, nil
}

func conjuntoDe(lista []string) map[string]bool {
	m := make(map[string]bool, len(lista))
	for _, s := range lista {
		m[s] = true
	}
	return m
}

// compilador expande y compila patrones, y se queda con el primer error para no llenar CargarReglas de comprobaciones.
type compilador struct {
	definiciones map[string]string
	conjunto     *ConjuntoDeReglas
	err          error
}

func (k *compilador) compilar(patron string) *regexp.Regexp {
	if k.err != nil {
		return nil
	}
	expandido, err := k.expandir(patron)
	if err == nil {
		if err = EsPortable(expandido); err != nil {
			err = fmt.Errorf("el patrón %q sale del subconjunto portable: %w", expandido, err)
		}
	}
	var re *regexp.Regexp
	if err == nil {
		if re, err = regexp.Compile(expandido); err != nil {
			err = fmt.Errorf("RE2 no compila el patrón %q: %w", expandido, err)
		}
	}
	if err != nil {
		k.err = err
		return nil
	}
	k.conjunto.patrones = append(k.conjunto.patrones, expandido)
	return re
}

func (k *compilador) compilarTodos(patrones []string) []*regexp.Regexp {
	res := make([]*regexp.Regexp, 0, len(patrones))
	for _, p := range patrones {
		res = append(res, k.compilar(p))
	}
	return res
}

// expandir reemplaza las macros <<NOMBRE>> hasta que no quede ninguna (pueden llevar otras macros).
func (k *compilador) expandir(patron string) (string, error) {
	for range 32 {
		var falta string
		nuevo := marcador.ReplaceAllStringFunc(patron, func(m string) string {
			definicion, ok := k.definiciones[m[2:len(m)-2]]
			if !ok {
				falta = m
				return m
			}
			return definicion
		})
		if falta != "" {
			return "", fmt.Errorf("la macro %s no está definida", falta)
		}
		if nuevo == patron {
			return patron, nil
		}
		patron = nuevo
	}
	return "", fmt.Errorf("las macros del patrón %q no terminan de expandirse", patron)
}

// plantilla convierte el reemplazo de las reglas ($1, $2) a la forma de regexp.Expand (${1}) y comprueba que cada
// grupo exista.
func plantilla(reemplazo string, errPrevio error, re *regexp.Regexp) (string, error) {
	if errPrevio != nil || re == nil {
		return "", errPrevio
	}
	var sb strings.Builder
	for i := 0; i < len(reemplazo); i++ {
		c := reemplazo[i]
		switch {
		case c == '$' && i+1 < len(reemplazo) && reemplazo[i+1] >= '0' && reemplazo[i+1] <= '9':
			if n := int(reemplazo[i+1] - '0'); n > re.NumSubexp() {
				return "", fmt.Errorf("el reemplazo %q usa el grupo %d y el patrón no lo tiene", reemplazo, n)
			}
			sb.WriteString("${" + string(reemplazo[i+1]) + "}")
			i++
		case c == '$':
			sb.WriteString("$$")
		default:
			sb.WriteByte(c)
		}
	}
	return sb.String(), nil
}
