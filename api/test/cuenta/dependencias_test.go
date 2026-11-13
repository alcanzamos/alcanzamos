package cuenta_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

func dependenciasCompletas() cuenta.Dependencias {
	e := nuevoEntorno()
	return cuenta.Dependencias{
		Repo: e.repo, Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
		Reloj: e.reloj, Limitador: e.limitador, Log: e.log(),
	}
}

// Ítem 294, L10: una dependencia que falta se descubre al armar el servicio y no a mitad de la tarea, cuando el aviso
// llama a un correo que no existe.
func TestNuevoServicioFallaSiFaltaUnaDependencia(t *testing.T) {
	quitar := map[string]func(*cuenta.Dependencias){
		"Repo":      func(d *cuenta.Dependencias) { d.Repo = nil },
		"Correo":    func(d *cuenta.Dependencias) { d.Correo = nil },
		"Politica":  func(d *cuenta.Dependencias) { d.Politica = nil },
		"Hasher":    func(d *cuenta.Dependencias) { d.Hasher = nil },
		"Reloj":     func(d *cuenta.Dependencias) { d.Reloj = nil },
		"Limitador": func(d *cuenta.Dependencias) { d.Limitador = nil },
		"Log":       func(d *cuenta.Dependencias) { d.Log = nil },
	}
	for nombre, f := range quitar {
		t.Run(nombre, func(t *testing.T) {
			d := dependenciasCompletas()
			f(&d)
			s, err := cuenta.NuevoServicio(d)
			if s != nil || !errors.Is(err, cuenta.ErrDependenciaFaltante) || !strings.Contains(err.Error(), nombre) {
				t.Fatalf("servicio %v, error %v: se esperaba ErrDependenciaFaltante que nombre %s", s, err, nombre)
			}
		})
	}
	t.Run("varias", func(t *testing.T) {
		d := dependenciasCompletas()
		d.Correo, d.Reloj = nil, nil
		if _, err := cuenta.NuevoServicio(d); err == nil || !strings.Contains(err.Error(), "Correo") || !strings.Contains(err.Error(), "Reloj") {
			t.Fatalf("el error debe nombrarlas todas: %v", err)
		}
	})
	t.Run("completas", func(t *testing.T) {
		if s, err := cuenta.NuevoServicio(dependenciasCompletas()); err != nil || s == nil {
			t.Fatalf("con todas las dependencias debe armar: %v", err)
		}
	})
}
