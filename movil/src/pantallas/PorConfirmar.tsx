import type { NavigationProp } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Respuesta } from '../api/cliente';
import { confirmarFecha, omitirFecha, type FechaPorConfirmar, type Pendientes } from '../api/repeticiones';
import { Aviso } from '../componentes/Aviso';
import { Boton, BotonDeTexto } from '../componentes/Boton';
import { cifras } from '../componentes/Cifras';
import { Tarjeta } from '../componentes/Tarjeta';
import { Texto } from '../componentes/Texto';
import { formatearPesos } from '../dinero';
import { estiloDeTipografia } from '../fuentes';
import { montoHablado } from '../montoHablado';
import { seguirPorAccesoNegado } from '../navegacion/accesoNegado';
import type { Rutas } from '../navegacion/rutas';
import { avisoDeFallo, resumenPorConfirmar, type DatosDeAviso } from '../textos';
import { avisoDeConfirmado, avisosDePorConfirmar, textosDeFilaPorConfirmar } from '../textosDePorConfirmar';
import { textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { HojaDeMas, HojaDeMonto, HojaDeNoPaso } from './HojasDeFecha';

const p = textos.porConfirmar;

type Hoja = { tipo: 'mas' | 'monto' | 'no_paso'; fila: FechaPorConfirmar };

export const claveDe = (fila: FechaPorConfirmar) => `${fila.recurrente_id}-${fila.fecha}`;

type AlTerminar = {
  navigation: NavigationProp<Rutas>;
  alEmpezar: () => void;
  alTerminar: (aviso: DatosDeAviso) => void;
  refrescar: () => void;
};

/**
 * «Confirmar», «Cambiar el monto» y «No pasó» de una fecha por confirmar (E14-PRR 4.1, D-091 y D-092): la hoja abierta,
 * el envío en curso y el error, compartidos por las filas de una lista. Lo usan PN-01 y PN-08 (E14-PPA 4.3).
 */
export function usePorConfirmar({ navigation, alEmpezar, alTerminar, refrescar }: AlTerminar) {
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<DatosDeAviso | null>(null);

  // Un fallo no cambia nada: la fecha sigue por confirmar. Un 409 (otra petición la resolvió o hubo un choque en la
  // base) pide la lista de nuevo: el cliente decide con lo que hay ahora (api/README.md, «Concurrencia»).
  const fallar = (respuesta: Extract<Respuesta<unknown>, { ok: false }>, generico: DatosDeAviso) => {
    if (seguirPorAccesoNegado(navigation, respuesta)) return;
    if (respuesta.estado === 409) refrescar();
    setHoja(null);
    setError(avisoDeFallo(respuesta, generico));
  };

  async function confirmar(fila: FechaPorConfirmar, centavos?: bigint) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    alEmpezar();
    const respuesta = await confirmarFecha(fila.recurrente_id, fila.fecha, centavos);
    setEnviando(false);
    if (!respuesta.ok) return fallar(respuesta, avisosDePorConfirmar.errorAlConfirmar);
    setHoja(null);
    alTerminar(avisoDeConfirmado(respuesta.cuerpo));
  }

  async function noPaso(fila: FechaPorConfirmar) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    alEmpezar();
    const respuesta = await omitirFecha(fila.recurrente_id, fila.fecha);
    setEnviando(false);
    if (!respuesta.ok) return fallar(respuesta, avisosDePorConfirmar.errorAlOmitir);
    setHoja(null);
    alTerminar(avisosDePorConfirmar.yaNoContamos);
  }

  return { hoja, setHoja, enviando, error, confirmar, noPaso };
}

export type ControlDePorConfirmar = ReturnType<typeof usePorConfirmar>;

/** «Confirmar» y «Más» de una fila «Por confirmar» (E14-PRR 7.1, propuesta 3), con los nombres accesibles de E14. */
export function AccionesPorConfirmar({ fila, control }: { fila: FechaPorConfirmar; control: ControlDePorConfirmar }) {
  const t = textosDeFilaPorConfirmar(fila);
  return (
    <View style={estilos.acciones}>
      <Boton
        variante="secundario"
        nombre={t.nombreDeConfirmar}
        deshabilitado={control.enviando}
        alTocar={() => void control.confirmar(fila)}
      >
        {p.confirmar}
      </Boton>
      <BotonDeTexto nombre={t.nombreDeMas} alTocar={() => control.setHoja({ tipo: 'mas', fila })}>
        {p.mas}
      </BotonDeTexto>
    </View>
  );
}

/** Las hojas de la fila abierta: «Más», «Cambiar el monto» y «No pasó» (`HojasDeFecha.tsx`). */
export function HojasPorConfirmar({ control }: { control: ControlDePorConfirmar }) {
  const { hoja, setHoja, enviando, confirmar, noPaso } = control;
  if (hoja?.tipo === 'mas')
    return (
      <HojaDeMas
        fila={hoja.fila}
        alCerrar={() => setHoja(null)}
        alElegir={(opcion) => setHoja({ tipo: opcion === 'monto' ? 'monto' : 'no_paso', fila: hoja.fila })}
      />
    );
  if (hoja?.tipo === 'monto')
    return (
      <HojaDeMonto
        fila={hoja.fila}
        textoDelBoton={p.hoja.confirmar}
        enviando={enviando}
        alCerrar={() => setHoja(null)}
        alConfirmar={(centavos) => void confirmar(hoja.fila, centavos)}
      />
    );
  if (hoja?.tipo === 'no_paso')
    return <HojaDeNoPaso enviando={enviando} alCerrar={() => setHoja(null)} alConfirmar={() => void noPaso(hoja.fila)} />;
  return null;
}

// La sección «Por confirmar» de PN-01 (E14-PRR 4.1, D-091 a D-093): una fila por fecha que ya llegó, con «Confirmar» a
// la vista y «Más» (D-092) para «Cambiar el monto» y «No pasó». Con más de una fecha, el resumen y «Confirmar todos».
// Qué fechas hay lo decide el API (E17-ECO 4.7): aquí solo se muestran y se mandan las decisiones.
export function PorConfirmar({ datos, ...alTerminar }: AlTerminar & { datos: Pendientes }) {
  const control = usePorConfirmar(alTerminar);
  const { pendientes, resumen } = datos;

  return (
    <Tarjeta titulo={p.titulo}>
      <Texto variante="ayuda">{pendientes.length > 1 ? p.textoVarias : p.textoUna}</Texto>
      {pendientes.length > 1 && (
        <>
          <Text style={estilos.resumen}>{cifras(resumenPorConfirmar(resumen.ingresos, resumen.gastos), true)}</Text>
          <Boton variante="secundario" alTocar={() => alTerminar.navigation.navigate('ConfirmarTodos', { pendientes: datos })}>
            {p.confirmarTodos}
          </Boton>
        </>
      )}
      {control.error && <Aviso {...control.error} />}
      {pendientes.map((fila) => {
        const t = textosDeFilaPorConfirmar(fila);
        // ACC-004 (bug 231): TalkBack lee la fila como una unidad, con un solo nombre que trae el monto; «Confirmar» y
        // «Más» siguen siendo dos paradas aparte dentro de ella.
        return (
          <View
            key={claveDe(fila)}
            accessible
            accessibilityLabel={t.etiqueta}
            accessibilityHint={undefined}
            style={estilos.fila}
          >
            <View style={estilos.datos}>
              <View style={estilos.columna}>
                <Text style={estilos.principal}>{cifras(t.principal, true)}</Text>
                <Text style={estilos.apoyo}>{cifras(t.apoyo)}</Text>
                <Text style={estilos.apoyo}>{p.marca}</Text>
              </View>
              <Text
                accessibilityLabel={montoHablado(BigInt(fila.monto_habitual_centavos))}
                accessibilityHint={undefined}
                style={estilos.monto}
              >
                {cifras(formatearPesos(BigInt(fila.monto_habitual_centavos)), true)}
              </Text>
            </View>
            <AccionesPorConfirmar fila={fila} control={control} />
          </View>
        );
      })}
      <HojasPorConfirmar control={control} />
    </Tarjeta>
  );
}

const estilos = StyleSheet.create({
  resumen: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
  // Una Fila de lista · Por confirmar (E14-PRR 7.1): la Fila con valor, sin el ícono Siguiente, y «Confirmar» y «Más».
  fila: {
    gap: tokens.espacio['2'],
    paddingTop: tokens.espacio['3'],
    borderTopWidth: tokens['ancho-borde'].fino,
    borderTopColor: tokens.color.borde.decorativo,
  },
  datos: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.espacio['3'] },
  columna: { flex: 1, gap: tokens.espacio['1'] },
  principal: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
  apoyo: { ...estiloDeTipografia('pequeno'), color: tokens.color.texto.secundario },
  monto: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
  acciones: { flexDirection: 'row', alignItems: 'center', gap: tokens.espacio['2'] },
});
