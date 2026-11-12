import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { InformacionDePrivacidad } from '../../src/pantallas/InformacionDePrivacidad';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';

async function mostrarDesdeElMenu() {
  const navegacion = navegacionFalsa();
  await render(<InformacionDePrivacidad {...propiedades('InformacionDePrivacidad', navegacion, { desdeElMenu: true })} />);
  return navegacion;
}

async function mostrar(llegada?: 'correo_confirmado') {
  const navegacion = navegacionFalsa();
  await render(
    <InformacionDePrivacidad {...propiedades('InformacionDePrivacidad', navegacion, llegada ? { llegada } : undefined)} />,
  );
  return navegacion;
}

describe('PN-63 · Información de privacidad en el primer uso (E14-PCP 4.6)', () => {
  it('lleva el título, la frase de entrada y las ocho tarjetas de E14, en orden', async () => {
    await mostrar();
    expect(screen.getByRole('header', { name: 'Cómo cuidamos tus datos' })).toBeOnTheScreen();
    expect(screen.getByText('Antes de seguir, esto es lo que hacemos con tu información.')).toBeOnTheScreen();
    expect(screen.getAllByRole('header')).toHaveLength(9);
    for (const titulo of [
      'Lo que guardamos',
      'Para qué lo usamos',
      'Lo tuyo es solo tuyo',
      'Los avisos no cuentan nada',
      'Cuida lo que escribes',
      'Tus derechos',
      'Quién responde',
      'Dónde se guardan',
    ]) {
      expect(screen.getByRole('header', { name: titulo })).toBeOnTheScreen();
    }
    expect(screen.getByText('Andrés Jiménez es el responsable. Escríbele a privacidad@alcanzamos.co.')).toBeOnTheScreen();
    expect(screen.getByText(/^En Azure, en México\./)).toBeOnTheScreen();
  });

  it('solo informa: no hay casillas; los botones son «Leer la política completa» y «Continuar»', async () => {
    await mostrar();
    expect(screen.queryByRole('checkbox')).not.toBeOnTheScreen();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  // D-195 (E14-PCP 4.6, fila 10): «Leer la política completa» es un botón Secundario, antes de «Continuar».
  it('«Leer la política completa» abre PN-68, va antes de «Continuar» y no cambia de pantalla por sí sola', async () => {
    const navegacion = await mostrar();
    const botones = screen.getAllByRole('button');
    const politica = screen.getByRole('button', { name: 'Leer la política completa' });
    expect(botones).toEqual([politica, screen.getByRole('button', { name: 'Continuar' })]);
    await fireEvent.press(politica);
    expect(navegacion.navigate).toHaveBeenCalledTimes(1);
    expect(navegacion.navigate).toHaveBeenCalledWith('Politica');
    expect(navegacion.dispatch).not.toHaveBeenCalled();
  });

  it('«Continuar» abre PN-64', async () => {
    const navegacion = await mostrar();
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    expect(navegacion.navigate).toHaveBeenCalledWith('AutorizacionDeDatos');
  });

  it('con la llegada del correo muestra arriba «Listo, confirmamos tu correo.» como mensaje de estado', async () => {
    await mostrar('correo_confirmado');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Listo, confirmamos tu correo.')).toBeOnTheScreen();
  });

  it('sin llegada no hay mensaje de estado', async () => {
    await mostrar();
    expect(screen.queryByText('Listo, confirmamos tu correo.')).not.toBeOnTheScreen();
  });
});

// E14-PCP 4.6 («Dos modos, una pantalla») y nota del 2026-11-08 (bug 260, USA-003): desde el menú, las mismas tarjetas;
// el título y el Atrás van en la barra nativa (Navegacion.tsx), y no hay «Continuar».
describe('PN-63 · Información de privacidad desde el menú (E14-PCP 4.6)', () => {
  it('lleva la frase de entrada y las ocho tarjetas; el título no se repite en la pantalla (va en la barra)', async () => {
    await mostrarDesdeElMenu();
    expect(screen.getByText('Antes de seguir, esto es lo que hacemos con tu información.')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Cómo cuidamos tus datos' })).not.toBeOnTheScreen();
    expect(screen.getAllByRole('header').map((titulo) => titulo.props.children)).toEqual([
      'Lo que guardamos',
      'Para qué lo usamos',
      'Lo tuyo es solo tuyo',
      'Los avisos no cuentan nada',
      'Cuida lo que escribes',
      'Tus derechos',
      'Quién responde',
      'Dónde se guardan',
    ]);
  });

  it('no lleva «Continuar» y no lleva a PN-64; su único botón es «Leer la política completa», que abre PN-68', async () => {
    const navegacion = await mostrarDesdeElMenu();
    expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: 'Leer la política completa' })]);
    expect(screen.queryByText('Continuar')).not.toBeOnTheScreen();
    expect(navegacion.navigate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Leer la política completa' }));
    expect(navegacion.navigate).toHaveBeenCalledWith('Politica');
  });
});
