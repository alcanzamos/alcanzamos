package cuenta_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

// leerZIP devuelve cada archivo del ZIP como filas de CSV, sin la marca de orden de bytes.
func leerZIP(t *testing.T, datos []byte) map[string][][]string {
	t.Helper()
	z, err := zip.NewReader(bytes.NewReader(datos), int64(len(datos)))
	if err != nil {
		t.Fatal(err)
	}
	salida := map[string][][]string{}
	for _, f := range z.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		crudo, _ := io.ReadAll(r)
		r.Close()
		if !bytes.HasPrefix(crudo, []byte("\xEF\xBB\xBF")) {
			t.Errorf("%s: falta la marca UTF-8 para que la hoja de cálculo lea las tildes", f.Name)
		}
		filas, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(crudo, []byte("\xEF\xBB\xBF")))).ReadAll()
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		salida[f.Name] = filas
	}
	return salida
}

var encabezados = map[string][]string{
	"movimientos.csv":  {"fecha", "tipo", "monto_en_pesos", "categoria", "medio_de_pago", "descripcion", "meta", "sentido", "compartido_con_el_hogar"},
	"metas.csv":        {"nombre", "monto_objetivo_en_pesos", "fecha_objetivo", "creada_el"},
	"deudas.csv":       {"nombre", "monto_en_pesos", "total_a_pagar_en_pesos", "cuotas", "inicio", "vence", "origen"},
	"presupuestos.csv": {"periodo", "categoria", "monto_asignado_en_pesos"},
}

func TestElZIPTrae_LosCuatroCSV_ConSusEncabezados_YLosDemasSoloEncabezados(t *testing.T) {
	datos, err := cuenta.ArmarZIP([]cuenta.MovimientoExportado{
		{Fecha: "2026-11-02", Tipo: "gasto", MontoCentavos: 4500000, Categoria: "Alimentación", Medio: "efectivo", Descripcion: "mercado, con «tildes»", Compartido: false},
		{Fecha: "2026-11-03", Tipo: "aporte", MontoCentavos: 12345, Medio: "transferencia", Meta: "Arriendo", Sentido: "salida", Compartido: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	z := leerZIP(t, datos)
	if len(z) != 4 {
		t.Fatalf("archivos: %v", reflect.ValueOf(z).MapKeys())
	}
	for nombre, quiere := range encabezados {
		if len(z[nombre]) == 0 || !reflect.DeepEqual(z[nombre][0], quiere) {
			t.Errorf("%s: encabezado %v, se esperaba %v", nombre, z[nombre], quiere)
		}
	}
	for _, vacio := range []string{"metas.csv", "deudas.csv", "presupuestos.csv"} {
		if len(z[vacio]) != 1 {
			t.Errorf("%s: solo los nombres de las columnas por ahora, hay %d filas", vacio, len(z[vacio]))
		}
	}
	m := z["movimientos.csv"]
	if len(m) != 3 {
		t.Fatalf("filas: %v", m)
	}
	if !reflect.DeepEqual(m[1], []string{"2026-11-02", "gasto", "45000.00", "Alimentación", "efectivo", "mercado, con «tildes»", "", "", "no"}) {
		t.Errorf("fila 1: %v", m[1])
	}
	if !reflect.DeepEqual(m[2], []string{"2026-11-03", "aporte", "123.45", "", "transferencia", "", "Arriendo", "salida", "sí"}) {
		t.Errorf("fila 2: %v", m[2])
	}
}

func TestSinMovimientosElZIPTrae_LosCuatroArchivosSoloConEncabezados(t *testing.T) {
	datos, err := cuenta.ArmarZIP(nil)
	if err != nil {
		t.Fatal(err)
	}
	z := leerZIP(t, datos)
	if len(z) != 4 {
		t.Fatalf("archivos: %d", len(z))
	}
	for nombre, quiere := range encabezados {
		if len(z[nombre]) != 1 || !reflect.DeepEqual(z[nombre][0], quiere) {
			t.Errorf("%s: %v", nombre, z[nombre])
		}
	}
}

// Una descripción que empieza como una fórmula no se ejecuta al abrir el CSV en una hoja de cálculo.
func TestUnaDescripcionConFormulaNoSeEjecutaEnLaHoja(t *testing.T) {
	for _, texto := range []string{"=HYPERLINK(\"http://malo\")", "+1", "-1", "@SUMA(A1)", "\tcmd"} {
		datos, err := cuenta.ArmarZIP([]cuenta.MovimientoExportado{{Fecha: "2026-11-02", Tipo: "gasto", MontoCentavos: 100, Medio: "efectivo", Descripcion: texto}})
		if err != nil {
			t.Fatal(err)
		}
		if celda := leerZIP(t, datos)["movimientos.csv"][1][5]; celda != "'"+texto {
			t.Errorf("%q: %q", texto, celda)
		}
	}
}

type repoDeExportacionFalso struct {
	filas []cuenta.MovimientoExportado
	err   error
	de    []string
}

func (r *repoDeExportacionFalso) MovimientosDe(_ context.Context, persona string) ([]cuenta.MovimientoExportado, error) {
	r.de = append(r.de, persona)
	return r.filas, r.err
}

func TestElServicioArmaElZIPDeLaPersona(t *testing.T) {
	repo := &repoDeExportacionFalso{filas: []cuenta.MovimientoExportado{{Fecha: "2026-11-02", Tipo: "gasto", MontoCentavos: 100, Medio: "efectivo"}}}
	datos, err := cuenta.NuevoExportador(repo).ZIP(context.Background(), "p1")
	if err != nil || len(leerZIP(t, datos)["movimientos.csv"]) != 2 || !reflect.DeepEqual(repo.de, []string{"p1"}) {
		t.Fatalf("%v %v", err, repo.de)
	}
	repo.err = cuenta.ErrNoExiste
	if _, err := cuenta.NuevoExportador(repo).ZIP(context.Background(), "p1"); !errors.Is(err, cuenta.ErrNoExiste) {
		t.Errorf("error %v", err)
	}
}

func apiDeExportacion(t *testing.T, repo *repoDeExportacionFalso, registro *bytes.Buffer) (http.Handler, func() string) {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(registro, nil))
	almacen := almacenFalso{}
	resolutor := sesion.NuevoResolutor(almacen, &relojtest.Fijo{T: ahoraDePrueba})
	enr := servidor.NuevoEnrutador(resolutor, seguridad.NuevoRegistro(log), log)
	cuenta.NuevoHandlerDeExportacion(cuenta.NuevoExportador(repo), log).Registrar(enr)
	h, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return csrftest.ConCabeceras(servidor.ManejadorConAPI(h)), func() string {
		token, huella := seguridad.NuevoTokenOpaco()
		almacen[string(huella)] = seguridad.Sujeto{Persona: personaQueBorra, Verificada: true, Autorizada: true}
		return token
	}
}

func TestGetDatosEntregaElZIPSinGuardarCopiaNiRegistrarNada(t *testing.T) {
	registro := &bytes.Buffer{}
	repo := &repoDeExportacionFalso{filas: []cuenta.MovimientoExportado{{Fecha: "2026-11-02", Tipo: "gasto", MontoCentavos: 100, Medio: "efectivo", Descripcion: "secreto"}}}
	h, token := apiDeExportacion(t, repo, registro)
	r := httptest.NewRequest("GET", "/api/v1/cuenta/datos", nil)
	r.AddCookie(&http.Cookie{Name: "__Host-sesion", Value: token()})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	if rr.Code != 200 || rr.Header().Get("Content-Type") != "application/zip" || rr.Header().Get("Cache-Control") != "no-store" ||
		rr.Header().Get("Content-Disposition") != `attachment; filename="alcanzamos-mis-datos.zip"` || rr.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("%d %v", rr.Code, rr.Header())
	}
	if len(leerZIP(t, rr.Body.Bytes())) != 4 || !reflect.DeepEqual(repo.de, []string{personaQueBorra}) {
		t.Error("el ZIP de la persona de la sesión")
	}
	if strings.Contains(registro.String(), "secreto") || strings.Contains(registro.String(), personaQueBorra) {
		t.Errorf("registro con datos: %s", registro)
	}
}

func TestGetDatosSinSesionDa401YConErroresNoFiltraNada(t *testing.T) {
	registro := &bytes.Buffer{}
	repo := &repoDeExportacionFalso{}
	h, token := apiDeExportacion(t, repo, registro)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("GET", "/api/v1/cuenta/datos", nil))
	if rr.Code != 401 || len(repo.de) != 0 {
		t.Errorf("sin sesión: %d", rr.Code)
	}
	for err, quiere := range map[error]int{cuenta.ErrNoExiste: 401, errors.New("falla de la base con secreto"): 500} {
		repo.err = err
		r := httptest.NewRequest("GET", "/api/v1/cuenta/datos", nil)
		r.AddCookie(&http.Cookie{Name: "__Host-sesion", Value: token()})
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		if rr.Code != quiere || rr.Header().Get("Content-Type") == "application/zip" || rr.Header().Get("Content-Disposition") != "" {
			t.Errorf("%v: %d %v", err, rr.Code, rr.Header())
		}
	}
}
