import { render, screen } from '@testing-library/react-native';
import { Nota, Texto } from '../../src/componentes/Texto';
import { tokens } from '../../src/tokens/tokens.generated';

describe('Texto y Nota', () => {
  it('el texto de cuerpo usa tipografia.cuerpo y el de ayuda tipografia.pequeno en color secundario', async () => {
    await render(
      <>
        <Texto>Cuerpo</Texto>
        <Texto variante="ayuda">Ayuda</Texto>
      </>,
    );
    expect(screen.getByText('Cuerpo')).toHaveStyle({ fontSize: tokens.tipografia.cuerpo.fontSize });
    expect(screen.getByText('Ayuda')).toHaveStyle({
      fontSize: tokens.tipografia.pequeno.fontSize,
      color: tokens.color.texto.secundario,
    });
  });

  it('pone los números en Figtree (D-123)', async () => {
    await render(<Texto>En 7 días</Texto>);
    expect(screen.getByText('7')).toHaveStyle({ fontFamily: 'Figtree-SemiBold' });
  });

  it('la nota lleva el ícono de Información y el texto pequeño en color de información', async () => {
    await render(<Nota>Una nota</Nota>);
    expect(screen.getByText('Una nota')).toHaveStyle({
      fontSize: tokens.tipografia.pequeno.fontSize,
      color: tokens.color.estado.informacion.texto,
    });
    expect(JSON.stringify(screen.toJSON())).toContain(tokens.color.estado.informacion.icono);
  });
});
