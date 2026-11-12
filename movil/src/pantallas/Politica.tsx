import { Linking, StyleSheet, Text } from 'react-native';
import { Boton } from '../componentes/Boton';
import { FilaDeFinalidad } from '../componentes/FilaDeFinalidad';
import { Pantalla } from '../componentes/Pantalla';
import { Tarjeta } from '../componentes/Tarjeta';
import { Nota, Texto } from '../componentes/Texto';
import { Vinetas } from '../componentes/Vinetas';
import { diaEnPalabras } from '../fechas';
import { estiloDeTipografia } from '../fuentes';
import { VERSION_DE_LA_POLITICA } from '../politica';
import { finalidadesDeE14 } from '../textos';
import { formatear, textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';

const t = textos.politica;
const finalidades = t.finalidades;

type Fila = { codigo: string; nombre: string; descripcion: string };

// Las finalidades de E14-PCP 5 que PN-68 lista (fila 4), separadas en «Necesarias» y «Opcionales». Las de la persona
// adulta salen del mismo texto de PN-64; las del menor son de PN-36 y de la pantalla del menor. La aceptación de la
// transmisión a los encargados no es una fila: la explica la tarjeta «Dónde guardamos tus datos» (fila 5 b).
const fila = (codigo: string, { nombre, descripcion }: { nombre: string; descripcion: string }): Fila => ({
  codigo,
  nombre,
  descripcion,
});
const necesarias: Fila[] = [
  fila('cuenta_y_acceso', finalidadesDeE14.cuenta_y_acceso!),
  fila('funciones_financieras', finalidadesDeE14.funciones_financieras!),
  fila('cuenta_del_menor', finalidades.cuenta_del_menor),
];
const opcionales: Fila[] = [
  fila('avisos', finalidadesDeE14.avisos!),
  fila('horas_de_vida', finalidadesDeE14.horas_de_vida!),
  fila('correo_del_menor', finalidades.correo_del_menor),
];

function Grupo({ titulo, filas }: { titulo: string; filas: Fila[] }) {
  return (
    <>
      <Text accessibilityRole="header" style={estilos.grupo}>
        {titulo}
      </Text>
      {filas.map(({ codigo, nombre, descripcion }) => (
        <FilaDeFinalidad key={codigo} nombre={nombre} descripcion={descripcion} />
      ))}
    </>
  );
}

// PN-68 · Política de tratamiento, canal de consultas y de reclamos, y responsable (E14-PCP 4.11, RF-059, RF-060, D-195).
// Informativa y pública: no hay formulario (D-088) ni hace falta una cuenta, y el texto va en la app, así que no carga
// nada ni tiene estado de error de carga. La versión es la del texto vigente (RF-063). Se apila sobre la pantalla que la
// abre y su Atrás, el de la barra nativa o el del sistema, vuelve ahí. El título lo pone la barra. «Escribir al correo»
// abre la aplicación de correo del dispositivo con la dirección escrita. Sin la nota del menor (fila 8): la cuenta de un
// menor se construye en I11 y esta pantalla no sabe quién la abre.
export function Politica() {
  const fecha = diaEnPalabras(VERSION_DE_LA_POLITICA.fecha);
  return (
    <Pantalla conBarra>
      <Nota>
        {formatear(t.version, {
          numero: VERSION_DE_LA_POLITICA.numero,
          fecha: fecha ?? VERSION_DE_LA_POLITICA.fecha,
        })}
      </Nota>
      <Tarjeta titulo={t.responsable.titulo}>
        <Texto>{t.responsable.proyecto}</Texto>
        <Texto>{t.responsable.nombre}</Texto>
        <Texto>{t.responsable.correo}</Texto>
      </Tarjeta>
      <Tarjeta titulo={finalidades.titulo}>
        <Grupo titulo={finalidades.necesarias} filas={necesarias} />
        <Grupo titulo={finalidades.opcionales} filas={opcionales} />
        <Texto>{finalidades.sinVenta}</Texto>
      </Tarjeta>
      <Tarjeta titulo={t.derechos.titulo}>
        <Texto>{t.derechos.intro}</Texto>
        <Vinetas items={Object.values(t.derechos.items)} />
      </Tarjeta>
      <Tarjeta titulo={t.dondeGuardamos.titulo}>
        <Vinetas items={Object.values(t.dondeGuardamos.items)} />
      </Tarjeta>
      <Tarjeta titulo={t.consultas.titulo}>
        <Texto>{t.consultas.intro}</Texto>
        <Vinetas items={Object.values(t.consultas.datos)} />
        <Texto>{t.consultas.menor}</Texto>
        <Text style={estilos.grupo}>{t.consultas.tiempos.titulo}</Text>
        <Vinetas items={[t.consultas.tiempos.consulta, t.consultas.tiempos.reclamo, t.consultas.tiempos.incompleto]} />
        <Texto>{t.consultas.adolescentes}</Texto>
      </Tarjeta>
      <Boton
        variante="secundario"
        alTocar={() => {
          // Sin una aplicación de correo, el dispositivo no puede abrir la dirección: sigue escrita en la pantalla.
          void Linking.openURL(`mailto:${t.escribir.direccion}`).catch(() => undefined);
        }}
      >
        {t.escribir.boton}
      </Boton>
    </Pantalla>
  );
}

const estilos = StyleSheet.create({
  grupo: { ...estiloDeTipografia('cuerpo-destacado'), color: tokens.color.texto.principal },
});
