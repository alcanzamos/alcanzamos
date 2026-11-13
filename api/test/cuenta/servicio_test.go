package cuenta_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

// enlaceFalso es un enlace de verificación del repositorio falso.
type enlaceFalso struct {
	correo string
	vence  time.Time
	usado  bool
}

// repoFalso guarda en memoria lo que recibiría el Repositorio y finge sus tres casos (D-172): correo libre, correo con
// una cuenta sin verificar (solo cambia el enlace) y correo con una cuenta verificada.
type repoFalso struct {
	mu                                    sync.Mutex
	verificadas                           map[string]bool // correo → true si la cuenta existente está verificada
	solicitudes                           []cuenta.NuevaVerificacion
	enlaces                               map[string]*enlaceFalso // huella (texto) → enlace
	completadas                           []cuenta.CuentaElegida
	errSolicitar, errEnlace, errCompletar error
	compuerta                             chan struct{} // si no es nil, SolicitarVerificacion espera a que se cierre

	// BorrarSinConfirmar y AvisarAntesDeLaPurga (ítem 294, D-203)
	plazos      cuenta.PlazosDeLaPurga
	resultado   cuenta.ResultadoDeLaPurga
	avisarHasta time.Time
	porAvisar   []cuenta.CuentaPorAvisar
	avisadas    map[string]time.Time // id → el momento del aviso que el repositorio registró
	errAvisar   error
}

func (r *repoFalso) SolicitarVerificacion(_ context.Context, v cuenta.NuevaVerificacion) error {
	if r.compuerta != nil {
		<-r.compuerta
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.errSolicitar != nil {
		return r.errSolicitar
	}
	if verificada, existe := r.verificadas[v.Correo]; existe && verificada {
		return cuenta.ErrCorreoYaRegistrado
	}
	if _, existe := r.verificadas[v.Correo]; !existe && v.SoloSiExiste {
		return cuenta.ErrSinCuenta
	}
	if r.verificadas == nil {
		r.verificadas = map[string]bool{}
	}
	if r.enlaces == nil {
		r.enlaces = map[string]*enlaceFalso{}
	}
	for _, e := range r.enlaces {
		if e.correo == v.Correo {
			e.usado = true // el anterior deja de servir
		}
	}
	r.verificadas[v.Correo] = false
	r.enlaces[string(v.HuellaDelEnlace)] = &enlaceFalso{correo: v.Correo, vence: v.VenceElEnlaceEn}
	r.solicitudes = append(r.solicitudes, v)
	return nil
}

func (r *repoFalso) CorreoDelEnlace(_ context.Context, h []byte, ahora time.Time) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.errEnlace != nil {
		return "", r.errEnlace
	}
	if e, ok := r.enlaces[string(h)]; ok && !e.usado && e.vence.After(ahora) {
		return e.correo, nil
	}
	return "", cuenta.ErrEnlaceInvalido
}

func (r *repoFalso) CompletarCuenta(_ context.Context, c cuenta.CuentaElegida) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.errCompletar != nil {
		return r.errCompletar
	}
	e, ok := r.enlaces[string(c.HuellaDelEnlace)]
	if !ok || e.usado || !e.vence.After(c.Ahora) {
		return cuenta.ErrEnlaceInvalido
	}
	e.usado = true
	r.verificadas[e.correo] = true
	r.completadas = append(r.completadas, c)
	return nil
}

func (r *repoFalso) BorrarSinConfirmar(_ context.Context, p cuenta.PlazosDeLaPurga) (cuenta.ResultadoDeLaPurga, error) {
	r.plazos = p
	return r.resultado, nil
}

// AvisarAntesDeLaPurga hace lo del repositorio real sin la base: ofrece cada cuenta a `enviar` y solo registra el aviso de
// la que sale bien.
func (r *repoFalso) AvisarAntesDeLaPurga(ctx context.Context, avisarHasta time.Time, enviar cuenta.EnvioDelAviso) (int, error) {
	r.avisarHasta = avisarHasta
	if r.errAvisar != nil {
		return 0, r.errAvisar
	}
	if r.avisadas == nil {
		r.avisadas = map[string]time.Time{}
	}
	n := 0
	for _, c := range r.porAvisar {
		if _, ya := r.avisadas[c.ID]; ya {
			continue
		}
		en, err := enviar(ctx, c)
		if err != nil {
			continue
		}
		r.avisadas[c.ID] = en
		n++
	}
	return n, nil
}

type hasheadorFalso struct {
	mu        sync.Mutex
	llamadas  int
	contrasen []string
	err       error
}

func (h *hasheadorFalso) Hashear(_ context.Context, c string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.llamadas++
	h.contrasen = append(h.contrasen, c)
	if h.err != nil {
		return "", h.err
	}
	return "$argon2id$falso$" + c, nil
}

var ahoraDePrueba = time.Date(2026, 10, 22, 15, 0, 0, 0, time.UTC)

// entorno agrupa un Servicio con sus dobles.
type entorno struct {
	svc       *cuenta.Servicio
	repo      *repoFalso
	correo    *correotest.Falso
	hasher    *hasheadorFalso
	reloj     *relojtest.Fijo
	limitador *seguridad.LimitadorDeIntentos
	registro  *bytes.Buffer
}

func nuevoEntorno() *entorno {
	e := &entorno{repo: &repoFalso{}, correo: &correotest.Falso{}, hasher: &hasheadorFalso{}, reloj: &relojtest.Fijo{T: ahoraDePrueba}, registro: &bytes.Buffer{}}
	e.limitador = seguridad.NuevoLimitadorDeIntentos(e.reloj)
	e.svc = cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: e.repo, Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
		Reloj: e.reloj, Limitador: e.limitador, Log: e.log(),
	})
	return e
}

// log es el registro del servicio: JSON sobre el búfer del entorno.
func (e *entorno) log() *slog.Logger { return slog.New(slog.NewJSONHandler(e.registro, nil)) }

func solicitudValida() cuenta.SolicitudDeCuenta {
	return cuenta.SolicitudDeCuenta{Correo: "  Laura@Ejemplo.TEST ", MayorDeEdad: true}
}

// pedirYEsperar crea la cuenta con la solicitud válida y espera a que termine el trabajo en segundo plano.
func (e *entorno) pedirYEsperar(t *testing.T) {
	t.Helper()
	if err := e.svc.CrearCuenta(context.Background(), solicitudValida()); err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
}

// D-172 (1) y (2): un correo sin cuenta recibe el enlace de verificación; no se calcula ningún hash (la contraseña se
// elige después) y lo guardado es solo el SHA-256 del token.
func TestCrearCuentaConCorreoNuevoGuardaElEnlaceYLoEnvia(t *testing.T) {
	e := nuevoEntorno()
	e.pedirYEsperar(t)

	if len(e.repo.solicitudes) != 1 || e.hasher.llamadas != 0 {
		t.Fatalf("solicitudes %d, hashes %d", len(e.repo.solicitudes), e.hasher.llamadas)
	}
	v := e.repo.solicitudes[0]
	if v.Correo != "laura@ejemplo.test" || v.Nombre != cuenta.NombreProvisional {
		t.Errorf("solicitud normalizada: %+v", v)
	}
	if !v.VenceElEnlaceEn.Equal(ahoraDePrueba.Add(24*time.Hour)) || !v.Ahora.Equal(ahoraDePrueba) {
		t.Errorf("el enlace debe vencer a las 24 horas (D-192): %+v", v)
	}
	enviados := e.correo.Enviados()
	if len(enviados) != 1 || enviados[0].Destino != "laura@ejemplo.test" || enviados[0].Aviso || enviados[0].Recuperacion {
		t.Fatalf("correos: %+v", enviados)
	}
	huella, err := seguridad.HuellaDeToken(enviados[0].Token)
	if err != nil || !bytes.Equal(huella, v.HuellaDelEnlace) {
		t.Fatalf("la huella guardada no corresponde al token enviado: %v", err)
	}
	registro := e.registro.String()
	for _, secreto := range []string{enviados[0].Token, "laura"} {
		if strings.Contains(registro, secreto) {
			t.Errorf("el registro no debe llevar %q: %s", secreto, registro)
		}
	}
}

// D-172 (2): con una cuenta sin verificar llega un enlace nuevo, no el aviso, y el anterior deja de servir (SEG-012).
func TestCorreoConCuentaSinVerificarRecibeUnEnlaceNuevo(t *testing.T) {
	e := nuevoEntorno()
	e.pedirYEsperar(t)
	viejo := e.correo.Enviados()[0].Token
	e.reloj.T = ahoraDePrueba.Add(time.Minute)
	e.pedirYEsperar(t)

	enviados := e.correo.Enviados()
	if len(enviados) != 2 || enviados[1].Aviso || enviados[1].Token == "" || enviados[1].Token == viejo {
		t.Fatalf("debe recibir la verificación nueva, no el aviso: %+v", enviados)
	}
	if _, err := e.svc.VerificarYElegirContrasena(context.Background(), viejo, "lluvia café tren azul", "Laura"); !errors.Is(err, cuenta.ErrEnlaceInvalido) {
		t.Errorf("el enlace anterior ya no debe servir: %v", err)
	}
	if _, err := e.svc.VerificarYElegirContrasena(context.Background(), enviados[1].Token, "lluvia café tren azul", "Laura"); err != nil {
		t.Errorf("el nuevo sí: %v", err)
	}
}

// D-172 (2): con una cuenta verificada no se toca nada y el dueño recibe el aviso, sin enlace ni token.
func TestCorreoConCuentaVerificadaRecibeSoloElAviso(t *testing.T) {
	e := nuevoEntorno()
	e.repo.verificadas = map[string]bool{"laura@ejemplo.test": true}
	e.pedirYEsperar(t)
	if len(e.repo.solicitudes) != 0 || e.hasher.llamadas != 0 {
		t.Fatal("no debe guardar nada")
	}
	enviados := e.correo.Enviados()
	if len(enviados) != 1 || !enviados[0].Aviso || enviados[0].Destino != "laura@ejemplo.test" || enviados[0].Token != "" {
		t.Fatalf("debe llegar solo el aviso, sin token: %+v", enviados)
	}
	if strings.Contains(e.registro.String(), "laura") {
		t.Errorf("el registro no debe llevar el correo: %s", e.registro)
	}
}

// D-140 (2): 3 correos por hora a una dirección, sumando verificación y aviso; la respuesta no cambia (SEG-009, SEG-014).
func TestElCuartoCorreoDeLaHoraNoSaleYLaRespuestaEsLaMisma(t *testing.T) {
	e := nuevoEntorno()
	e.repo.verificadas = map[string]bool{"laura@ejemplo.test": true}
	for i := range 5 {
		if err := e.svc.CrearCuenta(context.Background(), solicitudValida()); err != nil {
			t.Fatalf("intento %d: %v", i+1, err)
		}
	}
	e.svc.Esperar()
	if n := len(e.correo.Enviados()); n != CorreosPorHoraEsperados {
		t.Fatalf("salieron %d correos, se esperaban %d", n, CorreosPorHoraEsperados)
	}
	e.reloj.T = ahoraDePrueba.Add(time.Hour)
	e.pedirYEsperar(t)
	if n := len(e.correo.Enviados()); n != CorreosPorHoraEsperados+1 {
		t.Fatalf("a la hora debe salir otro: %d", n)
	}
}

// CorreosPorHoraEsperados es la cifra de D-140, repetida a propósito: si cambia en el limitador, esta prueba lo avisa.
const CorreosPorHoraEsperados = 3

func TestUnEnvioQueFallaSeRegistraSinCorreoNiToken(t *testing.T) {
	e := nuevoEntorno()
	e.correo.Error = errors.New("el servidor de correo no responde")
	e.pedirYEsperar(t)
	if !strings.Contains(e.registro.String(), "no se pudo enviar el correo") {
		t.Errorf("falta el registro del fallo: %s", e.registro)
	}
	if strings.Contains(e.registro.String(), "laura") {
		t.Errorf("el registro no debe llevar el correo: %s", e.registro)
	}
}

// Un fallo de la base no cambia lo que ve el cliente (responde igual) ni envía nada; queda en el registro, sin el correo.
func TestUnFalloDelRepositorioNoEnviaYSeRegistra(t *testing.T) {
	e := nuevoEntorno()
	e.repo.errSolicitar = errors.New("bd caída")
	e.pedirYEsperar(t)
	if len(e.correo.Enviados()) != 0 {
		t.Error("un fallo no debe enviar nada")
	}
	if !strings.Contains(e.registro.String(), "no se pudo pedir la verificación") || strings.Contains(e.registro.String(), "laura") {
		t.Errorf("registro: %s", e.registro)
	}
}

func TestCrearCuentaValidacion(t *testing.T) {
	casos := []struct {
		nombre string
		cambia func(*cuenta.SolicitudDeCuenta)
		campos map[string]string
	}{
		{"correo vacío", func(s *cuenta.SolicitudDeCuenta) { s.Correo = "  " }, map[string]string{"correo": cuenta.CorreoVacio}},
		{"correo sin @", func(s *cuenta.SolicitudDeCuenta) { s.Correo = "laura.ejemplo.test" }, map[string]string{"correo": cuenta.CorreoInvalido}},
		{"correo sin dominio", func(s *cuenta.SolicitudDeCuenta) { s.Correo = "laura@" }, map[string]string{"correo": cuenta.CorreoInvalido}},
		{"correo con dominio sin punto", func(s *cuenta.SolicitudDeCuenta) { s.Correo = "laura@ejemplo" }, map[string]string{"correo": cuenta.CorreoInvalido}},
		{"correo con nombre y ángulos", func(s *cuenta.SolicitudDeCuenta) { s.Correo = "Laura <laura@ejemplo.test>" }, map[string]string{"correo": cuenta.CorreoInvalido}},
		{"correo con salto de línea", func(s *cuenta.SolicitudDeCuenta) { s.Correo = "laura@ejemplo.test\r\nBcc: x@y.test" }, map[string]string{"correo": cuenta.CorreoInvalido}},
		{"menor de edad o sin marcar", func(s *cuenta.SolicitudDeCuenta) { s.MayorDeEdad = false }, map[string]string{"mayor_de_edad": cuenta.MayorDeEdadRequerido}},
		{"todo mal a la vez", func(s *cuenta.SolicitudDeCuenta) { *s = cuenta.SolicitudDeCuenta{} }, map[string]string{
			"correo": cuenta.CorreoVacio, "mayor_de_edad": cuenta.MayorDeEdadRequerido}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno()
			sol := solicitudValida()
			c.cambia(&sol)
			err := e.svc.CrearCuenta(context.Background(), sol)
			e.svc.Esperar()
			comprobarCampos(t, err, c.campos)
			if len(e.repo.solicitudes) != 0 || len(e.correo.Enviados()) != 0 {
				t.Error("una solicitud rechazada no guarda ni envía nada")
			}
		})
	}
}

// comprobarCampos exige un *ErrValidacion con exactamente los campos dados.
func comprobarCampos(t *testing.T, err error, esperados map[string]string) {
	t.Helper()
	var inv *cuenta.ErrValidacion
	if !errors.As(err, &inv) {
		t.Fatalf("se esperaba *ErrValidacion: %v", err)
	}
	if len(inv.Campos) != len(esperados) {
		t.Errorf("campos %v, se esperaban %v", inv.Campos, esperados)
	}
	for k, v := range esperados {
		if inv.Campos[k] != v {
			t.Errorf("campo %s = %q, se esperaba %q", k, inv.Campos[k], v)
		}
	}
}

func TestPermitirCreacionCuentaTodosLosIntentos(t *testing.T) {
	e := nuevoEntorno()
	for i := range 20 {
		if !e.svc.PermitirCreacion("203.0.113.7") {
			t.Fatalf("el intento %d debía pasar", i+1)
		}
	}
	if e.svc.PermitirCreacion("203.0.113.7") {
		t.Fatal("el 21 se frena")
	}
}

// D-172 (4): «Reenviar» pide el correo, sin sesión, y hace lo mismo que crear: con o sin cuenta, enlace nuevo o aviso.
func TestReenviarVerificacionHaceLoMismoQueCrear(t *testing.T) {
	for _, existente := range []map[string]bool{nil, {"laura@ejemplo.test": false}, {"laura@ejemplo.test": true}} {
		e := nuevoEntorno()
		e.repo.verificadas = existente
		if err := e.svc.ReenviarVerificacion(context.Background(), "  Laura@Ejemplo.TEST ", "203.0.113.7"); err != nil {
			t.Fatal(err)
		}
		e.svc.Esperar()
		enviados := e.correo.Enviados()
		esAviso := existente["laura@ejemplo.test"]
		if existente == nil { // B1: sin cuenta no se hace nada
			if len(enviados) != 0 {
				t.Errorf("sin cuenta no debe salir nada: %+v", enviados)
			}
			continue
		}
		if len(enviados) != 1 || enviados[0].Aviso != esAviso || enviados[0].Destino != "laura@ejemplo.test" {
			t.Errorf("con %v: correos %+v", existente, enviados)
		}
	}
}

func TestReenviarVerificacionValidaElCorreo(t *testing.T) {
	for correo, codigo := range map[string]string{"": cuenta.CorreoVacio, "sin-arroba": cuenta.CorreoInvalido} {
		e := nuevoEntorno()
		err := e.svc.ReenviarVerificacion(context.Background(), correo, "203.0.113.7")
		e.svc.Esperar()
		comprobarCampos(t, err, map[string]string{"correo": codigo})
		if len(e.repo.solicitudes) != 0 || len(e.correo.Enviados()) != 0 {
			t.Errorf("%q: no debe guardar ni enviar nada", correo)
		}
	}
}

// D-143 (5), D-140 (2), D-136: espera corta de 30 segundos, 3 por hora por dirección y 20 por origen. Los cuentan por el
// correo escrito, exista o no la cuenta.
func TestReenviarVerificacionRespetaLaEsperaYLosLimites(t *testing.T) {
	for _, existente := range []map[string]bool{nil, {"laura@ejemplo.test": true}} {
		e := nuevoEntorno()
		e.repo.verificadas = existente
		pedir := func(correo, origen string) error {
			return e.svc.ReenviarVerificacion(context.Background(), correo, origen)
		}
		if err := pedir("laura@ejemplo.test", "o1"); err != nil {
			t.Fatal(err)
		}
		if err := pedir("LAURA@ejemplo.test", "o2"); !errors.Is(err, cuenta.ErrDemasiadosIntentos) {
			t.Fatalf("antes de 30 segundos: %v", err)
		}
		for i := 1; i <= 2; i++ {
			e.svc.Esperar() // el reloj de prueba no admite que se mueva mientras el trabajo en segundo plano lo lee
			e.reloj.T = e.reloj.T.Add(31 * time.Second)
			if err := pedir("laura@ejemplo.test", "o3"); err != nil {
				t.Fatalf("reenvío %d: %v", i+1, err)
			}
		}
		e.svc.Esperar()
		e.reloj.T = e.reloj.T.Add(31 * time.Second)
		if err := pedir("laura@ejemplo.test", "o4"); !errors.Is(err, cuenta.ErrDemasiadosIntentos) {
			t.Fatalf("el cuarto de la hora: %v", err)
		}
		e.svc.Esperar()
		e.reloj.T = ahoraDePrueba.Add(time.Hour + time.Minute)
		if err := pedir("laura@ejemplo.test", "o5"); err != nil {
			t.Fatalf("a la hora: %v", err)
		}
	}
	// 20 por origen, con direcciones distintas.
	e := nuevoEntorno()
	for i := range 20 {
		if err := e.svc.ReenviarVerificacion(context.Background(), "u"+strings.Repeat("x", i)+"@ejemplo.test", "o1"); err != nil {
			t.Fatalf("pedido %d: %v", i+1, err)
		}
	}
	if err := e.svc.ReenviarVerificacion(context.Background(), "otro@ejemplo.test", "o1"); !errors.Is(err, cuenta.ErrDemasiadosIntentos) {
		t.Fatalf("el 21 del origen: %v", err)
	}
	e.svc.Esperar()
}

const claveDePrueba = "lluvia café tren azul"

// enlaceDePrueba pide la verificación de laura@ejemplo.test y devuelve el token que llegó por correo.
func (e *entorno) enlaceDePrueba(t *testing.T) string {
	t.Helper()
	e.pedirYEsperar(t)
	enviados := e.correo.Enviados()
	return enviados[len(enviados)-1].Token
}

// PN-74 (D-172 (3)): con el enlace, la contraseña y el nombre se guarda todo junto y la sesión sale solo de ahí.
func TestVerificarYElegirContrasenaGuardaTodoYDaLaSesion(t *testing.T) {
	e := nuevoEntorno()
	token := e.enlaceDePrueba(t)
	e.reloj.T = ahoraDePrueba.Add(time.Hour)

	sesionNueva, err := e.svc.VerificarYElegirContrasena(context.Background(), token, claveDePrueba, "  Laura ")
	if err != nil {
		t.Fatal(err)
	}
	if len(e.repo.completadas) != 1 || e.hasher.llamadas != 1 {
		t.Fatalf("completadas %d, hashes %d", len(e.repo.completadas), e.hasher.llamadas)
	}
	c := e.repo.completadas[0]
	if c.Nombre != "Laura" || c.HashContrasena != "$argon2id$falso$"+claveDePrueba || !c.Ahora.Equal(e.reloj.T) {
		t.Errorf("cuenta elegida: %+v", c)
	}
	if h, err := seguridad.HuellaDeToken(token); err != nil || !bytes.Equal(h, c.HuellaDelEnlace) {
		t.Errorf("debe consumir el enlace del correo: %v", err)
	}
	if h, err := seguridad.HuellaDeToken(sesionNueva.Token); err != nil || !bytes.Equal(h, c.HuellaDeSesion) || sesionNueva.Token == token {
		t.Errorf("la sesión debe ser un token nuevo cuya huella se guarda: %v", err)
	}
	if strings.Contains(e.registro.String(), claveDePrueba) || strings.Contains(e.registro.String(), sesionNueva.Token) {
		t.Errorf("el registro no lleva ni la contraseña ni el token: %s", e.registro)
	}
	// Una sola vez (D-192 (a)).
	if _, err := e.svc.VerificarYElegirContrasena(context.Background(), token, claveDePrueba, "Laura"); !errors.Is(err, cuenta.ErrEnlaceInvalido) {
		t.Errorf("segundo uso: %v", err)
	}
}

func TestVerificarYElegirContrasenaValidacion(t *testing.T) {
	casos := []struct {
		nombre, contrasena, usuario string
		campos                      map[string]string
	}{
		{"contraseña vacía", "", "Laura", map[string]string{"contrasena": cuenta.ContrasenaVacia}},
		{"contraseña de 14", "abcdefghijklmn", "Laura", map[string]string{"contrasena": cuenta.ContrasenaCorta}},
		{"contraseña de SecLists", "123456789987654321", "Laura", map[string]string{"contrasena": cuenta.ContrasenaComun}},
		{"contraseña de la lista en español", "tequieromucho2026", "Laura", map[string]string{"contrasena": cuenta.ContrasenaComun}},
		{"contraseña repetida", "aaaaaaaaaaaaaaa", "Laura", map[string]string{"contrasena": cuenta.ContrasenaComun}},
		{"contraseña en secuencia", "123456789012345", "Laura", map[string]string{"contrasena": cuenta.ContrasenaComun}},
		{"contraseña de teclado", "qwertyuiopasdfg", "Laura", map[string]string{"contrasena": cuenta.ContrasenaComun}},
		// D-142, D-192: el correo de la cuenta del enlace o la palabra «Alcanzamos». El texto vive en es.json.
		{"contraseña con el correo", "la-clave-de-laura-es-larga", "Laura", map[string]string{"contrasena": cuenta.ContrasenaPersonal}},
		{"contraseña con la palabra Alcanzamos", "uso Alcanzamos a diario", "Laura", map[string]string{"contrasena": cuenta.ContrasenaPersonal}},
		{"nombre vacío", claveDePrueba, " ", map[string]string{"nombre": cuenta.NombreVacio}},
		{"nombre de 61", claveDePrueba, strings.Repeat("ñ", 61), map[string]string{"nombre": cuenta.NombreLargo}},
		{"todo mal a la vez", "", "", map[string]string{"contrasena": cuenta.ContrasenaVacia, "nombre": cuenta.NombreVacio}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno()
			token := e.enlaceDePrueba(t)
			_, err := e.svc.VerificarYElegirContrasena(context.Background(), token, c.contrasena, c.usuario)
			comprobarCampos(t, err, c.campos)
			if len(e.repo.completadas) != 0 || e.hasher.llamadas != 0 {
				t.Error("una solicitud rechazada no calcula el hash ni completa la cuenta")
			}
			// El enlace sigue vigente: la persona corrige y vuelve a intentar.
			if _, err := e.svc.VerificarYElegirContrasena(context.Background(), token, claveDePrueba, "Laura"); err != nil {
				t.Errorf("el enlace no se gasta con un campo mal escrito: %v", err)
			}
		})
	}
	t.Run("nombre de 60", func(t *testing.T) {
		e := nuevoEntorno()
		if _, err := e.svc.VerificarYElegirContrasena(context.Background(), e.enlaceDePrueba(t), claveDePrueba, strings.Repeat("ñ", 60)); err != nil {
			t.Fatal(err)
		}
	})
}

// D-192 (c): un enlace mal formado, desconocido o vencido es siempre el mismo error y no toca nada.
func TestVerificarYElegirContrasenaConEnlaceQueNoSirve(t *testing.T) {
	e := nuevoEntorno()
	token := e.enlaceDePrueba(t)
	desconocido, _ := seguridad.NuevoTokenOpaco()
	e.reloj.T = ahoraDePrueba.Add(24 * time.Hour) // vence a las 24 horas exactas
	for nombre, t0 := range map[string]string{"mal formado": "xyz", "vacío": "", "desconocido": desconocido, "vencido": token} {
		if _, err := e.svc.VerificarYElegirContrasena(context.Background(), t0, claveDePrueba, "Laura"); !errors.Is(err, cuenta.ErrEnlaceInvalido) {
			t.Errorf("%s: %v", nombre, err)
		}
	}
	if e.hasher.llamadas != 0 || len(e.repo.completadas) != 0 {
		t.Error("un enlace que no sirve no calcula el hash ni completa la cuenta")
	}
}

func TestVerificarYElegirContrasenaFallosInternosNoDanSesion(t *testing.T) {
	for nombre, preparar := range map[string]func(*entorno){
		"falla la base al leer el enlace": func(e *entorno) { e.repo.errEnlace = errors.New("bd caída") },
		"falla el hash":                   func(e *entorno) { e.hasher.err = errors.New("sin memoria") },
		"falla la base al completar":      func(e *entorno) { e.repo.errCompletar = errors.New("bd caída") },
	} {
		t.Run(nombre, func(t *testing.T) {
			e := nuevoEntorno()
			token := e.enlaceDePrueba(t)
			preparar(e)
			s, err := e.svc.VerificarYElegirContrasena(context.Background(), token, claveDePrueba, "Laura")
			if err == nil || errors.Is(err, cuenta.ErrEnlaceInvalido) || s.Token != "" {
				t.Errorf("se esperaba el fallo, sin sesión: %+v, %v", s, err)
			}
		})
	}
}

func TestBorrarCuentasSinConfirmarPideLosPlazos(t *testing.T) {
	e := nuevoEntorno()
	e.repo.resultado = cuenta.ResultadoDeLaPurga{Borradas: 3}
	n, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba)
	if err != nil || n != 3 {
		t.Fatalf("borradas %d, %v", n, err)
	}
	// Caso 1: 7 días. Caso 2: 7 días desde creada_en y 48 horas desde el aviso; sin aviso, el límite del día 14 (D-203).
	esperado := cuenta.PlazosDeLaPurga{
		Ahora:          ahoraDePrueba,
		CreadasHasta:   ahoraDePrueba.Add(-7 * 24 * time.Hour),
		AvisadasHasta:  ahoraDePrueba.Add(-48 * time.Hour),
		SinAvisoHasta:  ahoraDePrueba.Add(-14 * 24 * time.Hour),
		ConservarHasta: ahoraDePrueba.AddDate(3, 0, 0),
	}
	if e.repo.plazos != esperado {
		t.Errorf("plazos: %+v, se esperaba %+v", e.repo.plazos, esperado)
	}
	if e.repo.plazos.ConservarHasta.Format("2006-01-02") != "2029-10-22" {
		t.Errorf("conservar hasta %v", e.repo.plazos.ConservarHasta)
	}
}

// B1 (L6): «Reenviar el correo» solo actúa sobre cuentas que existen: con un correo sin cuenta no crea nada ni envía nada.
func TestReenviarVerificacionNoCreaCuentas(t *testing.T) {
	e := nuevoEntorno()
	if err := e.svc.ReenviarVerificacion(context.Background(), "nadie@ejemplo.test", "203.0.113.7"); err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
	if len(e.repo.solicitudes) != 0 || len(e.repo.verificadas) != 0 || len(e.correo.Enviados()) != 0 {
		t.Errorf("no debe crear ni enviar: %+v %v %+v", e.repo.solicitudes, e.repo.verificadas, e.correo.Enviados())
	}
	// Y crear (PN-58) sí crea.
	e.pedirYEsperar(t)
	if len(e.repo.solicitudes) != 1 {
		t.Errorf("crear sí crea: %d", len(e.repo.solicitudes))
	}
}

// A1 (L6): el límite de 3 correos por hora a la dirección se mira ANTES de revocar el enlace: el cuarto pedido no deja a
// la persona sin un enlace que sirva.
func TestElCuartoPedidoDeLaHoraNoRevocaElEnlaceVigente(t *testing.T) {
	e := nuevoEntorno()
	for range seguridad.CorreosPorDestino {
		e.pedirYEsperar(t)
	}
	vigente := e.correo.Enviados()[seguridad.CorreosPorDestino-1].Token
	e.pedirYEsperar(t) // el cuarto: no sale correo y no se toca el enlace
	if n := len(e.correo.Enviados()); n != seguridad.CorreosPorDestino {
		t.Fatalf("salieron %d correos", n)
	}
	if len(e.repo.solicitudes) != seguridad.CorreosPorDestino {
		t.Errorf("el cuarto pedido tocó la base: %d solicitudes", len(e.repo.solicitudes))
	}
	if _, err := e.svc.VerificarYElegirContrasena(context.Background(), vigente, claveDePrueba, "Laura"); err != nil {
		t.Errorf("el último enlace enviado debe seguir sirviendo: %v", err)
	}
}

// A2 (L6): tope global del trabajo en segundo plano. Con el cupo lleno, el pedido responde igual, el trabajo se descarta y
// se registra sin correo ni token; al liberarse, vuelve a aceptar.
func TestElTrabajoEnSegundoPlanoTieneUnTopeGlobal(t *testing.T) {
	e := nuevoEntorno()
	e.svc = cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: e.repo, Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
		Reloj: e.reloj, Limitador: e.limitador, Log: e.log(), CupoDeSolicitudes: 2,
	})
	e.repo.compuerta = make(chan struct{})
	for i := range 4 {
		sol := cuenta.SolicitudDeCuenta{Correo: fmt.Sprintf("u%d@ejemplo.test", i), MayorDeEdad: true}
		if err := e.svc.CrearCuenta(context.Background(), sol); err != nil {
			t.Fatalf("el pedido %d debe responder igual aunque el cupo esté lleno: %v", i+1, err)
		}
	}
	if !strings.Contains(e.registro.String(), "descartado") {
		t.Errorf("falta el registro del descarte: %s", e.registro)
	}
	if strings.Contains(e.registro.String(), "@") {
		t.Errorf("el registro lleva un correo: %s", e.registro)
	}
	close(e.repo.compuerta)
	e.svc.Esperar()
	if n := len(e.correo.Enviados()); n != 2 {
		t.Errorf("solo caben 2 a la vez: salieron %d", n)
	}
	e.pedirYEsperar(t)
	if n := len(e.correo.Enviados()); n != 3 {
		t.Errorf("liberado el cupo vuelve a aceptar: %d", n)
	}
}
