import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { reiniciarBorrador } from '../../src/borradorDeRegistro';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { atras, instalarAtras } from '../ayudas/atras';
import { respuestaJson } from '../ayudas/fetchFalso';
import { apiFalsa, BASE, gastoDeAyer, listado } from '../ayudas/movimientosFalsos';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const PN71 = 'Este es tu primer ingreso.';

// El Atrás de Android con la pila de verdad (US-52): PN-71 → PN-01 → PN-02 → «Corregir» o borrar.
describe('flujo de movimientos en Android: el Atrás de PN-01, PN-02 y «Corregir»', () => {
  beforeEach(() => {
    instalarAtras();
    fijarHoy(new Date('2026-11-02T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    reiniciarBorrador();
  });
  afterEach(() => jest.useRealTimers());

  async function abrirPN02() {
    await render(<Navegacion />);
    await screen.findByText(PN71);
    await fireEvent.press(screen.getByRole('button', { name: 'Movimientos' }));
    await fireEvent.press(await screen.findByText('Alimentación · Mercado', { exact: false }));
    await screen.findByRole('button', { name: 'Borrar este movimiento' });
  }

  it('Atrás recorre la pila al revés: PN-02 → PN-01 → PN-71 → sale de la app', async () => {
    apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer] }) });
    await abrirPN02();
    expect(await atras()).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Borrar este movimiento' })).not.toBeOnTheScreen());
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeOnTheScreen();
    expect(await atras()).toBe(true);
    await screen.findByText(PN71);
    expect(await atras()).toBe(false);
  });

  it('después de borrar, el Atrás no vuelve al movimiento borrado: PN-01, PN-71 y sale', async () => {
    let hay = true;
    apiFalsa(respuestaJson, {
      lista: () => listado({ movimientos: hay ? [gastoDeAyer] : [], meses: hay ? ['2026-11'] : [] }),
      borrar: () => {
        hay = false;
        return respuestaJson(204);
      },
    });
    await abrirPN02();
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar este movimiento' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Borrar el movimiento' }));
    expect(await screen.findByText('Listo, borramos el gasto de $45.000.')).toBeOnTheScreen();
    expect(await atras()).toBe(true);
    await screen.findByText(PN71);
    expect(screen.queryByRole('button', { name: 'Borrar este movimiento' })).not.toBeOnTheScreen();
    expect(await atras()).toBe(false);
  });

  it('después de corregir, el Atrás no vuelve al movimiento ni al formulario', async () => {
    apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer] }) });
    await abrirPN02();
    await fireEvent.press(screen.getByRole('button', { name: 'Corregir' }));
    await fireEvent.changeText(await screen.findByLabelText('Monto'), '40.000');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
    expect(await screen.findByText('Listo, guardamos los cambios.')).toBeOnTheScreen();
    expect(await atras()).toBe(true);
    await screen.findByText(PN71);
    expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Corregir' })).not.toBeOnTheScreen();
    expect(await atras()).toBe(false);
  });

  it('con un filtro puesto, abrir un movimiento y volver conserva el filtro', async () => {
    const pedidos = apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer], categorias: [] }) });
    await render(<Navegacion />);
    await screen.findByText(PN71);
    await fireEvent.press(screen.getByRole('button', { name: 'Movimientos' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Octubre' }));
    await waitFor(() => expect(pedidos.at(-1)?.ruta).toBe('/api/v1/movimientos?periodo=2026-10'));
    await fireEvent.press(await screen.findByText('Alimentación · Mercado', { exact: false }));
    await screen.findByRole('button', { name: 'Corregir' });
    await fireEvent.press(screen.getByRole('button', { name: 'Corregir' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Guardar los cambios' }));
    await screen.findByText('Listo, guardamos los cambios.');
    // Tras guardar, PN-01 sigue en octubre: la lista se vuelve a pedir con ese periodo.
    await waitFor(() => expect(pedidos.filter((p) => p.metodo === 'GET' && p.ruta.startsWith('/api/v1/movimientos?')).at(-1)?.ruta).toBe('/api/v1/movimientos?periodo=2026-10'));
    expect(screen.getByRole('radio', { name: 'Octubre' }).props.accessibilityState.checked).toBe(true);
  });
});
