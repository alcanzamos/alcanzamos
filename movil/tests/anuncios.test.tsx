import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { anunciar, configuracionDeAnuncios, ESPERA_DEL_ANUNCIO_MS, leerMecanismo } from '../src/anuncios';
import { HojaInferior } from '../src/componentes/HojaInferior';
import { MensajeDeEstado } from '../src/componentes/MensajeDeEstado';
import { Pantalla } from '../src/componentes/Pantalla';
import { RegionDeAnuncios } from '../src/componentes/RegionDeAnuncios';
import { avisos } from '../src/textos';
import { anunciados, regionesVivas, textoDe, textosDe, usarMecanismo } from './ayudas/anuncios';

const adelantar = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

const anunciarAhora = (texto: string) =>
  act(async () => {
    anunciar(texto);
    jest.advanceTimersByTime(ESPERA_DEL_ANUNCIO_MS);
  });

describe('ACC-004: las dos variantes de los anuncios (EXPO_PUBLIC_ANUNCIOS, temporal)', () => {
  describe('el interruptor', () => {
    it.each([
      [undefined, 'region'],
      ['', 'region'],
      ['region', 'region'],
      [' region ', 'region'],
      ['anuncio', 'anuncio'],
      [' anuncio\n', 'anuncio'],
    ] as const)('%j elige la variante %s', (valor, mecanismo) => {
      expect(leerMecanismo(valor)).toBe(mecanismo);
    });

    it('un valor desconocido usa la región viva y lo avisa en la consola', () => {
      const aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(leerMecanismo('anuncios')).toBe('region');
      expect(aviso).toHaveBeenCalledWith(
        '[anuncios] EXPO_PUBLIC_ANUNCIOS="anuncios" no es «region» ni «anuncio»: se usa «region».',
      );
      aviso.mockRestore();
    });

    it('se lee una vez, al cargar el módulo; por omisión es la región viva', () => {
      const original = process.env.EXPO_PUBLIC_ANUNCIOS;
      const cargar = () => {
        let configuracion: typeof configuracionDeAnuncios | undefined;
        jest.isolateModules(() => {
          configuracion = jest.requireActual<typeof import('../src/anuncios')>('../src/anuncios').configuracionDeAnuncios;
        });
        return configuracion!;
      };
      try {
        delete process.env.EXPO_PUBLIC_ANUNCIOS;
        expect(cargar().mecanismo).toBe('region');
        process.env.EXPO_PUBLIC_ANUNCIOS = 'anuncio';
        const cargada = cargar();
        expect(cargada.mecanismo).toBe('anuncio');
        process.env.EXPO_PUBLIC_ANUNCIOS = 'region';
        expect(cargada.mecanismo).toBe('anuncio');
      } finally {
        process.env.EXPO_PUBLIC_ANUNCIOS = original;
      }
    });
  });

  describe('variante «region»: una región viva que React Native no aplana', () => {
    usarMecanismo('region');
    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    it('la región es una vista nativa (collapsable={false}) con la región viva «polite», montada desde el principio y vacía', async () => {
      await render(<RegionDeAnuncios />);
      const [region, ...otras] = regionesVivas();
      expect(otras).toEqual([]);
      expect(region!.type).toBe('View');
      expect(region!.props.collapsable).toBe(false);
      expect(region!.props.accessibilityLiveRegion).toBe('polite');
      expect(textoDe(region!)).toBe('');
    });

    it('queda en el árbol de accesibilidad sin verse: 1 × 1 dp, recortada y con el texto transparente, nunca de tamaño cero, oculta ni sin opacidad', async () => {
      await render(<RegionDeAnuncios />);
      const region = regionesVivas()[0]!;
      expect(region).toHaveStyle({ position: 'absolute', width: 1, height: 1, overflow: 'hidden' });
      expect(region).not.toHaveStyle({ display: 'none' });
      expect(region).not.toHaveStyle({ opacity: 0 });
      expect(region.props.importantForAccessibility).toBeUndefined();
      expect(region.props.accessibilityElementsHidden).toBeUndefined();
      expect(textosDe(region)[0]).toHaveStyle({ color: 'transparent' });
    });

    it('anunciar cambia el texto de la región pasada la espera, sin announceForAccessibility', async () => {
      await render(<RegionDeAnuncios />);
      await act(async () => {
        anunciar('Falta el correo electrónico.');
      });
      await adelantar(ESPERA_DEL_ANUNCIO_MS - 1);
      expect(textoDe(regionesVivas()[0]!)).toBe('');
      await adelantar(1);
      expect(textoDe(regionesVivas()[0]!)).toBe('Falta el correo electrónico.');
      expect(anunciados()).toEqual([]);
    });

    it('el mismo texto otra vez es un texto nuevo en la región (otra vista), para que TalkBack lo vuelva a decir', async () => {
      await render(<RegionDeAnuncios />);
      await anunciarAhora('Listo, guardamos los cambios.');
      const primero = textosDe(regionesVivas()[0]!)[0];
      await screen.rerender(<RegionDeAnuncios />);
      expect(textosDe(regionesVivas()[0]!)[0]).toBe(primero);
      await anunciarAhora('Listo, guardamos los cambios.');
      const segundo = textosDe(regionesVivas()[0]!)[0];
      expect(segundo).not.toBe(primero);
      expect(textoDe(regionesVivas()[0]!)).toBe('Listo, guardamos los cambios.');
    });

    it('cancelado antes de la espera, la región no cambia', async () => {
      await render(<RegionDeAnuncios />);
      await act(async () => {
        anunciar('No pudimos guardar.')();
      });
      await adelantar(ESPERA_DEL_ANUNCIO_MS * 2);
      expect(textoDe(regionesVivas()[0]!)).toBe('');
    });

    it('lo dice la última región montada (la pantalla o la hoja de arriba); al irse, vuelve a la anterior', async () => {
      const Dos = ({ hoja }: { hoja: boolean }) => (
        <>
          <RegionDeAnuncios />
          {hoja && <RegionDeAnuncios />}
        </>
      );
      await render(<Dos hoja />);
      await anunciarAhora('En la hoja.');
      expect(regionesVivas().map(textoDe)).toEqual(['', 'En la hoja.']);
      await screen.rerender(<Dos hoja={false} />);
      await anunciarAhora('En la pantalla.');
      expect(regionesVivas().map(textoDe)).toEqual(['En la pantalla.']);
    });

    it('sin ninguna región montada no pasa nada', async () => {
      await anunciarAhora('Nadie lo oye.');
      expect(anunciados()).toEqual([]);
    });

    it('Pantalla lleva su región fuera de lo que se desplaza, después del contenido', async () => {
      await render(
        <Pantalla titulo="Inicia sesión">
          <Text>Contenido</Text>
        </Pantalla>,
      );
      const [region, ...otras] = regionesVivas();
      expect(otras).toEqual([]);
      expect(region!.props.collapsable).toBe(false);
      expect(region!.parent!.type).toBe('');
      const raiz = screen.container.children as { type: string }[];
      expect(raiz.map((hijo) => hijo.type)).toEqual(['RCTScrollView', 'View']);
    });

    it('HojaInferior lleva su región dentro de la hoja (la ventana modal que TalkBack recorre)', async () => {
      await render(
        <HojaInferior visible alCerrar={jest.fn()} titulo="Cambiar el monto">
          <Text>Contenido</Text>
        </HojaInferior>,
      );
      const [region, ...otras] = regionesVivas();
      expect(otras).toEqual([]);
      expect(region!.props.collapsable).toBe(false);
      let ancestro = region!.parent;
      while (ancestro && !ancestro.props.accessibilityViewIsModal) ancestro = ancestro.parent;
      expect(ancestro).not.toBeNull();
    });

    it('bug 225: el mensaje de estado de la llegada lo dice la región de la pantalla; el Aviso no lleva región propia', async () => {
      await render(<Pantalla titulo="Inicia sesión" estado={avisos.sesionCerrada} />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      const [region, ...otras] = regionesVivas();
      expect(otras).toEqual([]);
      expect(textoDe(region!)).toBe('Tu sesión se cerró. Entra de nuevo.');
      expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBeUndefined();
      expect(anunciados()).toEqual([]);
    });

    it('bug 225: cada llegada se vuelve a decir, aunque repita el texto', async () => {
      const aviso = { tipo: 'logro' as const, titulo: 'Listo, guardamos los cambios.' };
      const Llegada = ({ estado }: { estado: typeof aviso }) => (
        <>
          <MensajeDeEstado aviso={estado} />
          <RegionDeAnuncios />
        </>
      );
      await render(<Llegada estado={aviso} />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      const primero = textosDe(regionesVivas()[0]!)[0];
      await screen.rerender(<Llegada estado={{ ...aviso }} />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      expect(textosDe(regionesVivas()[0]!)[0]).not.toBe(primero);
      expect(textoDe(regionesVivas()[0]!)).toBe('Listo, guardamos los cambios.');
    });
  });

  describe('variante «anuncio»: announceForAccessibility, sin región viva', () => {
    usarMecanismo('anuncio');
    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    it('no hay ninguna región viva en la pantalla ni en la hoja', async () => {
      await render(
        <Pantalla titulo="Inicia sesión" estado={avisos.sesionCerrada}>
          <HojaInferior visible alCerrar={jest.fn()}>
            <Text>Contenido</Text>
          </HojaInferior>
        </Pantalla>,
      );
      expect(regionesVivas()).toEqual([]);
    });

    it('anunciar llama a announceForAccessibility pasada la espera', async () => {
      await render(<RegionDeAnuncios />);
      await act(async () => {
        anunciar('Falta el correo electrónico.');
      });
      await adelantar(ESPERA_DEL_ANUNCIO_MS - 1);
      expect(anunciados()).toEqual([]);
      await adelantar(1);
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Falta el correo electrónico.');
    });
  });
});
