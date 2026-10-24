import { act, render, screen } from '@testing-library/react-native';
import { MensajeDeEstado } from '../../src/componentes/MensajeDeEstado';
import { avisos } from '../../src/textos';

describe('MensajeDeEstado (E14-PCP 4.16 T11)', () => {
  it('el contenedor es una región viva cortés y el aviso entra después, para que se anuncie', async () => {
    await render(<MensajeDeEstado aviso={avisos.correoConfirmado} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Listo, confirmamos tu correo.')).toBeOnTheScreen();
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('none');
    expect(JSON.stringify(screen.toJSON())).toContain('"accessibilityLiveRegion":"polite"');
  });
});
