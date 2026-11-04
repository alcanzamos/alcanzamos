import { descargarMisDatos, NOMBRE_DEL_ZIP } from '../../src/api/descarga';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

// Los módulos nativos: un «sistema de mockArchivos» en memoria que cuenta lo escrito y lo borrado, y la mockHoja de compartir.
const mockArchivos = new Map<string, Uint8Array>();
const mockHoja = { shareAsync: jest.fn() };
let mockFallaAlEscribir = false;
let mockFallaAlBorrar = false;

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string;
    constructor(base: string, nombre: string) {
      this.uri = `${base}/${nombre}`;
    }
    get exists() {
      return mockArchivos.has(this.uri);
    }
    write(contenido: Uint8Array) {
      if (mockFallaAlEscribir) throw new Error('disco lleno');
      mockArchivos.set(this.uri, contenido);
    }
    delete() {
      if (mockFallaAlBorrar) throw new Error('no se pudo borrar');
      mockArchivos.delete(this.uri);
    }
  },
}));
jest.mock('expo-sharing', () => ({
  shareAsync: (...argumentos: unknown[]) => mockHoja.shareAsync(...argumentos),
}));

const zip = (estado = 200) => {
  const r = respuestaJson(estado, {}) as Response & { arrayBuffer: () => Promise<ArrayBuffer> };
  r.arrayBuffer = async () => new Uint8Array([80, 75]).buffer;
  return r;
};

describe('«Descargar mis datos» en Android (PN-69, D-180)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    mockArchivos.clear();
    mockHoja.shareAsync.mockReset().mockResolvedValue(undefined);
    mockFallaAlEscribir = false;
    mockFallaAlBorrar = false;
  });

  it('pide GET /api/v1/cuenta/datos con el Bearer y la cabecera de Android, y sin Origin', async () => {
    const { pedidos } = instalarFetchFalso(zip());
    await descargarMisDatos();
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuenta/datos');
    expect(pedidos[0]?.init.method).toBe('GET');
    expect(pedidos[0]?.init.headers).toEqual({
      Accept: 'application/zip',
      'X-Alcanzamos-Cliente': 'android',
      Authorization: 'Bearer tk-activa',
    });
  });

  it('éxito: escribe en la caché, abre la mockHoja con application/zip y borra el archivo', async () => {
    instalarFetchFalso(zip());
    let existiaAlCompartir = false;
    mockHoja.shareAsync.mockImplementation(async (uri: string) => {
      existiaAlCompartir = mockArchivos.has(uri) && mockArchivos.get(uri)?.length === 2;
    });
    expect(await descargarMisDatos()).toEqual({ ok: true });
    expect(existiaAlCompartir).toBe(true);
    expect(mockHoja.shareAsync).toHaveBeenCalledWith(
      `file:///cache/${NOMBRE_DEL_ZIP}`,
      expect.objectContaining({ mimeType: 'application/zip' }),
    );
    expect(mockArchivos.size).toBe(0);
  });

  it('la persona cancela la mockHoja (o falla): el archivo se borra igual y no es un éxito', async () => {
    instalarFetchFalso(zip());
    mockHoja.shareAsync.mockRejectedValue(new Error('cancelado'));
    expect(await descargarMisDatos()).toMatchObject({ ok: false, codigo: 'archivo_no_preparado' });
    expect(mockArchivos.size).toBe(0);
  });

  it('un error al escribir: no abre la mockHoja y no queda nada', async () => {
    instalarFetchFalso(zip());
    mockFallaAlEscribir = true;
    expect(await descargarMisDatos()).toMatchObject({ ok: false, codigo: 'archivo_no_preparado' });
    expect(mockHoja.shareAsync).not.toHaveBeenCalled();
    expect(mockArchivos.size).toBe(0);
  });

  it('si el borrado falla no tapa el resultado', async () => {
    instalarFetchFalso(zip());
    mockFallaAlBorrar = true;
    expect(await descargarMisDatos()).toEqual({ ok: true });
  });

  it.each([
    [401, { error: 'sin_sesion' }, 'sin_sesion'],
    [403, { error: 'autorizacion_pendiente' }, 'autorizacion_pendiente'],
    [500, { error: 'error_interno' }, 'error_interno'],
  ])('el API contesta %i: trae su código, no escribe ni comparte nada', async (estado, cuerpo, codigo) => {
    instalarFetchFalso(respuestaJson(estado, cuerpo));
    expect(await descargarMisDatos()).toEqual({ ok: false, estado, codigo, campos: {} });
    expect(mockHoja.shareAsync).not.toHaveBeenCalled();
    expect(mockArchivos.size).toBe(0);
  });

  it('una respuesta de error sin JSON da «desconocido»', async () => {
    instalarFetchFalso(respuestaJson(502));
    expect(await descargarMisDatos()).toMatchObject({ ok: false, estado: 502, codigo: 'desconocido' });
  });

  it('sin conexión o sin dirección del API: estado 0 y nada en disco', async () => {
    instalarFetchFalso(new TypeError('Network request failed'));
    expect(await descargarMisDatos()).toMatchObject({ ok: false, estado: 0, codigo: 'sin_conexion' });
    delete process.env.EXPO_PUBLIC_URL_API;
    expect(await descargarMisDatos()).toMatchObject({ ok: false, estado: 0, codigo: 'sin_configuracion' });
    expect(mockArchivos.size).toBe(0);
  });
});
