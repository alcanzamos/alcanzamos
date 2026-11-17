import { useEffect, useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text, type HostInstance } from 'react-native';
import { useLlevarFoco } from '../src/anuncios';
import { crearCuenta } from '../src/api/cuentas';
import { HojaInferior } from '../src/componentes/HojaInferior';
import { HojaQueSale } from '../src/componentes/HojaQueSale';
import { CrearCuenta } from '../src/pantallas/CrearCuenta';
import { focosDeTalkBack, limpiarAnuncios } from './ayudas/anuncios';
import { animacionesAMano, terminarAnimaciones } from './ayudas/animacion';
import { navegacionFalsa, propiedades } from './ayudas/pantalla';

jest.mock('../src/api/cuentas', () => ({ crearCuenta: jest.fn() }));
jest.mock('expo-secure-store', () => jest.requireActual('./ayudas/secureStoreFalso').crearSecureStoreFalso());

const nada = () => undefined;
const cuadro = () =>
  act(async () => {
    jest.advanceTimersByTime(16);
  });

function Escena({ abierta, segunda = false, retenida }: { abierta: boolean; segunda?: boolean; retenida: boolean }) {
  const destino = useRef<HostInstance>(null);
  const llevarFoco = useLlevarFoco();

  useEffect(() => {
    if (!abierta) llevarFoco(destino);
  }, [abierta, llevarFoco]);

  const hoja = (
    <HojaInferior visible={retenida || abierta} alCerrar={nada}>
      <Text>Primera hoja</Text>
    </HojaInferior>
  );

  return (
    <>
      <Text ref={destino} accessibilityLabel="Fondo" accessibilityHint={undefined}>
        Fondo
      </Text>
      {retenida ? <HojaQueSale>{abierta && hoja}</HojaQueSale> : hoja}
      <HojaInferior visible={segunda} alCerrar={nada}>
        <Text>Segunda hoja</Text>
      </HojaInferior>
    </>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  animacionesAMano();
  limpiarAnuncios();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// Pruebas de regresión de la verificación independiente del 2026-11-17 (bugs 303 y 304).
describe.each([false, true])('retención de hoja: %s', (retenida) => {
  it('reabrir la hoja durante la salida no enfoca el fondo', async () => {
    const { rerender } = await render(<Escena abierta retenida={retenida} />);
    await terminarAnimaciones();
    await rerender(<Escena abierta={false} retenida={retenida} />);
    await rerender(<Escena abierta retenida={retenida} />);
    await terminarAnimaciones();
    await cuadro();

    expect(screen.getByText('Primera hoja')).toBeOnTheScreen();
    expect(focosDeTalkBack()).toEqual([]);
  });

  it('otra hoja abierta antes del cuadro impide enfocar detrás', async () => {
    const { rerender } = await render(<Escena abierta retenida={retenida} />);
    await terminarAnimaciones();
    await rerender(<Escena abierta={false} retenida={retenida} />);
    await terminarAnimaciones();
    await rerender(<Escena abierta={false} segunda retenida={retenida} />);
    await terminarAnimaciones();
    await cuadro();

    expect(screen.getByText('Segunda hoja')).toBeOnTheScreen();
    expect(focosDeTalkBack()).toEqual([]);
  });
});

it('«Intentar de nuevo» al crear la cuenta queda ocupado mientras envía', async () => {
  const fallo = { ok: false as const, estado: 500, codigo: 'interno', campos: {} };
  let soltar!: (respuesta: typeof fallo) => void;
  const crear = jest.mocked(crearCuenta);
  crear.mockReset();
  crear.mockResolvedValueOnce(fallo);
  crear.mockImplementationOnce(
    () =>
      new Promise((resolver) => {
        soltar = resolver;
      }),
  );

  await render(<CrearCuenta {...propiedades('CrearCuenta', navegacionFalsa(), { mayorDeEdad: true })} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));

  const reintentar = screen.getByRole('button', { name: 'Intentar de nuevo' });
  const estado = reintentar.props.accessibilityState;
  await fireEvent.press(reintentar);
  expect(crear).toHaveBeenCalledTimes(2);
  await act(async () => soltar(fallo));

  expect(estado).toEqual({ disabled: false, busy: true });
});

it('«Intentar de nuevo» al crear la cuenta quita el aviso y el botón cuando llega la respuesta', async () => {
  const fallo = { ok: false as const, estado: 500, codigo: 'interno', campos: {} };
  let soltar!: (respuesta: { ok: false; estado: number; codigo: string; campos: Record<string, string> }) => void;
  const crear = jest.mocked(crearCuenta);
  crear.mockReset();
  crear.mockResolvedValueOnce(fallo);
  crear.mockImplementationOnce(
    () =>
      new Promise((resolver) => {
        soltar = resolver;
      }),
  );

  await render(<CrearCuenta {...propiedades('CrearCuenta', navegacionFalsa(), { mayorDeEdad: true })} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
  expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeOnTheScreen();
  await act(async () => soltar({ ok: false, estado: 422, codigo: 'validacion', campos: { correo: 'correo_invalido' } }));

  expect(screen.queryByRole('button', { name: 'Intentar de nuevo' })).not.toBeOnTheScreen();
});
