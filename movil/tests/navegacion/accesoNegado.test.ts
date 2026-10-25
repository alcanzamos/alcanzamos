import { CommonActions } from '@react-navigation/native';
import { seguirPorAccesoNegado } from '../../src/navegacion/accesoNegado';

const fallo = (estado: number, codigo: string) => ({ ok: false as const, estado, codigo, campos: {} });
const reinicio = (nombre: string, params?: object) =>
  CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] });

describe('seguirPorAccesoNegado (api/README.md, «las de /api/ que piden sesión»)', () => {
  it.each([
    [401, 'sin_sesion', reinicio('Entrar', { llegada: 'sesion_cerrada' })],
    [403, 'verificacion_pendiente', reinicio('RevisaTuCorreo', undefined)],
    [403, 'autorizacion_pendiente', reinicio('InformacionDePrivacidad', undefined)],
  ])('%s %s lleva a la pantalla que corresponde', (estado, codigo, accion) => {
    const dispatch = jest.fn();
    expect(seguirPorAccesoNegado({ dispatch } as never, fallo(estado, codigo))).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(accion);
  });

  it.each([
    [400, 'solicitud_invalida'],
    [403, 'otro_codigo'],
    [422, 'validacion'],
    [429, 'demasiados_intentos'],
    [500, 'desconocido'],
    [0, 'sin_conexion'],
  ])('%s %s no cambia de pantalla', (estado, codigo) => {
    const dispatch = jest.fn();
    expect(seguirPorAccesoNegado({ dispatch } as never, fallo(estado, codigo))).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
