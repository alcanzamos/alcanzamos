import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
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

  it('deshabilitada se anuncia deshabilitada, sigue marcada y no cambia al tocarla (E14-PRR 4.8, «No pasó»)', async () => {
    const alCambiar = jest.fn();
    await render(<Casilla texto="Energía" marcada={false} deshabilitada alCambiar={alCambiar} />);
    expect(screen.getByRole('checkbox', { name: 'Energía', disabled: true })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('checkbox'));
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it('habilitada no se anuncia deshabilitada', async () => {
    await render(<Casilla texto="Energía" marcada alCambiar={jest.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Energía', disabled: false })).toBeOnTheScreen();
  });

  it('con `contenido` lo muestra en vez del texto y el nombre sigue siendo `texto`', async () => {
    await render(
      <Casilla texto="Energía, $120.000" contenido={<Text>Fila con monto</Text>} marcada alCambiar={jest.fn()} />,
    );
    expect(screen.getByText('Fila con monto')).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'Energía, $120.000' })).toBeOnTheScreen();
    expect(screen.queryByText('Energía, $120.000')).not.toBeOnTheScreen();
  });
});
