//go:build integration

package app_test

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/quotedprintable"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/app"
	"github.com/alcanzamos/alcanzamos/api/src/config"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// buzonSEG006 es un servidor SMTP de mentira que acepta todo y guarda el cuerpo de cada mensaje, ya sin quoted-printable:
// la prueba saca de ahí los enlaces de verificación y de recuperación, como la persona los abre desde su correo.
type buzonSEG006 struct {
	mu        sync.Mutex
	mensajes  []string
	direccion string
}

func nuevoBuzonSEG006(t *testing.T) *buzonSEG006 {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	b := &buzonSEG006{direccion: l.Addr().String()}
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go b.atender(c)
		}
	}()
	return b
}

func (b *buzonSEG006) atender(c net.Conn) {
	defer c.Close()
	r := bufio.NewReader(c)
	responder := func(s string) { _, _ = io.WriteString(c, s+"\r\n") }
	responder("220 buzón de prueba")
	for {
		linea, err := r.ReadString('\n')
		if err != nil {
			return
		}
		switch orden := strings.ToUpper(strings.TrimRight(linea, "\r\n")); {
		case strings.HasPrefix(orden, "DATA"):
			responder("354 siga")
			var datos strings.Builder
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if l == ".\r\n" {
					break
				}
				datos.WriteString(strings.TrimPrefix(l, "."))
			}
			_, cuerpo, _ := strings.Cut(datos.String(), "\r\n\r\n")
			texto, err := io.ReadAll(quotedprintable.NewReader(strings.NewReader(cuerpo)))
			if err == nil {
				b.mu.Lock()
				b.mensajes = append(b.mensajes, string(texto))
				b.mu.Unlock()
			}
			responder("250 recibido")
		case strings.HasPrefix(orden, "QUIT"):
			responder("221 adiós")
			return
		default:
			responder("250 bien")
		}
	}
}

// token espera, hasta 10 s, un correo con un enlace `<ruta>?t=<token>` y devuelve el token del último.
func (b *buzonSEG006) token(t *testing.T, ruta string) string {
	t.Helper()
	enlace := regexp.MustCompile(regexp.QuoteMeta(ruta) + `\?t=([A-Za-z0-9_-]+)`)
	for limite := time.Now().Add(10 * time.Second); time.Now().Before(limite); time.Sleep(20 * time.Millisecond) {
		b.mu.Lock()
		for i := len(b.mensajes) - 1; i >= 0; i-- {
			if m := enlace.FindStringSubmatch(b.mensajes[i]); m != nil {
				b.mu.Unlock()
				return m[1]
			}
		}
		b.mu.Unlock()
	}
	t.Fatalf("no llegó ningún correo con %s", ruta)
	return ""
}

// camposDeUnEvento son los de E17-VTE 2.1, y ninguno más (seguridad.Registro).
var camposDeUnEvento = []string{"time", "level", "msg", "evento_seguridad", "cuenta", "ruta", "codigo", "peticion"}

// SEG-006 (RNF-025, T-28, NM-16): inicios fallidos repetidos, accesos denegados y errores de autorización quedan
// registrados sin contraseñas, montos ni textos. Arma el API de producción (`app.ArmarEnrutador`) sobre una base propia,
// con el registro capturado y un buzón SMTP de mentira, y recorre de verdad todo lo que deja eventos de seguridad o pasa
// por ellos: crear la cuenta y confirmarla con el enlace del correo (también con un enlace falso y una contraseña que no
// cumple), una ruta sin autorizar, autorizar, registrar y corregir un movimiento con descripción, interpretar un texto,
// rechazos de CSRF con montos y textos en el cuerpo, «No autorizo» ya autorizada, inicios fallidos hasta el 429, entrar en
// la web y en Android, Bearer falso, cambiar la contraseña (mal y bien), recuperar el acceso (enlace falso y bueno), cerrar
// la sesión y usarla después, y borrar la cuenta con la contraseña mal y bien.
//
// Comprueba: (1) salió cada evento esperado (tipo, ruta y código); (2) cada evento lleva solo los campos de E17-VTE 2.1,
// con la ruta como patrón registrado (sin ids) y la cuenta desconocida o el id de la persona; (3) ninguna línea del
// registro, sea evento o no, lleva una contraseña, un token (de sesión, de los enlaces o falso), un monto, la descripción,
// el texto interpretado, el nombre, el correo ni la dirección IP; (4) el id de la persona solo aparece en eventos.
func TestSEG_006LosEventosDeSeguridadNoLlevanContrasenasTokensMontosNiTextos(t *testing.T) {
	ctx, cancelar := context.WithCancel(context.Background())
	pool := pgtest.Nueva(t)
	buzon := nuevoBuzonSEG006(t)
	cfg, err := config.Cargar(func(k string) string {
		return map[string]string{
			"CORREO_SMTP": buzon.direccion, "CORREO_REMITENTE": "a@b.test", "CORREO_PRIVACIDAD": "p@b.test",
			"URL_PUBLICA": urlPublicaDePrueba,
		}[k]
	})
	if err != nil {
		t.Fatal(err)
	}
	registro := &vBuf{}
	e, esperar, err := app.ArmarEnrutador(ctx, cfg, pool, slog.New(slog.NewJSONHandler(registro, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cancelar(); esperar() })
	api, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	h := servidor.ManejadorConAPI(api)

	const (
		correo         = "rosalba.quintero.seg006@ejemplo.test"
		nombre         = "Rosalba Quintero"
		clave          = "nube verde canoa trompeta"
		claveNueva     = "jirafa lenta bajo lluvia"
		claveRecobrada = "faro dorado sobre colina"
		claveMala      = "esta no es mi clave de verdad"
		claveCorta     = "sol1234"
		tokenFalso     = "c2VnMDA2LWVzdGUtdG9rZW4tbm8tZXhpc3RlLW51bmNhIQ"   // gitleaks:allow (token inventado para la prueba)
		otroTokenFalso = "b3Ryby10b2tlbi1mYWxzby1kZS1zZWctMDA2LXBhcmEtdmVy" // gitleaks:allow (token inventado para la prueba)
		descripcion    = "arepas de la tía Rosalba en el mercado"
		correccion     = "cumpleaños de Fabiola con torta de guayaba"
		texto          = "pagué 4.821.397 en zapatos para Mateo"
		monto          = "48213977" // centavos: $482.139,77
		montoCorregido = "73915533"
	)
	secretos := []string{
		correo, "rosalba", "quintero", clave, claveNueva, claveRecobrada, claveMala, claveCorta, tokenFalso, otroTokenFalso,
		descripcion, "arepas", correccion, "fabiola", "guayaba", texto, "zapatos", "mateo",
		monto, "482139", "482.139", montoCorregido, "739155", "739.155", "4.821.397", "4821397",
		"203.0.113.",
	}

	type opcion func(*http.Request)
	conCookie := func(c *http.Cookie) opcion { return func(r *http.Request) { r.AddCookie(c) } }
	conCabecera := func(k, v string) opcion { return func(r *http.Request) { r.Header.Set(k, v) } }
	sinCabecera := func(k string) opcion { return func(r *http.Request) { r.Header.Del(k) } }
	// pedir hace el pedido como la web (mismo origen, JSON) desde una dirección de documentación (RFC 5737).
	pedir := func(metodo, ruta, cuerpo, ip string, opciones ...opcion) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
		r.RemoteAddr = "203.0.113." + ip + ":4321"
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Sec-Fetch-Site", "same-origin")
		for _, o := range opciones {
			o(r)
		}
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		return rr
	}
	debe := func(que string, rr *httptest.ResponseRecorder, codigo int) {
		t.Helper()
		if rr.Code != codigo {
			t.Fatalf("%s: %d %s, se esperaba %d", que, rr.Code, rr.Body, codigo)
		}
	}
	cookieDe := func(que string, rr *httptest.ResponseRecorder) *http.Cookie {
		t.Helper()
		cs := rr.Result().Cookies()
		if len(cs) != 1 || cs[0].Value == "" {
			t.Fatalf("%s: sin la cookie de sesión: %v", que, rr.Header())
		}
		secretos = append(secretos, cs[0].Value)
		return cs[0]
	}
	entrar := func(que, contrasena, ip string) *http.Cookie {
		t.Helper()
		rr := pedir("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+contrasena+`"}`, ip)
		debe(que, rr, 200)
		return cookieDe(que, rr)
	}

	// Crear la cuenta y confirmarla con el enlace del correo (PN-58, PN-74): un enlace falso y una contraseña corta antes.
	debe("crear la cuenta", pedir("POST", "/api/v1/cuentas", `{"correo":"`+correo+`","mayor_de_edad":true}`, "1"), 202)
	esperar()
	verificacion := buzon.token(t, "/verificar")
	secretos = append(secretos, verificacion)
	debe("enlace falso", pedir("POST", "/api/v1/cuentas/verificacion", `{"token":"`+tokenFalso+`","contrasena":"`+clave+`","nombre":"`+nombre+`"}`, "1"), 400)
	debe("contraseña corta", pedir("POST", "/api/v1/cuentas/verificacion", `{"token":"`+verificacion+`","contrasena":"`+claveCorta+`","nombre":"`+nombre+`"}`, "1"), 422)
	rr := pedir("POST", "/api/v1/cuentas/verificacion", `{"token":"`+verificacion+`","contrasena":"`+clave+`","nombre":"`+nombre+`"}`, "1")
	debe("confirmar la cuenta", rr, 200)
	sesion := cookieDe("confirmar la cuenta", rr)
	var persona string
	if err := pool.QueryRow(ctx, `SELECT persona_id::text FROM perfil_adulto WHERE correo = $1`, correo).Scan(&persona); err != nil {
		t.Fatal(err)
	}

	// Sin autorizar, una ruta que la pide: acceso_denegado. Después autoriza (PN-64).
	debe("categorías sin autorizar", pedir("GET", "/api/v1/categorias", "", "2", conCookie(sesion)), 403)
	debe("autorizar", pedir("POST", "/api/v1/autorizaciones", `{"finalidades":["cuenta_y_acceso","funciones_financieras"],"version":"1.0"}`, "2", conCookie(sesion)), 200)

	// Registrar, corregir e interpretar: montos y textos libres en el cuerpo.
	rr = pedir("GET", "/api/v1/categorias", "", "2", conCookie(sesion))
	debe("categorías", rr, 200)
	var catalogo struct {
		Gasto []struct {
			ID int `json:"id"`
		} `json:"gasto"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &catalogo); err != nil || len(catalogo.Gasto) == 0 {
		t.Fatalf("catálogo: %v %s", err, rr.Body)
	}
	categoria := strconv.Itoa(catalogo.Gasto[0].ID)
	hoy := vHoy().Format("2006-01-02")
	movimiento := `{"tipo":"gasto","monto_centavos":` + monto + `,"fecha":"` + hoy + `","categoria_id":` + categoria + `,"medio":"efectivo","descripcion":"` + descripcion + `"}`
	rr = pedir("POST", "/api/v1/movimientos", movimiento, "2", conCookie(sesion))
	debe("registrar", rr, 201)
	var creado struct {
		MovimientoID string `json:"movimiento_id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &creado); err != nil || creado.MovimientoID == "" {
		t.Fatalf("registrar: %v %s", err, rr.Body)
	}
	corregido := `{"tipo":"gasto","monto_centavos":` + montoCorregido + `,"fecha":"` + hoy + `","categoria_id":` + categoria + `,"medio":"transferencia","descripcion":"` + correccion + `"}`
	debe("corregir", pedir("PUT", "/api/v1/movimientos/"+creado.MovimientoID, corregido, "2", conCookie(sesion)), 200)
	debe("monto inválido", pedir("POST", "/api/v1/movimientos", strings.Replace(movimiento, monto, "-"+monto, 1), "2", conCookie(sesion)), 422)
	debe("interpretar", pedir("POST", "/api/v1/movimientos/interpretacion", `{"texto":"`+texto+`"}`, "2", conCookie(sesion)), 200)

	// Rechazos de CSRF (E17 3.15) con el monto y el texto en el cuerpo: ni pasan ni quedan en el registro.
	debe("CSRF de otro sitio", pedir("POST", "/api/v1/movimientos", movimiento, "3", conCookie(sesion),
		conCabecera("Sec-Fetch-Site", "cross-site"), conCabecera("Origin", "https://atacante.example")), 403)
	debe("CSRF con text/plain", pedir("POST", "/api/v1/movimientos/interpretacion", `{"texto":"`+texto+`"}`, "3", conCookie(sesion),
		conCabecera("Content-Type", "text/plain")), 415)

	// «No autorizo» con lo necesario ya autorizado: acceso_denegado.
	debe("no autorizo ya autorizada", pedir("POST", "/api/v1/autorizaciones/rechazo", "{}", "2", conCookie(sesion)), 403)

	// Inicios fallidos: con la cuenta, y repetidos con un correo sin cuenta hasta el 429.
	debe("contraseña mal", pedir("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+claveMala+`"}`, "4"), 401)
	for i := range 6 {
		quiere := 401
		if i == 5 {
			quiere = 429
		}
		debe("inicio fallido repetido", pedir("POST", "/api/v1/sesiones", `{"identificador":"nadie.seg006@ejemplo.test","contrasena":"`+claveMala+`"}`, "5"), quiere)
	}

	// Sin sesión, con una cookie inventada y con un Bearer falso: error_autorizacion.
	debe("sin sesión", pedir("GET", "/api/v1/movimientos", "", "6"), 401)
	debe("cookie inventada", pedir("GET", "/api/v1/movimientos", "", "6", conCookie(&http.Cookie{Name: sesion.Name, Value: tokenFalso})), 401)
	debe("Bearer falso", pedir("POST", "/api/v1/movimientos", movimiento, "6", sinCabecera("Sec-Fetch-Site"),
		conCabecera("Authorization", "Bearer "+otroTokenFalso)), 401)

	// Entrar en la web y en Android (token en el cuerpo).
	web := entrar("entrar en la web", clave, "7")
	rr = pedir("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+clave+`"}`, "7",
		sinCabecera("Sec-Fetch-Site"), conCabecera("X-Alcanzamos-Cliente", "android"))
	debe("entrar en Android", rr, 200)
	var android struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &android); err != nil || android.Token == "" {
		t.Fatalf("entrar en Android: %v %s", err, rr.Body)
	}
	secretos = append(secretos, android.Token)
	debe("Android lista", pedir("GET", "/api/v1/movimientos", "", "7", sinCabecera("Sec-Fetch-Site"),
		conCabecera("Authorization", "Bearer "+android.Token)), 200)

	// Cambiar la contraseña (PN-73): mal (evento de la cuenta) y bien.
	debe("cambiar con la actual mal", pedir("POST", "/api/v1/cuenta/contrasena", `{"contrasena_actual":"`+claveMala+`","contrasena_nueva":"`+claveNueva+`"}`, "8", conCookie(web)), 400)
	debe("cambiar la contraseña", pedir("POST", "/api/v1/cuenta/contrasena", `{"contrasena_actual":"`+clave+`","contrasena_nueva":"`+claveNueva+`"}`, "8", conCookie(web)), 200)

	// Recuperar el acceso (PN-61, PN-62): enlace falso y bueno.
	debe("pedir la recuperación", pedir("POST", "/api/v1/recuperacion", `{"correo":"`+correo+`"}`, "9"), 202)
	esperar()
	recuperacion := buzon.token(t, "/recuperar")
	secretos = append(secretos, recuperacion)
	debe("recuperar con enlace falso", pedir("POST", "/api/v1/recuperacion/contrasena", `{"token":"`+otroTokenFalso+`","contrasena":"`+claveRecobrada+`"}`, "9"), 400)
	debe("recuperar", pedir("POST", "/api/v1/recuperacion/contrasena", `{"token":"`+recuperacion+`","contrasena":"`+claveRecobrada+`"}`, "9"), 200)

	// Cerrar la sesión y usarla después: error_autorizacion.
	salida := entrar("entrar tras recuperar", claveRecobrada, "10")
	debe("cerrar la sesión", pedir("DELETE", "/api/v1/sesiones/actual", "", "10", conCookie(salida)), 204)
	debe("sesión cerrada", pedir("GET", "/api/v1/cuenta/seguridad", "", "10", conCookie(salida)), 401)

	// Borrar la cuenta (PN-69): mal (evento de la cuenta) y bien.
	ultima := entrar("entrar para borrar", claveRecobrada, "11")
	debe("borrar con la contraseña mal", pedir("POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+claveMala+`"}`, "11", conCookie(ultima)), 400)
	debe("borrar la cuenta", pedir("POST", "/api/v1/cuenta/borrado", `{"contrasena":"`+claveRecobrada+`"}`, "11", conCookie(ultima)), 200)
	esperar()

	// (1) y (2): los eventos.
	patrones := map[string]bool{}
	for _, r := range e.Rutas() {
		patrones[r.Patron] = true
	}
	uuid := regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-`)
	vistos := map[string]int{}
	lineas := strings.Split(strings.TrimSpace(registro.String()), "\n")
	for _, linea := range lineas {
		var campos map[string]any
		if err := json.Unmarshal([]byte(linea), &campos); err != nil {
			t.Fatalf("una línea del registro no es JSON: %q", linea)
		}
		evento, esEvento := campos["evento_seguridad"].(string)
		if !esEvento {
			continue
		}
		ruta, _ := campos["ruta"].(string)
		codigo, _ := campos["codigo"].(float64)
		vistos[evento+" "+ruta+" "+strconv.Itoa(int(codigo))]++
		if len(campos) != len(camposDeUnEvento) {
			t.Errorf("un evento con campos de más o de menos: %s", linea)
		}
		for _, k := range camposDeUnEvento {
			if _, hay := campos[k]; !hay {
				t.Errorf("un evento sin %q: %s", k, linea)
			}
		}
		if !patrones[ruta] || uuid.MatchString(ruta) {
			t.Errorf("la ruta de un evento no es un patrón registrado: %s", linea)
		}
		if cuenta := campos["cuenta"]; cuenta != "desconocida" && cuenta != persona {
			t.Errorf("la cuenta de un evento no es «desconocida» ni la persona: %s", linea)
		}
	}
	for _, quiere := range []string{
		"acceso_denegado GET /api/v1/categorias 403",
		"acceso_denegado POST /api/v1/autorizaciones/rechazo 403",
		"inicio_sesion_fallido POST /api/v1/sesiones 401",
		"inicio_sesion_fallido POST /api/v1/sesiones 429",
		"inicio_sesion_fallido POST /api/v1/cuenta/contrasena 400",
		"inicio_sesion_fallido POST /api/v1/cuenta/borrado 400",
		"error_autorizacion GET /api/v1/movimientos 401",
		"error_autorizacion POST /api/v1/movimientos 401",
		"error_autorizacion GET /api/v1/cuenta/seguridad 401",
	} {
		if vistos[quiere] == 0 {
			t.Errorf("falta el evento %q; salieron %v", quiere, vistos)
		}
	}

	// (3) y (4): ninguna línea, evento o no, lleva un dato de la persona; el id de la persona, solo en eventos. El registro
	// capturado es el de todo el API, no solo el de los eventos: trae también las líneas de registrar e interpretar.
	for _, msg := range []string{`"msg":"movimiento registrado"`, `"msg":"movimiento corregido"`, `"msg":"texto interpretado"`} {
		if !strings.Contains(registro.String(), msg) {
			t.Errorf("el registro capturado no tiene %s:\n%s", msg, registro)
		}
	}
	for _, linea := range lineas {
		minusculas := strings.ToLower(linea)
		for _, s := range secretos {
			if strings.Contains(minusculas, strings.ToLower(s)) {
				t.Errorf("el registro lleva %q: %s", s, linea)
			}
		}
		if strings.Contains(linea, persona) && !strings.Contains(linea, `"evento_seguridad"`) {
			t.Errorf("el id de la persona fuera de un evento de seguridad: %s", linea)
		}
	}
	t.Logf("%d líneas en el registro; eventos: %v", len(lineas), vistos)
}
