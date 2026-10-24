import { conBarra } from '../../src/navegacion/barra';
import { tokens } from '../../src/tokens/tokens.generated';

describe('conBarra (E14-SDD 5.10)', () => {
  it('muestra la barra nativa con el título, en titulo-2 y sobre el fondo de página, sin sombra', () => {
    const opciones = conBarra('Seguridad de la cuenta');
    expect(opciones.headerShown).toBe(true);
    expect(opciones.title).toBe('Seguridad de la cuenta');
    expect(opciones.headerShadowVisible).toBe(false);
    expect(opciones.headerStyle).toEqual({ backgroundColor: tokens.color.fondo.pagina });
    expect(opciones.headerTintColor).toBe(tokens.color.texto.principal);
    expect(opciones.headerTitleStyle).toEqual({
      fontFamily: 'Figtree-SemiBold',
      fontSize: tokens.tipografia['titulo-2'].fontSize,
      color: tokens.color.texto.principal,
    });
  });
});
