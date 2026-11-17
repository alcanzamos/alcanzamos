import { fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';
import { HojaInferior } from '../../src/componentes/HojaInferior';
import { tokens } from '../../src/tokens/tokens.generated';
import { animacionesAMano, terminarAnimaciones } from '../ayudas/animacion';

describe('HojaInferior (Hoja inferior, E14-SDD 5.12)', () => {
  it('visible muestra su contenido; oculta, no', async () => {
    const { rerender } = await render(
      <HojaInferior visible alCerrar={jest.fn()}>
        <Text>Contenido</Text>
      </HojaInferior>,
    );
    expect(screen.getByText('Contenido')).toBeOnTheScreen();
    await rerender(
      <HojaInferior visible={false} alCerrar={jest.fn()}>
        <Text>Contenido</Text>
      </HojaInferior>,
    );
    expect(screen.queryByText('Contenido')).not.toBeOnTheScreen();
  });

  it('el Atrás de Android (onRequestClose) la cierra', async () => {
    const alCerrar = jest.fn();
    await render(
      <HojaInferior visible alCerrar={alCerrar}>
        <Text>Contenido</Text>
      </HojaInferior>,
    );
    await fireEvent(screen.root!, 'requestClose');
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  it('es una ventana modal para TalkBack y sube desde abajo sobre una hoja blanca con esquinas redondeadas', async () => {
    await render(
      <HojaInferior visible alCerrar={jest.fn()}>
        <Text>Contenido</Text>
      </HojaInferior>,
    );
    const dibujo = JSON.stringify(screen.toJSON());
    expect(dibujo).toContain('"accessibilityViewIsModal":true');
    // La hoja se desliza sola (`translateY`): con el `Modal` en `animationType="none"`, Android no anima la ventana y la
    // hoja sabe cuándo termina de salir (bug 303).
    expect(dibujo).toContain('"animationType":"none"');
    expect(dibujo).toContain('translateY');
    expect(dibujo).toContain(tokens.color.fondo.superficie);
    expect(dibujo).toContain(`"borderTopLeftRadius":${tokens.radio.grande}`);
  });

  it('con título lo muestra como encabezado y trae el ícono «Cerrar», que la cierra (E14-SDD 5.12)', async () => {
    const alCerrar = jest.fn();
    await render(
      <HojaInferior visible titulo="¿Esta fecha no pasó?" alCerrar={alCerrar}>
        <Text>Contenido</Text>
      </HojaInferior>,
    );
    expect(screen.getByRole('header', { name: '¿Esta fecha no pasó?' })).toBeOnTheScreen();
    const cerrar = screen.getByRole('button', { name: 'Cerrar' });
    expect(cerrar).toHaveStyle({ minWidth: tokens.tamano['tactil-minimo'], minHeight: tokens.tamano['tactil-minimo'] });
    await fireEvent.press(cerrar);
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  // ACC-004 (bug 228): sin «Cerrar», TalkBack no tenía cómo salir de la hoja deslizando; el Atrás no se alcanza así.
  it('sin título no lleva encabezado, pero sí el ícono «Cerrar» de 48 dp, que la cierra (bug 228)', async () => {
    const alCerrar = jest.fn();
    await render(
      <HojaInferior visible alCerrar={alCerrar}>
        <Text>Contenido</Text>
      </HojaInferior>,
    );
    expect(screen.queryByRole('header')).not.toBeOnTheScreen();
    const cerrar = screen.getByRole('button', { name: 'Cerrar' });
    expect(cerrar).toHaveStyle({ minWidth: tokens.tamano['tactil-minimo'], minHeight: tokens.tamano['tactil-minimo'] });
    expect(tokens.tamano['tactil-minimo']).toBeGreaterThanOrEqual(48);
    await fireEvent.press(cerrar);
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  // La hoja de «No autorizo» (E14-PME 4.11) trae más contenido que las de presupuesto: explicación, descarga, contraseña y
  // dos botones. Con `desplazable` el contenido se desplaza dentro de la hoja, que no pasa de la altura de la ventana, y
  // la región viva queda fuera de lo que se desplaza.
  it('con `desplazable` el contenido va en un ScrollView que deja tocar los botones con el teclado abierto', async () => {
    await render(
      <HojaInferior visible desplazable titulo="¿No autorizas?" alCerrar={jest.fn()}>
        <Text>Contenido</Text>
      </HojaInferior>,
    );
    const dibujo = JSON.stringify(screen.toJSON());
    expect(dibujo).toContain('"keyboardShouldPersistTaps":"handled"');
    expect(screen.getByText('Contenido')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeOnTheScreen();
    // La región viva de la hoja no se desplaza con el contenido: TalkBack la sigue encontrando.
    const [desplazable] = screen.container.queryAll((vista) => vista.props.keyboardShouldPersistTaps === 'handled');
    expect(desplazable?.queryAll((vista) => vista.props.accessibilityLiveRegion !== undefined)).toHaveLength(0);
    expect(screen.container.queryAll((vista) => vista.props.accessibilityLiveRegion === 'polite')).toHaveLength(1);
  });

  it('sin `desplazable` no lleva ScrollView (las hojas de siempre no cambian)', async () => {
    await render(
      <HojaInferior visible alCerrar={jest.fn()}>
        <Text>Contenido</Text>
      </HojaInferior>,
    );
    expect(JSON.stringify(screen.toJSON())).not.toContain('keyboardShouldPersistTaps');
  });

  // Bug 303: el Modal de Android no avisa cuándo termina de cerrarse su ventana (`onDismiss` es de iOS), así que la hoja se
  // anima sola y se quita cuando la animación termina.
  describe('se desliza sola (bug 303)', () => {
    beforeEach(() => animacionesAMano());
    afterEach(() => jest.restoreAllMocks());

    const contenido = (visible: boolean) => (
      <HojaInferior visible={visible} alCerrar={jest.fn()}>
        <Text>Contenido</Text>
      </HojaInferior>
    );

    it('entra desde fuera de la pantalla hasta su lugar y sale hacia abajo, y el Modal sigue hasta que termina de salir', async () => {
      const { rerender } = await render(contenido(true));
      expect(Animated.timing).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ toValue: 0, useNativeDriver: true }),
      );
      await terminarAnimaciones();
      await rerender(contenido(false));
      expect(Animated.timing).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ toValue: expect.any(Number) as number, useNativeDriver: true }),
      );
      expect(jest.mocked(Animated.timing).mock.lastCall![1].toValue).toBeGreaterThan(0);
      expect(screen.getByText('Contenido')).toBeOnTheScreen();
      await terminarAnimaciones();
      expect(screen.queryByText('Contenido')).not.toBeOnTheScreen();
    });

    it('mientras sale no deja tocar nada de lo que ya se va', async () => {
      const { rerender } = await render(contenido(true));
      await terminarAnimaciones();
      await rerender(contenido(false));
      const velo = screen.container.queryAll((v) => v.props.accessibilityViewIsModal === true)[0]!;
      expect(velo.props.pointerEvents).toBe('none');
    });

    it('abierta, sí deja tocar', async () => {
      await render(contenido(true));
      const velo = screen.container.queryAll((v) => v.props.accessibilityViewIsModal === true)[0]!;
      expect(velo.props.pointerEvents).toBe('auto');
    });

    it('si se vuelve a abrir mientras sale, se queda y no se quita', async () => {
      const { rerender } = await render(contenido(true));
      await terminarAnimaciones();
      await rerender(contenido(false));
      await rerender(contenido(true));
      await terminarAnimaciones();
      expect(screen.getByText('Contenido')).toBeOnTheScreen();
    });

    it('nunca abierta, no anima ni dibuja nada', async () => {
      await render(contenido(false));
      expect(Animated.timing).not.toHaveBeenCalled();
      expect(screen.queryByText('Contenido')).not.toBeOnTheScreen();
    });
  });
});
