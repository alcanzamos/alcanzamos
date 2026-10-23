package seguridad

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestRegistrarEventoDeSeguridad(t *testing.T) {
	casos := []struct {
		nombre string
		tipo   TipoDeEvento
		cuenta string
		ruta   string
		codigo int
		quiere string // valor esperado de `cuenta`
	}{
		{"acceso denegado de una cuenta", AccesoDenegado, "0192f3c4-0000-7000-8000-000000000001", "GET /api/v1/movimientos/{id}", 403, "0192f3c4-0000-7000-8000-000000000001"},
		{"sesión inexistente: cuenta desconocida", ErrorAutorizacion, "", "GET /api/v1/movimientos", 401, "desconocida"},
		{"inicio de sesión fallido", InicioSesionFallido, "", "POST /api/v1/sesiones", 401, "desconocida"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			var salida bytes.Buffer
			reg := NuevoRegistro(slog.New(slog.NewJSONHandler(&salida, nil)))
			ctx := ConPeticion(context.Background(), "abc123")
			antes := time.Now().UTC().Add(-time.Second)

			reg.Registrar(ctx, c.tipo, c.cuenta, c.ruta, c.codigo)

			if n := strings.Count(salida.String(), "\n"); n != 1 {
				t.Fatalf("se esperaba una línea, hay %d: %q", n, salida.String())
			}
			var linea map[string]any
			if err := json.Unmarshal(salida.Bytes(), &linea); err != nil {
				t.Fatal(err)
			}
			instante, err := time.Parse(time.RFC3339Nano, linea["time"].(string))
			if err != nil || instante.Before(antes) {
				t.Fatalf("time inválido: %v (%v)", linea["time"], err)
			}
			delete(linea, "time")
			esperado := map[string]any{
				"level":            "WARN",
				"msg":              "evento de seguridad",
				"evento_seguridad": string(c.tipo),
				"cuenta":           c.quiere,
				"ruta":             c.ruta,
				"codigo":           float64(c.codigo),
				"peticion":         "abc123",
			}
			// Nada más que los campos de E17-VTE 2.1: ni origen, ni IP, ni correo.
			if len(linea) != len(esperado) {
				t.Fatalf("campos distintos de los de E17-VTE 2.1: %v", linea)
			}
			for k, v := range esperado {
				if linea[k] != v {
					t.Errorf("%s = %v, se esperaba %v", k, linea[k], v)
				}
			}
		})
	}
}

func TestIdentificadoresDePeticion(t *testing.T) {
	a, b := NuevaPeticion(), NuevaPeticion()
	if len(a) != 32 || a == b {
		t.Fatalf("identificadores inesperados: %q, %q", a, b)
	}
	if PeticionDe(context.Background()) != "" || PersonaDe(context.Background()) != "" {
		t.Fatal("un contexto vacío no lleva petición ni persona")
	}
	ctx := ConPersona(ConPeticion(context.Background(), a), "p1")
	if PeticionDe(ctx) != a || PersonaDe(ctx) != "p1" {
		t.Fatal("el contexto no devolvió lo guardado")
	}
}
