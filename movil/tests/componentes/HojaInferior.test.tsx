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
});
