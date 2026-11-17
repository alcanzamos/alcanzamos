import { screen } from '@testing-library/react-native';

// Bug 303 (ACC-004): el botón que está mandando algo al API no se deshabilita para TalkBack (Android le quitaba el foco y
// saltaba a «Navegar hacia arriba»): sigue habilitado y dice que está ocupado. Cada botón que envía lo comprueba con esto
// además de probar que el segundo toque no manda nada.

type Opciones = { name: string | RegExp };

/** El botón con ese nombre está ocupado, sigue habilitado para TalkBack y se ve como deshabilitado. */
export function comprobarOcupado({ name }: Opciones) {
  const boton = screen.getByRole('button', { name });
  expect(boton).toBeBusy();
  expect(boton).toBeEnabled();
  expect(boton.props.accessibilityState).toEqual({ disabled: false, busy: true });
}
