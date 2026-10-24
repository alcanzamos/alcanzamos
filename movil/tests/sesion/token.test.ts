import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';
import { borrarToken, guardarToken, leerToken } from '../../src/sesion/token';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const mockAlmacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

describe('token de la sesión', () => {
  beforeEach(() => {
    mockAlmacen.guardado.clear();
    mockAlmacen.llamadas.length = 0;
  });

  it('se guarda, se lee y se borra solo con expo-secure-store (Keystore)', async () => {
    expect(await leerToken()).toBeNull();
    await guardarToken('token-de-prueba');
    expect(await leerToken()).toBe('token-de-prueba');
    await borrarToken();
    expect(await leerToken()).toBeNull();
    expect(mockAlmacen.llamadas.map((l) => l.metodo)).toEqual(['get', 'set', 'get', 'delete', 'get']);
  });

  it('usa una sola clave', async () => {
    await guardarToken('a');
    await guardarToken('b');
    expect([...mockAlmacen.guardado.keys()]).toEqual(['sesion']);
  });
});
