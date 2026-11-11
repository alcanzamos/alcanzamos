import { fireEvent, render, screen } from '@testing-library/react-native';
import { HojaDeElecciones } from '../../src/componentes/HojaDeElecciones';
import { tokens } from '../../src/tokens/tokens.generated';

const opciones = [
  { valor: 'a', etiqueta: 'Primera' },
  { valor: 'b', etiqueta: 'Segunda' },
];

describe('HojaDeElecciones (Hoja inferior con una lista de elección única)', () => {
  it('cada opción es un radio con su estado y la elegida está marcada', async () => {
    await render(<HojaDeElecciones visible alCerrar={jest.fn()} opciones={opciones} valor="b" alElegir={jest.fn()} />);
    expect(screen.getByRole('radio', { name: 'Primera' }).props.accessibilityState.checked).toBe(false);
    expect(screen.getByRole('radio', { name: 'Segunda' }).props.accessibilityState.checked).toBe(true);
  });

  it('tocar una opción la elige', async () => {
    const alElegir = jest.fn();
    await render(<HojaDeElecciones visible alCerrar={jest.fn()} opciones={opciones} valor={null} alElegir={alElegir} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Primera' }));
    expect(alElegir).toHaveBeenCalledWith('a');
  });

  it('ACC-004 (bug 228): trae el ícono «Cerrar» de 48 dp, que la cierra sin elegir nada', async () => {
    const alCerrar = jest.fn();
    const alElegir = jest.fn();
    await render(<HojaDeElecciones visible alCerrar={alCerrar} opciones={opciones} valor="b" alElegir={alElegir} />);
    const cerrar = screen.getByRole('button', { name: 'Cerrar' });
    expect(cerrar).toHaveStyle({ minWidth: tokens.tamano['tactil-minimo'], minHeight: tokens.tamano['tactil-minimo'] });
    await fireEvent.press(cerrar);
    expect(alCerrar).toHaveBeenCalledTimes(1);
    expect(alElegir).not.toHaveBeenCalled();
  });

  it('oculta no muestra nada y el Atrás la cierra', async () => {
    const alCerrar = jest.fn();
    const { rerender } = await render(
      <HojaDeElecciones visible={false} alCerrar={alCerrar} opciones={opciones} valor={null} alElegir={jest.fn()} />,
    );
    expect(screen.queryByRole('radio', { name: 'Primera' })).not.toBeOnTheScreen();
    await rerender(<HojaDeElecciones visible alCerrar={alCerrar} opciones={opciones} valor={null} alElegir={jest.fn()} />);
    await fireEvent(screen.root!, 'requestClose');
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });
});
