//go:build integration

package app_test

import (
	"context"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/mail"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/app"
	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// cuentaDelCaso2 crea una cuenta adulta con el correo confirmado, sin ninguna autorización, creada hace `edad`.
func cuentaDelCaso2(t *testing.T, pool *pgxpool.Pool, correoDeLaCuenta string, edad time.Duration) string {
	t.Helper()
	ctx := context.Background()
	// Una cuenta adulta exige su perfil al confirmar la transacción: las dos filas van juntas.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa, creada_en) VALUES ('Laura', 'adulta', now() - make_interval(secs => $1)) RETURNING id::text`, edad.Seconds()).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, $2, true)`, id, correoDeLaCuenta); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return id
}

func configDeCorreo(direccion string) config.Config {
	return config.Config{
		CorreoSMTP: direccion, CorreoRemitente: "no-responder@ejemplo.test",
		CorreoPrivacidad: "privacidad@ejemplo.test", URLPublica: "https://app.ejemplo.test",
	}
}

// Ítem 294, L10: ArmarTareas es lo que usa `api tareas` en producción. Con el servidor de correo de mentira, el aviso de
// la purga llega de verdad (destinatario, asunto, enlace a /entrar y la fecha del borrado), queda registrado y no sale dos veces.
func TestArmarTareasEnviaElAvisoDeVerdad(t *testing.T) {
	pool := pgtest.Nueva(t)
	ctx := context.Background()
	direccion, capturas := correotest.ServidorQueCaptura(t)
	id := cuentaDelCaso2(t, pool, "laura@ejemplo.test", 6*24*time.Hour)

	ejecutor, err := app.ArmarTareas(configDeCorreo(direccion), pool, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	antes := time.Now()
	for range 3 {
		if n, err := ejecutor.Ejecutar(ctx); err != nil || n != 3 {
			t.Fatalf("ejecutadas %d, error %v", n, err)
		}
	}
	msgs := capturas.Mensajes()
	if len(msgs) != 1 {
		t.Fatalf("el aviso sale una sola vez aunque la tarea corra 3 veces: %d mensajes", len(msgs))
	}
	if msgs[0].Destinatario != "laura@ejemplo.test" || msgs[0].Remitente != "no-responder@ejemplo.test" {
		t.Errorf("sobre inesperado: %+v", msgs[0])
	}
	m, err := mail.ReadMessage(strings.NewReader(msgs[0].Datos))
	if err != nil {
		t.Fatal(err)
	}
	asunto, err := new(mime.WordDecoder).DecodeHeader(m.Header.Get("Subject"))
	if err != nil || asunto != "Tu cuenta de Alcanzamos se borra en 2 días" {
		t.Errorf("asunto %q (%v)", asunto, err)
	}
	cuerpo, err := io.ReadAll(m.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(cuerpo), "https://app.ejemplo.test/entrar") {
		t.Errorf("falta el enlace a /entrar: %s", cuerpo)
	}
	var aviso *time.Time
	if err := pool.QueryRow(ctx, `SELECT aviso_de_purga_en FROM perfil_adulto WHERE persona_id = $1::uuid`, id).Scan(&aviso); err != nil || aviso == nil {
		t.Fatalf("el aviso debe quedar registrado: %v, %v", aviso, err)
	}
	if aviso.Before(antes.Add(-time.Minute)) || aviso.After(time.Now()) {
		t.Errorf("el aviso registrado %v no es de esta corrida (%v)", aviso, antes)
	}
}

// Ítem 294, L10: con el servidor de correo caído el aviso no sale ni se registra, la cuenta sigue, y la limpieza de
// sesiones y enlaces vencidos corre igual.
func TestArmarTareasConElCorreoCaidoNoSaltaLaLimpieza(t *testing.T) {
	pool := pgtest.Nueva(t)
	ctx := context.Background()
	id := cuentaDelCaso2(t, pool, "laura@ejemplo.test", 6*24*time.Hour)
	if _, err := pool.Exec(ctx, `INSERT INTO sesion (hash_token, persona_id, creada_en, ultimo_uso_en, vence_en)
		VALUES (decode(repeat('ab', 32), 'hex'), $1::uuid, now() - interval '2 days', now() - interval '2 days', now() - interval '1 day')`, id); err != nil {
		t.Fatal(err)
	}
	ejecutor, err := app.ArmarTareas(configDeCorreo("127.0.0.1:1"), pool, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if n, err := ejecutor.Ejecutar(ctx); err != nil || n != 3 {
		t.Fatalf("ejecutadas %d, error %v", n, err)
	}
	var avisos, sesiones int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE aviso_de_purga_en IS NOT NULL) FROM perfil_adulto`).Scan(&avisos); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM sesion`).Scan(&sesiones); err != nil {
		t.Fatal(err)
	}
	if avisos != 0 || sesiones != 0 {
		t.Errorf("sin servidor de correo no se registra ningún aviso (%d) y la sesión vencida se limpia igual (quedan %d)", avisos, sesiones)
	}
}

// Ítem 294, L14 (4): la limpieza de sesiones y enlaces nunca espera al correo. El servidor de correo de la prueba, al recibir
// la conexión del primer aviso, mira la base: la sesión vencida ya se limpió y la cuenta del caso 2 ya pasó la purga.
func TestArmarTareasLaLimpiezaTerminaAntesDeQueEmpieceElPrimerEnvio(t *testing.T) {
	pool := pgtest.Nueva(t)
	ctx := context.Background()
	id := cuentaDelCaso2(t, pool, "laura@ejemplo.test", 6*24*time.Hour)
	if _, err := pool.Exec(ctx, `INSERT INTO sesion (hash_token, persona_id, creada_en, ultimo_uso_en, vence_en)
		VALUES (decode(repeat('ab', 32), 'hex'), $1::uuid, now() - interval '2 days', now() - interval '2 days', now() - interval '1 day')`, id); err != nil {
		t.Fatal(err)
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	vistoAlConectar := make(chan int, 4)
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			var sesiones int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM sesion`).Scan(&sesiones); err != nil {
				sesiones = -1
			}
			vistoAlConectar <- sesiones
			c.Close() // el envío falla de inmediato: la cuenta queda para la corrida siguiente
		}
	}()
	ejecutor, err := app.ArmarTareas(configDeCorreo(l.Addr().String()), pool, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if n, err := ejecutor.Ejecutar(ctx); err != nil || n != 3 {
		t.Fatalf("ejecutadas %d, error %v", n, err)
	}
	select {
	case sesiones := <-vistoAlConectar:
		if sesiones != 0 {
			t.Errorf("cuando el primer envío empezó la sesión vencida seguía en la base (%d): la limpieza esperó al correo", sesiones)
		}
	default:
		t.Fatal("la tarea de los avisos no llegó a conectarse al servidor de correo")
	}
}

// Una dependencia que falta se descubre al armar las tareas, no a mitad de la corrida.
func TestArmarTareasSinPoolFalla(t *testing.T) {
	if _, err := app.ArmarTareas(configDeCorreo("127.0.0.1:1"), nil, slog.New(slog.NewJSONHandler(io.Discard, nil))); err == nil {
		t.Fatal("sin pool no se puede armar")
	}
}
