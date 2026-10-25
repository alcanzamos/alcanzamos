import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { autorizar, obtenerCatalogo, rechazar } from '../api/autorizaciones';
import { SIN_CONEXION } from '../api/cliente';
import { Aviso } from '../componentes/Aviso';
import { Boton } from '../componentes/Boton';
import { Casilla } from '../componentes/Casilla';
import { Pantalla } from '../componentes/Pantalla';
import { Tarjeta } from '../componentes/Tarjeta';
import { Nota, Texto } from '../componentes/Texto';
import { diaEnPalabras } from '../fechas';
import { estiloDeTipografia } from '../fuentes';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import { reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, finalidadesDeE14, type DatosDeAviso } from '../textos';
import { formatear, textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';

type Finalidad = { codigo: string; texto: (typeof finalidadesDeE14)[string] };
type Catalogo = { version: string; fecha: string; necesarias: Finalidad[]; accesorias: Finalidad[] };
type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; aviso: DatosDeAviso }
  | { fase: 'listo'; catalogo: Catalogo };

/**
 * Del catálogo del API a lo que se dibuja. Un código que E14 no tiene, un tipo desconocido o una fecha que no se puede
 * escribir en palabras es un error de carga: no se omite en silencio una finalidad que la persona no vería.
 */
function leerCatalogo(cuerpo: Awaited<ReturnType<typeof obtenerCatalogo>> & { ok: true }): Catalogo | null {
  const { version, finalidades } = cuerpo.cuerpo;
  const fecha = diaEnPalabras(version?.fecha ?? '');
  if (!fecha || !version?.numero || !Array.isArray(finalidades)) return null;
  const catalogo: Catalogo = { version: version.numero, fecha, necesarias: [], accesorias: [] };
  for (const { codigo, tipo } of finalidades) {
    const texto = finalidadesDeE14[codigo];
    if (!texto || (tipo !== 'necesaria' && tipo !== 'accesoria')) return null;
    if (tipo === 'accesoria' && !texto.casilla) return null;
    (tipo === 'necesaria' ? catalogo.necesarias : catalogo.accesorias).push({ codigo, texto });
  }
  return catalogo.necesarias.length > 0 ? catalogo : null;
}

function FilaDeFinalidad({ texto }: { texto: Finalidad['texto'] }) {
  return (
    <View style={estilos.fila}>
      <Text style={estilos.nombre}>{texto.nombre}</Text>
      <Texto>{texto.descripcion}</Texto>
    </View>
  );
}

// PN-64 · Autorización de datos (E14-PCP 4.7, RF-031, RF-063). Ninguna casilla viene marcada. Las necesarias van en una
// tarjeta y una casilla; cada accesoria, en la suya. «Autorizar y continuar» sin lo necesario no pide nada: muestra el
// error. Sin «Leer la política completa»: abre PN-68, que no está construida. «Autorizar y continuar» lleva a Inicio,
// que no existe todavía: va a PN-71, como al entrar, en la misma sesión (mismo token, sin volver a iniciar sesión).
// «No autorizo» borra la cuenta recién creada y el token, y va a PN-60. Los dos cambian con `reemplazarPila`: el Atrás
// del sistema no vuelve a PN-64 ni a una cuenta borrada. Su Atrás de la barra vuelve a PN-63.
export function AutorizacionDeDatos({ navigation }: NativeStackScreenProps<Rutas, 'AutorizacionDeDatos'>) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [necesarias, setNecesarias] = useState(false);
  const [elegidas, setElegidas] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | undefined>();
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);

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
    if (!necesarias) {
      setError(textos.autorizacion.necesarias.error);
      setAviso(null);
      return;
    }
    const { catalogo } = estado;
    setError(undefined);
    setEnviando(true);
    const respuesta = await autorizar(
      [
        ...catalogo.necesarias.map((f) => f.codigo),
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
    // Sin conexión, E14 dice «Todavía no pudimos borrar tu correo.»; con un error del servidor, lo mismo.
    setAviso(
      respuesta.codigo === SIN_CONEXION ? avisos.errorAlBorrarElCorreo : avisoDeFallo(respuesta, avisos.errorAlBorrarElCorreo),
    );
  }

  const catalogo = estado.fase === 'listo' ? estado.catalogo : null;

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
          <Texto>{textos.autorizacion.explicacion}</Texto>
          <Tarjeta titulo={textos.autorizacion.necesarias.titulo}>
            {catalogo.necesarias.map(({ codigo, texto }) => (
              <FilaDeFinalidad key={codigo} texto={texto} />
            ))}
          </Tarjeta>
          <Casilla
            texto={textos.autorizacion.necesarias.casilla}
            marcada={necesarias}
            alCambiar={(marcada) => {
              setNecesarias(marcada);
              if (marcada) setError(undefined);
            }}
            error={error}
          />
          <Texto variante="ayuda">{textos.autorizacion.necesarias.nota}</Texto>
          <Tarjeta titulo={textos.autorizacion.opcionales.titulo}>
            {catalogo.accesorias.map(({ codigo, texto }) => (
              <FilaDeFinalidad key={codigo} texto={texto} />
            ))}
          </Tarjeta>
          {catalogo.accesorias.map(({ codigo, texto }) => (
            <Casilla
              key={codigo}
              texto={texto.casilla ?? ''}
              marcada={elegidas[codigo] ?? false}
              alCambiar={(marcada) => setElegidas({ ...elegidas, [codigo]: marcada })}
            />
          ))}
          <Texto variante="ayuda">{textos.autorizacion.opcionales.nota}</Texto>
          <Nota>{formatear(textos.autorizacion.version, { numero: catalogo.version, fecha: catalogo.fecha })}</Nota>
          <Boton deshabilitado={enviando} alTocar={() => void enviar()}>
            {textos.autorizacion.autorizar}
          </Boton>
          <Boton variante="secundario" deshabilitado={enviando} alTocar={() => void noAutorizo()}>
            {textos.autorizacion.noAutorizo}
          </Boton>
        </>
      )}
    </Pantalla>
  );
}

const estilos = StyleSheet.create({
  fila: { gap: tokens.espacio['1'] },
  nombre: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
});
