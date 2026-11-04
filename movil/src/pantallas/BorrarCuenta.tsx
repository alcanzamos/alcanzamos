import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { borrarLaCuenta, resumenDeBorrado, type ResumenDeBorrado } from '../api/cuentas';
import { descargarMisDatos } from '../api/descarga';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { CampoDeContrasena } from '../componentes/CampoDeContrasena';
import { Casilla } from '../componentes/Casilla';
import { IconoHogar } from '../componentes/Iconos';
import { Pantalla } from '../componentes/Pantalla';
import { Tarjeta } from '../componentes/Tarjeta';
import { Texto } from '../componentes/Texto';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import { reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, nombresEnFrase, textoDeErrorDeCampo, type DatosDeAviso } from '../textos';
import { formatear, plural, textos } from '../textos/es.generated';

type Estado =
  { fase: 'cargando' } | { fase: 'error'; aviso: DatosDeAviso } | { fase: 'listo'; resumen: ResumenDeBorrado };

const t = textos.borrarCuenta;

// La fila 4 de PN-69 cambia con el hogar (E14-PCP 4.12): quien lo administra con otra persona adulta, la única persona
// adulta, o quien es miembro sin el papel.
function textoDelHogar(hogar: NonNullable<ResumenDeBorrado['hogar']>) {
  const nombre = hogar.nombre ?? t.hogar.nombrePorOmision;
  if (hogar.unica_adulta) return formatear(t.hogar.unicaAdulta, { hogar: nombre });
  if (hogar.es_administradora && hogar.nuevo_administrador)
    return formatear(t.hogar.administradora, {
      nombre: hogar.nuevo_administrador,
    });
  return t.hogar.miembro;
}

// PN-69 · Borrar la cuenta (E14-PCP 4.12, RF-032, RN-006, RN-007): la pantalla es la confirmación. Todo lo que cambia
// según el hogar y los menores sale del API antes de mostrar el botón: sin eso no se puede avisar lo que RN-006 pide.
// «Descargar mis datos» (D-102) no está en esta historia. El título lo pone la barra nativa; Atrás vuelve a PN-71.
export function BorrarCuenta({ navigation }: NativeStackScreenProps<Rutas, 'BorrarCuenta'>) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [contrasena, setContrasena] = useState('');
  const [confirmaMenores, setConfirmaMenores] = useState(false);
  const [errores, setErrores] = useState<{
    contrasena?: string;
    menores?: string;
  }>({});
  const [aviso, setAviso] = useState<DatosDeAviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [descarga, setDescarga] = useState<
    { fase: 'libre' } | { fase: 'preparando' } | { fase: 'aviso'; aviso: DatosDeAviso }
  >({
    fase: 'libre',
  });
  const campoContrasena = useRef<TextInputInstance>(null);

  useEffect(() => {
    let vigente = true;
    void resumenDeBorrado().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) setEstado({ fase: 'listo', resumen: respuesta.cuerpo });
      else if (!seguirPorAccesoNegado(navigation, respuesta))
        setEstado({
          fase: 'error',
          aviso: avisoDeFallo(respuesta, avisos.errorAlCargarTusDatos),
        });
    });
    return () => {
      vigente = false;
    };
  }, [intento, navigation]);

  const menores = estado.fase === 'listo' ? estado.resumen.menores : [];
  const nombres = nombresEnFrase(menores.map((m) => m.nombre));

  // «Descargar mis datos» (D-102, D-180): opcional, no condiciona el borrado ni abre otra pantalla. El archivo se comparte
  // desde la hoja de Android y no queda copia dentro de la app (descarga.ts).
  async function descargar() {
    if (descarga.fase === 'preparando') return;
    setDescarga({ fase: 'preparando' });
    const respuesta = await descargarMisDatos();
    if (respuesta.ok) return setDescarga({ fase: 'aviso', aviso: avisos.descargaLista });
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
    setDescarga({
      fase: 'aviso',
      aviso: avisoDeFallo(respuesta, avisos.errorAlDescargar),
    });
  }

  async function enviar() {
    if (enviando) return;
    setEnviando(true);
    const respuesta = await borrarLaCuenta({
      contrasena,
      confirma_menores: confirmaMenores,
      menores: menores.map((m) => m.id),
    });
    setEnviando(false);
    // El token ya se borró del Keystore: la persona vuelve a PN-60 sin poder volver atrás a su cuenta.
    if (respuesta.ok)
      return reemplazarPila(navigation, 'Entrar', {
        llegada: 'tu_cuenta_borrada',
      });
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
    if (respuesta.codigo === 'menores_cambiaron') {
      // Los menores a cargo ya no son los que se mostraron (RN-006): no se borró nada. Se vuelve a leer el resumen y la
      // casilla vuelve a pedirse, ahora con los de verdad.
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
      if (deLaContrasena) delCampo.contrasena = textoDeErrorDeCampo(deLaContrasena, 'borrarCuenta');
      if (deLosMenores)
        delCampo.menores = formatear(textos.erroresDeCampo.borrarCuenta.confirmacion_requerida, { nombres });
    }
    setErrores(delCampo);
    setAviso(delCampo.contrasena || delCampo.menores ? null : avisoDeFallo(respuesta, avisos.errorAlBorrarLaCuenta));
    if (delCampo.contrasena) campoContrasena.current?.focus();
  }

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
          <Boton variante="secundario" alTocar={() => navigation.goBack()}>
            {t.ahoraNo}
          </Boton>
        </>
      )}
      {estado.fase === 'listo' && (
        <>
          {descarga.fase === 'aviso' && <Aviso {...descarga.aviso} />}
          {aviso && <Aviso {...aviso} />}
          <Aviso {...avisos.vasABorrarTuCuenta} />
          <Tarjeta titulo={t.loQueSeBorra.titulo}>
            <Texto>{t.loQueSeBorra.detalle}</Texto>
            <Texto variante="ayuda">{t.loQueSeBorra.prueba}</Texto>
          </Tarjeta>
          {estado.resumen.hogar && (
            <Tarjeta titulo={estado.resumen.hogar.nombre ?? t.hogar.nombrePorOmision} Icono={IconoHogar}>
              <Texto>{textoDelHogar(estado.resumen.hogar)}</Texto>
            </Tarjeta>
          )}
          {menores.length > 0 && (
            <>
              <Tarjeta titulo={t.menores.titulo}>
                <Texto>{plural(t.menores.dependen, menores.length, { nombres })}</Texto>
              </Tarjeta>
              <Casilla
                texto={plural(t.menores.casilla, menores.length, { nombres })}
                marcada={confirmaMenores}
                alCambiar={setConfirmaMenores}
                error={errores.menores}
              />
            </>
          )}
          <CampoDeContrasena
            ref={campoContrasena}
            etiqueta={t.contrasena.etiqueta}
            ayuda={t.contrasena.ayuda}
            autocompletar="current-password"
            valor={contrasena}
            alCambiar={setContrasena}
            error={errores.contrasena}
          />
          <BotonDeTexto deshabilitado={descarga.fase === 'preparando'} alTocar={() => void descargar()}>
            {descarga.fase === 'preparando' ? textos.descargarMisDatos.preparando : textos.descargarMisDatos.boton}
          </BotonDeTexto>
          <Texto variante="ayuda">{textos.descargarMisDatos.ayuda}</Texto>
          <Boton variante="destructivo" deshabilitado={enviando} alTocar={() => void enviar()}>
            {t.borrarMiCuenta}
          </Boton>
          <Boton variante="secundario" alTocar={() => navigation.goBack()}>
            {t.ahoraNo}
          </Boton>
        </>
      )}
    </Pantalla>
  );
}
