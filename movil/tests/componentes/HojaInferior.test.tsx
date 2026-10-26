import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { HojaInferior } from '../../src/componentes/HojaInferior';
import { tokens } from '../../src/tokens/tokens.generated';

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
    expect(dibujo).toContain('"animationType":"slide"');
    expect(dibujo).toContain(tokens.color.fondo.superficie);
    expect(dibujo).toContain(`"borderTopLeftRadius":${tokens.radio.grande}`);
  });
});
