package bd_test

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/bd"
)

// Pruebas de regresión de la verificación independiente del 2026-11-17 (US-79, D-204).

type fuenteS13 func(context.Context) (string, error)

func (f fuenteS13) Token(ctx context.Context) (string, error) {
	return f(ctx)
}

func TestS13EntornoPGNoRebajaTLSNiConservaPassword(t *testing.T) {
	t.Setenv("PGPASSWORD", "password-ambiental")
	t.Setenv("PGSSLMODE", "disable")
	t.Setenv("PGPORT", "6543")
	t.Setenv("PGSSLROOTCERT", "")
	t.Setenv("PGSERVICE", "")
	t.Setenv("PGSERVICEFILE", filepath.Join(t.TempDir(), "inexistente"))
	t.Setenv("PGPASSFILE", filepath.Join(t.TempDir(), "inexistente"))

	pedidos := 0
	cfg, err := bd.ConfigurarPool(
		entorno(entornoCompleto()),
		func(string) (bd.FuenteDeTokens, error) {
			return fuenteS13(func(context.Context) (string, error) {
				pedidos++
				return tokenDePrueba, nil
			}), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.ConnConfig.Copy()
	if c.Port != 6543 || c.TLSConfig == nil ||
		c.TLSConfig.InsecureSkipVerify ||
		c.TLSConfig.ServerName != c.Host || len(c.Fallbacks) != 0 {
		t.Fatal("el entorno alteró el puerto esperado o rebajó verify-full")
	}
	if err := cfg.BeforeConnect(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	if pedidos != 1 || c.Password != tokenDePrueba {
		t.Fatal("BeforeConnect no reemplazó la contraseña ambiental")
	}
}

func TestS13CancelarConexionTerminaLaFuente(t *testing.T) {
	iniciada := make(chan struct{})
	terminada := make(chan error, 1)
	liberar := make(chan struct{})
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	defer close(liberar)

	resultado := make(chan error, 1)
	go func() {
		pool, err := bd.ConectarCon(
			ctx,
			entorno(entornoCompleto()),
			func(string) (bd.FuenteDeTokens, error) {
				return fuenteS13(func(ctx context.Context) (string, error) {
					close(iniciada)
					select {
					case <-ctx.Done():
						terminada <- ctx.Err()
						return "", ctx.Err()
					case <-liberar:
						return "", errors.New("fin de la prueba")
					}
				}), nil
			},
		)
		if pool != nil {
			pool.Close()
		}
		resultado <- err
	}()

	select {
	case <-iniciada:
	case <-time.After(5 * time.Second):
		t.Fatal("la petición del token no empezó")
	}
	cancelar()
	select {
	case err := <-terminada:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("la fuente no recibió la cancelación")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("la fuente sobrevivió a la cancelación de la conexión")
	}
	select {
	case err := <-resultado:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("la conexión no conservó context.Canceled")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("la conexión no terminó")
	}
}

func TestS13ErrorDeFuenteNoExponePayloadRemoto(t *testing.T) {
	const secreto = "texto remoto que no debe salir"
	cfg, err := bd.ConfigurarPool(
		entorno(entornoCompleto()),
		func(string) (bd.FuenteDeTokens, error) {
			return fuenteS13(func(context.Context) (string, error) {
				return "", errors.New("respuesta del servidor: " + secreto)
			}), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	err = cfg.BeforeConnect(context.Background(), cfg.ConnConfig.Copy())
	if err == nil {
		t.Fatal("el fallo de la fuente debía rechazar la conexión")
	}
	if strings.Contains(err.Error(), secreto) {
		t.Fatal("el error público expone el payload remoto")
	}
}
