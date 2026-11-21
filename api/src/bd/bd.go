// Package bd conecta con PostgreSQL (pgx v5, pgxpool) y aplica las migraciones con goose como biblioteca.
package bd

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Variables de entorno de la conexión. Hay dos formas (README del API, «Base de datos y migraciones»): la URL (local y
// pruebas) y la identidad administrada de Azure (D-204 (1), D-123), sin contraseña guardada. En Azure solo vale la segunda:
// con la URL y una señal de que corre en Azure, la conexión se rechaza (ver enAzure).
const (
	VariableURL       = "BASE_DE_DATOS_URL"
	VariableHost      = "PGHOST"
	VariableBase      = "PGDATABASE"
	VariableUsuario   = "PGUSER"
	VariableModoSSL   = "PGSSLMODE"
	VariableIdentidad = "AZURE_CLIENT_ID" // client id de la identidad administrada de usuario que se conecta

	// Señales de que el proceso corre en Azure. infra/azure pone VariableIdentidad en el API y en los trabajos; Container Apps
	// pone las otras dos en toda réplica, también si alguien quita la primera.
	variableEndpointDeIdentidad = "IDENTITY_ENDPOINT"
	variableNombreDeLaApp       = "CONTAINER_APP_NAME"

	// AlcanceEntra es el alcance del token de Entra ID para Azure Database for PostgreSQL.
	AlcanceEntra = "https://ossrdbms-aad.database.windows.net/.default"

	modoSSLExigido = "verify-full" // el único que acepta la identidad administrada
)

// FuenteDeTokens da el token de Entra ID que hace de contraseña. Es lo único de Azure que ve este paquete: las
// pruebas ponen una falsa y no tocan la red.
type FuenteDeTokens interface {
	Token(ctx context.Context) (string, error)
}

// NuevaFuente crea la fuente de tokens de la identidad con ese client id.
type NuevaFuente func(clienteID string) (FuenteDeTokens, error)

// NuevaFuenteDeEntra es la NuevaFuente de producción: la credencial de identidad administrada de usuario. Crearla no usa
// la red; azidentity guarda el token hasta que está por vencer.
func NuevaFuenteDeEntra(clienteID string) (FuenteDeTokens, error) {
	cred, err := azidentity.NewManagedIdentityCredential(&azidentity.ManagedIdentityCredentialOptions{ID: azidentity.ClientID(clienteID)})
	if err != nil {
		return nil, fmt.Errorf("crear la credencial de la identidad administrada: %w", err)
	}
	return FuenteDeCredencial(cred), nil
}

// FuenteDeCredencial pide los tokens a una credencial de Azure con el alcance de PostgreSQL.
func FuenteDeCredencial(cred azcore.TokenCredential) FuenteDeTokens { return fuenteDeCredencial{cred} }

type fuenteDeCredencial struct{ cred azcore.TokenCredential }

func (f fuenteDeCredencial) Token(ctx context.Context) (string, error) {
	t, err := f.cred.GetToken(ctx, policy.TokenRequestOptions{Scopes: []string{AlcanceEntra}})
	if err != nil {
		return "", err
	}
	return t.Token, nil
}

// Conectar abre un pool y verifica la conexión con un ping (ver ConfigurarPool para las dos formas de conectar).
func Conectar(ctx context.Context) (*pgxpool.Pool, error) {
	return ConectarCon(ctx, os.Getenv, NuevaFuenteDeEntra)
}

// ConectarCon es Conectar con el entorno y la fuente de tokens dados.
func ConectarCon(ctx context.Context, entorno func(string) string, nueva NuevaFuente) (*pgxpool.Pool, error) {
	cfg, err := ConfigurarPool(entorno, nueva)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("configurar la conexión: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("conectar con PostgreSQL: %w", err)
	}
	return pool, nil
}

// ConfigurarPool arma la configuración del pool. Con BASE_DE_DATOS_URL usa esa URL, salvo que el proceso corra en Azure
// (VariableIdentidad, IDENTITY_ENDPOINT o CONTAINER_APP_NAME presentes): ahí la URL es un error, porque llevaría una
// contraseña fija o una conexión sin verify-full (E11-INF 2.3 bis). Sin URL usa la identidad administrada: PGHOST, PGDATABASE, PGUSER, PGSSLMODE (que tiene que ser verify-full) y AZURE_CLIENT_ID; la
// contraseña de cada conexión nueva es un token de Entra ID, pedido en BeforeConnect y nunca escrito en el registro ni
// en un error. Toda conexión del pool fija TimeZone=UTC, también si la URL o el entorno (PGTZ) piden otra zona (E17 3.9,
// E13 §3.4).
func ConfigurarPool(entorno func(string) string, nueva NuevaFuente) (*pgxpool.Config, error) {
	var cfg *pgxpool.Config
	var err error
	if u := entorno(VariableURL); u != "" {
		if senales := enAzure(entorno); len(senales) > 0 {
			return nil, urlEnAzure{senales: senales}
		}
		if cfg, err = pgxpool.ParseConfig(u); err != nil {
			err = fmt.Errorf("configurar la conexión: %w", err)
		}
	} else {
		cfg, err = configurarIdentidad(entorno, nueva)
	}
	if err != nil {
		return nil, err
	}
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	return cfg, nil
}

// enAzure devuelve las señales de que el proceso corre en Azure que están definidas (vacío si corre fuera). Una variable en
// blanco no cuenta.
func enAzure(entorno func(string) string) []string {
	var presentes []string
	for _, nombre := range []string{VariableIdentidad, variableEndpointDeIdentidad, variableNombreDeLaApp} {
		if strings.TrimSpace(entorno(nombre)) != "" {
			presentes = append(presentes, nombre)
		}
	}
	return presentes
}

// urlEnAzure es el error de recibir la URL corriendo en Azure. Nombra las variables y nunca la URL, que lleva la contraseña.
type urlEnAzure struct{ senales []string }

func (e urlEnAzure) Error() string {
	return VariableURL + " no se acepta en Azure (definidas: " + strings.Join(e.senales, ", ") + "): la conexión es con la identidad " +
		"administrada, con PGHOST, PGDATABASE, PGUSER, PGSSLMODE=" + modoSSLExigido + " y " + VariableIdentidad + ", sin contraseña guardada"
}

func configurarIdentidad(entorno func(string) string, nueva NuevaFuente) (*pgxpool.Config, error) {
	valor := func(nombre string) string { return strings.TrimSpace(entorno(nombre)) }
	var faltan []string
	for _, nombre := range []string{VariableHost, VariableBase, VariableUsuario, VariableModoSSL, VariableIdentidad} {
		if valor(nombre) == "" {
			faltan = append(faltan, nombre)
		}
	}
	if len(faltan) > 0 {
		return nil, errors.New("falta " + VariableURL + " o la identidad administrada completa: faltan " + strings.Join(faltan, ", "))
	}
	if modo := entorno(VariableModoSSL); modo != modoSSLExigido {
		return nil, fmt.Errorf("%s debe ser %s con identidad administrada, no %q", VariableModoSSL, modoSSLExigido, modo)
	}
	destino := url.URL{
		Scheme:   "postgres",
		User:     url.User(valor(VariableUsuario)),
		Host:     valor(VariableHost),
		Path:     "/" + valor(VariableBase),
		RawQuery: "sslmode=" + modoSSLExigido,
	}
	cfg, err := pgxpool.ParseConfig(destino.String())
	if err != nil {
		return nil, fmt.Errorf("configurar la conexión: %w", err)
	}
	fuente, err := nueva(valor(VariableIdentidad))
	if err != nil {
		return nil, err
	}
	cfg.BeforeConnect = func(ctx context.Context, c *pgx.ConnConfig) error {
		token, err := fuente.Token(ctx)
		if err != nil {
			return errorDeToken{causa: err}
		}
		if token == "" {
			return errors.New("obtener el token de Entra ID para PostgreSQL: llegó vacío")
		}
		c.Password = token
		return nil
	}
	return cfg, nil
}

// errorDeToken es el error de pedir el token: su texto solo dice la categoría (falló, cancelado o tiempo agotado) y nunca
// copia el mensaje del SDK, que puede traer el cuerpo de una respuesta remota; ese texto llega al registro por pgx y app.go.
// La causa sigue disponible con errors.Is y errors.As para quien necesite distinguirla (cancelación, tiempo agotado).
type errorDeToken struct{ causa error }

func (e errorDeToken) Error() string {
	categoria := "falló"
	switch {
	case errors.Is(e.causa, context.Canceled):
		categoria = "cancelado"
	case errors.Is(e.causa, context.DeadlineExceeded):
		categoria = "tiempo agotado"
	}
	return "obtener el token de Entra ID para PostgreSQL: " + categoria
}

func (e errorDeToken) Unwrap() error { return e.causa }
