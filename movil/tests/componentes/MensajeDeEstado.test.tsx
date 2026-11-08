import { render, screen, waitFor } from '@testing-library/react-native';
import { MensajeDeEstado } from '../../src/componentes/MensajeDeEstado';
import { avisos } from '../../src/textos';
import { anunciados, esperarAnuncio } from '../ayudas/anuncios';

describe('MensajeDeEstado (E14-PCP 4.16 T11)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ACC-004 (bug 225): al llegar a la pantalla TalkBack anuncia el aviso, sin mover el foco', async () => {
    await render(<MensajeDeEstado aviso={avisos.correoConfirmado} />);
    expect(screen.getByText('Listo, confirmamos tu correo.')).toBeOnTheScreen();
    await esperarAnuncio('Listo, confirmamos tu correo.');
    expect(anunciados()).toEqual(['Listo, confirmamos tu correo.']);
  });

  it('ACC-004 (bug 225): cada llegada se anuncia, aunque diga lo mismo que la anterior (dos gastos iguales seguidos)', async () => {
    const primero = { tipo: 'logro' as const, titulo: 'Listo, guardamos los cambios.' };
    await render(<MensajeDeEstado aviso={primero} />);
    await esperarAnuncio('Listo, guardamos los cambios.');
    await screen.rerender(<MensajeDeEstado aviso={primero} />);
    await screen.rerender(<MensajeDeEstado aviso={{ ...primero }} />);
    await waitFor(() => expect(anunciados()).toHaveLength(2), { timeout: 2000 });
    expect(anunciados()).toEqual(['Listo, guardamos los cambios.', 'Listo, guardamos los cambios.']);
  });
});
