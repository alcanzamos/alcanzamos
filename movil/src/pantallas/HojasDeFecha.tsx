import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextInputInstance } from 'react-native';
import type { FechaPorConfirmar } from '../api/repeticiones';
import { useAvisarErrores } from '../anuncios';
import { Boton } from '../componentes/Boton';
import { CampoDeMonto } from '../componentes/CampoDeMonto';
import { HojaInferior } from '../componentes/HojaInferior';
import { IconoSiguiente } from '../componentes/Iconos';
import { Texto } from '../componentes/Texto';
import { formatearPesos, leerMonto } from '../dinero';
import { estiloDeTipografia } from '../fuentes';
import { textosDeFilaPorConfirmar } from '../textosDePorConfirmar';
import { textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { textoDelMonto } from '../validacionDeRegistro';

const h = textos.porConfirmar.hoja;
const ahoraNo = textos.movimientos.detalle.ahoraNo;

export type Opcion = 'monto' | 'no_paso' | 'incluir';

// Las hojas de una fecha por confirmar (E14-PRR 4.1, E14-SDD 5.12): «Más», «No pasó» y «Cambiar el monto». Las usan la
// sección de PN-01 y «Confirmar todos» (4.8). Cada una avisa lo que se eligió; quien las abre guarda.

/** «Más»: «Cambiar el monto» y «No pasó»; en una fila «No pasó» de «Confirmar todos», solo «Volver a incluirla». */
export function HojaDeMas({
  fila,
  conIncluir = false,
  alElegir,
  alCerrar,
}: {
  fila: FechaPorConfirmar;
  conIncluir?: boolean;
  alElegir: (opcion: Opcion) => void;
  alCerrar: () => void;
}) {
  const opciones: [Opcion, string][] = conIncluir
    ? [['incluir', h.volverAIncluirla]]
    : [
        ['monto', h.cambiarElMonto],
        ['no_paso', h.noPaso],
      ];
  return (
    <HojaInferior visible titulo={textosDeFilaPorConfirmar(fila).tituloDeLaHoja} alCerrar={alCerrar}>
      {opciones.map(([opcion, texto]) => (
        <Pressable key={opcion} accessibilityRole="button" onPress={() => alElegir(opcion)} style={estilos.fila}>
          <Text style={estilos.texto}>{texto}</Text>
          <IconoSiguiente color={tokens.color.texto.secundario} />
        </Pressable>
      ))}
    </HojaInferior>
  );
}

/** «¿Esta fecha no pasó?»: sin el Botón destructivo, porque no borra nada y la repetición sigue (RF-006). */
export function HojaDeNoPaso({
  enviando,
  alConfirmar,
  alCerrar,
}: {
  enviando: boolean;
  alConfirmar: () => void;
  alCerrar: () => void;
}) {
  return (
    <HojaInferior visible titulo={h.tituloNoPaso} alCerrar={alCerrar}>
      <Texto>{h.textoNoPaso}</Texto>
      <Boton deshabilitado={enviando} alTocar={alConfirmar}>
        {h.noPaso}
      </Boton>
      <Boton variante="secundario" alTocar={alCerrar}>
        {ahoraNo}
      </Boton>
    </HojaInferior>
  );
}

/** «¿Cuánto llegó?» o «¿Cuánto pagaste?», con el monto habitual escrito; los errores son los de E14-PPN 3.1. */
export function HojaDeMonto({
  fila,
  textoDelBoton,
  enviando = false,
  alConfirmar,
  alCerrar,
}: {
  fila: FechaPorConfirmar;
  textoDelBoton: string;
  enviando?: boolean;
  alConfirmar: (centavos: bigint) => void;
  alCerrar: () => void;
}) {
  const [monto, setMonto] = useState(formatearPesos(BigInt(fila.monto_habitual_centavos)));
  const [error, setError] = useState<string>();
  const campo = useRef<TextInputInstance>(null);
  const avisarErrores = useAvisarErrores();

  const confirmar = () => {
    const lectura = leerMonto(monto);
    if (lectura.ok) alConfirmar(lectura.centavos);
    else {
      const texto = textoDelMonto(lectura);
      setError(texto);
      avisarErrores([{ error: texto, campo }]);
    }
  };

  return (
    <HojaInferior visible titulo={textosDeFilaPorConfirmar(fila).tituloDelMonto} alCerrar={alCerrar}>
      <CampoDeMonto ref={campo} valor={monto} alCambiar={setMonto} error={error} />
      <Texto variante="ayuda">{textos.movimientos.detalle.soloEstaFecha}</Texto>
      <Boton deshabilitado={enviando} alTocar={confirmar}>
        {textoDelBoton}
      </Boton>
      <Boton variante="secundario" alTocar={alCerrar}>
        {ahoraNo}
      </Boton>
    </HojaInferior>
  );
}

const estilos = StyleSheet.create({
  // Una Fila de lista navegable (E14-SDD 5.20): toda la fila es el área táctil.
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espacio['3'],
    minHeight: tokens.tamano['tactil-minimo'],
  },
  texto: { ...estiloDeTipografia('cuerpo'), flex: 1, color: tokens.color.texto.principal },
});
