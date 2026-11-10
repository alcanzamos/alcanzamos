import { render, screen, waitFor } from '@testing-library/react-native';
import { MensajeDeEstado } from '../../src/componentes/MensajeDeEstado';
import { RegionDeAnuncios } from '../../src/componentes/RegionDeAnuncios';
import { avisos, type DatosDeAviso } from '../../src/textos';
import { anunciados, esperarAnuncio, regionesVivas, textosDe } from '../ayudas/anuncios';

// La llegada a una pantalla: el mensaje y la región viva de la pantalla (ACC-004, bug 225).
const Llegada = ({ aviso }: { aviso: DatosDeAviso }) => (
  <>
    <MensajeDeEstado aviso={aviso} />
    <RegionDeAnuncios />
  </>
);

describe('MensajeDeEstado (E14-PCP 4.16 T11)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ACC-004 (bug 225): al llegar a la pantalla TalkBack anuncia el aviso, sin mover el foco', async () => {
    await render(<Llegada aviso={avisos.correoConfirmado} />);
    expect(screen.getByText('Listo, confirmamos tu correo.')).toBeOnTheScreen();
    await esperarAnuncio('Listo, confirmamos tu correo.');
    expect(anunciados()).toEqual(['Listo, confirmamos tu correo.']);
  });

  it('ACC-004 (bug 225): cada llegada se anuncia, aunque diga lo mismo que la anterior (dos gastos iguales seguidos)', async () => {
    const primero = { tipo: 'logro' as const, titulo: 'Listo, guardamos los cambios.' };
    await render(<Llegada aviso={primero} />);
    await esperarAnuncio('Listo, guardamos los cambios.');
    const dicho = textosDe(regionesVivas()[0]!)[0];
    await screen.rerender(<Llegada aviso={primero} />);
    await screen.rerender(<Llegada aviso={{ ...primero }} />);
    // Un `Text` nuevo en la región: TalkBack lo vuelve a decir.
    await waitFor(() => expect(textosDe(regionesVivas()[0]!)[0]).not.toBe(dicho), { timeout: 2000 });
    expect(anunciados()).toEqual(['Listo, guardamos los cambios.']);
  });
});
