import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Aviso } from '../componentes/Aviso';
import { Boton } from '../componentes/Boton';
import { CampoDeFecha } from '../componentes/CampoDeFecha';
import { Pantalla } from '../componentes/Pantalla';
import { Texto } from '../componentes/Texto';
import { resultadoDeEdad } from '../edad/calculo';
import { hayMenorRecordado, recordarMenor } from '../edad/recuerdo';
import type { Rutas } from '../navegacion/rutas';
import { avisos, textosDeEdad } from '../textos';
import { textos } from '../textos/es.generated';

// PN-65 · Pantalla neutral de edad, solo Android (E14-PCP 4.8, RE-002). Se abre solo desde «Crear una cuenta» de PN-60.
// La edad se calcula aquí: la fecha no se envía a ningún lado ni se guarda (D-089); vive solo en el estado de esta
// pantalla. Del resultado, el teléfono recuerda únicamente «menos de 18» y la hora, 24 horas (`edad/recuerdo.ts`).
// No dice qué edad se necesita. Sin el botón «Ya tengo un usuario: iniciar sesión» hasta I11 (D-137): el Atrás del
// sistema vuelve a PN-60.
export function Edad({ navigation }: NativeStackScreenProps<Rutas, 'Edad'>) {
  const [fase, setFase] = useState<'cargando' | 'campo' | 'menor'>('cargando');
  const [fecha, setFecha] = useState<Date>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let vigente = true;
    void hayMenorRecordado().then((menor) => {
      if (vigente) setFase(menor ? 'menor' : 'campo');
    });
    return () => {
      vigente = false;
    };
  }, []);

  async function continuar() {
    const resultado = resultadoDeEdad(fecha, new Date());
    if (resultado === 'vacia') setError(textosDeEdad.vacia);
    else if (resultado === 'futura') setError(textosDeEdad.futura);
    else if (resultado === 'menor') {
      setFecha(undefined);
      setError(undefined);
      setFase('menor');
      await recordarMenor();
    } else {
      // La persona adulta sigue a PN-58 en lugar de PN-65: Atrás desde ahí vuelve a PN-60, no a esta pantalla.
      navigation.replace('CrearCuenta', { mayorDeEdad: true });
    }
  }

  return (
    <Pantalla conLogo titulo={textos.edad.titulo}>
      {fase === 'menor' && <Aviso {...avisos.menorDeEdad} />}
      {fase === 'campo' && (
        <>
          <Texto>{textos.edad.frase}</Texto>
          <CampoDeFecha
            etiqueta={textos.edad.fecha.etiqueta}
            ayuda={textos.edad.fecha.ayuda}
            valor={fecha}
            alCambiar={(nueva) => {
              setFecha(nueva);
              setError(undefined);
            }}
            error={error}
          />
          <Boton alTocar={() => void continuar()}>{textos.edad.continuar}</Boton>
        </>
      )}
    </Pantalla>
  );
}
