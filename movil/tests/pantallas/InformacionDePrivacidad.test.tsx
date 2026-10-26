import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { InformacionDePrivacidad } from '../../src/pantallas/InformacionDePrivacidad';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';

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

  it('solo informa: no hay casillas ni «Leer la política completa» (PN-68 no existe)', async () => {
    await mostrar();
    expect(screen.queryByRole('checkbox')).not.toBeOnTheScreen();
    expect(screen.queryByText('Leer la política completa')).not.toBeOnTheScreen();
    expect(screen.getAllByRole('button')).toHaveLength(1);
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
