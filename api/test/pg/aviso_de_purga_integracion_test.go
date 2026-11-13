//go:build integration

// Pruebas de integración del aviso antes de la purga (ítem 294, D-203) contra PostgreSQL: el correo del día 5 a las cuentas
// del caso 2 (adulta, correo confirmado, ninguna autorización como titular), la purga con las 48 horas y el límite del
// día 14, y el envío con las filas bloqueadas. Solo datos sintéticos.
package pg_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/correo"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
)

const hora = time.Hour
const dia = 24 * hora

// entornoDeAviso es un entorno de cuentas con un servicio de tareas aparte, con el registro en un búfer y, si hace falta,
// otro correo y otro plazo de envío. El servicio del entorno (`svc`) sigue sirviendo para sembrar las cuentas.
type entornoDeAviso struct {
	*entornoDeCuentas
	registro *bytes.Buffer
	tarea    *cuenta.Servicio
	// limitadorDeTareas es el de los servicios de las pruebas de la tarea: aparte del que usa `svc` al sembrar, que ya
	// gastó un correo de la dirección con el enlace de verificación.
	limitadorDeTareas *seguridad.LimitadorDeIntentos
}

func nuevoEntornoDeAviso(t *testing.T) *entornoDeAviso {
	t.Helper()
	a := &entornoDeAviso{entornoDeCuentas: nuevoEntornoDeCuentas(t), registro: &bytes.Buffer{}}
	a.limitadorDeTareas = seguridad.NuevoLimitadorDeIntentos(a.reloj)
	a.tarea = a.servicioDeTareas(a.correo, 0)
	return a
}

func (a *entornoDeAviso) servicioDeTareas(c correo.Correo, plazo time.Duration) *cuenta.Servicio {
	return cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: a.repo, Correo: c, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: a.hasher,
		Reloj: a.reloj, Limitador: a.limitadorDeTareas, Log: slog.New(slog.NewJSONHandler(a.registro, nil)),
		PlazoDeEnvioConFilasBloqueadas: plazo,
	})
}

// corrida es una pasada de la tarea con `hoy` como la hora, y devuelve cuántas cuentas borró.
func (a *entornoDeAviso) corrida(t *testing.T, hoy time.Time) int {
	t.Helper()
	n, err := a.tarea.BorrarCuentasSinConfirmar(context.Background(), hoy)
	if err != nil {
		t.Fatalf("la tarea en %v: %v", hoy, err)
	}
	return n
}

// sembrar deja una cuenta creada en `creada`: si verificada, con el correo confirmado y la contraseña; si no, pendiente.
func (a *entornoDeAviso) sembrar(t *testing.T, correo string, creada time.Time, verificada bool, autorizadas ...string) string {
	t.Helper()
	id := a.semillaEdad(t, correo, 0, verificada, autorizadas...)
	if _, err := a.pool.Exec(context.Background(), `UPDATE persona SET creada_en = $1 WHERE id = $2::uuid`, creada, id); err != nil {
		t.Fatal(err)
	}
	return id
}

func (a *entornoDeAviso) existe(t *testing.T, id string) bool {
	t.Helper()
	return contar(t, a.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, id) == 1
}

// avisoDe es `aviso_de_purga_en` de la cuenta; nil si no tiene.
func (a *entornoDeAviso) avisoDe(t *testing.T, id string) *time.Time {
	t.Helper()
	var en *time.Time
	if err := a.pool.QueryRow(context.Background(), `SELECT aviso_de_purga_en FROM perfil_adulto WHERE persona_id = $1::uuid`, id).Scan(&en); err != nil {
		t.Fatal(err)
	}
	return en
}

// avisosEnviados son los correos de aviso de la purga que salieron, por destino.
func (a *entornoDeAviso) avisosEnviados() map[string][]time.Time {
	salieron := map[string][]time.Time{}
	for _, e := range a.correo.Enviados() {
		if e.AvisoDePurga {
			salieron[e.Destino] = append(salieron[e.Destino], e.BorradoEn)
		}
	}
	return salieron
}

func (a *entornoDeAviso) numeroDeAvisos() int {
	n := 0
	for _, v := range a.avisosEnviados() {
		n += len(v)
	}
	return n
}

// S7 (1) y S3: sin aviso, la cuenta del caso 2 no se borra antes del día 14 y desde el día 14 sí, y queda un ERROR con el
// id de la cuenta y sin el correo. Con el servidor de correo caído el aviso nunca sale.
func TestElCaso2SinAvisoNoSeBorraAntesDelDia14YDesdeElDia14Si(t *testing.T) {
	a := nuevoEntornoDeAviso(t)
	creada := ahora
	id := a.sembrar(t, "sin-aviso@ejemplo.test", creada, true)
	a.correo.Error = errors.New("servidor caído")

	for _, tras := range []time.Duration{5 * dia, 7 * dia, 7*dia + hora, 10 * dia, 14*dia - time.Minute, 14*dia - time.Nanosecond} {
		if n := a.corrida(t, creada.Add(tras)); n != 0 {
			t.Fatalf("a los %v de creada se borraron %d cuentas: sin aviso espera hasta el día 14", tras, n)
		}
		if !a.existe(t, id) || a.avisoDe(t, id) != nil {
			t.Fatalf("a los %v: la cuenta debe seguir, sin aviso registrado", tras)
		}
	}
	if strings.Contains(a.registro.String(), `"level":"ERROR"`) {
		t.Fatalf("antes del día 14 no hay error: %s", a.registro)
	}

	if n := a.corrida(t, creada.Add(14*dia)); n != 1 {
		t.Fatalf("a los 14 días justos se esperaba borrar 1 cuenta: %d", n)
	}
	if a.existe(t, id) {
		t.Fatal("desde el día 14 se borra aunque el aviso no haya salido")
	}
	registro := a.registro.String()
	lineaDeError := ""
	for _, l := range strings.Split(registro, "\n") {
		if strings.Contains(l, `"level":"ERROR"`) {
			lineaDeError += l
		}
	}
	if !strings.Contains(lineaDeError, id) {
		t.Errorf("falta el id de la cuenta en el error: %s", registro)
	}
	if strings.Contains(registro, "sin-aviso") || strings.Contains(registro, "ejemplo.test") {
		t.Errorf("el registro no debe llevar el correo: %s", registro)
	}
	if a.numeroDeAvisos() != 0 {
		t.Error("el servidor estaba caído: no pudo salir ningún aviso")
	}
	// Idempotente: ya no hay nada que borrar ni que registrar.
	n := strings.Count(registro, `"level":"ERROR"`)
	if a.corrida(t, creada.Add(15*dia)) != 0 || strings.Count(a.registro.String(), `"level":"ERROR"`) != n {
		t.Error("una segunda pasada no borra nada ni repite el error")
	}
}

// S3 en un despliegue: una cuenta del caso 2 que ya pasó el día 14 al primer intento y sin aviso se borra, con el error,
// aunque el servidor de correo esté sano: la purga va antes que el aviso, que ya no tiene a quién avisar.
func TestUnaCuentaDelCaso2DeMasDe14DiasSinAvisoSeBorraConElError(t *testing.T) {
	a := nuevoEntornoDeAviso(t)
	id := a.sembrar(t, "vieja@ejemplo.test", ahora.Add(-20*dia), true)
	if n := a.corrida(t, ahora); n != 1 || a.existe(t, id) {
		t.Fatalf("borradas %d, existe %v", n, a.existe(t, id))
	}
	if a.numeroDeAvisos() != 0 {
		t.Error("una cuenta que se borra en la misma pasada no recibe aviso")
	}
	if !strings.Contains(a.registro.String(), `"level":"ERROR"`) || !strings.Contains(a.registro.String(), id) {
		t.Errorf("falta el error con el id: %s", a.registro)
	}
}

// La purga del caso 2 pide las dos condiciones (7 días desde creada_en y 48 horas desde el aviso). Los avisos se escriben
// directo en la base, con un servidor de correo caído para que la pasada no mande ninguno.
func TestLaPurgaDelCaso2EsperaLasDosCondiciones(t *testing.T) {
	a := nuevoEntornoDeAviso(t)
	avisar := func(id string, en time.Time) {
		t.Helper()
		if _, err := a.pool.Exec(context.Background(), `UPDATE perfil_adulto SET aviso_de_purga_en = $2 WHERE persona_id = $1::uuid`, id, en); err != nil {
			t.Fatal(err)
		}
	}
	faltan1Minuto := a.sembrar(t, "faltan-48h-1min@ejemplo.test", ahora.Add(-8*dia), true)
	avisar(faltan1Minuto, ahora.Add(-48*hora+time.Minute))
	justas := a.sembrar(t, "48h-justas@ejemplo.test", ahora.Add(-8*dia), true)
	avisar(justas, ahora.Add(-48*hora))
	faltaElDia7 := a.sembrar(t, "falta-el-dia-7@ejemplo.test", ahora.Add(-7*dia+5*time.Minute), true)
	avisar(faltaElDia7, ahora.Add(-3*dia)) // no pasa en la práctica (el aviso sale desde el día 5), pero la purga pide las dos
	sinAviso := a.sembrar(t, "sin-aviso-8@ejemplo.test", ahora.Add(-8*dia), true)
	a.correo.Error = errors.New("servidor caído") // ya sembradas: que la pasada no mande ningún aviso

	if n := a.corrida(t, ahora); n != 1 {
		t.Fatalf("borradas %d, se esperaba solo la de las 48 horas justas", n)
	}
	for nombre, c := range map[string]struct {
		id    string
		queda bool
	}{"faltan 48 h por un minuto": {faltan1Minuto, true}, "48 h justas": {justas, false}, "falta el día 7": {faltaElDia7, true}, "sin aviso a los 8 días": {sinAviso, true}} {
		if a.existe(t, c.id) != c.queda {
			t.Errorf("%s: existe %v, se esperaba %v", nombre, a.existe(t, c.id), c.queda)
		}
	}
	if n := a.corrida(t, ahora.Add(time.Minute)); n != 1 || a.existe(t, faltan1Minuto) {
		t.Errorf("un minuto después cumple las 48 horas: borradas %d", n)
	}
	if n := a.corrida(t, ahora.Add(time.Minute)); n != 0 || !a.existe(t, faltaElDia7) {
		t.Errorf("a la que le falta el día 7 todavía no: borradas %d", n)
	}
	if n := a.corrida(t, ahora.Add(5*time.Minute)); n != 1 || a.existe(t, faltaElDia7) {
		t.Errorf("con el día 7 cumplido y el aviso de hace más de 48 horas se borra: borradas %d", n)
	}
}

// S7 (2): una cuenta que autoriza después del aviso deja de ser del caso 2 y no se borra, ni se le avisa otra vez. Cualquier
// autorización como titular, vigente o retirada, la saca del caso 2.
func TestUnaCuentaQueAutorizaDespuesDelAvisoNoSeBorra(t *testing.T) {
	for nombre, autorizar := range map[string]func(*testing.T, *entornoDeAviso, string){
		"todas las necesarias": func(t *testing.T, a *entornoDeAviso, id string) {
			for _, f := range []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"} {
				otorgarEn(t, a.pool, id, id, f, ahora.Add(6*dia))
			}
		},
		"una sola": func(t *testing.T, a *entornoDeAviso, id string) {
			otorgarEn(t, a.pool, id, id, "avisos", ahora.Add(6*dia))
		},
		"la autorización ya retirada": func(t *testing.T, a *entornoDeAviso, id string) {
			otorgarEn(t, a.pool, id, id, "avisos", ahora.Add(6*dia))
			if _, err := a.pool.Exec(context.Background(), `UPDATE autorizacion SET retirada_en = otorgada_en + interval '1 minute' WHERE titular_id = $1::uuid`, id); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(nombre, func(t *testing.T) {
			a := nuevoEntornoDeAviso(t)
			id := a.sembrar(t, "autoriza@ejemplo.test", ahora, true)
			control := a.sembrar(t, "no-autoriza@ejemplo.test", ahora, true)
			if a.corrida(t, ahora.Add(5*dia)) != 0 || a.avisoDe(t, id) == nil {
				t.Fatal("el día 5 sale el aviso y no se borra nada")
			}
			autorizar(t, a, id)
			// Cumplidos los 7 días y las 48 horas, y mucho más allá del día 14.
			for _, tras := range []time.Duration{7*dia + hora, 9 * dia, 14 * dia, 60 * dia} {
				a.corrida(t, ahora.Add(tras))
				if !a.existe(t, id) {
					t.Fatalf("a los %v la cuenta que autorizó después del aviso se borró", tras)
				}
			}
			if a.existe(t, control) {
				t.Error("la de control, que no autorizó, se borra a las 48 horas del aviso")
			}
			if n := len(a.avisosEnviados()["autoriza@ejemplo.test"]); n != 1 {
				t.Errorf("recibió %d avisos, se esperaba el de antes de autorizar", n)
			}
		})
	}
}

// S7 (3): el caso 1 (el correo sin confirmar) nunca recibe el aviso y se borra a los 7 días, como hoy. Tampoco la que ya
// autorizó algo, ni la que pasó de menor a adulta.
func TestElCaso1NuncaRecibeElAviso(t *testing.T) {
	ctx := context.Background()
	a := nuevoEntornoDeAviso(t)
	caso1 := a.sembrar(t, "sin-confirmar@ejemplo.test", ahora, false)
	caso1Autorizada := a.sembrar(t, "sin-confirmar-autorizada@ejemplo.test", ahora, false, "cuenta_y_acceso")
	yaAutorizo := a.sembrar(t, "ya-autorizo@ejemplo.test", ahora, true, "cuenta_y_acceso")
	// Una cuenta que pasó de menor a adulta, con el correo confirmado y ninguna autorización: no es de esta tarea.
	var pasada string
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa, creada_en) VALUES ('Mateo', 'adulta', $1) RETURNING id::text`, ahora).Scan(&pasada); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado, fecha_de_paso) VALUES ($1::uuid, 'paso@ejemplo.test', true, '2026-10-01')`, pasada); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	for _, tras := range []time.Duration{5 * dia, 6 * dia, 7*dia - time.Minute} {
		if a.corrida(t, ahora.Add(tras)) != 0 {
			t.Fatalf("a los %v no se borra nada", tras)
		}
	}
	if a.existe(t, caso1) == false || a.existe(t, caso1Autorizada) == false {
		t.Fatal("el caso 1 se borra a los 7 días, no antes")
	}
	if n := a.corrida(t, ahora.Add(7*dia)); n != 2 || a.existe(t, caso1) || a.existe(t, caso1Autorizada) {
		t.Fatalf("a los 7 días se borra el caso 1 (también el que tuviera autorizaciones): borradas %d", n)
	}
	a.corrida(t, ahora.Add(30*dia))
	if a.numeroDeAvisos() != 0 {
		t.Errorf("salieron %d avisos: ni el caso 1, ni la que ya autorizó, ni la que pasó de menor a adulta lo reciben (la última tampoco se borra)", a.numeroDeAvisos())
	}
	if !a.existe(t, yaAutorizo) || !a.existe(t, pasada) || a.avisoDe(t, pasada) != nil || a.avisoDe(t, yaAutorizo) != nil {
		t.Error("la que ya autorizó y la que pasó de menor a adulta ni se avisan ni se borran")
	}
}

// El aviso no sale antes de creada_en + 5 días (120 h).
func TestElAvisoNoSaleAntesDelDia5(t *testing.T) {
	a := nuevoEntornoDeAviso(t)
	id := a.sembrar(t, "dia5@ejemplo.test", ahora, true)
	a.corrida(t, ahora.Add(5*dia-time.Second))
	if a.numeroDeAvisos() != 0 || a.avisoDe(t, id) != nil {
		t.Fatal("a 1 s de las 120 horas todavía no sale")
	}
	a.corrida(t, ahora.Add(5*dia))
	if a.numeroDeAvisos() != 1 || a.avisoDe(t, id) == nil || !a.avisoDe(t, id).Equal(ahora.Add(5*dia)) {
		t.Fatalf("a las 120 horas justas sale el aviso, registrado en la hora de la pasada: %d, %v", a.numeroDeAvisos(), a.avisoDe(t, id))
	}
}

// S7 (4): sin autorizar, el aviso sale una sola vez aunque la tarea corra muchas veces: seguidas (cada 15 minutos) y a la vez.
func TestSinAutorizarElAvisoSaleUnaSolaVezAunqueLaTareaCorraMuchasVeces(t *testing.T) {
	a := nuevoEntornoDeAviso(t)
	id := a.sembrar(t, "una-vez@ejemplo.test", ahora, true)
	otra := a.sembrar(t, "otra-una-vez@ejemplo.test", ahora.Add(hora), true)
	primera := ahora.Add(5 * dia)
	for i := range 150 { // del día 5 al día 6 y medio, cada 15 minutos: ya se borraría el 7.º, pero el aviso espera las 48 horas
		if n := a.corrida(t, primera.Add(time.Duration(i)*15*time.Minute)); n != 0 {
			t.Fatalf("pasada %d: se borraron %d cuentas", i, n)
		}
	}
	for correo, fechas := range a.avisosEnviados() {
		if len(fechas) != 1 {
			t.Errorf("%s recibió %d avisos", correo, len(fechas))
		}
	}
	if a.numeroDeAvisos() != 2 {
		t.Fatalf("salieron %d avisos, se esperaban 2", a.numeroDeAvisos())
	}
	// El registro es el de la primera pasada: las siguientes no lo mueven.
	if en := a.avisoDe(t, id); en == nil || !en.Equal(primera) {
		t.Errorf("aviso registrado %v, se esperaba %v", en, primera)
	}
	if en := a.avisoDe(t, otra); en == nil || !en.Equal(primera.Add(hora)) { // creada una hora después: su día 5 llega una hora después
		t.Errorf("aviso registrado %v, se esperaba %v", en, primera.Add(hora))
	}
	// Y a la vez: ocho pasadas al mismo tiempo sobre una cuenta nueva mandan un solo correo.
	nueva := a.sembrar(t, "a-la-vez@ejemplo.test", primera.Add(-6*dia), true)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = a.tarea.BorrarCuentasSinConfirmar(context.Background(), primera.Add(2*dia)) //nolint:errcheck // se mira el resultado en la base y en el correo
		}()
	}
	wg.Wait()
	if n := len(a.avisosEnviados()["a-la-vez@ejemplo.test"]); n != 1 || a.avisoDe(t, nueva) == nil {
		t.Errorf("a la vez: %d avisos, se esperaba 1", n)
	}
	// Ya borradas las dos primeras, sigue sin salir ninguno más.
	antes := a.numeroDeAvisos()
	for i := range 10 {
		a.corrida(t, primera.Add(7*dia+time.Duration(i)*15*time.Minute))
	}
	if a.numeroDeAvisos() != antes {
		t.Errorf("salieron %d avisos de más", a.numeroDeAvisos()-antes)
	}
}

// S7 (5): la fecha del correo es la del borrado real: el aviso + 48 horas (que nunca es antes de creada_en + 7 días, porque
// el aviso sale desde el día 5). La cuenta sigue 1 segundo antes y se borra en ese momento.
func TestLaFechaDelCorreoEsLaDelBorradoReal(t *testing.T) {
	for nombre, c := range map[string]struct{ edad, pasada time.Duration }{
		"el día 5 justo":                            {5 * dia, 0},
		"a los 5 días y 7 horas":                    {5*dia + 7*hora, 0},
		"a los 6 días y 23 horas":                   {6*dia + 23*hora, 0},
		"a los 9 días (cuenta de antes del cambio)": {9 * dia, 0},
	} {
		t.Run(nombre, func(t *testing.T) {
			a := nuevoEntornoDeAviso(t)
			id := a.sembrar(t, "fecha@ejemplo.test", ahora.Add(-c.edad), true)
			if a.corrida(t, ahora) != 0 {
				t.Fatal("la primera pasada solo avisa")
			}
			fechas := a.avisosEnviados()["fecha@ejemplo.test"]
			if len(fechas) != 1 {
				t.Fatalf("avisos: %v", fechas)
			}
			creadaMas7, avisoMas48 := ahora.Add(-c.edad).Add(7*dia), ahora.Add(48*hora)
			esperada := creadaMas7
			if avisoMas48.After(esperada) {
				esperada = avisoMas48
			}
			if !fechas[0].Equal(esperada) {
				t.Fatalf("el correo dice %v, el borrado real es %v", fechas[0], esperada)
			}
			if a.corrida(t, fechas[0].Add(-time.Second)) != 0 || !a.existe(t, id) {
				t.Fatal("un segundo antes de la fecha del correo la cuenta sigue")
			}
			if a.corrida(t, fechas[0]) != 1 || a.existe(t, id) {
				t.Fatal("en el momento que dice el correo se borra")
			}
		})
	}
}

// S2 (5): las cuentas que ya pasaron el día 5 al desplegar reciben el aviso en la primera pasada y se borran 48 horas
// después, no antes.
func TestLasCuentasQueYaPasaronElDia5AlDesplegarReciebenElAvisoYSeBorran48HorasDespues(t *testing.T) {
	a := nuevoEntornoDeAviso(t)
	seis := a.sembrar(t, "seis-dias@ejemplo.test", ahora.Add(-6*dia), true)
	seisYMedio := a.sembrar(t, "seis-y-medio@ejemplo.test", ahora.Add(-6*dia-12*hora), true)
	nueve := a.sembrar(t, "nueve-dias@ejemplo.test", ahora.Add(-9*dia), true) // ya pasó el día 7 sin aviso (la de antes del despliegue)
	joven := a.sembrar(t, "cuatro-dias@ejemplo.test", ahora.Add(-4*dia), true)

	if n := a.corrida(t, ahora); n != 0 {
		t.Fatalf("la primera pasada solo avisa: borradas %d", n)
	}
	if a.numeroDeAvisos() != 3 || a.avisoDe(t, joven) != nil {
		t.Fatalf("la primera pasada avisa a las tres que ya pasaron el día 5 y no a la de 4 días: %d", a.numeroDeAvisos())
	}
	for _, id := range []string{seis, seisYMedio, nueve} {
		if en := a.avisoDe(t, id); en == nil || !en.Equal(ahora) {
			t.Errorf("aviso registrado %v", en)
		}
	}
	for correo, fechas := range a.avisosEnviados() {
		if len(fechas) != 1 || !fechas[0].Equal(ahora.Add(48*hora)) {
			t.Errorf("%s: el correo dice %v, se esperaba %v", correo, fechas, ahora.Add(48*hora))
		}
	}
	if n := a.corrida(t, ahora.Add(48*hora-time.Second)); n != 0 {
		t.Fatalf("un segundo antes de las 48 horas se borraron %d", n)
	}
	for _, id := range []string{seis, seisYMedio, nueve} {
		if !a.existe(t, id) {
			t.Fatal("antes de las 48 horas del aviso no se borra ninguna")
		}
	}
	if n := a.corrida(t, ahora.Add(48*hora)); n != 3 {
		t.Fatalf("a las 48 horas del aviso se borran las tres: %d", n)
	}
	if !a.existe(t, joven) {
		t.Error("la de 4 días sigue")
	}
	// La de 4 días recibe su aviso en su día 5 y se borra 48 horas después.
	a.corrida(t, ahora.Add(48*hora+hora)) // ahora + 49 h: ya tiene 5 días y 1 hora
	if a.avisoDe(t, joven) == nil {
		t.Error("la de 4 días, con 5 días y 1 hora, ya recibió su aviso")
	}
}

// S2 (2): si el envío falla, no se registra nada, la tarea sigue, queda un aviso en el registro (sin el correo) y la pasada
// siguiente lo reintenta; el envío de una cuenta que falla no impide el de las otras.
func TestSiElEnvioFallaNoSeRegistraYSeReintentaEnLaPasadaSiguiente(t *testing.T) {
	a := nuevoEntornoDeAviso(t)
	id := a.sembrar(t, "falla@ejemplo.test", ahora.Add(-6*dia), true)
	a.correo.Error = errors.New("servidor caído")
	if a.corrida(t, ahora) != 0 || a.corrida(t, ahora.Add(15*time.Minute)) != 0 {
		t.Fatal("no se borra nada")
	}
	if a.avisoDe(t, id) != nil || a.numeroDeAvisos() != 0 {
		t.Fatal("si el envío falla no se registra nada")
	}
	registro := a.registro.String()
	if c := strings.Count(registro, `"level":"WARN"`); c != 2 {
		t.Errorf("%d avisos en el registro, uno por intento: %s", c, registro)
	}
	if !strings.Contains(registro, id) || strings.Contains(registro, "falla@") || strings.Contains(registro, "ejemplo.test") {
		t.Errorf("el registro lleva el id y nunca el correo: %s", registro)
	}
	if strings.Contains(registro, `"level":"ERROR"`) {
		t.Errorf("un envío fallido es un aviso, no un error: %s", registro)
	}
	a.correo.Error = nil
	otra := a.sembrar(t, "otra@ejemplo.test", ahora.Add(-6*dia), true)
	retry := ahora.Add(30 * time.Minute)
	a.corrida(t, retry)
	for _, c := range []string{id, otra} {
		if en := a.avisoDe(t, c); en == nil || !en.Equal(retry) {
			t.Errorf("tras el reintento: %v", en)
		}
	}
	if a.numeroDeAvisos() != 2 {
		t.Errorf("salieron %d", a.numeroDeAvisos())
	}
}

// L5 (el dueño): el límite de 3 correos por hora a una dirección (D-172 (7)) no mira el aviso de la purga, ni este suma al
// contador de la dirección (D-203). Con una cuenta de verdad: los pedidos de la persona son «Crear la cuenta» con su correo
// ya verificado, que le manda el aviso de «alguien intentó crear una cuenta» (cuenta en el límite).
func TestElAvisoDePurgaNoPasaPorElLimiteDeCorreosPorHoraNiSumaAlContador(t *testing.T) {
	pedir := func(s *cuenta.Servicio, correo string) {
		t.Helper()
		if err := s.CrearCuenta(context.Background(), cuenta.SolicitudDeCuenta{Correo: correo, MayorDeEdad: true}); err != nil {
			t.Fatal(err)
		}
		s.Esperar()
	}
	delPedido := func(a *entornoDeAviso, correo string) int {
		n := 0
		for _, e := range a.correo.Enviados() {
			if e.Aviso && e.Destino == correo {
				n++
			}
		}
		return n
	}

	t.Run("con 3 pedidos en la última hora el aviso sale igual", func(t *testing.T) {
		a := nuevoEntornoDeAviso(t)
		id := a.sembrar(t, "limite-lleno@ejemplo.test", ahora.Add(-6*dia), true)
		s := a.tarea
		for range seguridad.CorreosPorDestino {
			pedir(s, "limite-lleno@ejemplo.test")
		}
		pedir(s, "limite-lleno@ejemplo.test")
		if n := delPedido(a, "limite-lleno@ejemplo.test"); n != seguridad.CorreosPorDestino {
			t.Fatalf("salieron %d correos del pedido, se esperaban %d: el límite está lleno", n, seguridad.CorreosPorDestino)
		}
		a.corrida(t, ahora)
		if a.avisoDe(t, id) == nil || len(a.avisosEnviados()["limite-lleno@ejemplo.test"]) != 1 {
			t.Fatalf("con el límite lleno el aviso sale y queda registrado: %v, %v", a.avisoDe(t, id), a.avisosEnviados())
		}
		pedir(s, "limite-lleno@ejemplo.test")
		if n := delPedido(a, "limite-lleno@ejemplo.test"); n != seguridad.CorreosPorDestino {
			t.Errorf("el aviso no reinicia el límite: salieron %d correos del pedido", n)
		}
	})

	t.Run("después del aviso la persona todavía puede pedir 3", func(t *testing.T) {
		a := nuevoEntornoDeAviso(t)
		id := a.sembrar(t, "limite-vacio@ejemplo.test", ahora.Add(-6*dia), true)
		s := a.tarea
		a.corrida(t, ahora)
		if a.avisoDe(t, id) == nil || len(a.avisosEnviados()["limite-vacio@ejemplo.test"]) != 1 {
			t.Fatal("debía salir el aviso")
		}
		for range seguridad.CorreosPorDestino {
			pedir(s, "limite-vacio@ejemplo.test")
		}
		if n := delPedido(a, "limite-vacio@ejemplo.test"); n != seguridad.CorreosPorDestino {
			t.Fatalf("tras el aviso salieron %d correos de 3 pedidos: el aviso sumó al contador de la dirección", n)
		}
		pedir(s, "limite-vacio@ejemplo.test")
		if n := delPedido(a, "limite-vacio@ejemplo.test"); n != seguridad.CorreosPorDestino {
			t.Errorf("el cuarto pedido de la hora no sale: %d", n)
		}
	})
}

// matoLaConexion es un correo que, al enviar, termina la conexión de la transacción que lo está esperando (la única
// «idle in transaction» de la base de la prueba): el correo sale y la escritura del aviso falla.
type matoLaConexion struct {
	*correotest.Falso
	pool interface {
		Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	}
	matar bool
}

func (m *matoLaConexion) EnviarAvisoDePurga(ctx context.Context, destino string, borradoEn time.Time) error {
	if err := m.Falso.EnviarAvisoDePurga(ctx, destino, borradoEn); err != nil {
		return err
	}
	if m.matar {
		_, err := m.pool.Exec(context.Background(),
			`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()`)
		return err
	}
	return nil
}

// S2 (6): si el correo sale y la escritura falla, no queda ningún aviso registrado y la pasada siguiente lo manda otra vez.
func TestSiElCorreoSaleYLaEscrituraFallaLaPasadaSiguienteLoManda(t *testing.T) {
	a := nuevoEntornoDeAviso(t)
	id := a.sembrar(t, "escritura@ejemplo.test", ahora.Add(-6*dia), true)
	mata := &matoLaConexion{Falso: a.correo, pool: a.pool, matar: true}
	a.tarea = a.servicioDeTareas(mata, 0)
	if _, err := a.tarea.BorrarCuentasSinConfirmar(context.Background(), ahora); err == nil {
		t.Fatal("la escritura del aviso falló: la tarea debe devolver el error de la base")
	}
	if a.numeroDeAvisos() != 1 {
		t.Fatalf("el correo salió: %d", a.numeroDeAvisos())
	}
	if a.avisoDe(t, id) != nil || !a.existe(t, id) {
		t.Fatal("la escritura falló: no queda aviso registrado y la cuenta sigue")
	}
	mata.matar = false
	if a.corrida(t, ahora.Add(15*time.Minute)) != 0 {
		t.Fatal("no se borra nada")
	}
	if en := a.avisoDe(t, id); en == nil || !en.Equal(ahora.Add(15*time.Minute)) || a.numeroDeAvisos() != 2 {
		t.Fatalf("la pasada siguiente lo manda otra vez y lo registra: aviso %v, correos %d", a.avisoDe(t, id), a.numeroDeAvisos())
	}
}

// Si la tarea se cancela (el contenedor se apaga), el repositorio no sigue con las cuentas que quedan ni deja nada registrado.
func TestUnaPasadaCanceladaNoSigueConLasDemasCuentas(t *testing.T) {
	a := nuevoEntornoDeAviso(t)
	a.sembrar(t, "cancela-1@ejemplo.test", ahora.Add(-6*dia), true)
	a.sembrar(t, "cancela-2@ejemplo.test", ahora.Add(-6*dia), true)
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	llamadas := 0
	avisadas, err := a.repo.AvisarAntesDeLaPurga(ctx, ahora.Add(-cuenta.PlazoParaAvisar), func(context.Context, cuenta.CuentaPorAvisar) (time.Time, error) {
		llamadas++
		cancelar()
		return time.Time{}, errors.New("cancelado")
	})
	if !errors.Is(err, context.Canceled) || avisadas != 0 || llamadas != 1 {
		t.Fatalf("avisadas %d, envíos %d, error %v", avisadas, llamadas, err)
	}
	if n := contar(t, a.pool, `SELECT count(*) FROM perfil_adulto WHERE aviso_de_purga_en IS NOT NULL`); n != 0 {
		t.Errorf("no debe quedar ningún aviso: %d", n)
	}
}

// Si un destinatario es rechazado, las otras cuentas igual reciben su aviso.
func TestUnEnvioQueFallaNoImpideElDeLasDemasCuentas(t *testing.T) {
	a := nuevoEntornoDeAviso(t)
	mala := a.sembrar(t, "a-rechazada@ejemplo.test", ahora.Add(-6*dia), true)
	buena := a.sembrar(t, "b-buena@ejemplo.test", ahora.Add(-6*dia), true)
	a.tarea = a.servicioDeTareas(&rechazaA{Falso: a.correo, destino: "a-rechazada@ejemplo.test"}, 0)
	a.corrida(t, ahora)
	if a.avisoDe(t, mala) != nil || a.avisoDe(t, buena) == nil {
		t.Fatalf("rechazada %v, buena %v", a.avisoDe(t, mala), a.avisoDe(t, buena))
	}
}

// rechazaA es un correo que rechaza el aviso a un destino y manda los demás.
type rechazaA struct {
	*correotest.Falso
	destino string
}

func (r *rechazaA) EnviarAvisoDePurga(ctx context.Context, destino string, borradoEn time.Time) error {
	if destino == r.destino {
		return errors.New("destinatario rechazado")
	}
	return r.Falso.EnviarAvisoDePurga(ctx, destino, borradoEn)
}

// S4: el envío con las filas bloqueadas tiene un tiempo de espera corto. Un servidor de correo que acepta la conexión y
// no responde hace fallar el envío dentro del plazo, no registra nada y deja las filas libres: otra transacción las puede
// bloquear después. Mientras el envío espera, las filas sí están bloqueadas (la prueba no vale si no lo estuvieran).
func TestUnServidorDeCorreoQueNoResponde(t *testing.T) {
	ctx := context.Background()
	a := nuevoEntornoDeAviso(t)
	id := a.sembrar(t, "cuelga@ejemplo.test", ahora.Add(-6*dia), true)

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	llego := make(chan struct{}, 4)
	var conexiones []net.Conn
	var mu sync.Mutex
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			conexiones = append(conexiones, c) // se acepta y no se dice nada
			mu.Unlock()
			llego <- struct{}{}
		}
	}()
	t.Cleanup(func() {
		mu.Lock()
		defer mu.Unlock()
		for _, c := range conexiones {
			c.Close()
		}
	})
	smtp := correo.NuevoSMTP(config.Config{
		CorreoSMTP: l.Addr().String(), CorreoRemitente: "no-responder@avisos.ejemplo.test",
		CorreoPrivacidad: "privacidad@ejemplo.test", URLPublica: "https://app.ejemplo.test",
	}, a.reloj)
	const plazo = 600 * time.Millisecond
	a.tarea = a.servicioDeTareas(smtp, plazo)

	salio := make(chan time.Duration, 1)
	fallo := make(chan error, 1)
	inicio := time.Now()
	go func() {
		_, err := a.tarea.BorrarCuentasSinConfirmar(ctx, ahora)
		fallo <- err
		salio <- time.Since(inicio)
	}()
	select {
	case <-llego:
	case <-time.After(10 * time.Second):
		t.Fatal("la tarea no llegó a conectarse al servidor de correo")
	}
	// Con el envío en curso, la fila de la persona y la de su perfil están bloqueadas.
	otra, err := a.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`SELECT 1 FROM persona WHERE id = $1::uuid FOR UPDATE NOWAIT`,
		`SELECT 1 FROM perfil_adulto WHERE persona_id = $1::uuid FOR UPDATE NOWAIT`,
	} {
		_, err := otra.Exec(ctx, q, id)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "55P03" {
			t.Errorf("con el envío en curso las filas deben estar bloqueadas (%s): %v", q, err)
		}
		if err := otra.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		if otra, err = a.pool.Begin(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if err := otra.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	select {
	case err := <-fallo:
		if err != nil {
			t.Fatalf("un envío que falla no hace fallar la tarea: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("la tarea sigue esperando al servidor de correo")
	}
	if tardo := <-salio; tardo < plazo || tardo > 5*time.Second {
		t.Errorf("la tarea tardó %v con un plazo de %v", tardo, plazo)
	}
	if a.avisoDe(t, id) != nil {
		t.Fatal("el envío falló: no se registra el aviso")
	}
	if !strings.Contains(a.registro.String(), `"level":"WARN"`) || strings.Contains(a.registro.String(), "cuelga@") {
		t.Errorf("registro: %s", a.registro)
	}
	// Las filas quedaron libres: otra transacción las bloquea sin esperar.
	libre, err := a.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`SELECT 1 FROM persona WHERE id = $1::uuid FOR UPDATE NOWAIT`,
		`SELECT 1 FROM perfil_adulto WHERE persona_id = $1::uuid FOR UPDATE NOWAIT`,
		`UPDATE perfil_adulto SET aviso_de_purga_en = NULL WHERE persona_id = $1::uuid`,
	} {
		if _, err := libre.Exec(ctx, q, id); err != nil {
			t.Errorf("las filas debían quedar libres (%s): %v", q, err)
		}
	}
	if err := libre.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	// Y la pasada siguiente, con el servidor sano, manda el aviso.
	a.tarea = a.servicioDeTareas(a.correo, 0)
	a.corrida(t, ahora.Add(15*time.Minute))
	if a.avisoDe(t, id) == nil || a.numeroDeAvisos() != 1 {
		t.Error("la pasada siguiente reintenta y avisa")
	}
}

// S2 (4): la condición del caso 2 se vuelve a evaluar con la fila bloqueada, antes de enviar. Un otorgamiento en curso tiene
// la fila de la persona y escribe en `autorizacion` (que no tiene llave a persona): la pasada elige a la cuenta, espera el
// bloqueo y, al confirmarse el otorgamiento, ya no la avisa ni la marca.
func TestElAvisoVuelveAEvaluarElCasoConLaFilaBloqueada(t *testing.T) {
	ctx := context.Background()
	a := nuevoEntornoDeAviso(t)
	id := a.sembrar(t, "otorga@ejemplo.test", ahora.Add(-6*dia), true)

	otorgamiento, err := a.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := otorgamiento.Exec(ctx, `SELECT 1 FROM persona WHERE id = $1::uuid FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := otorgamiento.Exec(ctx,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en)
		 VALUES ($1::uuid, $1::uuid, 'cuenta_y_acceso', '1.1 del 2026-11-12', $2)`, id, ahora); err != nil {
		t.Fatal(err)
	}
	terminada := make(chan error, 1)
	go func() {
		_, err := a.tarea.BorrarCuentasSinConfirmar(ctx, ahora)
		terminada <- err
	}()
	// Espera a que la pasada esté esperando el bloqueo de la fila.
	esperando := false
	for range 200 {
		if contar(t, a.pool, `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`) > 0 {
			esperando = true
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !esperando {
		t.Fatal("la pasada no llegó a esperar el bloqueo de la fila")
	}
	if err := otorgamiento.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-terminada; err != nil {
		t.Fatal(err)
	}
	if a.numeroDeAvisos() != 0 || a.avisoDe(t, id) != nil {
		t.Fatalf("la cuenta autorizó mientras la pasada esperaba: no se avisa ni se marca (avisos %d, marca %v)", a.numeroDeAvisos(), a.avisoDe(t, id))
	}
	if !a.existe(t, id) {
		t.Fatal("la cuenta sigue")
	}
}
