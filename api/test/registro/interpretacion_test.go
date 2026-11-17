package registro_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/interpretacion"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

const rutaInterpretacion = "/api/v1/movimientos/interpretacion"

// Las categorías que la persona ve; «Transporte» no está: las
// ocultó (RN-011) o no es apta para un menor.
func catalogoVisible() []registro.Categoria {
	return []registro.Categoria{
		{ID: 1, Nombre: "Alimentación", Tipo: registro.Gasto},
		{ID: 7, Nombre: "Restaurantes y hoteles", Tipo: registro.Gasto},
		{ID: 16, Nombre: "Otros gastos", Tipo: registro.Gasto, General: true},
		{ID: 20, Nombre: "Salario", Tipo: registro.Ingreso},
	}
}

func motorReal(t *testing.T, opciones ...interpretacion.Opcion) interpretacion.Interpretador {
	t.Helper()
	reglas, err := interpretacion.ReglasIncluidas()
	if err != nil {
		t.Fatal(err)
	}
	return interpretacion.NuevoPorReglas(reglas, opciones...)
}

// apiCon arma el enrutador real con el registro, el interpretador dado, la sesión de una persona autorizada y la hora dada.
func apiCon(t *testing.T, repo *repoFalso, ahora string, i interpretacion.Interpretador, log *slog.Logger) http.Handler {
	t.Helper()
	hora, err := time.Parse(time.RFC3339, ahora)
	if err != nil {
		t.Fatal(err)
	}
	e := servidor.NuevoEnrutador(sesionFalsa{}, seguridad.NuevoRegistro(log), log).ConURLPublica(urlPublica)
	servicio := registro.NuevoServicio(repo, &relojtest.Fijo{T: hora})
	if i != nil {
		servicio = servicio.ConInterpretador(i)
	}
	registro.NuevoHandler(servicio, log).Registrar(e)
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

func sinLog() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }

func interpretar(t *testing.T, texto string) (int, string, http.Header) {
	t.Helper()
	repo := &repoFalso{categorias: catalogoVisible()}
	return post(apiCon(t, repo, hoy, motorReal(t), sinLog()), rutaInterpretacion, `{"texto":"`+texto+`"}`)
}

func TestInterpretarProponeTipoMontoCategoriaYFechaSinGuardarNada(t *testing.T) {
	repo := &repoFalso{categorias: catalogoVisible()}
	codigo, resp, cabeceras := post(apiCon(t, repo, hoy, motorReal(t), sinLog()), rutaInterpretacion, `{"texto":"gasté 15 mil en almuerzo"}`)
	const quiere = `{"resultado":"propuesta","tipo":"gasto","monto_centavos":1500000,"categoria":{"id":7,"nombre":"Restaurantes y hoteles"},"fecha":"2026-10-26","varios_movimientos":false}`
	if codigo != 200 || resp != quiere || cabeceras.Get("Cache-Control") != "no-store" {
		t.Errorf("%d %s %v", codigo, resp, cabeceras)
	}
	// RN-001: lo interpretado no se guarda por sí solo; guardar es el POST de /movimientos con lo que la persona confirmó.
	if len(repo.guardados) != 0 || len(repo.corregidos) != 0 || len(repo.borrados) != 0 || len(repo.decisiones) != 0 {
		t.Errorf("la interpretación escribió: %+v", repo)
	}
}

func TestInterpretarUnIngresoConFechaRelativaUsaElHoyDeColombia(t *testing.T) {
	_, resp, _ := interpretar(t, "recibí 2 millones de salario ayer")
	const quiere = `{"resultado":"propuesta","tipo":"ingreso","monto_centavos":200000000,"categoria":{"id":20,"nombre":"Salario"},"fecha":"2026-10-25","varios_movimientos":false}`
	if resp != quiere {
		t.Errorf("%s, se esperaba %s", resp, quiere)
	}
	// Las 22:00 del 26 de octubre en Colombia son las 03:00 UTC del 27: «hoy» es el 26.
	repo := &repoFalso{categorias: catalogoVisible()}
	_, resp, _ = post(apiCon(t, repo, "2026-10-27T03:00:00Z", motorReal(t), sinLog()), rutaInterpretacion, `{"texto":"gasté 15 mil en almuerzo"}`)
	if !strings.Contains(resp, `"fecha":"2026-10-26"`) {
		t.Errorf("hoy en Colombia: %s", resp)
	}
}

func TestInterpretarNuncaProponeUnaCategoriaQueLaPersonaNoVe(t *testing.T) {
	// «Transporte» no está entre las visibles (RN-011, RF-005): se devuelve sin categoría, nunca la oculta ni otra.
	_, resp, _ := interpretar(t, "taxi 8 mil")
	const quiere = `{"resultado":"propuesta","tipo":"gasto","monto_centavos":800000,"categoria":null,"fecha":"2026-10-26","varios_movimientos":false}`
	if resp != quiere {
		t.Errorf("%s, se esperaba %s", resp, quiere)
	}
	// La categoría se busca por nombre y por tipo: «Salario» visible como ingreso no sirve a un gasto.
	repo := &repoFalso{categorias: []registro.Categoria{{ID: 20, Nombre: "Salario", Tipo: registro.Ingreso}}}
	if _, resp, _ := post(apiCon(t, repo, hoy, interpretacion.InterpretadorFalso{Respuesta: respuestaDeRegistro(interpretacion.Gasto, "Salario")}, sinLog()), rutaInterpretacion, `{"texto":"x"}`); !strings.Contains(resp, `"categoria":null`) {
		t.Errorf("otro tipo: %s", resp)
	}
}

func TestInterpretarConVariosMontosAvisaYSoloProponeElPrimero(t *testing.T) {
	// Como el ejemplo de E14-PPN 3.1: el resumen toma el primer movimiento y el aviso dice que quedó otro. Sin categoría
	// (D-196, paso 1): la persona la elige.
	_, resp, _ := interpretar(t, "mercado 45 mil y cine 12 mil")
	const quiere = `{"resultado":"propuesta","tipo":"gasto","monto_centavos":4500000,"categoria":null,"fecha":"2026-10-26","varios_movimientos":true}`
	if resp != quiere {
		t.Errorf("%s, se esperaba %s", resp, quiere)
	}
}

// D-196, paso 1 (provisional hasta la US-68): con «mercado 45 mil ayer y 12 mil de pasajes» el motor da el monto y la
// fecha del primer movimiento y la categoría del segundo («Transporte»). Con más de un monto la categoría va vacía y la
// persona la elige; el monto, la fecha y el aviso siguen siendo los del primero. Con un solo monto no cambia nada.
func TestInterpretarConMasDeUnMontoDejaLaCategoriaVacia(t *testing.T) {
	conTransporte := append(catalogoVisible(), registro.Categoria{ID: 8, Nombre: "Transporte", Tipo: registro.Gasto})
	h := apiCon(t, &repoFalso{categorias: conTransporte}, hoy, motorReal(t), sinLog())
	casos := []struct{ texto, quiere string }{
		{"mercado 45 mil ayer y 12 mil de pasajes", `{"resultado":"propuesta","tipo":"gasto","monto_centavos":4500000,"categoria":null,"fecha":"2026-10-25","varios_movimientos":true}`},
		{"mercado 45 mil ayer", `{"resultado":"propuesta","tipo":"gasto","monto_centavos":4500000,"categoria":{"id":1,"nombre":"Alimentación"},"fecha":"2026-10-25","varios_movimientos":false}`},
		{"12 mil de pasajes", `{"resultado":"propuesta","tipo":"gasto","monto_centavos":1200000,"categoria":{"id":8,"nombre":"Transporte"},"fecha":"2026-10-26","varios_movimientos":false}`},
		// Con un total explícito el texto es un solo movimiento (E15 5.15): la categoría se propone.
		{"mercado y aseo en total 60 mil", `{"resultado":"propuesta","tipo":"gasto","monto_centavos":6000000,"categoria":{"id":1,"nombre":"Alimentación"},"fecha":"2026-10-26","varios_movimientos":false}`},
	}
	for _, c := range casos {
		if codigo, resp, _ := post(h, rutaInterpretacion, `{"texto":"`+c.texto+`"}`); codigo != 200 || resp != c.quiere {
			t.Errorf("%q: %d %s, se esperaba %s", c.texto, codigo, resp, c.quiere)
		}
	}
	// La regla es del servicio, no del motor: con cualquier interpretador que sugiera una categoría, el texto con dos
	// montos va sin ella, y el mismo interpretador con un texto de un monto sí la propone.
	falso := interpretacion.InterpretadorFalso{Respuesta: respuestaDeRegistro(interpretacion.Gasto, "Alimentación")}
	h = apiCon(t, &repoFalso{categorias: conTransporte}, hoy, falso, sinLog())
	if _, resp, _ := post(h, rutaInterpretacion, `{"texto":"almuerzo 15 mil y taxi 8 mil"}`); !strings.Contains(resp, `"categoria":null`) || !strings.Contains(resp, `"varios_movimientos":true`) {
		t.Errorf("con el falso y dos montos: %s", resp)
	}
	if _, resp, _ := post(h, rutaInterpretacion, `{"texto":"almuerzo 15 mil"}`); !strings.Contains(resp, `"categoria":{"id":1,"nombre":"Alimentación"}`) {
		t.Errorf("con el falso y un monto: %s", resp)
	}
}

// D-084 (8): un monto ambiguo se rechaza sin adivinar; el cliente muestra «¿Quisiste decir $12.500 o $12,50?».
func TestInterpretarConMontoAmbiguoNoAdivinaYDaLasDosLecturas(t *testing.T) {
	_, resp, _ := interpretar(t, "almuerzo 12.5")
	const quiere = `{"resultado":"monto_ambiguo","tipo":"gasto","monto_centavos":null,"categoria":{"id":7,"nombre":"Restaurantes y hoteles"},"fecha":"2026-10-26","varios_movimientos":false,` +
		`"lecturas_del_monto":{"con_punto_de_miles":"12.500","con_coma_decimal":"12,50"}}`
	if resp != quiere {
		t.Errorf("%s, se esperaba %s", resp, quiere)
	}
}

// RF-021, RE-001 (RP-027, RP-028): un pedido de recomendación financiera no recibe propuesta, solo un código.
func TestInterpretarRechazaLosPedidosDeRecomendacionesFinancieras(t *testing.T) {
	for _, texto := range []string{"qué me recomiendas invertir 1 millón", "debería sacar un crédito de 5 millones"} {
		codigo, resp, _ := interpretar(t, texto)
		if codigo != 200 || resp != `{"resultado":"recomendacion"}` {
			t.Errorf("%q: %d %s", texto, codigo, resp)
		}
	}
}

func TestInterpretarUnaPreguntaNoRecibePropuesta(t *testing.T) {
	if codigo, resp, _ := interpretar(t, "cuánto gasté este mes"); codigo != 200 || resp != `{"resultado":"pregunta"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

func TestInterpretarSinMontoNoSeEntendio(t *testing.T) {
	for _, texto := range []string{"hola", "gasté en el almuerzo"} {
		if codigo, resp, _ := interpretar(t, texto); codigo != 200 || resp != `{"resultado":"no_entendido"}` {
			t.Errorf("%q: %d %s", texto, codigo, resp)
		}
	}
}

func TestInterpretarSeAcabaElTiempoEsUnCodigoNoUn500(t *testing.T) {
	repo := &repoFalso{categorias: catalogoVisible()}
	for nombre, i := range map[string]interpretacion.Interpretador{
		"el motor real con el presupuesto agotado": motorReal(t, interpretacion.ConPresupuesto(time.Nanosecond)),
		"un interpretador que se pasa del tiempo":  interpretacion.InterpretadorFalso{Err: interpretacion.ErrTiempoAgotado},
	} {
		codigo, resp, _ := post(apiCon(t, repo, hoy, i, sinLog()), rutaInterpretacion, `{"texto":"gasté 15 mil en almuerzo"}`)
		if codigo != 200 || resp != `{"resultado":"tiempo_agotado"}` {
			t.Errorf("%s: %d %s", nombre, codigo, resp)
		}
	}
}

func TestInterpretarUnFalloInesperadoDelInterpretadorEsUn500(t *testing.T) {
	h := apiCon(t, &repoFalso{}, hoy, interpretacion.InterpretadorFalso{Err: io.ErrUnexpectedEOF}, sinLog())
	if codigo, resp, _ := post(h, rutaInterpretacion, `{"texto":"hola"}`); codigo != 500 || resp != `{"error":"error_interno"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

// Si el interpretador mismo rechaza el largo, es el mismo 422 del campo `texto`; un servicio sin interpretador no sabe interpretar.
func TestInterpretarTraduceLosErroresDeTextoDelInterpretadorYSinInterpretadorFalla(t *testing.T) {
	for err, codigo := range map[error]string{interpretacion.ErrTextoVacio: "texto_requerido", interpretacion.ErrTextoLargo: "texto_largo"} {
		h := apiCon(t, &repoFalso{}, hoy, interpretacion.InterpretadorFalso{Err: err}, sinLog())
		if c, resp, _ := post(h, rutaInterpretacion, `{"texto":"hola"}`); c != 422 || resp != `{"campos":{"texto":"`+codigo+`"},"error":"datos_invalidos"}` {
			t.Errorf("%v: %d %s", err, c, resp)
		}
	}
	if c, resp, _ := post(apiCon(t, &repoFalso{}, hoy, nil, sinLog()), rutaInterpretacion, `{"texto":"hola"}`); c != 500 || resp != `{"error":"error_interno"}` {
		t.Errorf("sin interpretador: %d %s", c, resp)
	}
}

// Una intención que el API no conoce no se propone; un registro sin fecha usa el hoy de Colombia.
func TestInterpretarConIntencionDesconocidaOSinFecha(t *testing.T) {
	repo := &repoFalso{categorias: catalogoVisible()}
	if _, resp, _ := post(apiCon(t, repo, hoy, interpretacion.InterpretadorFalso{Respuesta: interpretacion.Interpretacion{Intencion: "otra"}}, sinLog()), rutaInterpretacion, `{"texto":"x"}`); resp != `{"resultado":"no_entendido"}` {
		t.Errorf("intención desconocida: %s", resp)
	}
	sinFecha := respuestaDeRegistro(interpretacion.Gasto, "")
	sinFecha.Fecha = nil
	_, resp, _ := post(apiCon(t, repo, hoy, interpretacion.InterpretadorFalso{Respuesta: sinFecha}, sinLog()), rutaInterpretacion, `{"texto":"x"}`)
	const quiere = `{"resultado":"propuesta","tipo":"gasto","monto_centavos":1500000,"categoria":null,"fecha":"2026-10-26","varios_movimientos":false}`
	if resp != quiere {
		t.Errorf("sin fecha: %s, se esperaba %s", resp, quiere)
	}
}

func TestInterpretarFallaSiElCatalogoNoSeLee(t *testing.T) {
	repo := &repoFalso{categorias: catalogoVisible(), error: io.ErrClosedPipe}
	if codigo, resp, _ := post(apiCon(t, repo, hoy, motorReal(t), sinLog()), rutaInterpretacion, `{"texto":"gasté 15 mil en almuerzo"}`); codigo != 500 || resp != `{"error":"error_interno"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

// D-084 (2): 280 caracteres (no bytes) y nunca llega al motor un texto vacío o largo.
func TestInterpretarValidaElTextoSinLlamarAlMotor(t *testing.T) {
	espia := &espiaDeInterpretador{t: t}
	h := apiCon(t, &repoFalso{categorias: catalogoVisible()}, hoy, espia, sinLog())
	casos := []struct{ cuerpo, campo string }{
		{`{"texto":""}`, "texto_requerido"},
		{`{"texto":"   "}`, "texto_requerido"},
		{`{}`, "texto_requerido"},
		{`{"texto":"` + strings.Repeat("a", 281) + `"}`, "texto_largo"},
		{`{"texto":"` + strings.Repeat("ñ", 281) + `"}`, "texto_largo"},
	}
	for _, c := range casos {
		codigo, resp, _ := post(h, rutaInterpretacion, c.cuerpo)
		if quiere := `{"campos":{"texto":"` + c.campo + `"},"error":"datos_invalidos"}`; codigo != 422 || resp != quiere {
			t.Errorf("%.30s: %d %s", c.cuerpo, codigo, resp)
		}
	}
	if espia.llamadas != 0 {
		t.Errorf("el motor recibió %d textos inválidos", espia.llamadas)
	}
	// Justo en el límite sí pasa, también con caracteres de dos bytes.
	espia.permitido = true
	for _, texto := range []string{strings.Repeat("a", 280), strings.Repeat("ñ", 280)} {
		if codigo, _, _ := post(h, rutaInterpretacion, `{"texto":"`+texto+`"}`); codigo != 200 {
			t.Errorf("280 caracteres: %d", codigo)
		}
	}
}

func TestInterpretarRechazaCamposFueraDelContratoYCuerposMalos(t *testing.T) {
	h := apiCon(t, &repoFalso{categorias: catalogoVisible()}, hoy, motorReal(t), sinLog())
	for _, cuerpo := range []string{`{"texto":"hola","persona_id":"x"}`, `{"texto":5}`, `no es json`, `{"texto":"a"} {}`} {
		if codigo, resp, _ := post(h, rutaInterpretacion, cuerpo); codigo != 400 || resp != `{"error":"solicitud_invalida"}` {
			t.Errorf("%s: %d %s", cuerpo, codigo, resp)
		}
	}
}

// La ruta es un POST: lleva la defensa contra CSRF de E17 3.15, como los demás POST del registro.
func TestInterpretarLlevaLaDefensaContraCSRF(t *testing.T) {
	h := apiCon(t, &repoFalso{categorias: catalogoVisible()}, hoy, motorReal(t), sinLog())
	json := []string{"Content-Type", "application/json"}
	casos := []struct {
		nombre    string
		cabeceras []string
		esperado  int
	}{
		{"cross-site", append([]string{"Sec-Fetch-Site", "cross-site"}, json...), 403},
		{"Origin ajeno", append([]string{"Origin", "https://otro.test"}, json...), 403},
		{"sin señal de cliente", json, 403},
		{"sin JSON", []string{"Origin", urlPublica}, 415},
		{"web: same-origin", append([]string{"Sec-Fetch-Site", "same-origin"}, json...), 200},
		{"web: Origin igual a URL_PUBLICA", append([]string{"Origin", urlPublica}, json...), 200},
		{"Android", append([]string{"X-Alcanzamos-Cliente", "android"}, json...), 200},
	}
	for _, c := range casos {
		if codigo, resp, _ := publicar(h, rutaInterpretacion, `{"texto":"hola"}`, c.cabeceras...); codigo != c.esperado {
			t.Errorf("%s: %d %s", c.nombre, codigo, resp)
		}
	}
}

// SEG-016: desde el #84 la defensa contra CSRF la pone el Enrutador a todo POST, no la ruta. La de interpretación está
// entre las rutas del Enrutador, y cada caso de la defensa (cross-site, Origin ajeno, sin señal de cliente, sin JSON) da
// su 403 o su 415 sin llegar al manejador: el Interpretador no recibe ninguna llamada y no hay `Set-Cookie`.
func TestElEnrutadorProtegeLaRutaDeInterpretacion(t *testing.T) {
	espia := &espiaDeInterpretador{t: t}
	log := sinLog()
	e := servidor.NuevoEnrutador(sesionFalsa{}, seguridad.NuevoRegistro(log), log).ConURLPublica(urlPublica)
	hora := &relojtest.Fijo{T: time.Date(2026, 10, 26, 15, 0, 0, 0, time.UTC)}
	registro.NuevoHandler(registro.NuevoServicio(repoDelResto(), hora).ConInterpretador(espia), log).Registrar(e)
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	const patron = "POST " + rutaInterpretacion
	var delRegistro []servidor.Ruta
	for _, r := range e.Rutas() {
		if r.Patron == patron {
			delRegistro = append(delRegistro, r)
		}
	}
	if len(delRegistro) != 1 || delRegistro[0].Nivel != seguridad.RequiereAutorizacion {
		t.Fatalf("la ruta de interpretación no está entre las del Enrutador, o no es requiere_autorizacion: %v", delRegistro)
	}
	csrftest.ProbarDefensa(t, servidor.ManejadorConAPI(h), delRegistro, urlPublica, func() string { return fmt.Sprint(espia.llamadas) })
}

func TestInterpretarSoloAceptaPOST(t *testing.T) {
	h := apiCon(t, &repoFalso{categorias: catalogoVisible()}, hoy, motorReal(t), sinLog())
	// GET /movimientos/{id} recibe «interpretacion» como un id: no existe, el mismo 404 de siempre.
	if codigo, resp, _ := llamar(h, "GET", rutaInterpretacion, ""); codigo != 404 || resp != `{"error":"no_encontrado"}` {
		t.Errorf("GET: %d %s", codigo, resp)
	}
}

// E12, RNF-005: el texto no se registra en ningún nivel, ni el que dispara la interpretación ni sus errores.
func TestInterpretarNoRegistraElTexto(t *testing.T) {
	var salida bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&salida, &slog.HandlerOptions{Level: slog.LevelDebug}))
	const secreto = "gasté 7777 mil en la clínica de mi hija Sofía"
	for _, i := range []interpretacion.Interpretador{motorReal(t), interpretacion.InterpretadorFalso{Err: io.ErrUnexpectedEOF}, interpretacion.InterpretadorFalso{Err: interpretacion.ErrTiempoAgotado}} {
		post(apiCon(t, &repoFalso{categorias: catalogoVisible()}, hoy, i, log), rutaInterpretacion, `{"texto":"`+secreto+`"}`)
	}
	if salida.Len() == 0 {
		t.Fatal("la prueba no vio ningún registro")
	}
	for _, linea := range strings.Split(strings.TrimSpace(salida.String()), "\n") {
		limpia := sinHoraNiPeticion(t, linea)
		for _, trozo := range []string{"clínica", "Sofía", "7777"} {
			if strings.Contains(limpia, trozo) {
				t.Errorf("el registro contiene parte del texto %q: %s", trozo, linea)
			}
		}
	}
}

func respuestaDeRegistro(tipo interpretacion.Tipo, categoria string) interpretacion.Interpretacion {
	monto, fecha := int64(1500000), time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	return interpretacion.Interpretacion{Monto: &monto, Tipo: tipo, Fecha: &fecha, Categoria: categoria, Intencion: interpretacion.Registro, ReglasVersion: "D-1.0"}
}

// espiaDeInterpretador falla la prueba si se le llama (salvo con `permitido`) y cuenta las llamadas.
type espiaDeInterpretador struct {
	t         *testing.T
	llamadas  int
	permitido bool
}

func (e *espiaDeInterpretador) Interpretar(context.Context, interpretacion.Entrada) (interpretacion.Interpretacion, error) {
	e.llamadas++
	if !e.permitido {
		e.t.Error("se llamó al Interpretador")
	}
	return interpretacion.Interpretacion{Intencion: interpretacion.Pregunta}, nil
}

// desdeAndroid manda una petición de un cliente Android (cumple la defensa contra CSRF de E17 3.15) con cualquier método.
func desdeAndroid(h http.Handler, metodo, ruta, cuerpo string) (int, string) {
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	r.Header.Set("X-Alcanzamos-Cliente", "android")
	r.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	return rr.Code, strings.TrimSpace(rr.Body.String())
}

func repoDelResto() *repoFalso {
	repo := repoConMovimientos()
	repo.categorias = catalogoVisible()
	repo.recurrentes = repoConRepeticiones().recurrentes
	return repo
}

// recorrido hace lo que hace el resto del registro (categorías, guardar, listar, detalle, corregir, borrar, próximas y
// pendientes) y devuelve el código y el cuerpo de cada respuesta.
func recorrido(h http.Handler) []string {
	pasos := []struct{ metodo, ruta, cuerpo string }{
		{"GET", "/api/v1/categorias", ""},
		{"POST", "/api/v1/movimientos", cuerpo(`,"descripcion":"mercado"`)},
		{"POST", "/api/v1/movimientos", cuerpo(`,"repeticion":{"periodicidad":"mensual"}`)},
		{"GET", "/api/v1/movimientos?periodo=2026-10", ""},
		{"GET", "/api/v1/movimientos/" + idSuelto, ""},
		{"PUT", "/api/v1/movimientos/" + idSuelto, cuerpoDeCorreccion("")},
		{"DELETE", "/api/v1/movimientos/" + idSuelto, ""},
		{"GET", "/api/v1/repeticiones/proximas?periodicidad=mensual&inicio=2026-08-15", ""},
		{"GET", "/api/v1/repeticiones/pendientes", ""},
		{"POST", "/api/v1/repeticiones/" + recSalario + "/confirmacion", `{"fecha":"2026-10-16"}`},
		{"POST", "/api/v1/repeticiones/" + recArriendo + "/omision", `{"fecha":"2026-09-15"}`},
	}
	var salidas []string
	for _, p := range pasos {
		codigo, resp := desdeAndroid(h, p.metodo, p.ruta, p.cuerpo)
		salidas = append(salidas, fmt.Sprintf("%s %s -> %d %s", p.metodo, p.ruta, codigo, resp))
	}
	return salidas
}

// IAR-003 (E12 §6.2, RNF-008): cambiar el Interpretador no cambia ninguna otra función del registro. El recorrido da
// byte a byte lo mismo sin interpretador, con el motor de reglas y con el falso (con un registro, una recomendación o un error).
func TestIAR003CambiarElInterpretadorNoCambiaNingunaOtraFuncion(t *testing.T) {
	sin := recorrido(apiCon(t, repoDelResto(), hoy, nil, sinLog()))
	if len(sin) == 0 || strings.Contains(strings.Join(sin, "\n"), " 500 ") {
		t.Fatalf("el recorrido de referencia no sirve: %v", sin)
	}
	otros := map[string]interpretacion.Interpretador{
		"motor de reglas":     motorReal(t),
		"falso con registro":  interpretacion.InterpretadorFalso{Respuesta: respuestaDeRegistro(interpretacion.Gasto, "Otros gastos")},
		"falso con consejo":   interpretacion.InterpretadorFalso{Respuesta: interpretacion.Interpretacion{Intencion: interpretacion.Recomendacion}},
		"falso con un error":  interpretacion.InterpretadorFalso{Err: interpretacion.ErrTiempoAgotado},
		"espía que no se usa": &espiaDeInterpretador{t: t},
	}
	for nombre, i := range otros {
		if got := recorrido(apiCon(t, repoDelResto(), hoy, i, sinLog())); !slices.Equal(got, sin) {
			t.Errorf("con %s el registro cambió:\n%v\nantes:\n%v", nombre, got, sin)
		}
	}
}

// Y con el falso, la propia interpretación responde lo que él diga, sin mirar el texto (IAR-003, el puerto se cambia solo).
func TestIAR003LaInterpretacionSigueLoQueDigaElInterpretador(t *testing.T) {
	repo := &repoFalso{categorias: catalogoVisible()}
	falso := interpretacion.InterpretadorFalso{Respuesta: respuestaDeRegistro(interpretacion.Ingreso, "Salario")}
	_, resp, _ := post(apiCon(t, repo, hoy, falso, sinLog()), rutaInterpretacion, `{"texto":"lo que sea"}`)
	const quiere = `{"resultado":"propuesta","tipo":"ingreso","monto_centavos":1500000,"categoria":{"id":20,"nombre":"Salario"},"fecha":"2026-10-24","varios_movimientos":false}`
	if resp != quiere {
		t.Errorf("%s, se esperaba %s", resp, quiere)
	}
}

// RN-005 (RP-016): ningún cálculo pasa por el intérprete. Se llama a cada ruta del Enrutador que no es la de
// interpretación, con cuerpos que hacen los cálculos (próximas fechas, pendientes, totales de la lista), y el Interpretador
// no recibe ninguna llamada. Un espía que falla al llamarlo; y, de control, la ruta de interpretación sí lo llama.
func TestRN005NingunCalculoDelAPIPasaPorElInterpretador(t *testing.T) {
	espia := &espiaDeInterpretador{t: t}
	log := sinLog()
	e := servidor.NuevoEnrutador(sesionFalsa{}, seguridad.NuevoRegistro(log), log).ConURLPublica(urlPublica)
	hora := &relojtest.Fijo{T: time.Date(2026, 10, 26, 15, 0, 0, 0, time.UTC)}
	registro.NuevoHandler(registro.NuevoServicio(repoDelResto(), hora).ConInterpretador(espia), log).Registrar(e)
	construido, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	h := servidor.ManejadorConAPI(construido)

	cuerpos := map[string]string{
		"POST /api/v1/movimientos":                    cuerpo(`,"repeticion":{"periodicidad":"mensual"}`),
		"PUT /api/v1/movimientos/{id}":                cuerpoDeCorreccion(""),
		"POST /api/v1/repeticiones/{id}/confirmacion": `{"fecha":"2026-10-16"}`,
		"POST /api/v1/repeticiones/{id}/omision":      `{"fecha":"2026-09-15"}`,
		"POST /api/v1/repeticiones/decisiones":        `{"decisiones":[]}`,
	}
	llamadas := 0
	for _, r := range e.Rutas() {
		if r.Patron == "POST "+rutaInterpretacion {
			continue
		}
		metodo, ruta, _ := strings.Cut(r.Patron, " ")
		id := idSuelto
		if strings.Contains(ruta, "repeticiones") {
			id = recSalario
		}
		ruta = strings.ReplaceAll(ruta, "{id}", id)
		desdeAndroid(h, metodo, ruta, cuerpos[r.Patron])
		llamadas++
	}
	desdeAndroid(h, "GET", "/api/v1/movimientos?periodo=2026-10", "")
	desdeAndroid(h, "GET", "/api/v1/repeticiones/proximas?periodicidad=mensual&inicio=2026-08-15", "")
	if llamadas < 10 {
		t.Fatalf("la prueba solo recorrió %d rutas", llamadas)
	}
	if espia.llamadas != 0 {
		t.Fatalf("el Interpretador recibió %d llamadas desde rutas de cálculo", espia.llamadas)
	}
	espia.permitido = true
	desdeAndroid(h, "POST", rutaInterpretacion, `{"texto":"hola"}`)
	if espia.llamadas != 1 {
		t.Errorf("de control: la ruta de interpretación debía llamar al espía una vez, lo llamó %d", espia.llamadas)
	}
}

// sinHoraNiPeticion devuelve una línea JSON del registro sin la hora ni el id de la petición. Son valores que cambian en
// cada corrida, y un número que la prueba busca (un monto) puede aparecer en ellos por casualidad: «7777» salió una vez
// en la hora «…57.847777254Z».
func sinHoraNiPeticion(t *testing.T, linea string) string {
	t.Helper()
	d := json.NewDecoder(strings.NewReader(linea))
	d.UseNumber()
	var campos map[string]any
	if err := d.Decode(&campos); err != nil {
		t.Fatalf("una línea del registro no es JSON: %v: %s", err, linea)
	}
	delete(campos, slog.TimeKey)
	delete(campos, "peticion")
	b, err := json.Marshal(campos)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
