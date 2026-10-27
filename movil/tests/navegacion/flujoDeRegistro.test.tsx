import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { reiniciarBorrador } from '../../src/borradorDeRegistro';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { respuestaJson } from '../ayudas/fetchFalso';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;
jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: jest.fn() } }));
const abrirSelector = DateTimePickerAndroid.open as jest.Mock;

const BASE = 'http://api.prueba:18090';

// El Atrás de Android, como en flujoDeAutorizacion.test.tsx: verdadero si la pila lo manejó, falso si la app saldría.
const suscripciones = new Set<(evento: never) => boolean | null | undefined>();
const atras = (): boolean => [...suscripciones].reverse().some((alTocar) => alTocar(undefined as never));
const tocarAtras = (esperado: boolean) =>
  act(async () => {
    expect(atras()).toBe(esperado);
  });

const catalogo = {
  gasto: [
    { id: 4, nombre: 'x', general: false },
    { id: 16, nombre: 'x', general: true },
  ],
  ingreso: [{ id: 17, nombre: 'x', general: false }],
};
const creado = { movimiento_id: 'm1', recurrente_id: null, proximas: [], pendientes: [] };
const PN71 = 'Este es tu primer ingreso.';

type Pedido = { metodo: string; ruta: string; cuerpo?: string };
// El API de mentira con las cuatro rutas del flujo; `proximas` es lo que contesta el endpoint de L6.
function api(proximas: string[] = []) {
  const pedidos: Pedido[] = [];
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const ruta = url.replace(BASE, '');
    pedidos.push({ metodo: String(init.method), ruta, cuerpo: init.body as string | undefined });
    if (ruta.startsWith('/api/v1/cuenta/seguridad')) return respuestaJson(200, { ingreso_anterior: null });
    if (ruta === '/api/v1/categorias') return respuestaJson(200, catalogo);
    if (ruta.startsWith('/api/v1/repeticiones/proximas')) return respuestaJson(200, { proximas });
    return respuestaJson(201, creado);
  }) as unknown as typeof fetch;
  return pedidos;
}
const guardados = (pedidos: Pedido[]) => pedidos.filter((p) => p.metodo === 'POST');

describe('flujo de registrar un movimiento en Android (PN-71 → Registrar → PN-03)', () => {
  beforeEach(() => {
    suscripciones.clear();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_evento, alTocar) => {
      suscripciones.add(alTocar);
      return { remove: () => suscripciones.delete(alTocar) };
    });
    fijarHoy(new Date('2026-10-26T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    abrirSelector.mockReset();
    reiniciarBorrador();
  });
  afterEach(() => jest.useRealTimers());

  async function abrirElFormulario() {
    await render(<Navegacion />);
    await screen.findByText(PN71);
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar un movimiento' }));
    await screen.findByLabelText('Monto');
  }

  // USA-004 (D-165, punto 2): sin categoría sugerida (no hay motor de reglas), un gasto en efectivo cuesta CINCO
  // interacciones desde PN-71: abrir, monto, categoría, «Efectivo» y «Guardar». «Gasto» y «Hoy» ya vienen elegidos.
  it('USA-004: un gasto en efectivo desde PN-71 cuesta cinco interacciones y vuelve con «Listo, registramos tu gasto de $45.000.»', async () => {
    const pedidos = api();
    let interacciones = 0;
    const tocar = async (accion: () => Promise<unknown> | unknown) => {
      interacciones++;
      await accion();
    };
    await render(<Navegacion />);
    await screen.findByText(PN71);
    await tocar(() => fireEvent.press(screen.getByRole('button', { name: 'Registrar un movimiento' })));
    await tocar(async () => fireEvent.changeText(await screen.findByLabelText('Monto'), '45.000'));
    await tocar(() => fireEvent.press(screen.getByRole('radio', { name: 'Otros gastos' })));
    await tocar(() => fireEvent.press(screen.getByRole('radio', { name: 'Efectivo' })));
    await tocar(() => fireEvent.press(screen.getByRole('button', { name: 'Guardar' })));
    expect(await screen.findByText('Listo, registramos tu gasto de $45.000.')).toBeOnTheScreen();
    expect(interacciones).toBe(5);
    expect(screen.getByText(PN71)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen();
    expect(JSON.parse(guardados(pedidos)[0]!.cuerpo!)).toEqual({
      monto_centavos: 4500000,
      tipo: 'gasto',
      fecha: '2026-10-26',
      categoria_id: 16,
      medio: 'efectivo',
    });
    // El mensaje de estado es una región viva cortés: TalkBack lo anuncia sin mover el foco.
    expect(JSON.stringify(screen.toJSON())).toContain('"accessibilityLiveRegion":"polite"');
  });

  it('Atrás en Registrar vuelve a PN-71 sin guardar nada', async () => {
    const pedidos = api();
    await abrirElFormulario();
    await fireEvent.changeText(screen.getByLabelText('Monto'), '45.000');
    await tocarAtras(true);
    await waitFor(() => expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen());
    expect(screen.getByText(PN71)).toBeOnTheScreen();
    expect(guardados(pedidos)).toEqual([]);
    expect(screen.queryByText(/Listo, registramos/)).not.toBeOnTheScreen();
    // Al volver a entrar, el formulario empieza vacío.
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar un movimiento' }));
    expect((await screen.findByLabelText('Monto')).props.value).toBe('');
  });

  it('después de guardar, el Atrás no vuelve al formulario: sale de la app', async () => {
    api();
    await abrirElFormulario();
    await fireEvent.changeText(screen.getByLabelText('Monto'), '45.000');
    await fireEvent.press(screen.getByRole('radio', { name: 'Otros gastos' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Efectivo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText('Listo, registramos tu gasto de $45.000.');
    await tocarAtras(false);
    expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen();
  });

  it('PN-03: el Atrás vuelve al formulario sin cambiar nada y «Listo» deja «Se repite: Cada mes»', async () => {
    api(['2026-11-26', '2026-12-26', '2027-01-26']);
    await abrirElFormulario();
    await fireEvent.changeText(screen.getByLabelText('Monto'), '45.000');
    await fireEvent.press(screen.getByRole('button', { name: 'Cambiar' }));
    await screen.findByText('Lo registras una vez. En cada fecha te pedimos confirmarlo con un toque.');
    await fireEvent.press(screen.getByRole('radio', { name: 'Cada mes' }));
    await screen.findByText('26 de noviembre de 2026', { exact: false });
    await tocarAtras(true);
    await waitFor(() => expect(screen.queryByText('Lo registras una vez.', { exact: false })).not.toBeOnTheScreen());
    // Atrás no guardó la elección: el formulario sigue como estaba, con lo escrito.
    expect(screen.getByText('No se repite')).toBeOnTheScreen();
    expect(screen.getByLabelText('Monto').props.value).toBe('45.000');
    await fireEvent.press(screen.getByRole('button', { name: 'Cambiar' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Cada mes' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Listo' }));
    expect(await screen.findByText('Se repite: Cada mes')).toBeOnTheScreen();
    expect(screen.getByLabelText('Monto').props.value).toBe('45.000');
  });

  // S4 (D-164, D-165): el arriendo del 15 de agosto escrito el 26 de octubre, de punta a punta con la pila de verdad.
  it('el arriendo del 15 de agosto, mensual: PN-03 muestra lo que manda el API y se guarda con la fecha y la repetición', async () => {
    const pedidos = api(['2026-11-15', '2026-12-15', '2027-01-15']);
    await abrirElFormulario();
    await fireEvent.press(screen.getByRole('button', { name: 'Fecha, Hoy' }));
    await act(async () => abrirSelector.mock.calls[0][0].onValueChange({}, new Date(2026, 7, 15)));
    await fireEvent.changeText(screen.getByLabelText('Monto'), '1.200.000');
    await fireEvent.press(screen.getByRole('radio', { name: 'Arriendo o cuota de vivienda' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Transferencia' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cambiar' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Cada mes' }));
    expect(await screen.findByText('15 de noviembre de 2026', { exact: false })).toBeOnTheScreen();
    expect(screen.getByText('15 de diciembre de 2026', { exact: false })).toBeOnTheScreen();
    expect(screen.getByText('15 de enero de 2027', { exact: false })).toBeOnTheScreen();
    expect(pedidos.at(-1)?.ruta).toBe('/api/v1/repeticiones/proximas?periodicidad=mensual&inicio=2026-08-15');
    await fireEvent.press(screen.getByRole('button', { name: 'Listo' }));
    await screen.findByText('Se repite: Cada mes');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Listo, registramos tu gasto de $1.200.000.')).toBeOnTheScreen();
    expect(JSON.parse(guardados(pedidos)[0]!.cuerpo!)).toEqual({
      monto_centavos: 120000000,
      tipo: 'gasto',
      fecha: '2026-08-15',
      categoria_id: 4,
      medio: 'transferencia',
      repeticion: { periodicidad: 'mensual' },
    });
  });
});
