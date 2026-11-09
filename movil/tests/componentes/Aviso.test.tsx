import type { ComponentProps } from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { ESPERA_DEL_ANUNCIO_MS } from '../../src/anuncios';
import { Aviso } from '../../src/componentes/Aviso';
import { RegionDeAnuncios } from '../../src/componentes/RegionDeAnuncios';
import { tokens } from '../../src/tokens/tokens.generated';
import { anunciados, regionesVivas, textosDe } from '../ayudas/anuncios';

// El aviso en una pantalla: lo anuncia la región viva de la pantalla (ACC-004, bug 225).
const EnPantalla = (propiedades: ComponentProps<typeof Aviso>) => (
  <>
    <Aviso {...propiedades} />
    <RegionDeAnuncios />
  </>
);

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
      await render(<EnPantalla tipo="logro" titulo="Listo, cambiamos tu contraseña." mensaje="Cerramos las demás sesiones." />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS - 1);
      expect(anunciados()).toEqual([]);
      await adelantar(1);
      expect(anunciados()).toEqual(['Listo, cambiamos tu contraseña. Cerramos las demás sesiones.']);
      const dicho = textosDe(regionesVivas()[0]!)[0];
      await adelantar(ESPERA_DEL_ANUNCIO_MS * 5);
      // El mismo `Text` de la región: no se volvió a decir.
      expect(textosDe(regionesVivas()[0]!)[0]).toBe(dicho);
    });

    it('no depende de una región viva: Android aplana la vista y TalkBack no la oiría', async () => {
      await render(<Aviso tipo="logro" titulo="Listo." />);
      expect(JSON.stringify(screen.toJSON())).not.toContain('"accessibilityLiveRegion":"polite"');
    });

    it('con un título hablado anuncia los pesos, no «$»', async () => {
      await render(
        <EnPantalla tipo="logro" titulo="Listo, registramos tu gasto de $45.000." tituloHablado="Listo, registramos tu gasto de 45000 pesos." />,
      );
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      expect(anunciados()).toEqual(['Listo, registramos tu gasto de 45000 pesos.']);
    });

    it('si cambia el texto anuncia el nuevo; si no cambia, no repite', async () => {
      await render(<EnPantalla tipo="atencion" titulo="No pudimos guardar." />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      expect(anunciados()).toEqual(['No pudimos guardar.']);
      const dicho = textosDe(regionesVivas()[0]!)[0];
      await screen.rerender(<EnPantalla tipo="atencion" titulo="No pudimos guardar." />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      expect(textosDe(regionesVivas()[0]!)[0]).toBe(dicho);
      await screen.rerender(<EnPantalla tipo="atencion" titulo="Sin conexión." />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      expect(anunciados()).toEqual(['Sin conexión.']);
    });

    it('si se va antes de la espera, no se anuncia', async () => {
      await render(<EnPantalla tipo="atencion" titulo="No pudimos guardar." />);
      await screen.rerender(<RegionDeAnuncios />);
      await adelantar(ESPERA_DEL_ANUNCIO_MS);
      expect(anunciados()).toEqual([]);
    });

    it('con `viva` en falso es contenido de la pantalla, no un estado: no se anuncia', async () => {
      await render(<EnPantalla tipo="atencion" titulo="Vas a borrar tu cuenta." viva={false} />);
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
