import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text, type HostInstance } from 'react-native';
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

  it('ACC-004 (bug 226): con error, el error es parte de su nombre («Acepto, Falta tu autorización.»), una sola vez', async () => {
    await render(<Casilla texto="Acepto" marcada={false} alCambiar={jest.fn()} error="Falta tu autorización." />);
    expect(screen.getByText('Falta tu autorización.')).toBeOnTheScreen();
    const casilla = screen.getByRole('checkbox', { name: 'Acepto, Falta tu autorización.' });
    expect(casilla.props.accessibilityHint).toBeUndefined();
    // El texto visible del error no se lee aparte: TalkBack ya lo dice con la casilla.
    expect(screen.getByText('Falta tu autorización.').props.importantForAccessibility).toBe('no');
  });

  it('sin error su nombre es solo el texto, sin pista', async () => {
    await render(<Casilla texto="Acepto" marcada={false} alCambiar={jest.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Acepto' }).props.accessibilityHint).toBeUndefined();
    expect(screen.queryByText(/Falta/)).not.toBeOnTheScreen();
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

  it('deja la referencia a la casilla para llevarle el foco de TalkBack con un error (ACC-004, bug 226)', async () => {
    const ref = createRef<HostInstance>();
    await render(<Casilla ref={ref} texto="Autorizo." marcada={false} alCambiar={jest.fn()} error="Falta." />);
    expect(ref.current).not.toBeNull();
    // El error se ve, pero no es una región viva: Android la aplana y no se oiría. Lo dice la casilla al recibir el foco.
    expect(JSON.stringify(screen.toJSON())).not.toContain('"accessibilityLiveRegion":"polite"');
  });

  // SC-E21-25 3.6: la frase de los avisos con la app cerrada va bajo su casilla y la describe. En Android la ayuda se ve
  // (`tipografia.pequeno`, `color.texto.secundario`) y es la pista de accesibilidad de la casilla, como la ayuda de un campo.
  it('con `ayuda` la muestra debajo y es la pista de accesibilidad de la casilla; el nombre no cambia', async () => {
    await render(<Casilla texto="Autorizo los avisos." ayuda="Pasan por Google." marcada={false} alCambiar={jest.fn()} />);
    expect(screen.getByText('Pasan por Google.')).toBeOnTheScreen();
    const casilla = screen.getByRole('checkbox', { name: 'Autorizo los avisos.' });
    expect(casilla.props.accessibilityHint).toBe('Pasan por Google.');
    expect(screen.getByText('Pasan por Google.')).toHaveStyle({ color: tokens.color.texto.secundario });
  });

  it('con `ayuda` y error, el error sigue siendo parte del nombre y la ayuda, la pista', async () => {
    await render(
      <Casilla texto="Acepto" ayuda="Explicación." marcada={false} alCambiar={jest.fn()} error="Falta tu autorización." />,
    );
    const casilla = screen.getByRole('checkbox', { name: 'Acepto, Falta tu autorización.' });
    expect(casilla.props.accessibilityHint).toBe('Explicación.');
  });

  it('tocar la ayuda no cambia la casilla (solo la fila de la casilla la cambia)', async () => {
    const alCambiar = jest.fn();
    await render(<Casilla texto="Autorizo." ayuda="Explicación." marcada={false} alCambiar={alCambiar} />);
    await fireEvent.press(screen.getByText('Explicación.'));
    expect(alCambiar).not.toHaveBeenCalled();
  });
});
