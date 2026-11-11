//go:build integration

package app_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/app"
	"github.com/alcanzamos/alcanzamos/api/src/argon2id"
	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

// servir arma el API de verdad sobre la base y devuelve cómo llamarlo y el registro, que se llena solo.
func servir(t *testing.T, pool *pgxpool.Pool) (llamar func(metodo, ruta, cuerpo string, cookies ...*http.Cookie) *httptest.ResponseRecorder, registro *bytes.Buffer) {
	t.Helper()
	ctx := context.Background()
	entorno := map[string]string{
		"CORREO_SMTP": "127.0.0.1:1", "CORREO_REMITENTE": "a@b.test", "CORREO_PRIVACIDAD": "p@b.test",
		"URL_PUBLICA": "https://app.b.test",
	}
	cfg, err := config.Cargar(func(k string) string { return entorno[k] })
	if err != nil {
		t.Fatal(err)
	}
	registro = &bytes.Buffer{}
	enrutador, esperar, err := app.ArmarEnrutador(ctx, cfg, pool, slog.New(slog.NewJSONHandler(registro, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(esperar)
	api, err := enrutador.Construir()
	if err != nil {
		t.Fatal(err)
	}
	h := csrftest.ConCabeceras(servidor.ManejadorConAPI(api))
	llamar = func(metodo, ruta, cuerpo string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
		r.RemoteAddr = "203.0.113.7:4321"
		for _, c := range cookies {
			r.AddCookie(c)
		}
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		return rr
	}

	return llamar, registro
}

// US-53 de punta a punta, con el servidor armado de verdad y una base propia: entrar, borrar la cuenta, y comprobar
// que la sesión, la cookie y la cuenta ya no sirven y que no quedó ningún dato personal en el registro.
func TestBorrarLaCuentaDePuntaAPunta(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	const correo, clave = "laura@ejemplo.test", "lluvia café tren azul"
	hash, err := argon2id.Predeterminado().Hashear(ctx, clave)
	if err != nil {
		t.Fatal(err)
	}
	var persona string
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa) VALUES ('Laura', 'adulta') RETURNING id::text`).Scan(&persona); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, '` + correo + `', true)`,
		`INSERT INTO credencial (persona_id, hash) VALUES ($1::uuid, '` + hash + `')`,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, 'cuenta_y_acceso', '1.0', now() - interval '1 day')`,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, 'funciones_financieras', '1.0', now() - interval '1 day')`,
		`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, 'gasto', 1000, current_date, 'efectivo', 'mercado', 1)`,
	} {
		if _, err := tx.Exec(ctx, q, persona); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	llamar, registro := servir(t, pool)

	entrada := llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+clave+`"}`)
	if entrada.Code != 200 || len(entrada.Result().Cookies()) != 1 {
		t.Fatalf("entrar: %d %s", entrada.Code, entrada.Body)
	}
	cookie := entrada.Result().Cookies()[0]
	otraEntrada := llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+clave+`"}`)
	otraCookie := otraEntrada.Result().Cookies()[0]

	if rr := llamar("GET", "/api/v1/cuenta/borrado", "", cookie); rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"hogar":null,"menores":[]}` {
		t.Fatalf("resumen: %d %s", rr.Code, rr.Body)
	}
	if rr := llamar("POST", "/api/v1/cuenta/borrado", `{"contrasena":"otra clave distinta"}`, cookie); rr.Code != 400 {
		t.Fatalf("contraseña mal: %d %s", rr.Code, rr.Body)
	}
	if n := cuentaDe(t, pool, persona); n != 1 {
		t.Fatal("con la contraseña mal no se borra nada")
	}

	rr := llamar("POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+clave+`"}`, cookie)
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"cuenta_borrada"}` {
		t.Fatalf("borrar: %d %s", rr.Code, rr.Body)
	}
	if cs := rr.Result().Cookies(); len(cs) != 1 || cs[0].MaxAge >= 0 || cs[0].Value != "" {
		t.Errorf("la cookie se manda a borrar: %+v", cs)
	}
	if n := cuentaDe(t, pool, persona); n != 0 {
		t.Error("la cuenta sigue")
	}
	for _, tabla := range []string{"movimiento", "credencial", "perfil_adulto", "sesion"} {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM `+tabla).Scan(&n); err != nil || n != 0 {
			t.Errorf("%s: quedan %d filas (%v)", tabla, n, err)
		}
	}
	var retiradas int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NOT NULL AND conservar_hasta > current_date + interval '2 years'`, persona).Scan(&retiradas)
	if retiradas != 2 {
		t.Errorf("la prueba mínima de las autorizaciones: %d", retiradas)
	}

	// Ninguna sesión sirve, la que borró ni la del otro dispositivo; ni se puede entrar, ni borrar otra vez.
	for _, c := range []*http.Cookie{cookie, otraCookie} {
		if rr := llamar("GET", "/api/v1/cuenta/borrado", "", c); rr.Code != 401 {
			t.Errorf("la sesión sigue sirviendo: %d", rr.Code)
		}
	}
	if rr := llamar("POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+clave+`"}`, cookie); rr.Code != 401 {
		t.Errorf("segunda vez: %d", rr.Code)
	}
	if rr := llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+clave+`"}`); rr.Code != 401 {
		t.Errorf("entrar con la cuenta borrada: %d", rr.Code)
	}

	// E17-ECO 3.13: ni el correo, ni la contraseña, ni lo que escribió, ni el token quedaron en el registro. El id
	// interno de la cuenta solo puede estar en un evento de seguridad (el de la contraseña mal escrita).
	for _, dato := range []string{correo, clave, "otra clave distinta", "mercado", "Laura", cookie.Value} {
		if strings.Contains(registro.String(), dato) {
			t.Errorf("el registro lleva %q:\n%s", dato, registro)
		}
	}
	for _, linea := range strings.Split(registro.String(), "\n") {
		if strings.Contains(linea, persona) && !strings.Contains(linea, `"evento_seguridad"`) {
			t.Errorf("el id de la cuenta fuera de un evento de seguridad: %s", linea)
		}
	}
}

func cuentaDe(t *testing.T, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, persona string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM persona WHERE id = $1::uuid`, persona).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// US-53 con un hogar y menores, de punta a punta por HTTP y PostgreSQL: el resumen trae a quienes dependen solo de ella
// con su id; si cambian los menores entre el resumen y el borrado, 409 sin borrar nada; con los menores a la vista y la
// casilla marcada, borra a Laura y a sus menores, cierra el hogar y no deja nombres ni correos en el registro.
func TestBorrarConHogarYMenoresDePuntaAPunta(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	const correo, clave = "laura@ejemplo.test", "lluvia café tren azul"
	hash, err := argon2id.Predeterminado().Hashear(ctx, clave)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	persona := func(nombre, etapa string) string {
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa) VALUES ($1, $2) RETURNING id::text`, nombre, etapa).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids[nombre] = id
		return id
	}
	sql := func(q string, args ...any) {
		if _, err := tx.Exec(ctx, q, args...); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
	}
	laura, camilo := persona("Laura", "adulta"), persona("Camilo", "adulta")
	mateo, sofia := persona("Mateo", "menor"), persona("Sofía", "menor")
	sql(`INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, $2, true)`, laura, correo)
	sql(`INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, 'camilo@ejemplo.test', true)`, camilo)
	sql(`INSERT INTO credencial (persona_id, hash) VALUES ($1::uuid, $2)`, laura, hash)
	sql(`INSERT INTO credencial (persona_id, hash) VALUES ($1::uuid, $2)`, camilo, hash)
	for _, m := range [][2]string{{mateo, "mateo.p"}, {sofia, "sofia.p"}} {
		sql(`INSERT INTO perfil_menor (persona_id, nombre_de_usuario) VALUES ($1::uuid, $2)`, m[0], m[1])
		sql(`INSERT INTO nacimiento_menor (persona_id, valor_cifrado, version_clave) VALUES ($1::uuid, decode(repeat('ab', 38), 'hex'), 1)`, m[0])
		sql(`INSERT INTO credencial (persona_id, hash) VALUES ($1::uuid, $2)`, m[0], hash)
	}
	var hogar string
	if err := tx.QueryRow(ctx, `INSERT INTO hogar (nombre, creado_en, administrador_id) VALUES ('Nuestro hogar', current_date, $1::uuid) RETURNING id::text`, laura).Scan(&hogar); err != nil {
		t.Fatal(err)
	}
	for i, p := range []string{laura, camilo, mateo, sofia} {
		sql(`INSERT INTO miembro_hogar (persona_id, hogar_id, desde) VALUES ($1::uuid, $2::uuid, now() + $3 * interval '1 minute')`, p, hogar, i)
	}
	for _, par := range [][2]string{{laura, mateo}, {laura, sofia}, {camilo, sofia}} {
		sql(`INSERT INTO tutoria (tutor_id, menor_id, declaro_escuchar_al_menor, declaro_representacion, autorizacion_expresa, version_declaracion, inicio) VALUES ($1::uuid, $2::uuid, true, true, true, '1.0', current_date)`, par[0], par[1])
	}
	for _, f := range []string{"cuenta_y_acceso", "funciones_financieras"} {
		sql(`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, $2, '1.0', now() - interval '1 day')`, laura, f)
	}
	sql(`INSERT INTO movimiento (persona_id, hogar_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, $2::uuid, 'gasto', 80000, current_date, 'efectivo', 'arriendo de enero', 4)`, laura, hogar)
	sql(`INSERT INTO movimiento (persona_id, hogar_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, $2::uuid, 'gasto', 5, current_date, 'efectivo', 'secreto de Camilo', 4)`, camilo, hogar)
	sql(`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, 'gasto', 6, current_date, 'efectivo', 'secreto de Sofía', 1)`, sofia)
	sql(`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, 'ingreso', 150000, current_date, 'transferencia', 'sueldo de Laura', 17)`, laura)
	sql(`INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, 8, '2026-10-01', 4000000)`, laura)
	sql(`INSERT INTO presupuesto_en_cero (persona_id, periodo) VALUES ($1::uuid, '2026-09-01')`, laura)
	sql(`INSERT INTO presupuesto (persona_id, hogar_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, $2::uuid, 3, '2026-10-01', 7)`, camilo, hogar)
	sql(`INSERT INTO presupuesto_en_cero (persona_id, periodo) VALUES ($1::uuid, '2026-08-01')`, camilo)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	llamar, registro := servir(t, pool)
	entrada := llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+clave+`"}`)
	if entrada.Code != 200 {
		t.Fatalf("entrar: %d %s", entrada.Code, entrada.Body)
	}
	cookie := entrada.Result().Cookies()[0]

	// «Descargar mis datos»: cuatro CSV, y en movimientos solo lo que Laura registró, sin nada de las demás personas.
	descarga := llamar("GET", "/api/v1/cuenta/datos", "", cookie)
	if descarga.Code != 200 || descarga.Header().Get("Content-Type") != "application/zip" || descarga.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("descarga: %d %v", descarga.Code, descarga.Header())
	}
	z, err := zip.NewReader(bytes.NewReader(descarga.Body.Bytes()), int64(descarga.Body.Len()))
	if err != nil || len(z.File) != 4 {
		t.Fatalf("ZIP: %v %d", err, len(z.File))
	}
	todo := ""
	for _, f := range z.File {
		r, _ := f.Open()
		crudo, _ := io.ReadAll(r)
		r.Close()
		todo += string(crudo)
		if f.Name == "movimientos.csv" {
			if n := strings.Count(string(crudo), "\n"); n != 3 {
				t.Errorf("movimientos.csv: %d líneas, se esperaban el encabezado y 2 movimientos de Laura:\n%s", n, crudo)
			}
		}
		// El presupuesto de Laura y el mes que dejó en cero (L6 (5) de la US-77); nada de Camilo.
		if quiere := "\xEF\xBB\xBFperiodo,categoria,monto_asignado_en_pesos\n2026-09,,0.00\n2026-10,Transporte,40000.00\n"; f.Name == "presupuestos.csv" && string(crudo) != quiere {
			t.Errorf("presupuestos.csv:\n%q\nse esperaba\n%q", crudo, quiere)
		}
	}
	for _, quiere := range []string{"arriendo de enero", "sueldo de Laura", "1500.00", "Salario", "800.00"} {
		if !strings.Contains(todo, quiere) {
			t.Errorf("la descarga no trae %q:\n%s", quiere, todo)
		}
	}
	for _, ajeno := range []string{"secreto", "Camilo", "Sofía", "Mateo", camilo, sofia, mateo, hogar, laura, "Ropa y calzado", "2026-08"} {
		if strings.Contains(todo, ajeno) {
			t.Errorf("la descarga lleva %q", ajeno)
		}
	}

	var resumen struct {
		Hogar struct {
			Nombre             string `json:"nombre"`
			EsAdministradora   bool   `json:"es_administradora"`
			NuevoAdministrador string `json:"nuevo_administrador"`
		} `json:"hogar"`
		Menores []struct{ ID, Nombre string } `json:"menores"`
	}
	leer := func() {
		t.Helper()
		resumen.Menores, resumen.Hogar.NuevoAdministrador = nil, ""
		rr := llamar("GET", "/api/v1/cuenta/borrado", "", cookie)
		if rr.Code != 200 || json.Unmarshal(rr.Body.Bytes(), &resumen) != nil {
			t.Fatalf("resumen: %d %s", rr.Code, rr.Body)
		}
	}
	leer()
	if resumen.Hogar.Nombre != "Nuestro hogar" || !resumen.Hogar.EsAdministradora || resumen.Hogar.NuevoAdministrador != "Camilo" ||
		len(resumen.Menores) != 1 || resumen.Menores[0].ID != mateo || resumen.Menores[0].Nombre != "Mateo" {
		t.Fatalf("resumen: %+v", resumen)
	}

	// Camilo se va: Sofía queda a cargo solo de Laura, que no lo vio en su pantalla.
	if _, err := pool.Exec(ctx, `DELETE FROM persona WHERE id = $1::uuid`, camilo); err != nil {
		t.Fatal(err)
	}
	personas := func() int { return cuentaDe(t, pool, laura) + cuentaDe(t, pool, mateo) + cuentaDe(t, pool, sofia) }
	rr := llamar("POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+clave+`","confirma_menores":true,"menores":["`+mateo+`"]}`, cookie)
	if rr.Code != 409 || strings.TrimSpace(rr.Body.String()) != `{"error":"menores_cambiaron"}` || rr.Header().Get("Set-Cookie") != "" {
		t.Fatalf("menores que cambiaron: %d %s", rr.Code, rr.Body)
	}
	if personas() != 3 {
		t.Fatal("con el 409 no se borra a nadie, y menos a Sofía")
	}

	leer()
	if len(resumen.Menores) != 2 || resumen.Menores[0].ID != mateo || resumen.Menores[1].ID != sofia || resumen.Hogar.NuevoAdministrador != "" {
		t.Fatalf("resumen tras el cambio: %+v", resumen)
	}
	vistos := `"menores":["` + mateo + `","` + sofia + `"]`
	// RN-006: con menores a cargo, sin la confirmación completa el API rechaza y no borra nada, aunque la contraseña sea buena.
	for nombre, cuerpo := range map[string]string{
		"sin la casilla ni la lista":         `{"contrasena":"` + clave + `"}`,
		"con la casilla y sin la lista":      `{"contrasena":"` + clave + `","confirma_menores":true}`,
		"con la casilla y la lista corta":    `{"contrasena":"` + clave + `","confirma_menores":true,"menores":["` + mateo + `"]}`,
		"con la lista y sin la casilla":      `{"contrasena":"` + clave + `",` + vistos + `}`,
		"con la lista y la casilla en falso": `{"contrasena":"` + clave + `","confirma_menores":false,` + vistos + `}`,
		"con una lista vacía":                `{"contrasena":"` + clave + `","confirma_menores":true,"menores":[]}`,
	} {
		rr := llamar("POST", "/api/v1/cuenta/borrado", cuerpo, cookie)
		if (rr.Code != 409 && rr.Code != 422) || rr.Header().Get("Set-Cookie") != "" || personas() != 3 {
			t.Errorf("%s: %d %s (personas %d)", nombre, rr.Code, rr.Body, personas())
		}
	}
	if rr := llamar("POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+clave+`",`+vistos+`}`, cookie); rr.Code != 422 || !strings.Contains(rr.Body.String(), "confirmacion_requerida") || personas() != 3 {
		t.Fatalf("sin marcar la casilla: %d %s", rr.Code, rr.Body)
	}
	rr = llamar("POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+clave+`","confirma_menores":true,`+vistos+`}`, cookie)
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"cuenta_borrada"}` {
		t.Fatalf("borrar: %d %s", rr.Code, rr.Body)
	}
	if personas() != 0 {
		t.Error("se borran Laura y sus dos menores")
	}
	for tabla, n := range map[string]int{"hogar": 0, "miembro_hogar": 0, "tutoria": 0, "movimiento": 0, "sesion": 0, "perfil_menor": 0, "credencial": 0} {
		var quedan int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM `+tabla).Scan(&quedan); err != nil || quedan != n {
			t.Errorf("%s: %d filas (%v)", tabla, quedan, err)
		}
	}
	if rr := llamar("POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+clave+`"}`, cookie); rr.Code != 401 {
		t.Errorf("segunda vez: %d", rr.Code)
	}

	// E17-ECO 3.13: ni correos, ni nombres, ni lo que escribió, ni ids de personas, ni el token en el registro.
	for _, dato := range []string{correo, "camilo@", clave, "Laura", "Camilo", "Mateo", "Sofía", "arriendo", cookie.Value, laura, mateo, sofia} {
		if strings.Contains(registro.String(), dato) {
			t.Errorf("el registro lleva %q:\n%s", dato, registro)
		}
	}
}
