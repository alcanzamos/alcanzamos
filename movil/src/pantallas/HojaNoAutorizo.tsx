import type { NavigationProp } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import type { HostInstance, TextInputInstance } from 'react-native';
import { borrarLaCuenta, resumenDeBorrado, type ResumenDeBorrado } from '../api/cuentas';
import { useAvisarErrores } from '../anuncios';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { CampoDeContrasena } from '../componentes/CampoDeContrasena';
import { Casilla } from '../componentes/Casilla';
import { HojaInferior } from '../componentes/HojaInferior';
import { Texto } from '../componentes/Texto';
import { useDescargaDeDatos } from '../descargaDeDatos';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import { reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, nombresEnFrase, textoDeErrorDeCampo, type DatosDeAviso } from '../textos';
import { formatear, plural, textos } from '../textos/es.generated';

type Estado =
  { fase: 'cargando' } | { fase: 'error'; aviso: DatosDeAviso } | { fase: 'listo'; resumen: ResumenDeBorrado };

const t = textos.autorizacion.hojaNoAutorizo;
const borrar = textos.borrarCuenta;

// La hoja «¿No autorizas?» de PN-54 (E14-PME 4.11, D-102, D-103), hoja inferior (E14-SDD 5.12): explica, ofrece «Descargar
// mis datos», pide la contraseña y tiene «Volver y decidir» y «Borrar mi cuenta». La usa PN-64 cuando «No autorizo» no
// puede borrar de un toque: la cuenta de antes del cambio, con historial, a la que solo le falta una aceptación
// (SC-E21-25, sección 5, paso 3). Reutiliza lo de PN-69: el resumen de lo que se borra (los menores que dependen solo de
// la persona, RN-006), el borrado con la contraseña y la descarga. Nunca llama al rechazo que borra sin preguntar. Sus
// avisos los dice la región viva de la hoja; los errores de campo, el campo al recibir el foco (ACC-004).
export function HojaNoAutorizo({
  navigation,
  alCerrar,
}: {
  navigation: NavigationProp<Rutas>;
  alCerrar: () => void;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [contrasena, setContrasena] = useState('');
  const [confirmaMenores, setConfirmaMenores] = useState(false);
  const [errores, setErrores] = useState<{ contrasena?: string; menores?: string }>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { descarga, descargar } = useDescargaDeDatos(navigation);
  const campoContrasena = useRef<TextInputInstance>(null);
  const casillaDeMenores = useRef<HostInstance>(null);
  const avisarErrores = useAvisarErrores();

  useEffect(() => {
    let vigente = true;
    void resumenDeBorrado().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) setEstado({ fase: 'listo', resumen: respuesta.cuerpo });
      else if (!seguirPorAccesoNegado(navigation, respuesta))
        setEstado({ fase: 'error', aviso: avisoDeFallo(respuesta, avisos.errorAlCargarTusDatos) });
    });
    return () => {
      vigente = false;
    };
  }, [intento, navigation]);

  const menores = estado.fase === 'listo' ? estado.resumen.menores : [];
  const nombres = nombresEnFrase(menores.map((m) => m.nombre));

  async function enviar() {
    if (enviando || estado.fase !== 'listo') return;
    if (contrasena === '') {
      setErrores({ contrasena: t.errorContrasena });
      setAviso(null);
      avisarErrores([{ error: t.errorContrasena, campo: campoContrasena }]);
      return;
    }
    setEnviando(true);
    const respuesta = await borrarLaCuenta({
      contrasena,
      confirma_menores: confirmaMenores,
      menores: menores.map((m) => m.id),
    });
    setEnviando(false);
    // El token ya se borró del Keystore: la persona vuelve a PN-60 sin poder volver atrás a su cuenta.
    if (respuesta.ok) return reemplazarPila(navigation, 'Entrar', { llegada: 'tu_cuenta_borrada' });
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
    if (respuesta.codigo === 'menores_cambiaron') {
      // Los menores ya no son los que se mostraron: no se borró nada. Se vuelve a leer y la casilla se pide de nuevo.
      setConfirmaMenores(false);
      setErrores({});
      setAviso(avisos.errorAlBorrarLaCuenta);
      setEstado({ fase: 'cargando' });
      setIntento(intento + 1);
      return;
    }
    const delCampo: { contrasena?: string; menores?: string } = {};
    if (respuesta.codigo === 'contrasena_incorrecta')
      delCampo.contrasena = textoDeErrorDeCampo(respuesta.codigo, 'borrarCuenta');
    if (respuesta.codigo === 'validacion') {
      const { contrasena: deLaContrasena, confirma_menores: deLosMenores } = respuesta.campos;
      if (deLaContrasena) delCampo.contrasena = t.errorContrasena;
      if (deLosMenores)
        delCampo.menores = formatear(textos.erroresDeCampo.borrarCuenta.confirmacion_requerida, { nombres });
    }
    setErrores(delCampo);
    setAviso(delCampo.contrasena || delCampo.menores ? null : avisoDeFallo(respuesta, avisos.errorAlBorrarLaCuenta));
    avisarErrores([
      { error: delCampo.menores, campo: casillaDeMenores },
      { error: delCampo.contrasena, campo: campoContrasena },
    ]);
  }

  return (
    <HojaInferior visible desplazable titulo={t.titulo} alCerrar={alCerrar}>
      {descarga.fase === 'aviso' && <Aviso {...descarga.aviso} />}
      {aviso && <Aviso {...aviso} />}
      {estado.fase === 'error' && <Aviso {...estado.aviso} />}
      <Texto>{t.explicacion}</Texto>
      <Texto variante="ayuda">{t.antesDescarga}</Texto>
      <BotonDeTexto deshabilitado={descarga.fase === 'preparando'} alTocar={() => void descargar()}>
        {descarga.fase === 'preparando' ? textos.descargarMisDatos.preparando : textos.descargarMisDatos.boton}
      </BotonDeTexto>
      <Texto variante="ayuda">{textos.descargarMisDatos.ayuda}</Texto>
      {menores.length > 0 && (
        <>
          <Texto>{plural(borrar.menores.dependen, menores.length, { nombres })}</Texto>
          <Casilla
            ref={casillaDeMenores}
            texto={plural(borrar.menores.casilla, menores.length, { nombres })}
            marcada={confirmaMenores}
            alCambiar={setConfirmaMenores}
            error={errores.menores}
          />
        </>
      )}
      {estado.fase !== 'error' && (
        <CampoDeContrasena
          ref={campoContrasena}
          etiqueta={borrar.contrasena.etiqueta}
          ayuda={borrar.contrasena.ayuda}
          autocompletar="current-password"
          valor={contrasena}
          alCambiar={setContrasena}
          error={errores.contrasena}
        />
      )}
      {estado.fase === 'error' && (
        <Boton
          variante="secundario"
          alTocar={() => {
            setEstado({ fase: 'cargando' });
            setIntento(intento + 1);
          }}
        >
          {textos.acciones.intentarDeNuevo}
        </Boton>
      )}
      <Boton alTocar={alCerrar}>{t.volver}</Boton>
      {estado.fase === 'listo' && (
        <Boton variante="destructivo" deshabilitado={enviando} alTocar={() => void enviar()}>
          {borrar.borrarMiCuenta}
        </Boton>
      )}
    </HojaInferior>
  );
}
