import { render, screen } from '@testing-library/react-native';
import { Aviso } from '../../src/componentes/Aviso';
import { tokens } from '../../src/tokens/tokens.generated';

describe('Aviso (E14-SDD 5.4)', () => {
  it('muestra el título y el mensaje en un solo elemento para el lector de pantalla', async () => {
    await render(<Aviso tipo="informacion" titulo="No pudimos crear la cuenta." mensaje="Intenta de nuevo." />);
    const aviso = screen.getByRole('alert');
    expect(aviso).toBeOnTheScreen();
    expect(screen.getByText('No pudimos crear la cuenta.')).toBeOnTheScreen();
    expect(screen.getByText('Intenta de nuevo.')).toBeOnTheScreen();
    expect(aviso.props.accessible).toBe(true);
  });

  it('es una región viva cortés, salvo si lo envuelve otra', async () => {
    await render(<Aviso tipo="logro" titulo="Listo." />);
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('polite');
    await screen.rerender(<Aviso tipo="logro" titulo="Listo." viva={false} />);
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('none');
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
