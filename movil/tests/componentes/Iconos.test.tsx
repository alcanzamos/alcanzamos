import { render, screen } from '@testing-library/react-native';
import {
  IconoAtencion,
  IconoCalendario,
  IconoCheck,
  IconoCompartido,
  IconoInformacion,
  IconoLogro,
  IconoOcultar,
  IconoPropio,
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
    ['Check', IconoCheck],
    ['Propio', IconoPropio],
    ['Compartido', IconoCompartido],
  ])('el ícono %s se dibuja y el lector de pantalla lo salta', async (_nombre, Icono) => {
    await render(<Icono color="red" />);
    expect(screen.toJSON()).not.toBeNull();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).toContain('no-hide-descendants');
  });
});
