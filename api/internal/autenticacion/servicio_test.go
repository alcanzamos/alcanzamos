package autenticacion

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/cuenta"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
)

// Cuenta que existe con la contraseña mal, cuenta que no existe e identificador que no es un correo: el mismo error y
// Argon2id una vez en cada caso (RNF-014, CU-52 2a). Sin medir tiempos de reloj, que serían frágiles.
func TestElFalloEsIgualYArgon2idCorreUnaVezEnCadaCaso(t *testing.T) {
	casos := []struct{ nombre, identificador, clave string }{
		{"contraseña incorrecta", correoDePrueba, "no es esa contraseña"},
		{"cuenta que no existe", "nadie@ejemplo.test", claveDePrueba},
		{"identificador que no es un correo", "laura_menor", claveDePrueba},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno(t)
			_, err := e.svc.IniciarSesion(context.Background(), c.identificador, c.clave, "203.0.113.7")
			if !errors.Is(err, ErrCredencialesInvalidas) {
				t.Fatalf("error %v", err)
			}
			if e.hasher.verificadas != 1 {
				t.Errorf("Argon2id corrió %d veces, se esperaba 1", e.hasher.verificadas)
			}
			if len(e.repo.sesiones) != 0 {
				t.Error("un fallo no crea sesión")
			}
		})
	}
}

func TestIniciarSesionConLaContrasenaCorrecta(t *testing.T) {
	e := nuevoEntorno(t)
	s, err := e.svc.IniciarSesion(context.Background(), "  Laura@Ejemplo.TEST ", claveDePrueba, "203.0.113.7")
	if err != nil || !s.Verificada {
		t.Fatalf("%+v, %v", s, err)
	}
	if e.hasher.verificadas != 1 {
		t.Errorf("Argon2id corrió %d veces", e.hasher.verificadas)
	}
	huella, err := seguridad.HuellaDeToken(s.Token)
	if err != nil || len(e.repo.sesiones) != 1 {
		t.Fatalf("sesiones: %+v (%v)", e.repo.sesiones, err)
	}
	g := e.repo.sesiones[0]
	if g.persona != personaDePrueba || string(g.huella) != string(huella) || !g.en.Equal(ahoraDePrueba) {
		t.Errorf("sesión guardada %+v", g)
	}
	// Cada inicio lleva un token nuevo.
	s2, _ := e.svc.IniciarSesion(context.Background(), correoDePrueba, claveDePrueba, "203.0.113.7")
	if s2.Token == s.Token {
		t.Error("el token debe ser nuevo en cada inicio de sesión")
	}
	// La cuenta sin verificar entra con la sesión limitada.
	sv, err := e.svc.IniciarSesion(context.Background(), "sinverificar@ej.test", claveDePrueba, "203.0.113.7")
	if err != nil || sv.Verificada {
		t.Errorf("sin verificar: %+v, %v", sv, err)
	}
}

func TestCamposVaciosNoCuentanNiCalculan(t *testing.T) {
	e := nuevoEntorno(t)
	_, err := e.svc.IniciarSesion(context.Background(), " ", "", "o1")
	var inv *cuenta.ErrValidacion
	if !errors.As(err, &inv) || inv.Campos["identificador"] != "identificador_vacio" || inv.Campos["contrasena"] != "contrasena_vacia" {
		t.Fatalf("error %v", err)
	}
	if e.hasher.verificadas != 0 {
		t.Error("sin datos no se calcula nada")
	}
}

// D-136: 5 fallos por identificador en 15 minutos frenan el sexto, aunque la contraseña sea la correcta, exista o no
// la cuenta; pasados los 15 minutos se puede intentar de nuevo (espera, no bloqueo).
func TestCincoFallosPorIdentificadorFrenanElSexto(t *testing.T) {
	for _, identificador := range []string{correoDePrueba, "nadie@ejemplo.test"} {
		t.Run(identificador, func(t *testing.T) {
			e := nuevoEntorno(t)
			for i := range 5 {
				// Origen distinto en cada intento: lo que frena es el identificador.
				_, err := e.svc.IniciarSesion(context.Background(), identificador, "mal", "203.0.113."+string(rune('1'+i)))
				if !errors.Is(err, ErrCredencialesInvalidas) {
					t.Fatalf("fallo %d: %v", i+1, err)
				}
			}
			verificadas := e.hasher.verificadas
			_, err := e.svc.IniciarSesion(context.Background(), identificador, claveDePrueba, "203.0.113.50")
			if !errors.Is(err, ErrDemasiadosIntentos) {
				t.Fatalf("el sexto debe frenarse aunque la contraseña sea correcta: %v", err)
			}
			if e.hasher.verificadas != verificadas {
				t.Error("un intento frenado no corre Argon2id")
			}
			e.reloj.T = e.reloj.T.Add(15 * time.Minute)
			if identificador == correoDePrueba {
				if _, err := e.svc.IniciarSesion(context.Background(), identificador, claveDePrueba, "203.0.113.50"); err != nil {
					t.Fatalf("pasados los 15 minutos se puede intentar: %v", err)
				}
			}
		})
	}
}

func TestVeinteFallosPorOrigenFrenanElVeintiuno(t *testing.T) {
	e := nuevoEntorno(t)
	for i := range 20 {
		// Un identificador distinto cada vez, del mismo origen.
		_, _ = e.svc.IniciarSesion(context.Background(), "u"+strings.Repeat("x", i)+"@ejemplo.test", "mal", "203.0.113.7")
	}
	if _, err := e.svc.IniciarSesion(context.Background(), correoDePrueba, claveDePrueba, "203.0.113.7"); !errors.Is(err, ErrDemasiadosIntentos) {
		t.Fatalf("el origen debe frenarse: %v", err)
	}
	if _, err := e.svc.IniciarSesion(context.Background(), correoDePrueba, claveDePrueba, "198.51.100.1"); err != nil {
		t.Fatalf("otro origen entra: %v", err)
	}
}

func TestCerrarSesion(t *testing.T) {
	e := nuevoEntorno(t)
	token, huella := seguridad.NuevoTokenOpaco()
	if err := e.svc.CerrarSesion(context.Background(), token); err != nil || len(e.repo.cerradas) != 1 || string(e.repo.cerradas[0]) != string(huella) {
		t.Fatalf("cerradas %v (%v)", e.repo.cerradas, err)
	}
	// Un token mal formado no toca la base.
	if err := e.svc.CerrarSesion(context.Background(), "basura"); err != nil || len(e.repo.cerradas) != 1 {
		t.Fatalf("token inválido: %v %v", err, e.repo.cerradas)
	}
}
