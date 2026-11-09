import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ingresoAnterior } from '../api/acceso';
import { cerrarSesion } from '../api/cuentas';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { cifras } from '../componentes/Cifras';
import { Pantalla } from '../componentes/Pantalla';
import { Texto } from '../componentes/Texto';
import { fechaEnPalabras } from '../fechas';
import { estiloDeTipografia } from '../fuentes';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import { avisoDeLlegada, reemplazarPila } from '../navegacion/llegada';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, avisos, type DatosDeAviso } from '../textos';
import { formatear, textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';

type Estado = { fase: 'cargando' } | { fase: 'error'; aviso: DatosDeAviso } | { fase: 'listo'; ingreso: string | null };

// PN-71 · Seguridad de la cuenta: el ingreso anterior, nunca el de ahora (E14-PCP 4.14, RF-062). Es la pantalla de inicio
// provisional de quien entra con autorización, hasta que haya un Inicio. La fecha va en palabras y en la hora de Colombia.
// «Movimientos» es su entrada a PN-01 (E14-SDD 5.9), que ya trae «Registrar» (D-164): aquí no hay botón para registrar.
// «Cerrar sesión» y «Borrar mi cuenta» (filas 7 y 8 de PN-66, que todavía no existe) viven aquí hasta que haya un Perfil:
// el borrado abre PN-69. Arriba de «Cerrar sesión», la entrada provisional «Cómo cuidamos tus datos» abre PN-63 desde el
// menú (4.14, nota del 2026-11-08, bug 260, y 4.16 T2 ter); «Borrar mi cuenta» queda última, como en PN-66. La de PN-68
// («Política de tratamiento y consultas») espera a que exista la pantalla.
export function SeguridadDeLaCuenta({ navigation, route }: NativeStackScreenProps<Rutas, 'SeguridadDeLaCuenta'>) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [sinConexion, setSinConexion] = useState(false);
  const llegada = route.params?.aviso ?? avisoDeLlegada(route.params?.llegada);

  useEffect(() => {
    let vigente = true;
    void ingresoAnterior().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) {
        const ingreso = respuesta.cuerpo.ingreso_anterior;
        setEstado(
          ingreso !== null && fechaEnPalabras(ingreso) === null
            ? { fase: 'error', aviso: avisos.errorAlCargarIngreso }
            : { fase: 'listo', ingreso },
        );
      } else if (!seguirPorAccesoNegado(navigation, respuesta)) {
        setEstado({ fase: 'error', aviso: avisoDeFallo(respuesta, avisos.errorAlCargarIngreso) });
      }
    });
    return () => {
      vigente = false;
    };
  }, [intento, navigation]);

  async function salir() {
    const respuesta = await cerrarSesion();
    // Solo la falta de conexión se queda: cualquier otra respuesta saca a la persona (y borra el token).
    if (!respuesta.ok && respuesta.estado === 0) setSinConexion(true);
    else reemplazarPila(navigation, 'Entrar');
  }

  const fecha = estado.fase === 'listo' && estado.ingreso ? fechaEnPalabras(estado.ingreso) : null;

  return (
    <Pantalla conBarra estado={llegada}>
      {sinConexion && <Aviso {...avisos.sinConexion} />}
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
      {estado.fase === 'listo' && (
        <>
          <View style={estilos.tarjeta}>
            <Text accessibilityRole="header" style={estilos.tituloDeTarjeta}>
              {textos.seguridadDeLaCuenta.tarjeta}
            </Text>
            {fecha ? (
              <>
                <Text style={estilos.fecha}>{cifras(formatear(textos.seguridadDeLaCuenta.ingresoAnterior, { fecha }))}</Text>
                <Texto variante="ayuda">{textos.seguridadDeLaCuenta.ingresoAclaracion}</Texto>
              </>
            ) : (
              <Texto>{textos.seguridadDeLaCuenta.primerIngreso}</Texto>
            )}
          </View>
          {fecha && (
            <>
              <Aviso {...avisos.noReconoceElIngreso} />
              <Boton variante="secundario" alTocar={() => navigation.navigate('CambiarContrasena')}>
                {textos.seguridadDeLaCuenta.cambiarContrasena}
              </Boton>
            </>
          )}
        </>
      )}
      <Boton variante="secundario" alTocar={() => navigation.navigate('ListaDeMovimientos')}>
        {textos.movimientos.titulo}
      </Boton>
      <BotonDeTexto alTocar={() => navigation.navigate('InformacionDePrivacidad', { desdeElMenu: true })}>
        {textos.privacidad.titulo}
      </BotonDeTexto>
      <BotonDeTexto alTocar={() => void salir()}>{textos.acciones.cerrarSesion}</BotonDeTexto>
      <BotonDeTexto alTocar={() => navigation.navigate('BorrarCuenta')}>{textos.borrarCuenta.borrarMiCuenta}</BotonDeTexto>
    </Pantalla>
  );
}

// Tarjeta de E14-SDD 5.7: blanca sobre la página, borde decorativo de 1, `radio.grande`, relleno de 16, sin sombra.
const estilos = StyleSheet.create({
  tarjeta: {
    gap: tokens.espacio['2'],
    padding: tokens.espacio['4'],
    borderWidth: tokens['ancho-borde'].fino,
    borderColor: tokens.color.borde.decorativo,
    borderRadius: tokens.radio.grande,
    backgroundColor: tokens.color.fondo.superficie,
  },
  tituloDeTarjeta: { ...estiloDeTipografia('titulo-3'), color: tokens.color.texto.principal },
  fecha: { ...estiloDeTipografia('cuerpo'), color: tokens.color.texto.principal },
});
