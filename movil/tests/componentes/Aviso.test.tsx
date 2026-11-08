import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { ESPERA_DEL_ANUNCIO_MS } from '../../src/anuncios';
import { Aviso } from '../../src/componentes/Aviso';
import { tokens } from '../../src/tokens/tokens.generated';
import { anunciados } from '../ayudas/anuncios';

const adelantar = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe('Aviso (E14-SDD 5.4)', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it('muestra el título y el mensaje en un solo elemento para el lector de pantalla', async () => {
    await render(<Aviso tipo="informacion" titulo="No pudimos crear la cuenta." mensaje="Intenta de nuevo." />);
    const aviso = screen.getByRole('alert');
    expect(aviso).toBeOnTheScreen();
    expect(screen.getByText('No pudimos crear la cuenta.')).toBeOnTheScreen();
    expect(screen.getByText('Intenta de nuevo.')).toBeOnTheScreen();
    expect(aviso.props.accessible).toBe(true);
  });

  it('ACC-004: con un título hablado, el nombre del elemento lo usa y deja el texto que se ve', async () => {
    await render(<Aviso tipo="informacion" titulo="Listo, borramos el gasto de $45.000." tituloHablado="Listo, borramos el gasto de 45000 pesos." mensaje="Intenta de nuevo." />);
    expect(screen.getByRole('alert').props.accessibilityLabel).toBe('Listo, borramos el gasto de 45000 pesos. Intenta de nuevo.');
    expect(screen.getByText('Intenta de nuevo.')).toBeOnTheScreen();
    await screen.rerender(<Aviso tipo="informacion" titulo="Listo $1." tituloHablado="Listo 1 peso." />);
    expect(screen.getByRole('alert').props.accessibilityLabel).toBe('Listo 1 peso.');
  });

  it('sin título hablado no pone nombre propio: el lector lee los textos', async () => {
    await render(<Aviso tipo="informacion" titulo="Texto" />);
    expect(screen.getByRole('alert').props.accessibilityLabel).toBeUndefined();
  });

  describe('ACC-004 (bug 225): TalkBack lo anuncia al aparecer', () => {
    beforeEach(() => jest.useFakeTimers());

    it('anuncia el título y el mensaje una sola vez, pasada la espera del anuncio', async () => {
      await render(<Aviso tipo="logro" titulo="Listo, cambiamos tu contraseña." mensaje="Cerramos las demás sesiones." />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS - 1);
      expect(anunciados()).toEqual([]);
      await adelantar(1);
      expect(anunciados()).toEqual(['Listo, cambiamos tu contraseña. Cerramos las demás sesiones.']);
      await adelantar(ESPERA_DEL_ANUNCIO_MS * 5);
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    });

    it('no depende de una región viva: Android aplana la vista y TalkBack no la oiría', async () => {
      await render(<Aviso tipo="logro" titulo="Listo." />);
      expect(JSON.stringify(screen.toJSON())).not.toContain('"accessibilityLiveRegion":"polite"');
    });

    it('con un título hablado anuncia los pesos, no «$»', async () => {
      await render(
        <Aviso tipo="logro" titulo="Listo, registramos tu gasto de $45.000." tituloHablado="Listo, registramos tu gasto de 45000 pesos." />,
      );
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      expect(anunciados()).toEqual(['Listo, registramos tu gasto de 45000 pesos.']);
    });

    it('si cambia el texto anuncia el nuevo; si no cambia, no repite', async () => {
      await render(<Aviso tipo="atencion" titulo="No pudimos guardar." />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      await screen.rerender(<Aviso tipo="atencion" titulo="No pudimos guardar." />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      await screen.rerender(<Aviso tipo="atencion" titulo="Sin conexión." />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      expect(anunciados()).toEqual(['No pudimos guardar.', 'Sin conexión.']);
    });

    it('si se va antes de la espera, no se anuncia', async () => {
      await render(<Aviso tipo="atencion" titulo="No pudimos guardar." />);
      await screen.unmount();
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      expect(anunciados()).toEqual([]);
    });

    it('con `viva` en falso es contenido de la pantalla, no un estado: no se anuncia', async () => {
      await render(<Aviso tipo="atencion" titulo="Vas a borrar tu cuenta." viva={false} />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      expect(anunciados()).toEqual([]);
    });
  });

  it.each(['informacion', 'atencion', 'logro'] as const)('el tipo %s usa su fondo de estado', async (tipo) => {
    await render(<Aviso tipo={tipo} titulo="Texto" />);
    expect(screen.getByRole('alert')).toHaveStyle({ backgroundColor: tokens.color.estado[tipo].fondo });
    expect(screen.getByText('Texto')).toHaveStyle({ color: tokens.color.estado[tipo].texto });
  });

  it('sin mensaje no dibuja el segundo texto', async () => {
    await render(<Aviso tipo="informacion" titulo="Solo título" />);
    expect(screen.getAllByText(/./)).toHaveLength(1);
  });

  it('pone en Figtree los números del texto', async () => {
    await render(<Aviso tipo="atencion" titulo="Faltan 15" />);
    expect(screen.getByText('15')).toHaveStyle({ fontFamily: 'Figtree-Bold' });
  });
});
