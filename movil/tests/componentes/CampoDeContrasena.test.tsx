import { fireEvent, render, screen } from '@testing-library/react-native';
import { CampoDeContrasena } from '../../src/componentes/CampoDeContrasena';
import { tokens } from '../../src/tokens/tokens.generated';

const propiedades = { etiqueta: 'Contraseña', valor: '', alCambiar: jest.fn() };

describe('CampoDeContrasena (E14-SDD 5.18)', () => {
  it('muestra puntos y el botón «Mostrar la contraseña»', async () => {
    await render(<CampoDeContrasena {...propiedades} />);
    expect(screen.getByLabelText('Contraseña').props.secureTextEntry).toBe(true);
    expect(screen.getByRole('button', { name: 'Mostrar la contraseña' })).toBeOnTheScreen();
  });

  it('Ver muestra lo escrito y el botón pasa a «Ocultar la contraseña»; Ocultar la vuelve a tapar', async () => {
    await render(<CampoDeContrasena {...propiedades} valor="lluvia café tren azul" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mostrar la contraseña' }));
    expect(screen.getByLabelText('Contraseña').props.secureTextEntry).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Ocultar la contraseña' }));
    expect(screen.getByLabelText('Contraseña').props.secureTextEntry).toBe(true);
    expect(screen.getByRole('button', { name: 'Mostrar la contraseña' })).toBeOnTheScreen();
  });

  it('el botón es una caja táctil de 48 × 48 dp', async () => {
    await render(<CampoDeContrasena {...propiedades} />);
    expect(screen.getByRole('button', { name: 'Mostrar la contraseña' })).toHaveStyle({
      width: tokens.tamano['tactil-minimo'],
      height: tokens.tamano['tactil-minimo'],
    });
  });

  it('permite pegar: lo pegado llega por onChangeText y no se oculta el menú del campo', async () => {
    const alCambiar = jest.fn();
    await render(<CampoDeContrasena {...propiedades} alCambiar={alCambiar} />);
    const campo = screen.getByLabelText('Contraseña');
    await fireEvent.changeText(campo, 'contraseña pegada desde el gestor');
    expect(alCambiar).toHaveBeenCalledWith('contraseña pegada desde el gestor');
    expect(campo.props.contextMenuHidden).toBeUndefined();
    expect(campo.props.onPaste).toBeUndefined();
    expect(campo.props.editable).not.toBe(false);
  });

  it('pasa el propósito de autocompletado (nueva o actual) y la ayuda', async () => {
    await render(
      <CampoDeContrasena
        {...propiedades}
        autocompletar="new-password"
        ayuda="Usa una frase de tres o cuatro palabras."
      />,
    );
    expect(screen.getByLabelText('Contraseña').props.autoComplete).toBe('new-password');
    expect(screen.getByText('Usa una frase de tres o cuatro palabras.')).toBeOnTheScreen();
  });

  it('muestra el error del campo', async () => {
    await render(<CampoDeContrasena {...propiedades} error="Falta la contraseña." />);
    expect(screen.getByText('Falta la contraseña.')).toBeOnTheScreen();
  });
});
