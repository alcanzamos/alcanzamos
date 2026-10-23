import AsyncStorage from '@react-native-async-storage/async-storage';
import { DURACION_DEL_RECUERDO_MS, hayMenorRecordado, recordarMenor } from '../../src/edad/recuerdo';

const AHORA = Date.UTC(2026, 9, 23, 17, 0, 0);

describe('recuerdo del resultado de PN-65 (D-089)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('dura 24 horas', () => {
    expect(DURACION_DEL_RECUERDO_MS).toBe(86_400_000);
  });

  it('guarda solo el resultado y la hora hasta la que vale: ni fecha de nacimiento ni edad', async () => {
    await recordarMenor(AHORA);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const [clave, valor] = jest.mocked(AsyncStorage.setItem).mock.calls[0] as [string, string];
    expect(clave).toBe('edad.resultado');
    expect(JSON.parse(valor)).toEqual({ resultado: 'menor', hasta: AHORA + DURACION_DEL_RECUERDO_MS });
    expect(Object.keys(JSON.parse(valor)).sort()).toEqual(['hasta', 'resultado']);
  });

  it('sin recuerdo no hay menor recordado', async () => {
    expect(await hayMenorRecordado(AHORA)).toBe(false);
  });

  it('dentro de las 24 horas lo recuerda, también cerrando y abriendo la app (el valor está guardado)', async () => {
    await recordarMenor(AHORA);
    expect(await hayMenorRecordado(AHORA)).toBe(true);
    expect(await hayMenorRecordado(AHORA + DURACION_DEL_RECUERDO_MS - 1)).toBe(true);
  });

  it('pasadas las 24 horas lo olvida y borra lo guardado', async () => {
    await recordarMenor(AHORA);
    expect(await hayMenorRecordado(AHORA + DURACION_DEL_RECUERDO_MS)).toBe(false);
    expect(await AsyncStorage.getItem('edad.resultado')).toBeNull();
  });

  it.each([
    ['un texto que no es JSON', 'no-es-json'],
    ['un valor que no es un objeto', '3'],
    ['otro resultado', JSON.stringify({ resultado: 'mayor', hasta: AHORA + 1000 })],
    ['una hora que no es un número', JSON.stringify({ resultado: 'menor', hasta: 'mañana' })],
  ])('con %s no hay menor recordado', async (_caso, guardado) => {
    await AsyncStorage.setItem('edad.resultado', guardado);
    expect(await hayMenorRecordado(AHORA)).toBe(false);
  });

  it('si el almacenamiento falla, se pregunta de nuevo y no se rompe nada', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('sin almacenamiento'));
    expect(await hayMenorRecordado(AHORA)).toBe(false);
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('sin almacenamiento'));
    await expect(recordarMenor(AHORA)).resolves.toBeUndefined();
  });
});
