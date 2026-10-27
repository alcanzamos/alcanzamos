// Prueba de integración del cliente del API de la app contra un API de verdad (fuera de Jest), US-49 A5 y US-50.
// Corre el MISMO código de `src/api/` que la app (cliente.ts, cuentas.ts, acceso.ts y autorizaciones.ts) con Node, con dos cambios que el
// teléfono no necesita: `expo-secure-store` se reemplaza por un almacén en memoria (no hay Keystore en Node) y los
// imports sin extensión se resuelven como `.ts` (Node quita los tipos solo, sin compilar nada).
//
// Desde la US-51 también prueba el registro (categorías, un gasto en efectivo, el arriendo, PN-03) con la sesión ya autorizada
// y, desde la US-52, la lista de movimientos de PN-01 con sus filtros.
// Uso (el API, PostgreSQL y Mailpit ya arriba; ver README, «Probar en el celular»):
//   EXPO_PUBLIC_URL_API=http://127.0.0.1:18090 URL_MAILPIT=http://127.0.0.1:58025 npm run integracion:api
// Las autorizaciones se dan por el API (GET y POST /api/v1/autorizaciones), no por SQL. Datos sintéticos; nada sale del equipo.
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';

const URL_API = process.env.EXPO_PUBLIC_URL_API;
const URL_MAILPIT = process.env.URL_MAILPIT;
if (!URL_API || !URL_MAILPIT) {
  console.error('Faltan EXPO_PUBLIC_URL_API o URL_MAILPIT.');
  process.exit(2);
}

// El almacén en memoria que reemplaza a expo-secure-store: guarda cada llamada para poder revisarla.
const almacen = (globalThis.__almacenSeguro = { datos: new Map(), llamadas: [] });
const shim = `
const a = globalThis.__almacenSeguro;
export const getItemAsync = async (k) => { a.llamadas.push(['get', k]); return a.datos.get(k) ?? null; };
export const setItemAsync = async (k, v) => { a.llamadas.push(['set', k]); a.datos.set(k, v); };
export const deleteItemAsync = async (k) => { a.llamadas.push(['delete', k]); a.datos.delete(k); };
`;
registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (especificador === 'expo-secure-store') {
      return { url: `data:text/javascript,${encodeURIComponent(shim)}`, shortCircuit: true };
    }
    try {
      return siguiente(especificador, contexto);
    } catch (error) {
      if (especificador.startsWith('.') && !/\.\w+$/.test(especificador))
        return siguiente(`${especificador}.ts`, contexto);
      throw error;
    }
  },
});

const { pedir, SIN_CONEXION } = await import('../src/api/cliente.ts');
const cuentas = await import('../src/api/cuentas.ts');
const acceso = await import('../src/api/acceso.ts');
const autorizaciones = await import('../src/api/autorizaciones.ts');
const registro = await import('../src/api/registro.ts');
const movimientos = await import('../src/api/movimientos.ts');
const { hoyEnColombia } = await import('../src/fechas.ts');

let fallas = 0;
const paso = (nombre, condicion, detalle = '') => {
  console.log(`${condicion ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!condicion) fallas++;
};
const token = () => almacen.datos.get('sesion') ?? null;

// Lo que hace la persona para dejar una cuenta nueva verificada: el enlace del correo se abre en el navegador (D-155).
// El correo sale de un trabajador aparte: puede tardar un instante en llegar a Mailpit, así que se espera un poco.
async function verificarCuenta(correoDeLaCuenta) {
  let mensaje;
  for (let i = 0; i < 20 && !mensaje; i++) {
    const lista = await (await fetch(`${URL_MAILPIT}/api/v1/messages`)).json();
    mensaje = lista.messages.find((m) => m.To.some((p) => p.Address === correoDeLaCuenta));
    if (!mensaje) await new Promise((r) => setTimeout(r, 250));
  }
  const texto = (await (await fetch(`${URL_MAILPIT}/api/v1/message/${mensaje.ID}`)).json()).Text;
  const [, enlaceDelCorreo] = /\/verificar\?t=([A-Za-z0-9_-]+)/.exec(texto);
  return fetch(`${URL_API}/api/v1/cuentas/verificacion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: enlaceDelCorreo }),
  });
}

const sufijo = Date.now();
const correo = `laura-${sufijo}@ejemplo.com`;
const contrasena = 'lluvia café tren azul';
const contrasenaNueva = 'otra frase de cuatro palabras';

// 1. Crear la cuenta en modo Android: el token llega en el cuerpo y el cliente lo guarda en el almacén seguro.
const creada = await cuentas.crearCuenta({ correo, contrasena, nombre: 'Laura', mayor_de_edad: true });
paso(
  'crear la cuenta: 202 verificacion_pendiente',
  creada.ok && creada.estado === 202 && creada.cuerpo.estado === 'verificacion_pendiente',
  JSON.stringify(creada),
);
const tokenDeCrear = token();
paso(
  'el token del cuerpo quedó en el almacén seguro y no llega a la pantalla',
  typeof tokenDeCrear === 'string' && tokenDeCrear.length === 43 && !('token' in (creada.cuerpo ?? {})),
  `largo ${tokenDeCrear?.length}`,
);
paso(
  'el almacén seguro se usó con una sola clave: sesion',
  almacen.llamadas.every(([, clave]) => clave === 'sesion'),
);

// 2. Estado: todavía sin verificar.
const estado1 = await cuentas.estadoDeLaCuenta();
paso(
  'estado: verificada = false con la sesión limitada',
  estado1.ok && estado1.cuerpo.verificada === false,
  JSON.stringify(estado1),
);

// 3. Verificar el correo con el enlace que llegó a Mailpit (la persona lo abre en el navegador, D-155).
const lista = await (await fetch(`${URL_MAILPIT}/api/v1/messages`)).json();
const mensaje = lista.messages.find((m) => m.To.some((p) => p.Address === correo));
paso('el correo de verificación llegó a Mailpit', Boolean(mensaje), mensaje?.Subject);
const texto = (await (await fetch(`${URL_MAILPIT}/api/v1/message/${mensaje.ID}`)).json()).Text;
const enlace = /https?:\/\/[^\s]+\/verificar\?t=([A-Za-z0-9_-]+)/.exec(texto);
paso('el enlace del correo es /verificar?t=<token> (abre la web)', Boolean(enlace), enlace?.[0].replace(/t=.+/, 't=…'));
// Lo que hace el navegador al abrir el enlace: sin la cabecera de la app y sin la sesión de la app.
const verificada = await fetch(`${URL_API}/api/v1/cuentas/verificacion`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: enlace[1] }),
});
paso(
  'verificar el enlace desde el navegador: 200 verificado, sin sesión',
  verificada.status === 200 && (await verificada.json()).con_sesion === false,
);

// 4. «Ya lo confirmé»: la misma sesión ahora dice verificada.
const estado2 = await cuentas.estadoDeLaCuenta();
paso(
  'estado: verificada = true con la misma sesión',
  estado2.ok && estado2.cuerpo.verificada === true,
  JSON.stringify(estado2),
);

// 5. Iniciar sesión: token nuevo.
const malas = await acceso.iniciarSesion({ identificador: correo, contrasena: 'no es esta' });
paso(
  'contraseña incorrecta: 401 credenciales_invalidas y no cambia el token',
  !malas.ok && malas.estado === 401 && malas.codigo === 'credenciales_invalidas' && token() === tokenDeCrear,
);
const entro = await acceso.iniciarSesion({ identificador: correo, contrasena });
const tokenDeEntrar = token();
paso(
  'iniciar sesión: 200 activa con token nuevo en el almacén',
  entro.ok && entro.cuerpo.estado === 'activa' && tokenDeEntrar !== tokenDeCrear && tokenDeEntrar?.length === 43,
);

// 6. Sin autorización el API niega (RNF-012): PN-71 da 403 autorizacion_pendiente.
const sinAut = await acceso.ingresoAnterior();
paso(
  'seguridad sin autorización: 403 autorizacion_pendiente',
  !sinAut.ok && sinAut.estado === 403 && sinAut.codigo === 'autorizacion_pendiente',
  JSON.stringify(sinAut),
);

// 7. PN-64 con el API de verdad: el catálogo, los errores de «Autorizar» y la autorización, todo en la MISMA sesión
// (S2, dueño 2026-10-24): autorizar no vuelve a iniciar sesión ni cambia el token.
const catalogo = await autorizaciones.obtenerCatalogo();
paso(
  'catálogo: 200, versión 1.0 del 2026-10-30 y las cuatro finalidades de una persona adulta, ninguna otorgada',
  catalogo.ok &&
    catalogo.cuerpo.version?.numero === '1.0' &&
    catalogo.cuerpo.version?.fecha === '2026-10-30' &&
    catalogo.cuerpo.finalidades?.map((f) => `${f.codigo}:${f.tipo}`).join() ===
      'cuenta_y_acceso:necesaria,funciones_financieras:necesaria,avisos:accesoria,horas_de_vida:accesoria' &&
    catalogo.cuerpo.finalidades.every((f) => f.otorgada === false),
  JSON.stringify(catalogo.cuerpo),
);
const necesarias = ['cuenta_y_acceso', 'funciones_financieras'];
const versionVieja = await autorizaciones.autorizar(necesarias, '0.9');
paso(
  'autorizar con una versión vieja: 409 version_desactualizada',
  !versionVieja.ok && versionVieja.estado === 409 && versionVieja.codigo === 'version_desactualizada',
);
const sinNecesarias = await autorizaciones.autorizar(['avisos'], '1.0');
paso(
  'autorizar sin las necesarias: 422 faltan_necesarias',
  !sinNecesarias.ok && sinNecesarias.estado === 422 && sinNecesarias.codigo === 'faltan_necesarias',
);
const aunSin = await acceso.ingresoAnterior();
paso('los errores no autorizaron nada: seguridad sigue en 403 autorizacion_pendiente', !aunSin.ok && aunSin.estado === 403);
const autorizada = await autorizaciones.autorizar([...necesarias, 'avisos'], catalogo.cuerpo.version.numero);
paso(
  'autorizar (necesarias y avisos): 200 autorizada y el token no cambia (misma sesión)',
  autorizada.ok && autorizada.cuerpo.estado === 'autorizada' && token() === tokenDeEntrar,
  JSON.stringify(autorizada),
);
const otorgadas = await autorizaciones.obtenerCatalogo();
paso(
  'el catálogo marca como otorgadas las tres autorizadas y no horas_de_vida',
  otorgadas.ok &&
    otorgadas.cuerpo.finalidades.filter((f) => f.otorgada).map((f) => f.codigo).join() ===
      'cuenta_y_acceso,funciones_financieras,avisos',
);
// S2: la misma sesión, sin volver a entrar, ya ve PN-71 y es su primer ingreso.
const seguridad = await acceso.ingresoAnterior();
paso(
  'S2: seguridad en la misma sesión: 200 y primer ingreso (ingreso_anterior null)',
  seguridad.ok && seguridad.cuerpo.ingreso_anterior === null,
  JSON.stringify(seguridad),
);

// 8. Un segundo ingreso: ahora hay ingreso anterior, en RFC 3339.
await acceso.iniciarSesion({ identificador: correo, contrasena });
const segundo = await acceso.ingresoAnterior();
paso(
  'segundo ingreso: ingreso_anterior es una fecha RFC 3339',
  segundo.ok &&
    typeof segundo.cuerpo.ingreso_anterior === 'string' &&
    !Number.isNaN(Date.parse(segundo.cuerpo.ingreso_anterior)),
  segundo.cuerpo?.ingreso_anterior,
);
const tokenDeCambiar = token();

// 9. Cambiar la contraseña: la sesión de ahora sigue; las demás se cierran.
const actualIncorrecta = await acceso.cambiarContrasena({
  contrasena_actual: 'no es esta',
  contrasena_nueva: contrasenaNueva,
});
paso(
  'cambiar con la actual incorrecta: 400 contrasena_actual_incorrecta',
  !actualIncorrecta.ok && actualIncorrecta.estado === 400 && actualIncorrecta.codigo === 'contrasena_actual_incorrecta',
);
const corta = await acceso.cambiarContrasena({ contrasena_actual: contrasena, contrasena_nueva: 'corta' });
paso(
  'cambiar con una nueva corta: 422 contrasena_corta',
  !corta.ok && corta.estado === 422 && corta.campos.contrasena_nueva === 'contrasena_corta',
  JSON.stringify(corta.campos),
);
const cambio = await acceso.cambiarContrasena({ contrasena_actual: contrasena, contrasena_nueva: contrasenaNueva });
paso('cambiar la contraseña: 200 contrasena_cambiada', cambio.ok && cambio.cuerpo.estado === 'contrasena_cambiada');
paso(
  'el token de ahora no cambió y sigue sirviendo',
  token() === tokenDeCambiar && (await acceso.ingresoAnterior()).ok,
);
const sesionVieja = await fetch(`${URL_API}/api/v1/cuenta/seguridad`, {
  headers: { Authorization: `Bearer ${tokenDeEntrar}`, 'X-Alcanzamos-Cliente': 'android' },
});
paso('una sesión anterior quedó cerrada: 401', sesionVieja.status === 401);

// 10. Cerrar sesión: DELETE, token borrado, y el token viejo ya no sirve (401 sin_sesion).
const salio = await cuentas.cerrarSesion();
paso('cerrar sesión: 204 y el token se borró del almacén seguro', salio.ok && salio.estado === 204 && token() === null);
const despues = await fetch(`${URL_API}/api/v1/cuenta/seguridad`, {
  headers: { Authorization: `Bearer ${tokenDeCambiar}`, 'X-Alcanzamos-Cliente': 'android' },
});
const cuerpoDespues = await despues.json();
paso('con el token cerrado: 401 sin_sesion', despues.status === 401 && cuerpoDespues.error === 'sin_sesion');
const sinToken = await acceso.ingresoAnterior();
paso(
  'el cliente sin token: 401 sin_sesion',
  !sinToken.ok && sinToken.estado === 401 && sinToken.codigo === 'sin_sesion',
);

// 11. Recuperación (PN-61): la respuesta es la misma con o sin cuenta; el correo con el enlace /recuperar llega a Mailpit.
const recup = await acceso.pedirRecuperacion(correo);
const recupSin = await acceso.pedirRecuperacion(`nadie-${sufijo}@ejemplo.com`);
paso(
  'recuperar: 202 enlace_enviado con o sin cuenta (mismo cuerpo)',
  recup.ok &&
    recupSin.ok &&
    JSON.stringify(recup.cuerpo) === JSON.stringify(recupSin.cuerpo) &&
    recup.cuerpo.estado === 'enlace_enviado',
);
let enlaceDeRecuperacion = null;
for (let i = 0; i < 20 && !enlaceDeRecuperacion; i++) {
  const l = await (await fetch(`${URL_MAILPIT}/api/v1/messages`)).json();
  const m = l.messages.find((x) => x.To.some((p) => p.Address === correo) && /Recupera/.test(x.Subject));
  if (m)
    enlaceDeRecuperacion = /\/recuperar\?t=[A-Za-z0-9_-]+/.exec(
      (await (await fetch(`${URL_MAILPIT}/api/v1/message/${m.ID}`)).json()).Text,
    )?.[0];
  else await new Promise((r) => setTimeout(r, 250));
}
paso(
  'el correo de recuperación trae el enlace /recuperar?t= (abre la web: PN-62 vive allí hasta los App Links de I08)',
  Boolean(enlaceDeRecuperacion),
);
const entroNueva = await acceso.iniciarSesion({ identificador: correo, contrasena: contrasenaNueva });
paso('entrar con la contraseña nueva: 200 activa', entroNueva.ok && entroNueva.cuerpo.estado === 'activa');

// 12. Contraste: con Origin o Sec-Fetch-Site el modo Android se rechaza (D-143 (3)); la app nunca los manda.
const conOrigin = await fetch(`${URL_API}/api/v1/sesiones`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Alcanzamos-Cliente': 'android', 'Sec-Fetch-Site': 'same-origin' },
  body: JSON.stringify({ identificador: correo, contrasena: contrasenaNueva }),
});
paso('modo Android con Sec-Fetch-Site: 400 solicitud_invalida (la app no lo manda)', conOrigin.status === 400);

// 13. «No autorizo» (RF-031): con la cuenta verificada y sin autorizar, el API borra la cuenta y su sesión; la app borra el token.
const correoRechazo = `rechazo-${sufijo}@ejemplo.com`;
await cuentas.crearCuenta({ correo: correoRechazo, contrasena, nombre: 'Rosa', mayor_de_edad: true });
const tokenDeRechazo = token();
await verificarCuenta(correoRechazo);
const sinAutorizar = await acceso.iniciarSesion({ identificador: correoRechazo, contrasena });
const tokenSinAutorizar = token();
paso('la cuenta nueva entra, sin autorizar: 200 activa', sinAutorizar.ok && sinAutorizar.cuerpo.estado === 'activa');
const antes = await acceso.ingresoAnterior();
paso('la cuenta nueva no autorizó: seguridad da 403 autorizacion_pendiente', !antes.ok && antes.estado === 403);
const rechazo = await autorizaciones.rechazar();
paso(
  'No autorizo: 204 y el token se borró del almacén seguro',
  rechazo.ok && rechazo.estado === 204 && token() === null,
  JSON.stringify(rechazo),
);
const viejas = await Promise.all(
  [tokenDeRechazo, tokenSinAutorizar].map((t) =>
    fetch(`${URL_API}/api/v1/cuenta/seguridad`, {
      headers: { Authorization: `Bearer ${t}`, 'X-Alcanzamos-Cliente': 'android' },
    }),
  ),
);
paso('ninguna sesión de la cuenta borrada sirve: 401', viejas.every((r) => r.status === 401));
const yaNoExiste = await acceso.iniciarSesion({ identificador: correoRechazo, contrasena });
paso(
  'la cuenta ya no existe: entrar da 401 credenciales_invalidas y no guarda token',
  !yaNoExiste.ok && yaNoExiste.estado === 401 && yaNoExiste.codigo === 'credenciales_invalidas' && token() === null,
  JSON.stringify(yaNoExiste),
);
const volver = await cuentas.crearCuenta({ correo: correoRechazo, contrasena, nombre: 'Rosa', mayor_de_edad: true });
paso('el correo quedó libre: se puede crear la cuenta otra vez (202)', volver.ok && volver.estado === 202);
const entroAutorizada = await acceso.iniciarSesion({ identificador: correo, contrasena: contrasenaNueva });
const noPuede = await autorizaciones.rechazar();
paso(
  'con la cuenta ya autorizada «No autorizo» da 403 ya_autorizada y no borra el token',
  entroAutorizada.ok && !noPuede.ok && noPuede.estado === 403 && noPuede.codigo === 'ya_autorizada' && token() !== null,
  JSON.stringify(noPuede),
);

// 14. Registro de movimientos (US-51): con la sesión ya autorizada de la cuenta de arriba. «Hoy» es el del servidor (la
// cabecera Date de su respuesta, en la hora de Colombia), no el de esta máquina: las expectativas se adaptan a él.
const hoy = hoyEnColombia(new Date((await fetch(`${URL_API}/salud`)).headers.get('date') ?? Date.now()));
// Los siguientes días 15 estrictamente después de hoy (lo que el API llama «próximas» de una repetición mensual desde el 15).
const proximosDia15 = (desde, cuantos) => {
  const [anio, mes] = desde.split('-').map(Number);
  const dias = [];
  for (let i = 0; dias.length < cuantos; i++) {
    const total = anio * 12 + (mes - 1) + i;
    const dia = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-15`;
    if (dia > desde) dias.push(dia);
  }
  return dias;
};
paso(`el «hoy» del servidor es una fecha posterior al 15 de agosto de 2026 (hoy ${hoy})`, hoy > '2026-08-15');

const categorias = await registro.obtenerCategorias();
const otrosGastos = categorias.ok ? categorias.cuerpo.gasto.find((c) => c.general) : undefined;
const otrosIngresos = categorias.ok ? categorias.cuerpo.ingreso.find((c) => c.general) : undefined;
paso(
  'categorías: 200 con las de gasto y las de ingreso, y la general de cada tipo (ids 16 y 25)',
  categorias.ok &&
    categorias.cuerpo.gasto.length > 0 &&
    categorias.cuerpo.ingreso.length > 0 &&
    otrosGastos?.id === 16 &&
    otrosIngresos?.id === 25 &&
    categorias.cuerpo.gasto.some((c) => c.id === 4),
  categorias.ok ? `${categorias.cuerpo.gasto.length} de gasto y ${categorias.cuerpo.ingreso.length} de ingreso` : JSON.stringify(categorias),
);
const base = { tipo: 'gasto', fecha: hoy, categoriaId: 16, medio: 'efectivo', descripcion: '', periodicidad: null };

// Un gasto en efectivo de hoy, con centavos enteros.
const efectivo = await registro.guardarMovimiento({ ...base, montoCentavos: 4500000n });
paso(
  'un gasto en efectivo de $45.000: 201, guarda el movimiento y no deja repetición ni pendientes',
  efectivo.ok &&
    efectivo.estado === 201 &&
    typeof efectivo.cuerpo.movimiento_id === 'string' &&
    efectivo.cuerpo.recurrente_id === null &&
    efectivo.cuerpo.proximas.length === 0 &&
    efectivo.cuerpo.pendientes.length === 0,
  JSON.stringify(efectivo.cuerpo),
);
const grande = await registro.guardarMovimiento({ ...base, montoCentavos: 9223372036854775807n });
paso('un monto de 64 bits (2^63 − 1 centavos) se guarda exacto: 201', grande.ok && grande.estado === 201, JSON.stringify(grande));

// PN-03 contra el API de verdad: las fechas las calcula el servidor (D-165), la app solo las pide.
const siguientes = proximosDia15(hoy, 3);
const proximas = await registro.obtenerProximas('mensual', '2026-08-15');
paso(
  `PN-03: el arriendo del 15 de agosto, mensual: los tres siguientes días 15 después de hoy (${siguientes.join(', ')})`,
  proximas.ok && JSON.stringify(proximas.cuerpo.proximas) === JSON.stringify(siguientes),
  JSON.stringify(proximas.cuerpo),
);
const inicioMalo = await registro.obtenerProximas('mensual', '2026-02-30');
paso(
  'PN-03: un inicio que no existe da 422 con inicio = fecha_invalida',
  !inicioMalo.ok && inicioMalo.estado === 422 && inicioMalo.campos.inicio === 'fecha_invalida',
  JSON.stringify(inicioMalo),
);
const periodoMalo = await registro.obtenerProximas('diaria', '2026-08-15');
paso(
  'PN-03: una periodicidad que no es de las cinco da 422 con periodicidad = periodicidad_invalida',
  !periodoMalo.ok && periodoMalo.estado === 422 && periodoMalo.campos.periodicidad === 'periodicidad_invalida',
  JSON.stringify(periodoMalo),
);

// S4: el arriendo del 15 de agosto, mensual, escrito hoy. Registra el 15 de agosto; las fechas de en medio son historia
// (E15 5.2) y la próxima es el siguiente día 15. Solo un día 15 de hoy que no es la fecha escrita queda pendiente.
const arriendo = await registro.guardarMovimiento({
  ...base,
  montoCentavos: 120000000n,
  fecha: '2026-08-15',
  categoriaId: 4,
  medio: 'transferencia',
  descripcion: 'Arriendo',
  periodicidad: 'mensual',
});
const pendientesEsperadas = hoy.endsWith('-15') ? [hoy] : [];
paso(
  'el arriendo del 15 de agosto, mensual: 201, registra el movimiento y crea la repetición',
  arriendo.ok &&
    arriendo.estado === 201 &&
    typeof arriendo.cuerpo.movimiento_id === 'string' &&
    typeof arriendo.cuerpo.recurrente_id === 'string',
  JSON.stringify(arriendo.cuerpo),
);
paso(
  `el arriendo: las fechas de en medio son historia (pendientes ${JSON.stringify(pendientesEsperadas)}) y las próximas son ${siguientes.join(', ')}`,
  arriendo.ok &&
    JSON.stringify(arriendo.cuerpo.pendientes) === JSON.stringify(pendientesEsperadas) &&
    JSON.stringify(arriendo.cuerpo.proximas) === JSON.stringify(siguientes),
  JSON.stringify(arriendo.cuerpo),
);

// L3: un regalo de diciembre sin repetición se guarda con su fecha futura y no queda pendiente.
const anioDeDiciembre = hoy < `${hoy.slice(0, 4)}-12-20` ? hoy.slice(0, 4) : String(Number(hoy.slice(0, 4)) + 1);
const regalo = await registro.guardarMovimiento({
  ...base,
  montoCentavos: 18000000n,
  fecha: `${anioDeDiciembre}-12-20`,
  descripcion: 'Regalos de Navidad',
});
paso(
  `un regalo del 20 de diciembre de ${anioDeDiciembre} sin repetición (L3): 201, se guarda con su fecha futura y no queda pendiente`,
  regalo.ok &&
    regalo.estado === 201 &&
    typeof regalo.cuerpo.movimiento_id === 'string' &&
    regalo.cuerpo.recurrente_id === null &&
    regalo.cuerpo.pendientes.length === 0 &&
    regalo.cuerpo.proximas.length === 0,
  JSON.stringify(regalo.cuerpo),
);
const futuraQueSeRepite = await registro.guardarMovimiento({
  ...base,
  montoCentavos: 9000000n,
  fecha: `${anioDeDiciembre}-12-20`,
  periodicidad: 'mensual',
});
paso(
  'una fecha futura que se repite guarda solo la repetición: sin movimiento y con esa fecha en las próximas',
  futuraQueSeRepite.ok &&
    futuraQueSeRepite.cuerpo.movimiento_id === null &&
    typeof futuraQueSeRepite.cuerpo.recurrente_id === 'string' &&
    futuraQueSeRepite.cuerpo.proximas[0] === `${anioDeDiciembre}-12-20`,
  JSON.stringify(futuraQueSeRepite.cuerpo),
);

// Errores de campo, todos a la vez (E14-PPN 3.1).
const vacio = await registro.guardarMovimiento({ ...base, montoCentavos: 0n, categoriaId: 999999, fecha: '2026-02-30' });
paso(
  'cero, categoría que no existe y fecha que no existe: 422 con los tres códigos a la vez',
  !vacio.ok &&
    vacio.estado === 422 &&
    vacio.codigo === 'datos_invalidos' &&
    vacio.campos.monto_centavos === 'monto_no_positivo' &&
    vacio.campos.categoria_id === 'categoria_invalida' &&
    vacio.campos.fecha === 'fecha_invalida',
  JSON.stringify(vacio.campos),
);
const tipoCruzado = await registro.guardarMovimiento({ ...base, montoCentavos: 100n, categoriaId: otrosIngresos?.id ?? 25 });
paso(
  'una categoría de ingreso en un gasto: 422 categoria_invalida',
  !tipoCruzado.ok && tipoCruzado.estado === 422 && tipoCruzado.campos.categoria_id === 'categoria_invalida',
  JSON.stringify(tipoCruzado.campos),
);

// Una categoría oculta por la persona (RN-011): el API la deja de ofrecer y no guarda en ella. No hay ruta para ocultar
// (PN-05 no existe todavía), así que solo se prueba con CONTENEDOR_POSTGRES, el contenedor de PostgreSQL local.
const contenedor = process.env.CONTENEDOR_POSTGRES;
if (contenedor) {
  const sql = `INSERT INTO ocultamiento_categoria (persona_id, categoria_id) SELECT persona_id, 3 FROM perfil_adulto WHERE correo = '${correo}'`;
  execFileSync(
    'docker',
    ['exec', contenedor, 'psql', '-U', process.env.POSTGRES_USER ?? 'alcanzamos', '-d', process.env.POSTGRES_DB ?? 'alcanzamos', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { stdio: 'pipe' },
  );
  const sinOculta = await registro.obtenerCategorias();
  paso(
    'la categoría que la persona ocultó (3, «Ropa y calzado») ya no sale en las categorías',
    sinOculta.ok && !sinOculta.cuerpo.gasto.some((c) => c.id === 3) && sinOculta.cuerpo.gasto.length > 0,
  );
  const oculta = await registro.guardarMovimiento({ ...base, montoCentavos: 100n, categoriaId: 3 });
  paso(
    'guardar en la categoría oculta: 422 categoria_invalida y no se guarda nada',
    !oculta.ok && oculta.estado === 422 && oculta.campos.categoria_id === 'categoria_invalida',
    JSON.stringify(oculta.campos),
  );
} else {
  console.log('OMITE categoría oculta: falta CONTENEDOR_POSTGRES (no hay ruta del API para ocultar una categoría)');
}

// 14b. PN-01 (US-52): la lista del mes y sus filtros contra el API de verdad, con lo que se registró arriba. Los montos de
// 64 bits llegan como texto y la suma del resumen es exacta aunque pase de 2^63 − 1 (D-082).
const mesDeHoy = hoy.slice(0, 7);
const deLaLista = await movimientos.listarMovimientos(null, null);
const delMes = deLaLista.ok ? deLaLista.cuerpo.movimientos : [];
paso(
  `PN-01 sin filtros: 200, el periodo es el mes de hoy del servidor (${mesDeHoy}), sin suma y con los meses de más reciente a más antiguo`,
  deLaLista.ok &&
    deLaLista.cuerpo.periodo_actual === mesDeHoy &&
    deLaLista.cuerpo.periodo === mesDeHoy &&
    deLaLista.cuerpo.resumen.total_centavos === null &&
    deLaLista.cuerpo.resumen.movimientos === delMes.length &&
    deLaLista.cuerpo.meses.includes(mesDeHoy) &&
    deLaLista.cuerpo.meses.includes('2026-08') &&
    deLaLista.cuerpo.meses.every((mes, i, todos) => i === 0 || todos[i - 1] > mes),
  deLaLista.ok ? JSON.stringify({ meses: deLaLista.cuerpo.meses, resumen: deLaLista.cuerpo.resumen }) : JSON.stringify(deLaLista),
);
paso(
  'PN-01: los montos llegan como texto, con todos sus dígitos (4500000 y 9223372036854775807)',
  delMes.every((m) => typeof m.monto_centavos === 'string') &&
    delMes.some((m) => m.monto_centavos === '4500000') &&
    delMes.some((m) => m.monto_centavos === '9223372036854775807'),
);
const deCategoria = await movimientos.listarMovimientos(mesDeHoy, 16);
const sumaEsperada = delMes.filter((m) => m.categoria_id === 16).reduce((suma, m) => suma + BigInt(m.monto_centavos), 0n);
paso(
  `PN-01 con una categoría: la suma exacta del resumen (${sumaEsperada}) pasa de 2^63 − 1 y no pierde un centavo`,
  deCategoria.ok &&
    sumaEsperada > 9223372036854775807n &&
    deCategoria.cuerpo.resumen.total_centavos === String(sumaEsperada) &&
    deCategoria.cuerpo.movimientos.every((m) => m.categoria_id === 16) &&
    deCategoria.cuerpo.categorias.some((c) => c.categoria_id === 16 && c.oculta === false),
  deCategoria.ok ? JSON.stringify(deCategoria.cuerpo.resumen) : JSON.stringify(deCategoria),
);
const deAgosto = await movimientos.listarMovimientos('2026-08', 4);
paso(
  'PN-01 con otro periodo y una categoría: el arriendo del 15 de agosto, de una repetición mensual, de $1.200.000',
  deAgosto.ok &&
    deAgosto.cuerpo.periodo === '2026-08' &&
    deAgosto.cuerpo.resumen.movimientos === 1 &&
    deAgosto.cuerpo.resumen.total_centavos === '120000000' &&
    deAgosto.cuerpo.movimientos[0]?.fecha === '2026-08-15' &&
    deAgosto.cuerpo.movimientos[0]?.descripcion === 'Arriendo' &&
    deAgosto.cuerpo.movimientos[0]?.compartido === false &&
    deAgosto.cuerpo.movimientos[0]?.recurrente?.periodicidad === 'mensual',
  deAgosto.ok ? JSON.stringify(deAgosto.cuerpo.movimientos) : JSON.stringify(deAgosto),
);
const filtroMalo = await movimientos.listarMovimientos('2026-13', 40000);
paso(
  'PN-01: un periodo y una categoría que no valen dan 422 con los dos códigos a la vez',
  !filtroMalo.ok &&
    filtroMalo.estado === 422 &&
    filtroMalo.campos.periodo === 'periodo_invalido' &&
    filtroMalo.campos.categoria === 'categoria_invalida',
  JSON.stringify(filtroMalo),
);

// 15. Sin conexión: una dirección que nadie escucha.
process.env.EXPO_PUBLIC_URL_API = 'http://127.0.0.1:9';
const sinRed = await pedir('GET', '/api/v1/cuentas/estado');
paso('sin conexión: estado 0 sin_conexion', !sinRed.ok && sinRed.estado === 0 && sinRed.codigo === SIN_CONEXION);

console.log(fallas === 0 ? '\nTodo en orden.' : `\n${fallas} comprobación(es) fallaron.`);
process.exit(fallas === 0 ? 0 : 1);
