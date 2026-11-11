package cuenta

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"strings"
)

// MovimientoExportado es una fila de movimientos.csv: lo que la persona registró, sin ids ni nada de otras personas.
type MovimientoExportado struct {
	Fecha         string // AAAA-MM-DD
	Tipo          string // gasto, ingreso o aporte
	MontoCentavos int64
	Categoria     string
	Medio         string
	Descripcion   string
	Meta          string // nombre de una meta propia, solo en un aporte
	Sentido       string // entrada o salida, solo en un aporte
	Compartido    bool   // lo compartió con el hogar
}

// PresupuestoExportado es una fila de presupuestos.csv: un presupuesto propio de una categoría en un mes o, con la categoría
// vacía y el monto en cero, un mes que la persona dejó en cero («Dejar el presupuesto en cero», PN-07; L6 (5) de la US-77).
type PresupuestoExportado struct {
	Periodo       string // AAAA-MM
	Categoria     string // vacía en un mes dejado en cero
	MontoCentavos int64
}

// RepositorioDeExportacion lee lo que «Descargar mis datos» entrega.
type RepositorioDeExportacion interface {
	// MovimientosDe devuelve los movimientos que la persona registró (`persona_id` suyo), o ErrNoExiste.
	MovimientosDe(ctx context.Context, persona string) ([]MovimientoExportado, error)
	// PresupuestosDe devuelve los presupuestos propios de la persona (`persona_id` suyo y sin hogar) y los meses que dejó
	// en cero, por periodo y, en cada mes, la marca primero y las categorías en el orden del catálogo; o ErrNoExiste.
	PresupuestosDe(ctx context.Context, persona string) ([]PresupuestoExportado, error)
}

// Exportador arma «Descargar mis datos» (RF-032, D-102).
type Exportador struct{ repo RepositorioDeExportacion }

// NuevoExportador crea el servicio.
func NuevoExportador(repo RepositorioDeExportacion) *Exportador { return &Exportador{repo: repo} }

// NombreDelArchivo es el nombre del ZIP que se descarga.
const NombreDelArchivo = "alcanzamos-mis-datos.zip"

// ZIP arma el archivo al pedirlo; no se guarda copia (E13, D-102).
func (e *Exportador) ZIP(ctx context.Context, persona string) ([]byte, error) {
	filas, err := e.repo.MovimientosDe(ctx, persona)
	if err != nil {
		return nil, err
	}
	presupuestos, err := e.repo.PresupuestosDe(ctx, persona)
	if err != nil {
		return nil, err
	}
	return ArmarZIP(filas, presupuestos)
}

// Archivos del ZIP, uno por tema (SC-E21-20), con la primera fila de nombres de columnas. Metas y deudas van solo con ella
// hasta que existan esos temas (D-180); los presupuestos llegaron con la US-77.
var archivos = []struct {
	nombre      string
	encabezados []string
}{
	{"movimientos.csv", []string{"fecha", "tipo", "monto_en_pesos", "categoria", "medio_de_pago", "descripcion", "meta", "sentido", "compartido_con_el_hogar"}},
	{"metas.csv", []string{"nombre", "monto_objetivo_en_pesos", "fecha_objetivo", "creada_el"}},
	{"deudas.csv", []string{"nombre", "monto_en_pesos", "total_a_pagar_en_pesos", "cuotas", "inicio", "vence", "origen"}},
	{"presupuestos.csv", []string{"periodo", "categoria", "monto_asignado_en_pesos"}},
}

// ArmarZIP escribe los cuatro CSV en un ZIP: UTF-8 con marca de orden de bytes (para que Excel lea las tildes), montos en
// pesos con dos decimales y punto, fechas AAAA-MM-DD y meses AAAA-MM. Ningún id y nada de otras personas.
func ArmarZIP(movimientos []MovimientoExportado, presupuestos []PresupuestoExportado) ([]byte, error) {
	// Todo se escribe en memoria: un `bytes.Buffer` no falla al escribir, así que los errores se juntan y se miran una vez.
	var salida bytes.Buffer
	var errores error
	z := zip.NewWriter(&salida)
	for _, a := range archivos {
		w, err := z.Create(a.nombre)
		errores = errors.Join(errores, err)
		_, err = w.Write([]byte("\xEF\xBB\xBF"))
		errores = errors.Join(errores, err)
		filas := [][]string{a.encabezados}
		switch a.nombre {
		case "movimientos.csv":
			for _, m := range movimientos {
				filas = append(filas, []string{
					m.Fecha, m.Tipo, pesos(m.MontoCentavos), segura(m.Categoria), m.Medio, segura(m.Descripcion),
					segura(m.Meta), m.Sentido, siNo(m.Compartido),
				})
			}
		case "presupuestos.csv":
			for _, p := range presupuestos {
				filas = append(filas, []string{p.Periodo, segura(p.Categoria), pesos(p.MontoCentavos)})
			}
		}
		errores = errors.Join(errores, csv.NewWriter(w).WriteAll(filas))
	}
	errores = errors.Join(errores, z.Close())
	if errores != nil {
		return nil, fmt.Errorf("armar el ZIP: %w", errores)
	}
	return salida.Bytes(), nil
}

func pesos(centavos int64) string { return fmt.Sprintf("%d.%02d", centavos/100, centavos%100) }

func siNo(b bool) string {
	if b {
		return "sí"
	}
	return "no"
}

// segura impide que una hoja de cálculo ejecute como fórmula un texto que la persona escribió: si empieza con = + - @ o
// un control, se le antepone una comilla simple (OWASP, CSV injection).
func segura(texto string) string {
	if texto != "" && strings.ContainsRune("=+-@\t\r", rune(texto[0])) {
		return "'" + texto
	}
	return texto
}
