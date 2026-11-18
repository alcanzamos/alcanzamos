// Package servidor es el servidor de archivos estáticos de ca-web: sirve la web compilada, arma /config.json con
// la URL del API y manda las cabeceras de seguridad. Solo usa la biblioteca estándar.
package servidor

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Variables de entorno. Su nombre es parte del contrato con la infraestructura (ca-web) y con la imagen.
const (
	// VarAPIURL es la URL del API de este ambiente: https://api.alcanzamos.co o https://api-uat.alcanzamos.co.
	VarAPIURL = "API_URL"
	// VarPermitirAPILocal, con el valor exacto «true», deja que API_URL sea http://localhost, http://127.0.0.1 o
	// http://[::1]. Es solo para desarrollo local: nunca se define en Azure.
	VarPermitirAPILocal = "PERMITIR_API_LOCAL"
	// VarPuerto es el puerto de escucha. Es el puerto de destino (target port) de la entrada de Container Apps.
	VarPuerto = "PUERTO"
	// VarDirectorio es la carpeta con la web compilada (la que contiene index.html).
	VarDirectorio = "DIRECTORIO_WEB"

	puertoPorDefecto     = 8080
	directorioPorDefecto = "dist"
)

// hostValido admite solo nombres DNS y, con la variable de desarrollo, las direcciones de loopback. Lo que pasa
// llega tal cual a la CSP: nada de espacios, comas, punto y coma, comodines ni comillas.
var hostValido = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`)

// Config es la configuración ya validada.
type Config struct {
	// OrigenAPI es el origen del API (esquema, host y puerto, sin barra final).
	OrigenAPI string
	// Puerto de escucha, de 0 a 65535 (0: el sistema elige uno).
	Puerto int
	// Directorio con la web compilada.
	Directorio string
}

// LeerConfig valida el entorno. getenv es os.Getenv en producción. Si algo falta o es inválido devuelve un error
// que dice qué variable corregir; nunca repite el valor recibido (podría traer credenciales).
func LeerConfig(getenv func(string) string) (Config, error) {
	origen, err := origenDelAPI(getenv(VarAPIURL), getenv(VarPermitirAPILocal) == "true")
	if err != nil {
		return Config{}, err
	}
	cfg := Config{OrigenAPI: origen, Puerto: puertoPorDefecto, Directorio: directorioPorDefecto}
	if v := strings.TrimSpace(getenv(VarPuerto)); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil || p < 0 || p > 65535 {
			return Config{}, fmt.Errorf("%s debe ser un número de 0 a 65535", VarPuerto)
		}
		cfg.Puerto = p
	}
	if v := strings.TrimSpace(getenv(VarDirectorio)); v != "" {
		cfg.Directorio = v
	}
	return cfg, nil
}

func origenDelAPI(valor string, permitirLocal bool) (string, error) {
	valor = strings.TrimSpace(valor)
	if valor == "" {
		return "", fmt.Errorf("%s falta: debe ser la URL https:// del API", VarAPIURL)
	}
	u, err := url.Parse(valor)
	if err != nil {
		return "", fmt.Errorf("%s no es una URL con un host válido", VarAPIURL)
	}
	esquema, host := strings.ToLower(u.Scheme), strings.ToLower(u.Hostname())
	if esquema != "https" && (esquema != "http" || !permitirLocal || !esLoopback(host)) {
		return "", fmt.Errorf("%s debe ser una URL absoluta que empiece con https://", VarAPIURL)
	}
	if u.User != nil {
		return "", errors.New(VarAPIURL + " no puede traer usuario ni contraseña")
	}
	if !esLoopback(host) && !hostValido.MatchString(host) {
		return "", fmt.Errorf("%s no tiene un host válido", VarAPIURL)
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(valor, "#") {
		return "", errors.New(VarAPIURL + " debe ser solo el origen: sin ruta, consulta ni fragmento")
	}
	autoridad := host
	if strings.Contains(host, ":") {
		autoridad = "[" + host + "]"
	}
	if p := u.Port(); p != "" {
		if n, err := strconv.Atoi(p); err != nil || n < 1 || n > 65535 {
			return "", fmt.Errorf("%s tiene un puerto inválido", VarAPIURL)
		}
		autoridad += ":" + p
	}
	return esquema + "://" + autoridad, nil
}

func esLoopback(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// configJSON es el cuerpo de /config.json: lo único que la web lee al arrancar.
func (c Config) configJSON() []byte {
	b, err := json.Marshal(map[string]string{"url_api": c.OrigenAPI})
	if err != nil {
		// Un map[string]string siempre se codifica.
		panic(err)
	}
	return append(b, '\n')
}

// politicaCSP es la Content-Security-Policy de todas las respuestas: la que mandaba el API para la web
// (api/src/servidor/servidor.go) más el origen del API en connect-src. La web carga todo del mismo origen (sin
// scripts ni estilos en línea, sin terceros) y solo habla con el API. web/vite.config.ts y web/e2e/csp.spec.ts
// repiten la política sin el API: si cambia aquí, debe cambiar allá.
func (c Config) politicaCSP() string {
	return "default-src 'self'; connect-src 'self' " + c.OrigenAPI +
		"; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
}
