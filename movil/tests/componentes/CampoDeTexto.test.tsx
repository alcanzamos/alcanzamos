import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text, type TextInputInstance } from 'react-native';
import { CampoDeLectura, CampoDeTexto } from '../../src/componentes/CampoDeTexto';
import { tokens } from '../../src/tokens/tokens.generated';
import { campo } from '../ayudas/campos';

const propiedades = { etiqueta: 'Correo electrónico', valor: '', alCambiar: jest.fn() };

describe('CampoDeTexto (E14-SDD 5.3)', () => {
  it('la etiqueta está siempre visible y es el nombre accesible del campo (su texto de ejemplo, transparente)', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    expect(screen.getByText('Correo electrónico')).toBeOnTheScreen();
    expect(campo('Correo electrónico')).toBeOnTheScreen();
  });

  it('ACC-004 (bugs 226 y 227): sin error, el texto de ejemplo es la etiqueta, transparente, sin accessibilityLabel ni accessibilityLabelledBy', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    const entrada = screen.getByPlaceholderText('Correo electrónico');
    expect(entrada.props.placeholderTextColor).toBe('transparent');
    // Un contentDescription taparía el texto de ejemplo con el campo vacío, o haría decir la etiqueta dos veces.
    expect(entrada.props.accessibilityLabel).toBeUndefined();
    expect(entrada.props.accessibilityLabelledBy).toBeUndefined();
    expect(screen.getByText('Correo electrónico').props.nativeID).toBeUndefined();
  });

  it('ACC-004 (bug 227): con contenido, el campo sigue nombrado por el texto de ejemplo («Editar casilla, Correo electrónico»)', async () => {
    await render(<CampoDeTexto {...propiedades} valor="laura@ejemplo.com" />);
    const entrada = screen.getByDisplayValue('laura@ejemplo.com');
    expect(entrada.props.placeholder).toBe('Correo electrónico');
    expect(entrada.props.placeholderTextColor).toBe('transparent');
  });

  it('ACC-004 (bug 226): con error, el texto de ejemplo es «etiqueta, error»: el campo lee su error al recibir el foco', async () => {
    await render(<CampoDeTexto {...propiedades} etiqueta="Monto" error="Falta el monto." />);
    expect(screen.getByPlaceholderText('Monto, Falta el monto.')).toBeOnTheScreen();
    expect(campo('Monto')).toBe(screen.getByPlaceholderText('Monto, Falta el monto.'));
  });

  it('ACC-004 (bug 226): el error se ve (E14-SDD 5.3), pero TalkBack no lo lee dos veces: el texto visible no es importante para la accesibilidad', async () => {
    await render(<CampoDeTexto {...propiedades} etiqueta="Monto" error="Falta el monto." />);
    expect(screen.getByText('Falta el monto.')).toBeOnTheScreen();
    expect(screen.getByText('Falta el monto.').props.importantForAccessibility).toBe('no');
    expect(screen.getByText('Monto').props.importantForAccessibility).toBe('no');
  });

  it('con un prefijo («$») lo muestra fuera del campo y TalkBack no lo lee', async () => {
    await render(<CampoDeTexto {...propiedades} etiqueta="Monto" valor="15.000" cifra prefijo="$" />);
    const prefijo = screen.getByText('$');
    expect(prefijo.props.importantForAccessibility).toBe('no');
    expect(prefijo).toHaveStyle({ fontFamily: 'Figtree-SemiBold' });
    expect(screen.getByDisplayValue('15.000').props.value).not.toContain('$');
    // Es hermano del campo dentro de la caja, no parte de su valor.
    expect(prefijo.parent).toBe(screen.getByDisplayValue('15.000').parent);
  });

  it('sin prefijo no dibuja nada antes del campo', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    expect(screen.getAllByText(/./)).toHaveLength(1);
  });

  it('`alEntrar` avisa cuando el campo recibe el foco', async () => {
    const alEntrar = jest.fn();
    await render(<CampoDeTexto {...propiedades} alEntrar={alEntrar} />);
    await fireEvent(campo('Correo electrónico'), 'focus');
    expect(alEntrar).toHaveBeenCalledTimes(1);
  });

  it('muestra la ayuda y la usa como pista de accesibilidad', async () => {
    await render(<CampoDeTexto {...propiedades} ayuda="Te enviaremos un enlace para confirmarlo." />);
    expect(screen.getByText('Te enviaremos un enlace para confirmarlo.')).toBeOnTheScreen();
    expect(campo('Correo electrónico').props.accessibilityHint).toBe(
      'Te enviaremos un enlace para confirmarlo.',
    );
  });

  it('avisa lo escrito', async () => {
    const alCambiar = jest.fn();
    await render(<CampoDeTexto {...propiedades} alCambiar={alCambiar} />);
    await fireEvent.changeText(campo('Correo electrónico'), 'laura@ejemplo.com');
    expect(alCambiar).toHaveBeenCalledWith('laura@ejemplo.com');
  });

  it('en error muestra el texto con su ícono y el borde de Atención; no hay región viva en el campo', async () => {
    await render(<CampoDeTexto {...propiedades} error="Falta el correo electrónico." />);
    expect(screen.getByText('Falta el correo electrónico.')).toBeOnTheScreen();
    expect(screen.getByText('Falta el correo electrónico.')).toHaveStyle({
      color: tokens.color.estado.atencion.texto,
    });
    // Una región viva en una vista sin más propiedades la aplana Android y no se oye (ACC-004, bug 226).
    expect(JSON.stringify(screen.toJSON())).not.toContain('"accessibilityLiveRegion":"polite"');
    expect(JSON.stringify(screen.toJSON())).toContain(tokens.color.estado.atencion.borde);
  });

  it('sin error no hay texto de error', async () => {
    await render(<CampoDeTexto {...propiedades} ayuda="Ayuda" />);
    expect(screen.queryByText(/Falta/)).not.toBeOnTheScreen();
  });

  it('con el foco el borde pasa a color.borde.foco de 2', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    const entrada = campo('Correo electrónico');
    await fireEvent(entrada, 'focus');
    expect(JSON.stringify(screen.toJSON())).toContain(tokens.color.borde.foco);
    await fireEvent(entrada, 'blur');
    expect(JSON.stringify(screen.toJSON())).not.toContain(tokens.color.borde.foco);
  });

  it('pasa el propósito de autocompletado y el teclado, y no corrige ni pone mayúsculas', async () => {
    await render(<CampoDeTexto {...propiedades} autocompletar="email" teclado="email-address" />);
    const entrada = campo('Correo electrónico');
    expect(entrada.props.autoComplete).toBe('email');
    expect(entrada.props.keyboardType).toBe('email-address');
    expect(entrada.props.autoCorrect).toBe(false);
    expect(entrada.props.autoCapitalize).toBe('none');
    expect(entrada.props.secureTextEntry).toBe(false);
  });

  it('mide al menos 48 dp', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    expect(campo('Correo electrónico')).toHaveStyle({ minHeight: tokens.tamano['tactil-minimo'] });
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
    expect(campo('Correo electrónico')).toHaveStyle({
      fontFamily: 'Figtree-SemiBold',
      fontVariant: ['tabular-nums'],
    });
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/stylistic|ss02/);
  });

  it('sin `cifra` el valor sigue en Atkinson', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    expect(campo('Correo electrónico')).toHaveStyle({ fontFamily: 'AtkinsonHyperlegibleNext-Regular' });
  });

  it('`maxLength` limita lo que se escribe y `alSalir` avisa cuando se pierde el foco', async () => {
    const alSalir = jest.fn();
    await render(<CampoDeTexto {...propiedades} maxLength={280} alSalir={alSalir} />);
    expect(campo('Correo electrónico').props.maxLength).toBe(280);
    await fireEvent(campo('Correo electrónico'), 'focus');
    expect(alSalir).not.toHaveBeenCalled();
    await fireEvent(campo('Correo electrónico'), 'blur');
    expect(alSalir).toHaveBeenCalledTimes(1);
  });

  it('ACC-004 (bug 227): un campo de solo lectura dice su etiqueta junto con su valor', async () => {
    await render(<CampoDeLectura etiqueta="Empieza el" valor="26 de octubre de 2026" />);
    expect(screen.getByText('Empieza el')).toBeOnTheScreen();
    expect(screen.getByText('26')).toBeOnTheScreen();
    expect(screen.getByLabelText('Empieza el, 26 de octubre de 2026')).toBeOnTheScreen();
  });

  it('ACC-004 (bug 226): un campo de solo lectura con error lo dice en su nombre, una sola vez', async () => {
    await render(<CampoDeLectura etiqueta="Empieza el" valor="26 de octubre de 2026" error="Elige otra fecha." />);
    expect(screen.getByLabelText('Empieza el, 26 de octubre de 2026, Elige otra fecha.')).toBeOnTheScreen();
    expect(screen.getByText('Elige otra fecha.').props.importantForAccessibility).toBe('no');
  });

  it('perder el foco sin `alSalir` no falla', async () => {
    await render(<CampoDeTexto {...propiedades} />);
    await expect(fireEvent(campo('Correo electrónico'), 'blur')).resolves.not.toThrow();
  });
});
