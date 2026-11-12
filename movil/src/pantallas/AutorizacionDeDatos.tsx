import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import type { HostInstance } from 'react-native';
import { autorizar, obtenerCatalogo, rechazar } from '../api/autorizaciones';
import { SIN_CONEXION } from '../api/cliente';
import { useAvisarErrores, useLlevarFoco } from '../anuncios';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { Casilla } from '../componentes/Casilla';
import { FilaDeFinalidad } from '../componentes/FilaDeFinalidad';
import { Pantalla } from '../componentes/Pantalla';
import { Tarjeta } from '../componentes/Tarjeta';
import { Nota, Texto } from '../componentes/Texto';
import { diaEnPalabras } from '../fechas';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import { reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, finalidadesDeE14, type DatosDeAviso } from '../textos';
import { formatear, textos } from '../textos/es.generated';
import { HojaNoAutorizo } from './HojaNoAutorizo';

/** La aceptación expresa de la transmisión a los encargados (SC-E21-25): tiene su tarjeta, no una fila de «Lo necesario». */
const TRANSMISION = 'transmision_a_encargados';

type Finalidad = { codigo: string; texto: (typeof finalidadesDeE14)[string] };
type Catalogo = {
  version: string;
  fecha: string;
  /** `falta_una_aceptacion`: la cuenta de antes del cambio, a la que solo le falta una necesaria (sección 5). */
  modo: 'completo' | 'falta_una_aceptacion';
  necesarias: Finalidad[];
  transmision: boolean;
  accesorias: Finalidad[];
};
type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; aviso: DatosDeAviso }
  | { fase: 'listo'; catalogo: Catalogo };

/**
 * Del catálogo del API a lo que se dibuja. Un código que E14 no tiene, un tipo o un modo desconocido o una fecha que no
 * se puede escribir en palabras es un error de carga: no se omite en silencio una finalidad que la persona no vería.
 */
function leerCatalogo(cuerpo: Awaited<ReturnType<typeof obtenerCatalogo>> & { ok: true }): Catalogo | null {
  const { version, modo, finalidades } = cuerpo.cuerpo;
  const fecha = diaEnPalabras(version?.fecha ?? '');
  if (!fecha || !version?.numero || !Array.isArray(finalidades)) return null;
  if (modo !== 'completo' && modo !== 'falta_una_aceptacion') return null;
  const catalogo: Catalogo = {
    version: version.numero,
    fecha,
    modo,
    necesarias: [],
    transmision: false,
    accesorias: [],
  };
  for (const { codigo, tipo } of finalidades) {
    if (codigo === TRANSMISION) {
      if (tipo !== 'necesaria' || catalogo.transmision) return null;
      catalogo.transmision = true;
      continue;
    }
    const texto = finalidadesDeE14[codigo];
    if (!texto || (tipo !== 'necesaria' && tipo !== 'accesoria')) return null;
    if (tipo === 'accesoria' && !texto.casilla) return null;
    (tipo === 'necesaria' ? catalogo.necesarias : catalogo.accesorias).push({ codigo, texto });
  }
  return catalogo.necesarias.length > 0 || catalogo.transmision ? catalogo : null;
}

// PN-64 · Autorización de datos (E14-PCP 4.7, RF-031, RF-063; SC-E21-25). Ninguna casilla viene marcada. Las necesarias van
// en una tarjeta y una casilla; la aceptación de la transmisión a los encargados, en su tarjeta y su casilla; cada
// accesoria, en la suya, y la de avisos con la frase de los servicios de notificaciones debajo (pista de accesibilidad de
// la casilla). «Autorizar y continuar» sin las casillas necesarias no pide nada: muestra el error de cada una que falta y
// el foco va a la primera. «Leer la política completa» abre PN-68 (D-195): PN-64 sigue debajo en la pila, así que al volver
// las casillas están como estaban. «Autorizar y continuar» lleva a Inicio, que no existe todavía: va a PN-71, como al
// entrar, en la misma sesión (mismo token, sin volver a iniciar sesión). «No autorizo» borra la cuenta recién creada y el
// token, y va a PN-60. Los dos cambian con `reemplazarPila`: el Atrás del sistema no vuelve a PN-64 ni a una cuenta
// borrada. Su Atrás de la barra vuelve a PN-63. En el modo `falta_una_aceptacion` (la cuenta de antes del cambio) solo está
// la tarjeta que falta y «No autorizo» no llama a ese borrado: abre la hoja de PN-54, donde la persona descarga sus datos,
// borra la cuenta con la contraseña o vuelve y decide (sección 5, paso 3). Lo mismo si el API contesta
// `403 cuenta_con_historial` al rechazo.
export function AutorizacionDeDatos({ navigation }: NativeStackScreenProps<Rutas, 'AutorizacionDeDatos'>) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [necesarias, setNecesarias] = useState(false);
  const [transmision, setTransmision] = useState(false);
  const [elegidas, setElegidas] = useState<Record<string, boolean>>({});
  const [errores, setErrores] = useState<{ necesarias?: string; transmision?: string }>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [hoja, setHoja] = useState(false);
  const casillaNecesarias = useRef<HostInstance>(null);
  const casillaTransmision = useRef<HostInstance>(null);
  const botonNoAutorizo = useRef<HostInstance>(null);
  const avisarErrores = useAvisarErrores();
  const llevarFoco = useLlevarFoco();

  useEffect(() => {
    let vigente = true;
    void obtenerCatalogo().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) {
        const catalogo = leerCatalogo(respuesta);
        setEstado(
          catalogo ? { fase: 'listo', catalogo } : { fase: 'error', aviso: avisos.errorAlCargarInformacion },
        );
      } else if (!seguirPorAccesoNegado(navigation, respuesta)) {
        setEstado({ fase: 'error', aviso: avisoDeFallo(respuesta, avisos.errorAlCargarInformacion) });
      }
    });
    return () => {
      vigente = false;
    };
  }, [intento, navigation]);

  async function enviar() {
    if (enviando || estado.fase !== 'listo') return;
    const { catalogo } = estado;
    const faltan: { necesarias?: string; transmision?: string } = {};
    if (catalogo.necesarias.length > 0 && !necesarias) faltan.necesarias = textos.autorizacion.necesarias.error;
    if (catalogo.transmision && !transmision) faltan.transmision = textos.autorizacion.dondeGuardamos.error;
    if (faltan.necesarias || faltan.transmision) {
      setErrores(faltan);
      setAviso(null);
      avisarErrores([
        { error: faltan.necesarias, campo: casillaNecesarias },
        { error: faltan.transmision, campo: casillaTransmision },
      ]);
      return;
    }
    setErrores({});
    setEnviando(true);
    const respuesta = await autorizar(
      [
        ...catalogo.necesarias.map((f) => f.codigo),
        ...(catalogo.transmision ? [TRANSMISION] : []),
        ...catalogo.accesorias.filter((f) => elegidas[f.codigo]).map((f) => f.codigo),
      ],
      catalogo.version,
    );
    setEnviando(false);
    if (respuesta.ok) {
      reemplazarPila(navigation, 'SeguridadDeLaCuenta');
      return;
    }
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
    // Con una versión desactualizada E14 no tiene texto propio: el general, y se vuelve a pedir el catálogo.
    if (respuesta.codigo === 'version_desactualizada') setIntento(intento + 1);
    setAviso(avisoDeFallo(respuesta, avisos.errorAlGuardarAutorizacion));
  }

  async function noAutorizo() {
    if (enviando) return;
    // La cuenta de antes del cambio ya tiene historia: no se borra sin preguntar.
    if (estado.fase === 'listo' && estado.catalogo.modo === 'falta_una_aceptacion') {
      setHoja(true);
      return;
    }
    setEnviando(true);
    const respuesta = await rechazar();
    setEnviando(false);
    if (respuesta.ok) {
      reemplazarPila(navigation, 'Entrar', { llegada: 'cuenta_borrada' });
      return;
    }
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
    // Ya autorizó (otro teléfono): no hay nada que borrar, la cuenta sigue.
    if (respuesta.codigo === 'ya_autorizada') {
      reemplazarPila(navigation, 'SeguridadDeLaCuenta');
      return;
    }
    // Autorizó algo antes: el borrado se decide en la hoja, con la contraseña (sección 5, paso 3).
    if (respuesta.codigo === 'cuenta_con_historial') {
      setHoja(true);
      return;
    }
    // Sin conexión, E14 dice «Todavía no pudimos borrar tu correo.»; con un error del servidor, lo mismo.
    setAviso(
      respuesta.codigo === SIN_CONEXION ? avisos.errorAlBorrarElCorreo : avisoDeFallo(respuesta, avisos.errorAlBorrarElCorreo),
    );
  }

  const catalogo = estado.fase === 'listo' ? estado.catalogo : null;
  const completo = catalogo?.modo === 'completo';

  return (
    <Pantalla conBarra>
      {estado.fase === 'error' && (
        <>
          <Aviso {...estado.aviso} />
          <Boton
            variante="secundario"
            alTocar={() => {
              setEstado({ fase: 'cargando' });
              setIntento(intento + 1);
            }}
          >
            {textos.acciones.intentarDeNuevo}
          </Boton>
        </>
      )}
      {catalogo && (
        <>
          {aviso && <Aviso {...aviso} />}
          {completo && <Texto>{textos.autorizacion.explicacion}</Texto>}
          {catalogo.necesarias.length > 0 && (
            <>
              <Tarjeta titulo={textos.autorizacion.necesarias.titulo}>
                {catalogo.necesarias.map(({ codigo, texto }) => (
                  <FilaDeFinalidad key={codigo} nombre={texto.nombre} descripcion={texto.descripcion} />
                ))}
              </Tarjeta>
              <Casilla
                ref={casillaNecesarias}
                texto={textos.autorizacion.necesarias.casilla}
                marcada={necesarias}
                alCambiar={(marcada) => {
                  setNecesarias(marcada);
                  if (marcada) setErrores({ ...errores, necesarias: undefined });
                }}
                error={errores.necesarias}
              />
              {completo && <Texto variante="ayuda">{textos.autorizacion.necesarias.nota}</Texto>}
            </>
          )}
          {catalogo.transmision && (
            <>
              <Tarjeta titulo={textos.autorizacion.dondeGuardamos.titulo}>
                <Texto>{textos.autorizacion.dondeGuardamos.explicacion}</Texto>
              </Tarjeta>
              <Casilla
                ref={casillaTransmision}
                texto={textos.autorizacion.dondeGuardamos.casilla}
                marcada={transmision}
                alCambiar={(marcada) => {
                  setTransmision(marcada);
                  if (marcada) setErrores({ ...errores, transmision: undefined });
                }}
                error={errores.transmision}
              />
              <Texto variante="ayuda">{textos.autorizacion.dondeGuardamos.nota}</Texto>
            </>
          )}
          {catalogo.accesorias.length > 0 && (
            <>
              <Tarjeta titulo={textos.autorizacion.opcionales.titulo}>
                {catalogo.accesorias.map(({ codigo, texto }) => (
                  <FilaDeFinalidad key={codigo} nombre={texto.nombre} descripcion={texto.descripcion} />
                ))}
              </Tarjeta>
              {catalogo.accesorias.map(({ codigo, texto }) => (
                <Casilla
                  key={codigo}
                  texto={texto.casilla ?? ''}
                  ayuda={codigo === 'avisos' ? textos.autorizacion.fraseDeAvisos : undefined}
                  marcada={elegidas[codigo] ?? false}
                  alCambiar={(marcada) => setElegidas({ ...elegidas, [codigo]: marcada })}
                />
              ))}
              <Texto variante="ayuda">{textos.autorizacion.opcionales.nota}</Texto>
            </>
          )}
          <Nota>{formatear(textos.autorizacion.version, { numero: catalogo.version, fecha: catalogo.fecha })}</Nota>
          <BotonDeTexto alTocar={() => navigation.navigate('Politica')}>{textos.politica.entradas.leerCompleta}</BotonDeTexto>
          <Boton deshabilitado={enviando} alTocar={() => void enviar()}>
            {textos.autorizacion.autorizar}
          </Boton>
          <Boton ref={botonNoAutorizo} variante="secundario" deshabilitado={enviando} alTocar={() => void noAutorizo()}>
            {textos.autorizacion.noAutorizo}
          </Boton>
        </>
      )}
      {hoja && (
        <HojaNoAutorizo
          navigation={navigation}
          alCerrar={() => {
            setHoja(false);
            // Al cerrar la hoja (Volver y decidir, Cerrar, el velo o el Atrás), el foco vuelve al botón que la abrió.
            llevarFoco(botonNoAutorizo);
          }}
        />
      )}
    </Pantalla>
  );
}
