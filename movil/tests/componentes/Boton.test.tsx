import { fireEvent, render, screen } from '@testing-library/react-native';
import { Boton, BotonDeTexto } from '../../src/componentes/Boton';
import { tokens } from '../../src/tokens/tokens.generated';

describe('Boton (E14-SDD 5.2)', () => {
  it('llama a alTocar al tocarlo', async () => {
    const alTocar = jest.fn();
    await render(<Boton alTocar={alTocar}>Crear cuenta</Boton>);
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(alTocar).toHaveBeenCalledTimes(1);
  });

  it('mide al menos 48 dp en alto y en ancho (tamano.tactil-minimo)', async () => {
    await render(<Boton>Entrar</Boton>);
    expect(screen.getByRole('button')).toHaveStyle({
      minHeight: tokens.tamano['tactil-minimo'],
      minWidth: tokens.tamano['tactil-minimo'],
    });
  });

  it('primario: relleno Monte y texto blanco; secundario: relleno blanco con contorno Monte', async () => {
    await render(
      <>
        <Boton>Primario</Boton>
        <Boton variante="secundario">Secundario</Boton>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Primario' })).toHaveStyle({
      backgroundColor: tokens.color.accion.primaria.fondo,
    });
    expect(screen.getByText('Primario')).toHaveStyle({ color: tokens.color.accion.primaria.texto });
    expect(screen.getByRole('button', { name: 'Secundario' })).toHaveStyle({
      backgroundColor: tokens.color.fondo.superficie,
      borderColor: tokens.color.accion.secundaria.borde,
    });
  });

  it('deshabilitado: no llama a alTocar, usa los colores de deshabilitado y lo dice al lector de pantalla', async () => {
    const alTocar = jest.fn();
    await render(
      <Boton deshabilitado alTocar={alTocar}>
        Reenviar el correo
      </Boton>,
    );
    const boton = screen.getByRole('button', { name: 'Reenviar el correo', disabled: true });
    await fireEvent.press(boton);
    expect(alTocar).not.toHaveBeenCalled();
    expect(boton).toHaveStyle({ backgroundColor: tokens.color.accion.deshabilitada.fondo });
    expect(screen.getByText('Reenviar el correo')).toHaveStyle({ color: tokens.color.accion.deshabilitada.texto });
  });

  it('el botón de texto no lleva relleno ni borde y usa la tipografía de etiqueta', async () => {
    await render(<BotonDeTexto>Cerrar sesión</BotonDeTexto>);
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toHaveStyle({
      backgroundColor: 'transparent',
      minHeight: tokens.tamano['tactil-minimo'],
    });
    expect(screen.getByText('Cerrar sesión')).toHaveStyle({
      fontFamily: 'AtkinsonHyperlegibleNext-SemiBold',
      fontSize: tokens.tipografia.etiqueta.fontSize,
      color: tokens.color.accion.secundaria.texto,
    });
  });

  it('un botón de texto deshabilitado atenúa el texto y sigue sin relleno', async () => {
    await render(
      <BotonDeTexto deshabilitado alTocar={jest.fn()}>
        Cambiar
      </BotonDeTexto>,
    );
    expect(screen.getByText('Cambiar')).toHaveStyle({ color: tokens.color.accion.deshabilitada.texto });
    expect(screen.getByRole('button')).toHaveStyle({ backgroundColor: 'transparent' });
  });

  it('con el foco pinta el anillo de color.borde.foco y lo quita al perderlo', async () => {
    await render(<Boton variante="secundario">Seguir</Boton>);
    const boton = screen.getByRole('button');
    await fireEvent(boton, 'focus');
    expect(screen.getByRole('button')).toHaveStyle({ borderColor: tokens.color.borde.foco });
    await fireEvent(boton, 'blur');
    expect(screen.getByRole('button')).toHaveStyle({ borderColor: tokens.color.accion.secundaria.borde });
  });

  it('pasa la pista de accesibilidad', async () => {
    await render(<Boton pista="Abre la recuperación">Seguir</Boton>);
    expect(screen.getByRole('button').props.accessibilityHint).toBe('Abre la recuperación');
  });
});

describe('Boton · Destructivo (E14-SDD 5.2)', () => {
  it('relleno de peligro con texto blanco, y deshabilitado no hace nada', async () => {
    const alTocar = jest.fn();
    const { rerender } = await render(<Boton variante="destructivo" alTocar={alTocar}>Borrar el movimiento</Boton>);
    expect(screen.getByRole('button', { name: 'Borrar el movimiento' })).toHaveStyle({
      backgroundColor: tokens.color.accion.destructiva.fondo,
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar el movimiento' }));
    expect(alTocar).toHaveBeenCalledTimes(1);
    await rerender(
      <Boton variante="destructivo" deshabilitado alTocar={alTocar}>
        Borrar el movimiento
      </Boton>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar el movimiento' }));
    expect(alTocar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Borrar el movimiento' })).toHaveStyle({
      backgroundColor: tokens.color.accion.deshabilitada.fondo,
    });
  });
});
