import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text, type TextInputInstance } from 'react-native';
import { CampoDeTexto } from '../../src/componentes/CampoDeTexto';
import { tokens } from '../../src/tokens/tokens.generated';

const propiedades = { etiqueta: 'Correo electrónico', valor: '', alCambiar: jest.fn() };

describe('CampoDeTexto (E14-SDD 5.3)', () => {
  it('la etiqueta está siempre visible y es el nombre accesible del campo', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    expect(screen.getByText('Correo electrónico')).toBeOnTheScreen();
    expect(screen.getByLabelText('Correo electrónico')).toBeOnTheScreen();
  });

  it('muestra la ayuda y la usa como pista de accesibilidad', async () => {
    await render(<CampoDeTexto {...propiedades} ayuda="Te enviaremos un enlace para confirmarlo." />);
    expect(screen.getByText('Te enviaremos un enlace para confirmarlo.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Correo electrónico').props.accessibilityHint).toBe(
      'Te enviaremos un enlace para confirmarlo.',
    );
  });

  it('avisa lo escrito', async () => {
    const alCambiar = jest.fn();
    await render(<CampoDeTexto {...propiedades} alCambiar={alCambiar} />);
    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'laura@ejemplo.com');
    expect(alCambiar).toHaveBeenCalledWith('laura@ejemplo.com');
  });

  it('en error muestra el texto con su ícono, en una región viva, y el borde de Atención', async () => {
    await render(<CampoDeTexto {...propiedades} error="Falta el correo electrónico." />);
    expect(screen.getByText('Falta el correo electrónico.')).toBeOnTheScreen();
    expect(screen.getByText('Falta el correo electrónico.')).toHaveStyle({
      color: tokens.color.estado.atencion.texto,
    });
    expect(JSON.stringify(screen.toJSON())).toContain('"accessibilityLiveRegion":"polite"');
    expect(JSON.stringify(screen.toJSON())).toContain(tokens.color.estado.atencion.borde);
  });

  it('sin error no hay texto de error', async () => {
    await render(<CampoDeTexto {...propiedades} ayuda="Ayuda" />);
    expect(screen.queryByText(/Falta/)).not.toBeOnTheScreen();
  });

  it('con el foco el borde pasa a color.borde.foco de 2', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    const campo = screen.getByLabelText('Correo electrónico');
    await fireEvent(campo, 'focus');
    expect(JSON.stringify(screen.toJSON())).toContain(tokens.color.borde.foco);
    await fireEvent(campo, 'blur');
    expect(JSON.stringify(screen.toJSON())).not.toContain(tokens.color.borde.foco);
  });

  it('pasa el propósito de autocompletado y el teclado, y no corrige ni pone mayúsculas', async () => {
    await render(<CampoDeTexto {...propiedades} autocompletar="email" teclado="email-address" />);
    const campo = screen.getByLabelText('Correo electrónico');
    expect(campo.props.autoComplete).toBe('email');
    expect(campo.props.keyboardType).toBe('email-address');
    expect(campo.props.autoCorrect).toBe(false);
    expect(campo.props.autoCapitalize).toBe('none');
    expect(campo.props.secureTextEntry).toBe(false);
  });

  it('mide al menos 48 dp', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    expect(screen.getByLabelText('Correo electrónico')).toHaveStyle({ minHeight: tokens.tamano['tactil-minimo'] });
  });

  it('deja la referencia al campo para llevarle el foco', async () => {
    const ref = createRef<TextInputInstance>();
    await render(<CampoDeTexto {...propiedades} ref={ref} />);
    expect(ref.current).not.toBeNull();
  });

  it('puede llevar un botón al final', async () => {
    await render(
      <CampoDeTexto
        {...propiedades}
        accion={
          <Pressable accessibilityRole="button" accessibilityLabel="Acción" accessibilityHint="x">
            <Text>+</Text>
          </Pressable>
        }
      />,
    );
    expect(screen.getByRole('button', { name: 'Acción' })).toBeOnTheScreen();
  });

  it('con `cifra` el valor va en Figtree con cifras tabulares y sin ss02 (D-123)', async () => {
    await render(<CampoDeTexto {...propiedades} valor="$45.000" cifra />);
    expect(screen.getByLabelText('Correo electrónico')).toHaveStyle({
      fontFamily: 'Figtree-SemiBold',
      fontVariant: ['tabular-nums'],
    });
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/stylistic|ss02/);
  });

  it('sin `cifra` el valor sigue en Atkinson', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    expect(screen.getByLabelText('Correo electrónico')).toHaveStyle({ fontFamily: 'AtkinsonHyperlegibleNext-Regular' });
  });

  it('`maxLength` limita lo que se escribe y `alSalir` avisa cuando se pierde el foco', async () => {
    const alSalir = jest.fn();
    await render(<CampoDeTexto {...propiedades} maxLength={280} alSalir={alSalir} />);
    expect(screen.getByLabelText('Correo electrónico').props.maxLength).toBe(280);
    await fireEvent(screen.getByLabelText('Correo electrónico'), 'focus');
    expect(alSalir).not.toHaveBeenCalled();
    await fireEvent(screen.getByLabelText('Correo electrónico'), 'blur');
    expect(alSalir).toHaveBeenCalledTimes(1);
  });

  it('perder el foco sin `alSalir` no falla', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    await expect(fireEvent(screen.getByLabelText('Correo electrónico'), 'blur')).resolves.not.toThrow();
  });
});
