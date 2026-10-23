import { render, screen } from '@testing-library/react-native';
import {
  IconoAtencion,
  IconoCalendario,
  IconoInformacion,
  IconoLogro,
  IconoOcultar,
  IconoVer,
} from '../../src/componentes/Iconos';

describe('Iconos (E14-SDD 5.1)', () => {
  it.each([
    ['Información', IconoInformacion],
    ['Atención', IconoAtencion],
    ['Logro', IconoLogro],
    ['Ver', IconoVer],
    ['Ocultar', IconoOcultar],
    ['Calendario', IconoCalendario],
  ])('el ícono %s se dibuja y el lector de pantalla lo salta', async (_nombre, Icono) => {
    await render(<Icono color="red" />);
    expect(screen.toJSON()).not.toBeNull();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).toContain('no-hide-descendants');
  });
});
