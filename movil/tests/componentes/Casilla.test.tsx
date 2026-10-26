import { fireEvent, render, screen } from '@testing-library/react-native';
import { Casilla } from '../../src/componentes/Casilla';
import { tokens } from '../../src/tokens/tokens.generated';

describe('Casilla de verificación (E14-SDD 5.17)', () => {
  it('es un checkbox con el texto como nombre, sin marcar, y su fila mide al menos 48', async () => {
    await render(<Casilla texto="Autorizo los avisos." marcada={false} alCambiar={jest.fn()} />);
    const casilla = screen.getByRole('checkbox', { name: 'Autorizo los avisos.', checked: false });
    expect(casilla).toBeOnTheScreen();
    expect(casilla).toHaveStyle({ minHeight: tokens.tamano['tactil-minimo'] });
  });

  it('al tocarla pide el valor contrario; marcada se anuncia marcada', async () => {
    const alCambiar = jest.fn();
    const { rerender } = await render(<Casilla texto="Acepto" marcada={false} alCambiar={alCambiar} />);
    await fireEvent.press(screen.getByRole('checkbox'));
    expect(alCambiar).toHaveBeenCalledWith(true);
    await rerender(<Casilla texto="Acepto" marcada alCambiar={alCambiar} />);
    expect(screen.getByRole('checkbox', { checked: true })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('checkbox'));
    expect(alCambiar).toHaveBeenLastCalledWith(false);
  });

  it('con error muestra el texto con su ícono y se lo da a TalkBack como pista', async () => {
    await render(<Casilla texto="Acepto" marcada={false} alCambiar={jest.fn()} error="Falta tu autorización." />);
    expect(screen.getByText('Falta tu autorización.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Acepto')).toHaveProp('accessibilityHint', 'Falta tu autorización.');
  });

  it('sin error no hay texto ni pista', async () => {
    await render(<Casilla texto="Acepto" marcada={false} alCambiar={jest.fn()} />);
    expect(screen.getByLabelText('Acepto').props.accessibilityHint).toBeUndefined();
  });

  it('el foco pinta el anillo de foco', async () => {
    await render(<Casilla texto="Acepto" marcada={false} alCambiar={jest.fn()} />);
    await fireEvent(screen.getByRole('checkbox'), 'focus');
    expect(screen.getByRole('checkbox')).toHaveStyle({ borderColor: tokens.color.borde.foco });
    await fireEvent(screen.getByRole('checkbox'), 'blur');
    expect(screen.getByRole('checkbox')).toHaveStyle({ borderColor: 'transparent' });
  });
});
