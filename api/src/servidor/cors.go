package servidor

import "net/http"

// CORS del API (E11-INF 2.16, D-205 (10)): la web (ca-web) vive en otro origen, así que el navegador solo le deja leer una
// respuesta de /api/ si trae estas cabeceras. Las pone el Enrutador, que es quien sabe cuál es el origen de la web
// (`URL_PUBLICA`), y solo sobre /api/: /salud y todo lo demás no las llevan.
//
//   - Un solo origen: el de `URL_PUBLICA`, exacto (esquema, anfitrión y puerto; sin comodines ni coincidencia parcial). Nunca `*`:
//     con credenciales el navegador lo rechazaría, y aunque no, sería abrir la sesión a cualquier página.
//   - Con credenciales (`Access-Control-Allow-Credentials: true`): la cookie de sesión `__Host-sesion` viaja en `fetch` con
//     `credentials: "include"`. Sin `URL_PUBLICA` válida ningún origen vale.
//   - `Vary: Origin` en toda respuesta de /api/, con o sin CORS: una caché no puede servir a un origen la respuesta de otro.
//   - Preflight: `OPTIONS` con `Origin` y `Access-Control-Request-Method` del origen de la web. Responde 204 sin pasar por la
//     ruta ni por la defensa contra CSRF (ese pedido no la lleva); permite GET, POST, PUT y DELETE y la cabecera
//     `Content-Type`, nada más (la web no manda otras cabeceras propias). El de otro origen no se contesta con CORS.
//   - Android no manda `Origin`: no recibe estas cabeceras y su pedido no cambia.
const (
	corsMetodos     = "GET, POST, PUT, DELETE"
	corsCabeceras   = "Content-Type"
	corsDuracionSeg = "600" // el navegador recuerda el preflight 10 minutos: sin esto, cada pedido que cambia algo son dos viajes
)

// conCORS envuelve las rutas de /api/. El origen se lee al atender cada pedido (ConURLPublica se llama antes de servir, pero
// el orden de las llamadas no importa).
func (e *Enrutador) conCORS(siguiente http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cab := w.Header()
		cab.Add("Vary", "Origin")
		if origenEs(r, e.origen) {
			cab.Set("Access-Control-Allow-Origin", e.origen)
			cab.Set("Access-Control-Allow-Credentials", "true")
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				cab.Add("Vary", "Access-Control-Request-Method")
				cab.Add("Vary", "Access-Control-Request-Headers")
				cab.Set("Access-Control-Allow-Methods", corsMetodos)
				cab.Set("Access-Control-Allow-Headers", corsCabeceras)
				cab.Set("Access-Control-Max-Age", corsDuracionSeg)
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		siguiente.ServeHTTP(w, r)
	})
}
