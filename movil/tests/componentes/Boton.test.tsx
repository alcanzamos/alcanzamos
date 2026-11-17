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

  // Bug 303 (231.3, 8.3, 228.2, 67.8): un botón que se deshabilita mientras envía hace que Android le quite el foco a
  // TalkBack, que salta a «Navegar hacia arriba». Con `ocupado` sigue habilitado para TalkBack (se puede seguir en él) y
  // dice que está ocupado; el segundo toque no hace nada y en pantalla se ve igual que deshabilitado.
  it('ocupado: sigue habilitado para TalkBack y marcado como ocupado, y se ve igual que deshabilitado', async () => {
    await render(
      <>
        <Boton ocupado alTocar={jest.fn()}>
          Guardar
        </Boton>
        <Boton deshabilitado alTocar={jest.fn()}>
          Reenviar
        </Boton>
      </>,
    );
    const ocupado = screen.getByRole('button', { name: 'Guardar' });
    expect(ocupado.props.accessibilityState).toEqual({ disabled: false, busy: true });
    expect(screen.getByRole('button', { name: 'Guardar', busy: true })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Guardar', disabled: false })).toBeEnabled();
    const deshabilitado = screen.getByRole('button', { name: 'Reenviar' });
    expect(deshabilitado.props.accessibilityState).toEqual({ disabled: true });
    expect(ocupado).toHaveStyle({ backgroundColor: tokens.color.accion.deshabilitada.fondo, borderColor: 'transparent' });
    expect(screen.getByText('Guardar')).toHaveStyle({ color: tokens.color.accion.deshabilitada.texto });
    expect(deshabilitado).toHaveStyle({ backgroundColor: tokens.color.accion.deshabilitada.fondo });
  });

  it('ocupado: el segundo toque no llama a alTocar, y al dejar de estar ocupado vuelve a funcionar', async () => {
    const alTocar = jest.fn();
    const { rerender } = await render(
      <Boton ocupado alTocar={alTocar}>
        Guardar
      </Boton>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    expect(alTocar).not.toHaveBeenCalled();
    await rerender(<Boton alTocar={alTocar}>Guardar</Boton>);
    expect(screen.getByRole('button', { name: 'Guardar' }).props.accessibilityState).toEqual({ disabled: false });
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    expect(alTocar).toHaveBeenCalledTimes(1);
  });

  it('ocupado en un botón de texto atenúa el texto, como deshabilitado, y sigue habilitado para TalkBack', async () => {
    await render(
      <BotonDeTexto ocupado alTocar={jest.fn()}>
        Descargar mis datos
      </BotonDeTexto>,
    );
    expect(screen.getByText('Descargar mis datos')).toHaveStyle({ color: tokens.color.accion.deshabilitada.texto });
    expect(screen.getByRole('button').props.accessibilityState).toEqual({ disabled: false, busy: true });
  });

  // L8.2 (bug 303): `BotonDeTexto` tiene el mismo `ocupado` que `Boton` («Cerrar sesión» lo usa mientras manda el DELETE).
  it('BotonDeTexto ocupado: marcado como ocupado y habilitado para TalkBack, y se ve igual que deshabilitado', async () => {
    await render(
      <>
        <BotonDeTexto ocupado alTocar={jest.fn()}>
          Cerrar sesión
        </BotonDeTexto>
        <BotonDeTexto deshabilitado alTocar={jest.fn()}>
          Cambiar
        </BotonDeTexto>
      </>,
    );
    const ocupado = screen.getByRole('button', { name: 'Cerrar sesión' });
    expect(ocupado.props.accessibilityState).toEqual({ disabled: false, busy: true });
    expect(screen.getByRole('button', { name: 'Cerrar sesión', busy: true })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cerrar sesión', disabled: false })).toBeEnabled();
    expect(ocupado).toHaveStyle({ backgroundColor: 'transparent', borderColor: 'transparent' });
    expect(screen.getByText('Cerrar sesión')).toHaveStyle({ color: tokens.color.accion.deshabilitada.texto });
    expect(screen.getByText('Cambiar')).toHaveStyle({ color: tokens.color.accion.deshabilitada.texto });
  });

  it('BotonDeTexto ocupado: el segundo toque no llama a alTocar, y al dejar de estar ocupado vuelve a funcionar', async () => {
    const alTocar = jest.fn();
    const { rerender } = await render(
      <BotonDeTexto ocupado alTocar={alTocar}>
        Cerrar sesión
      </BotonDeTexto>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(alTocar).not.toHaveBeenCalled();
    await rerender(<BotonDeTexto alTocar={alTocar}>Cerrar sesión</BotonDeTexto>);
    expect(screen.getByRole('button', { name: 'Cerrar sesión' }).props.accessibilityState).toEqual({ disabled: false });
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(alTocar).toHaveBeenCalledTimes(1);
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

  it('con `nombre` el lector de pantalla dice ese nombre en vez del texto visible', async () => {
    await render(<Boton nombre="Confirmar Salario del 16 de noviembre de 2026">Confirmar</Boton>);
    expect(screen.getByRole('button', { name: 'Confirmar Salario del 16 de noviembre de 2026' })).toBeOnTheScreen();
    expect(screen.getByText('Confirmar')).toBeOnTheScreen();
  });
});
