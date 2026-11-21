package bd_test

import (
	"bytes"
	"context"
	"errors"
	"log"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/bd"
)

// Conexión con identidad administrada (D-204 (1), D-123): sin BASE_DE_DATOS_URL, el pool se arma con PGHOST,
// PGDATABASE, PGUSER y PGSSLMODE, y la contraseña de cada conexión nueva es un token de Entra ID. Ninguna prueba toca la
// red de Azure: la fuente de tokens es falsa.

const (
	tokenDePrueba = "TOKEN-SECRETO-DE-PRUEBA"
	clienteID     = "11111111-2222-3333-4444-555555555555"
)

// entornoCompleto es la configuración de la identidad administrada, sin BASE_DE_DATOS_URL.
func entornoCompleto() map[string]string {
	return map[string]string{
		"PGHOST":          "pg-alcanzamos.postgres.database.azure.com",
		"PGDATABASE":      "alcanzamos",
		"PGUSER":          "id-alcanzamos-api",
		"PGSSLMODE":       "verify-full",
		"AZURE_CLIENT_ID": clienteID,
	}
}

func entorno(m map[string]string) func(string) string {
	return func(nombre string) string { return m[nombre] }
}

// fuenteFalsa es la fuente de tokens de las pruebas: cuenta las peticiones y entrega un token distinto por llamada
// si se le piden varios.
type fuenteFalsa struct {
	mu       sync.Mutex
	tokens   []string // el token de cada llamada, en orden; el último se repite
	err      error
	bloquear bool // espera al contexto, como una petición de red que no contesta
	llamadas int
}

func (f *fuenteFalsa) Token(ctx context.Context) (string, error) {
	f.mu.Lock()
	n := f.llamadas
	f.llamadas++
	f.mu.Unlock()
	if f.bloquear {
		<-ctx.Done()
		return "", ctx.Err()
	}
	if f.err != nil {
		return "", f.err
	}
	if len(f.tokens) == 0 {
		return tokenDePrueba, nil
	}
	return f.tokens[min(n, len(f.tokens)-1)], nil
}

func (f *fuenteFalsa) pedidos() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.llamadas
}

// fabricaFalsa devuelve la fuente y anota el client id con que la pidieron.
type fabricaFalsa struct {
	fuente   *fuenteFalsa
	pedidas  int
	clientes []string
}

func (f *fabricaFalsa) nueva(cliente string) (bd.FuenteDeTokens, error) {
	f.pedidas++
	f.clientes = append(f.clientes, cliente)
	return f.fuente, nil
}

func nuevaFabrica(f *fuenteFalsa) *fabricaFalsa { return &fabricaFalsa{fuente: f} }

func TestSinURLNiIdentidadElErrorNombraTodasLasVariables(t *testing.T) {
	fab := nuevaFabrica(&fuenteFalsa{})
	_, err := bd.ConfigurarPool(entorno(nil), fab.nueva)
	if err == nil {
		t.Fatal("sin ninguna variable debía fallar")
	}
	for _, v := range []string{"BASE_DE_DATOS_URL", "PGHOST", "PGDATABASE", "PGUSER", "PGSSLMODE", "AZURE_CLIENT_ID"} {
		if !strings.Contains(err.Error(), v) {
			t.Errorf("el error no nombra %s: %v", v, err)
		}
	}
	if fab.pedidas != 0 {
		t.Errorf("no debía pedirse ninguna fuente de tokens con la configuración incompleta: %d", fab.pedidas)
	}
}

func TestCadaVariableQueFaltaSeNombraYSoloEsa(t *testing.T) {
	todas := []string{"PGHOST", "PGDATABASE", "PGUSER", "PGSSLMODE", "AZURE_CLIENT_ID"}
	for _, falta := range todas {
		t.Run(falta, func(t *testing.T) {
			env := entornoCompleto()
			delete(env, falta)
			fab := nuevaFabrica(&fuenteFalsa{})
			_, err := bd.ConfigurarPool(entorno(env), fab.nueva)
			if err == nil {
				t.Fatalf("sin %s debía fallar", falta)
			}
			if !strings.Contains(err.Error(), falta) {
				t.Errorf("el error no nombra %s como la que falta: %v", falta, err)
			}
			for _, otra := range todas {
				if otra != falta && strings.Contains(err.Error(), otra) {
					t.Errorf("el error nombra %s, que sí está: %v", otra, err)
				}
			}
			if fab.pedidas != 0 {
				t.Errorf("no debía pedirse la fuente de tokens: %d", fab.pedidas)
			}
		})
	}
}

func TestUnaVariableSoloDeEspaciosCuentaComoFaltante(t *testing.T) {
	env := entornoCompleto()
	env["PGUSER"] = "   "
	_, err := bd.ConfigurarPool(entorno(env), nuevaFabrica(&fuenteFalsa{}).nueva)
	if err == nil || !strings.Contains(err.Error(), "PGUSER") {
		t.Fatalf("se esperaba un error que nombre PGUSER: %v", err)
	}
}

// Fuera de Azure (sin AZURE_CLIENT_ID ni las otras señales), la URL gana y las variables PG* sueltas no se miran: así se
// conecta quien trabaja en local, donde PGHOST y compañía pueden venir del entorno de la terminal.
func TestFueraDeAzureLaURLGanaSobreLasVariablesDeLaIdentidad(t *testing.T) {
	env := entornoCompleto()
	delete(env, "AZURE_CLIENT_ID")
	env["BASE_DE_DATOS_URL"] = "postgres://local:solo-local@127.0.0.1:55432/local?sslmode=disable"
	fab := nuevaFabrica(&fuenteFalsa{})
	cfg, err := bd.ConfigurarPool(entorno(env), fab.nueva)
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.ConnConfig
	if c.Host != "127.0.0.1" || c.Port != 55432 || c.Database != "local" || c.User != "local" || c.Password != "solo-local" {
		t.Errorf("no usó la URL: %+v", c)
	}
	if cfg.BeforeConnect != nil || fab.pedidas != 0 {
		t.Errorf("con la URL no se pide ningún token: BeforeConnect %v, fuentes %d", cfg.BeforeConnect != nil, fab.pedidas)
	}
	if c.RuntimeParams["timezone"] != "UTC" {
		t.Errorf("con la URL también se fija UTC: %v", c.RuntimeParams)
	}
}

// L24 (a): en Azure no se conecta con una URL (contraseña fija, o una conexión sin verify-full). Basta una señal de que
// corre en Azure: AZURE_CLIENT_ID (que pone infra/azure en el API y en los trabajos) o las que pone Container Apps.
func TestEnAzureLaURLSeRechazaConCualquierSenal(t *testing.T) {
	const url = "postgres://alguien:CLAVE-FIJA-DE-PRUEBA@127.0.0.1:55432/local?sslmode=disable"
	senales := map[string]string{
		"AZURE_CLIENT_ID":    clienteID,
		"IDENTITY_ENDPOINT":  "http://localhost:42356/msi/token",
		"CONTAINER_APP_NAME": "ca-api-alcanzamos-prod-eus2",
	}
	for nombre, valor := range senales {
		t.Run(nombre, func(t *testing.T) {
			// Con la identidad completa o sin ella, y con la señal sola: siempre se rechaza.
			for etiqueta, env := range map[string]map[string]string{"solo la URL y la señal": {}, "con la identidad completa": entornoCompleto()} {
				env["BASE_DE_DATOS_URL"] = url
				env[nombre] = valor
				fab := nuevaFabrica(&fuenteFalsa{})
				cfg, err := bd.ConfigurarPool(entorno(env), fab.nueva)
				if err == nil || cfg != nil {
					t.Fatalf("%s: con %s y la URL debía rechazarse", etiqueta, nombre)
				}
				for _, v := range []string{"BASE_DE_DATOS_URL", nombre} { // el error nombra la variable de la URL y la señal
					if !strings.Contains(err.Error(), v) {
						t.Errorf("%s: el error no nombra %s: %v", etiqueta, v, err)
					}
				}
				if strings.Contains(err.Error(), "CLAVE-FIJA-DE-PRUEBA") || strings.Contains(err.Error(), "127.0.0.1") {
					t.Errorf("%s: el error repite la URL, que lleva la contraseña: %v", etiqueta, err)
				}
				if fab.pedidas != 0 {
					t.Errorf("%s: no debía pedirse ninguna fuente de tokens: %d", etiqueta, fab.pedidas)
				}
			}
		})
	}
}

// Una señal vacía o de solo espacios no cuenta (igual que una variable de la identidad), y una URL vacía tampoco es una URL.
func TestUnaSenalVaciaNoImpideLaURLNiUnaURLVaciaImpideLaIdentidad(t *testing.T) {
	env := map[string]string{
		"BASE_DE_DATOS_URL": "postgres://local:solo-local@127.0.0.1:55432/local?sslmode=disable",
		"AZURE_CLIENT_ID":   "   ",
	}
	if _, err := bd.ConfigurarPool(entorno(env), nuevaFabrica(&fuenteFalsa{}).nueva); err != nil {
		t.Fatalf("una señal en blanco no es una señal: %v", err)
	}
	if _, err := bd.ConfigurarPool(entorno(entornoCompleto()), nuevaFabrica(&fuenteFalsa{}).nueva); err != nil {
		t.Fatalf("la identidad sin URL sigue funcionando: %v", err)
	}
}

func TestConIdentidadArmaLaConexionConVerifyFullYUTC(t *testing.T) {
	fab := nuevaFabrica(&fuenteFalsa{})
	cfg, err := bd.ConfigurarPool(entorno(entornoCompleto()), fab.nueva)
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.ConnConfig
	if c.Host != "pg-alcanzamos.postgres.database.azure.com" || c.Database != "alcanzamos" || c.User != "id-alcanzamos-api" {
		t.Errorf("host, base o usuario mal armados: %s %s %s", c.Host, c.Database, c.User)
	}
	if c.Password != "" {
		t.Errorf("la contraseña solo se pone al conectar: %q", c.Password)
	}
	if c.TLSConfig == nil || c.TLSConfig.InsecureSkipVerify || c.TLSConfig.ServerName != c.Host || len(c.Fallbacks) != 0 {
		t.Errorf("se esperaba verify-full sin alternativas más débiles: %+v, %d alternativas", c.TLSConfig, len(c.Fallbacks))
	}
	if c.RuntimeParams["timezone"] != "UTC" {
		t.Errorf("toda conexión fija UTC: %v", c.RuntimeParams)
	}
	if fab.pedidas != 1 || fab.clientes[0] != clienteID {
		t.Errorf("la fuente se pide una vez, con el client id de AZURE_CLIENT_ID: %d %v", fab.pedidas, fab.clientes)
	}
	if cfg.BeforeConnect == nil {
		t.Error("falta BeforeConnect")
	}
}

func TestConIdentidadSoloSeAceptaVerifyFull(t *testing.T) {
	for _, modo := range []string{"disable", "allow", "prefer", "require", "verify-ca", "verify-full ", "VERIFY-FULL", "nada"} {
		t.Run(modo, func(t *testing.T) {
			env := entornoCompleto()
			env["PGSSLMODE"] = modo
			fab := nuevaFabrica(&fuenteFalsa{})
			cfg, err := bd.ConfigurarPool(entorno(env), fab.nueva)
			if err == nil || cfg != nil {
				t.Fatalf("PGSSLMODE=%q debía rechazarse", modo)
			}
			if !strings.Contains(err.Error(), "PGSSLMODE") || !strings.Contains(err.Error(), "verify-full") {
				t.Errorf("el error debe nombrar PGSSLMODE y verify-full: %v", err)
			}
			if fab.pedidas != 0 {
				t.Errorf("no debía pedirse la fuente de tokens: %d", fab.pedidas)
			}
		})
	}
}

// Una conexión nueva del pool es una petición de token: cada conexión lleva el token que la fuente dio en ese momento
// (con el token renovado, la conexión nueva lo usa) y la configuración no guarda el token.
func TestCadaConexionNuevaPideUnTokenYUsaElQueRecibe(t *testing.T) {
	fuente := &fuenteFalsa{tokens: []string{"token-1", "token-2", "token-3"}}
	cfg, err := bd.ConfigurarPool(entorno(entornoCompleto()), nuevaFabrica(fuente).nueva)
	if err != nil {
		t.Fatal(err)
	}
	for i, esperado := range []string{"token-1", "token-2", "token-3"} {
		// El pool llama a BeforeConnect con una copia de la configuración, una vez por conexión nueva.
		copia := cfg.ConnConfig.Copy()
		if err := cfg.BeforeConnect(context.Background(), copia); err != nil {
			t.Fatal(err)
		}
		if copia.Password != esperado {
			t.Errorf("conexión %d: contraseña %q, se esperaba %q", i+1, copia.Password, esperado)
		}
		if got := fuente.pedidos(); got != i+1 {
			t.Errorf("tras la conexión %d hubo %d peticiones de token, se esperaba una por conexión", i+1, got)
		}
		if cfg.ConnConfig.Password != "" {
			t.Errorf("la configuración del pool no debe guardar el token: %q", cfg.ConnConfig.Password)
		}
	}
}

// Lo mismo, con el pool de verdad: cada intento de conexión nueva pide un token.
func TestElPoolPideUnTokenPorCadaConexionNueva(t *testing.T) {
	t.Setenv("PGPORT", "1") // nadie escucha: la conexión falla después de pedir el token
	env := entornoCompleto()
	env["PGHOST"] = "127.0.0.1"
	fuente := &fuenteFalsa{}
	cfg, err := bd.ConfigurarPool(entorno(env), nuevaFabrica(fuente).nueva)
	if err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for i := 1; i <= 3; i++ {
		if err := pool.Ping(context.Background()); err == nil {
			t.Fatal("sin servidor el ping debía fallar")
		}
		if got := fuente.pedidos(); got != i {
			t.Fatalf("tras %d conexiones nuevas hubo %d peticiones de token", i, got)
		}
	}
}

func TestUnErrorDelTokenSePropagaComoErrorDeConexionSinFiltrarElToken(t *testing.T) {
	falla := errors.New("Entra ID no contesta")
	fuente := &fuenteFalsa{err: falla}
	pool, err := bd.ConectarCon(context.Background(), entorno(entornoCompleto()), nuevaFabrica(fuente).nueva)
	if err == nil || pool != nil {
		t.Fatalf("se esperaba el error de la conexión: %v", err)
	}
	if !errors.Is(err, falla) {
		t.Errorf("el error del token debe llegar como causa: %v", err)
	}
	if !strings.Contains(err.Error(), "token") || strings.Contains(err.Error(), tokenDePrueba) {
		t.Errorf("el error debe decir que falló el token, sin el token: %v", err)
	}
	if fuente.pedidos() != 1 {
		t.Errorf("una conexión, una petición: %d", fuente.pedidos())
	}
}

func TestUnTokenVacioEsUnErrorDeConexion(t *testing.T) {
	fuente := &fuenteFalsa{tokens: []string{""}}
	pool, err := bd.ConectarCon(context.Background(), entorno(entornoCompleto()), nuevaFabrica(fuente).nueva)
	if err == nil || pool != nil || !strings.Contains(err.Error(), "vacío") {
		t.Fatalf("un token vacío debía fallar: %v", err)
	}
}

func TestCancelarElContextoCortaLaPeticionDelToken(t *testing.T) {
	fuente := &fuenteFalsa{bloquear: true}
	ctx, cancelar := context.WithCancel(context.Background())
	listo := make(chan error, 1)
	go func() {
		pool, err := bd.ConectarCon(ctx, entorno(entornoCompleto()), nuevaFabrica(fuente).nueva)
		if pool != nil {
			pool.Close()
		}
		listo <- err
	}()
	for fuente.pedidos() == 0 { // espera a que la petición del token esté en curso
		time.Sleep(time.Millisecond)
	}
	cancelar()
	select {
	case err := <-listo:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("la cancelación debe propagarse: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("la conexión no se cortó al cancelar el contexto")
	}
}

// El token no sale en el error de una conexión que falla después de recibirlo, ni en el registro (slog y log).
func TestElTokenNoApareceEnErroresNiEnElRegistro(t *testing.T) {
	var registro bytes.Buffer
	anteriorSlog := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&registro, &slog.HandlerOptions{Level: slog.LevelDebug})))
	log.SetOutput(&registro)
	t.Cleanup(func() { slog.SetDefault(anteriorSlog); log.SetOutput(nil) })

	t.Setenv("PGPORT", "1")
	env := entornoCompleto()
	env["PGHOST"] = "127.0.0.1"
	fuente := &fuenteFalsa{}
	pool, err := bd.ConectarCon(context.Background(), entorno(env), nuevaFabrica(fuente).nueva)
	if err == nil || pool != nil {
		t.Fatalf("sin servidor debía fallar: %v", err)
	}
	if fuente.pedidos() != 1 {
		t.Fatalf("el token se pidió %d veces", fuente.pedidos())
	}
	if strings.Contains(err.Error(), tokenDePrueba) || strings.Contains(registro.String(), tokenDePrueba) {
		t.Errorf("el token apareció: error %q, registro %q", err, registro.String())
	}
}

// credencialFalsa es el azcore.TokenCredential de las pruebas de la fuente de Entra.
type credencialFalsa struct {
	alcances [][]string
	err      error
}

func (c *credencialFalsa) GetToken(_ context.Context, o policy.TokenRequestOptions) (azcore.AccessToken, error) {
	c.alcances = append(c.alcances, o.Scopes)
	if c.err != nil {
		return azcore.AccessToken{}, c.err
	}
	return azcore.AccessToken{Token: tokenDePrueba, ExpiresOn: time.Now().Add(time.Hour)}, nil
}

func TestLaFuenteDeEntraPideElAlcanceDeOSSRDBMS(t *testing.T) {
	cred := &credencialFalsa{}
	token, err := bd.FuenteDeCredencial(cred).Token(context.Background())
	if err != nil || token != tokenDePrueba {
		t.Fatalf("token %q, error %v", token, err)
	}
	if len(cred.alcances) != 1 || len(cred.alcances[0]) != 1 ||
		cred.alcances[0][0] != "https://ossrdbms-aad.database.windows.net/.default" {
		t.Errorf("el alcance debe ser el de PostgreSQL: %v", cred.alcances)
	}
	if bd.AlcanceEntra != "https://ossrdbms-aad.database.windows.net/.default" {
		t.Errorf("AlcanceEntra: %q", bd.AlcanceEntra)
	}
}

func TestLaFuenteDeEntraPropagaElErrorSinElToken(t *testing.T) {
	falla := errors.New("identidad no disponible")
	_, err := bd.FuenteDeCredencial(&credencialFalsa{err: falla}).Token(context.Background())
	if !errors.Is(err, falla) || strings.Contains(err.Error(), tokenDePrueba) {
		t.Fatalf("se esperaba el error de la credencial: %v", err)
	}
}

// Crear la fuente real no abre ninguna conexión: la red se toca recién al pedir un token.
func TestNuevaFuenteDeEntraNoUsaLaRedAlCrearse(t *testing.T) {
	fuente, err := bd.NuevaFuenteDeEntra(clienteID)
	if err != nil || fuente == nil {
		t.Fatalf("fuente %v, error %v", fuente, err)
	}
}

// Sigue valiendo lo de antes: con BASE_DE_DATOS_URL no hace falta nada más.
func TestConURLSinLasVariablesDeLaIdentidadFunciona(t *testing.T) {
	fab := nuevaFabrica(&fuenteFalsa{})
	cfg, err := bd.ConfigurarPool(entorno(map[string]string{"BASE_DE_DATOS_URL": "postgres://u@127.0.0.1:1/b"}), fab.nueva)
	if err != nil || cfg.ConnConfig.Database != "b" || fab.pedidas != 0 {
		t.Fatalf("%v %+v", err, cfg)
	}
	if _, err := bd.ConfigurarPool(entorno(map[string]string{"BASE_DE_DATOS_URL": "://mala"}), fab.nueva); err == nil {
		t.Fatal("una URL mala debía fallar")
	}
}
