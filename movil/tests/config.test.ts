import { urlDelApi } from '../src/config';

describe('urlDelApi', () => {
  const original = process.env.EXPO_PUBLIC_URL_API;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_URL_API;
    else process.env.EXPO_PUBLIC_URL_API = original;
  });

  it('toma la dirección de la configuración y le quita la barra final', () => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090/';
    expect(urlDelApi()).toBe('http://api.prueba:18090');
  });

  it('es null si no hay dirección o está vacía', () => {
    delete process.env.EXPO_PUBLIC_URL_API;
    expect(urlDelApi()).toBeNull();
    process.env.EXPO_PUBLIC_URL_API = '   ';
    expect(urlDelApi()).toBeNull();
  });
});
