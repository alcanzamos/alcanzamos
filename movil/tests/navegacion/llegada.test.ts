import { CommonActions } from '@react-navigation/native';
import { avisoDeLlegada, reemplazarPila } from '../../src/navegacion/llegada';
import { avisos } from '../../src/textos';

describe('avisoDeLlegada', () => {
  it('trae el aviso de cada llegada', () => {
    expect(avisoDeLlegada('sesion_cerrada')).toBe(avisos.sesionCerrada);
    expect(avisoDeLlegada('correo_confirmado')).toBe(avisos.correoConfirmado);
    expect(avisoDeLlegada('contrasena_recuperada')).toBe(avisos.contrasenaRecuperada);
    expect(avisoDeLlegada('contrasena_cambiada')).toBe(avisos.contrasenaCambiada);
    expect(avisoDeLlegada('cuenta_borrada')).toBe(avisos.correoBorrado);
  });

  it('sin llegada, o con una que no existe, no hay aviso', () => {
    expect(avisoDeLlegada()).toBeNull();
    expect(avisoDeLlegada('inventada' as never)).toBeNull();
  });
});

describe('reemplazarPila', () => {
  it('deja la pantalla de destino como la única de la pila, para que Atrás no vuelva a la anterior', () => {
    const dispatch = jest.fn();
    reemplazarPila({ dispatch } as never, 'Entrar', { llegada: 'sesion_cerrada' });
    expect(dispatch).toHaveBeenCalledWith(
      CommonActions.reset({ index: 0, routes: [{ name: 'Entrar', params: { llegada: 'sesion_cerrada' } }] }),
    );
  });

  it('sin parámetros manda la ruta sin ellos', () => {
    const dispatch = jest.fn();
    reemplazarPila({ dispatch } as never, 'Entrar');
    expect(dispatch).toHaveBeenCalledWith(
      CommonActions.reset({ index: 0, routes: [{ name: 'Entrar', params: undefined }] }),
    );
  });
});
