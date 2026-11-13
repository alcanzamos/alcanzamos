//go:build integration

package pg_test

import (
	"context"
	"crypto/sha256"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/tareas"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
)

type correoPanicoI294 struct{ *correotest.Falso }

func (*correoPanicoI294) EnviarAvisoDePurga(context.Context, string, time.Time) error {
	panic("SMTP sintetico")
}

// S2, S4, L10.3: el panic real del envio revierte la transaccion, libera ambas filas y no salta la limpieza.
func TestI294VerificadorPanicoSMTPRevierteYLimpia(t *testing.T) {
	ctx := context.Background()
	a := nuevoEntornoDeAviso(t)
	id := a.sembrar(t, "panico@ejemplo.test", ahora.Add(-6*dia), true)
	for _, q := range []string{
		`INSERT INTO sesion (hash_token, persona_id, creada_en, ultimo_uso_en, vence_en) VALUES (decode(repeat('ab',32),'hex'),$1::uuid,$2::timestamptz-interval '2 days',$2::timestamptz-interval '2 days',$2::timestamptz-interval '1 day')`,
		`INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, creado_en, vence_en) VALUES (decode(repeat('cd',32),'hex'),$1::uuid,'recuperacion',$2::timestamptz-interval '2 days',$2::timestamptz-interval '1 day')`,
	} {
		if _, err := a.pool.Exec(ctx, q, id, ahora); err != nil {
			t.Fatal(err)
		}
	}
	huella := func() [32]byte {
		var datos string
		if err := a.pool.QueryRow(ctx, `SELECT jsonb_build_object('persona',to_jsonb(p),'perfil',to_jsonb(pa))::text FROM persona p JOIN perfil_adulto pa ON pa.persona_id=p.id WHERE p.id=$1::uuid`, id).Scan(&datos); err != nil {
			t.Fatal(err)
		}
		return sha256.Sum256([]byte(datos))
	}
	antes := huella()
	a.tarea = a.servicioDeTareas(t, &correoPanicoI294{Falso: a.correo}, 0)
	ejecutor := tareas.NuevoEjecutor(a.tarea, pg.NuevoLimpieza(a.pool), a.relojDeTareas, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	n, err := ejecutor.Ejecutar(ctx)
	if n != 1 || err == nil || err.Error() != "borrar cuentas sin confirmar: pánico: SMTP sintetico" {
		t.Fatalf("ejecutadas=%d error=%v", n, err)
	}
	if despues := huella(); antes != despues {
		t.Fatalf("cuenta alterada: antes=%x despues=%x", antes, despues)
	}
	for _, tabla := range []string{"sesion", "enlace_un_uso"} {
		if n := contar(t, a.pool, `SELECT count(*) FROM `+tabla+` WHERE vence_en < $1`, ahora); n != 0 {
			t.Errorf("%s: quedan %d vencidos", tabla, n)
		}
	}
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	for _, q := range []string{`SELECT 1 FROM persona WHERE id=$1::uuid FOR UPDATE NOWAIT`, `SELECT 1 FROM perfil_adulto WHERE persona_id=$1::uuid FOR UPDATE NOWAIT`} {
		if _, err := tx.Exec(ctx, q, id); err != nil {
			t.Fatal(err)
		}
	}
}
