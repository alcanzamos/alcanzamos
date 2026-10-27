import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { reiniciarBorrador } from '../../src/borradorDeRegistro';
import type { Movimiento } from '../../src/api/movimientos';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { atras, instalarAtras } from '../ayudas/atras';
import { respuestaJson } from '../ayudas/fetchFalso';
import {
  apiFalsa,
  arriendoDeEnero,
  BASE,
  gastoDeAyer,
  listado,
  movimiento,
  type Pedido,
} from '../ayudas/movimientosFalsos';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const PN71 = 'Este es tu primer ingreso.';
const de = (pedidos: Pedido[], metodo: string) => pedidos.filter((p) => p.metodo === metodo);

const recurrente = (vuelve: boolean) =>
  ({ recurrente_id: 'r1', fecha_programada: '2026-11-01', periodicidad: 'quincenal', vuelve_a_pendiente: vuelve }) as const;

// PN-71 → PN-01 → PN-02 del movimiento que se toca en la lista.
async function abrirDetalle(m: Movimiento = gastoDeAyer, textoDeLaFila = 'Alimentación · Mercado') {
  await render(<Navegacion />);
  await screen.findByText(PN71);
  await fireEvent.press(screen.getByRole('button', { name: 'Movimientos' }));
  await fireEvent.press(await screen.findByText(textoDeLaFila, { exact: false }));
  await screen.findByRole('button', { name: 'Corregir' });
  return m;
}

describe('PN-02 · Detalle de un movimiento, Android (E14-PRR 4.2)', () => {
  beforeEach(() => {
    instalarAtras();
    fijarHoy(new Date('2026-11-02T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    reiniciarBorrador();
  });
  afterEach(() => jest.useRealTimers());

  describe('el detalle', () => {
    it('muestra el monto, «Gasto en Alimentación», la fecha en palabras, el medio, de quién es y la descripción', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer] }) });
      await abrirDetalle();
      expect(screen.getByText('$45.000', { exact: false })).toBeOnTheScreen();
      expect(screen.getByText('Gasto en Alimentación')).toBeOnTheScreen();
      expect(screen.getByText('Ayer, 1 de noviembre de 2026', { exact: false })).toBeOnTheScreen();
      expect(screen.getByText('Medio de pago')).toBeOnTheScreen();
      expect(screen.getAllByText('Efectivo').length).toBeGreaterThan(0);
      expect(screen.getByText('De quién es')).toBeOnTheScreen();
      expect(screen.getByText('Solo mío')).toBeOnTheScreen();
      expect(screen.getByText('Mercado')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Corregir' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Borrar este movimiento' })).toBeOnTheScreen();
      expect(screen.queryByText('Se repite')).not.toBeOnTheScreen();
    });

    it('un ingreso sin descripción dice «Ingreso en Salario» y no trae la fila Descripción', async () => {
      apiFalsa(respuestaJson, {
        lista: listado({ movimientos: [movimiento({ id: 'i1', tipo: 'ingreso', categoria_id: 17, medio: 'transferencia' })] }),
      });
      await abrirDetalle(undefined, 'Salario');
      expect(screen.getByText('Ingreso en Salario')).toBeOnTheScreen();
      expect(screen.queryByText('Descripción')).not.toBeOnTheScreen();
    });

    it('una fecha de un recurrente trae «Se repite» «Cada quincena»', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [{ ...gastoDeAyer, recurrente: recurrente(true) }] }) });
      await abrirDetalle();
      expect(screen.getByText('Se repite')).toBeOnTheScreen();
      expect(screen.getByText('Cada quincena')).toBeOnTheScreen();
    });

    it('un aporte muestra su meta en lugar de la categoría y la marca «Compartido con el hogar»', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [arriendoDeEnero] }) });
      await abrirDetalle(undefined, 'Arriendo de enero');
      expect(screen.getByText('Aporte a «Arriendo de enero»')).toBeOnTheScreen();
      expect(screen.getByText('$100.000', { exact: false })).toBeOnTheScreen();
      expect(screen.getByText('Compartido con el hogar')).toBeOnTheScreen();
    });

    it('el Atrás vuelve a PN-01 y de ahí a PN-71', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer] }) });
      await abrirDetalle();
      expect(await atras()).toBe(true);
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Corregir' })).not.toBeOnTheScreen());
      expect(screen.getByRole('button', { name: 'Registrar' })).toBeOnTheScreen();
      expect(await atras()).toBe(true);
      await screen.findByText(PN71);
    });
  });

  describe('borrar', () => {
    const abrirLaHoja = async () => fireEvent.press(await screen.findByRole('button', { name: 'Borrar este movimiento' }));

    it('la hoja dice qué se borra y qué pasa, y «Ahora no» la cierra sin borrar nada', async () => {
      const pedidos = apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer] }) });
      await abrirDetalle();
      expect(screen.queryByText('¿Borrar este movimiento?')).not.toBeOnTheScreen();
      await abrirLaHoja();
      expect(await screen.findByText('¿Borrar este movimiento?')).toBeOnTheScreen();
      expect(screen.getByText('Gasto de $45.000 en Alimentación, Ayer.', { exact: false })).toBeOnTheScreen();
      expect(screen.getByText('Se quita de tu lista y calculamos el mes de nuevo.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Borrar el movimiento' })).toBeOnTheScreen();
      expect(screen.queryByText(/El avance de/)).not.toBeOnTheScreen();
      expect(screen.queryByText('Esta fecha volverá a quedar por confirmar.')).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Ahora no' }));
      await waitFor(() => expect(screen.queryByText('¿Borrar este movimiento?')).not.toBeOnTheScreen());
      expect(de(pedidos, 'DELETE')).toEqual([]);
    });

    it('el Atrás de Android cierra la hoja (onRequestClose) y no sale del detalle', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer] }) });
      await abrirDetalle();
      await abrirLaHoja();
      await fireEvent(await screen.findByText('¿Borrar este movimiento?'), 'requestClose');
      await waitFor(() => expect(screen.queryByText('¿Borrar este movimiento?')).not.toBeOnTheScreen());
      expect(screen.getByRole('button', { name: 'Corregir' })).toBeOnTheScreen();
    });

    it('«Borrar el movimiento» manda el DELETE y vuelve a PN-01 con «Listo, borramos el gasto de $45.000.»', async () => {
      let hay = true;
      const pedidos = apiFalsa(respuestaJson, {
        lista: () => listado({ movimientos: hay ? [gastoDeAyer] : [], meses: hay ? ['2026-11'] : [] }),
        borrar: () => {
          hay = false;
          return respuestaJson(204);
        },
      });
      await abrirDetalle();
      await abrirLaHoja();
      await fireEvent.press(await screen.findByRole('button', { name: 'Borrar el movimiento' }));
      expect(await screen.findByText('Listo, borramos el gasto de $45.000.')).toBeOnTheScreen();
      expect(de(pedidos, 'DELETE').map((p) => p.ruta)).toEqual(['/api/v1/movimientos/m-ayer']);
      // El aviso es una región viva cortés (TalkBack lo anuncia) y PN-01 pide la lista otra vez: ya no está.
      expect(JSON.stringify(screen.toJSON())).toContain('"accessibilityLiveRegion":"polite"');
      await screen.findByText('Todavía no hay movimientos');
      expect(screen.queryByText('Alimentación · Mercado', { exact: false })).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Corregir' })).not.toBeOnTheScreen();
    });

    it.each([
      ['un ingreso', movimiento({ id: 'i1', tipo: 'ingreso', categoria_id: 17, monto_centavos: '150000000', medio: 'transferencia' }), 'Salario', 'Ingreso de $1.500.000 en Salario, Ayer.', 'Listo, borramos el ingreso de $1.500.000.'],
      ['un aporte', { ...arriendoDeEnero, fecha: '2026-11-02' }, 'Arriendo de enero', 'Aporte de $100.000 a «Arriendo de enero», Hoy.', 'Listo, borramos el aporte de $100.000.'],
    ])('%s: la hoja y el aviso usan su forma', async (_nombre, m, fila, quitaDeLaLista, aviso) => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [m] }) });
      await abrirDetalle(m, fila);
      await abrirLaHoja();
      expect(await screen.findByText(quitaDeLaLista, { exact: false })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Borrar el movimiento' }));
      expect(await screen.findByText(aviso)).toBeOnTheScreen();
    });

    it('un aporte agrega cuánto baja el avance de la meta', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [arriendoDeEnero] }) });
      await abrirDetalle(undefined, 'Arriendo de enero');
      await abrirLaHoja();
      expect(
        await screen.findByText('El avance de «Arriendo de enero» baja $100.000. El avance nunca queda por debajo de cero.', {
          exact: false,
        }),
      ).toBeOnTheScreen();
    });

    it('un retiro de una meta no dice cuánto sube o baja el avance', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [{ ...arriendoDeEnero, sentido: 'salida' }] }) });
      await abrirDetalle(undefined, 'Arriendo de enero');
      await abrirLaHoja();
      await screen.findByText('¿Borrar este movimiento?');
      expect(screen.queryByText(/El avance de/)).not.toBeOnTheScreen();
    });

    // D-169: la frase solo si de verdad vuelve a pendiente; lo decide el API (`vuelve_a_pendiente`).
    it.each([
      [true, true],
      [false, false],
    ])('D-169: con vuelve_a_pendiente %s, la frase «Esta fecha volverá a quedar por confirmar.» sale: %s', async (vuelve, sale) => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [{ ...gastoDeAyer, recurrente: recurrente(vuelve) }] }) });
      await abrirDetalle();
      await abrirLaHoja();
      await screen.findByText('¿Borrar este movimiento?');
      const frase = screen.queryByText('Esta fecha volverá a quedar por confirmar.');
      expect(frase !== null).toBe(sale);
    });

    it('un doble toque manda un solo DELETE', async () => {
      let soltar: (r: Response) => void = () => undefined;
      const pedidos = apiFalsa(respuestaJson, {
        lista: listado({ movimientos: [gastoDeAyer] }),
        borrar: () => new Promise<Response>((resolver) => (soltar = resolver)),
      });
      await abrirDetalle();
      await abrirLaHoja();
      const boton = await screen.findByRole('button', { name: 'Borrar el movimiento' });
      await fireEvent.press(boton);
      await fireEvent.press(boton);
      expect(de(pedidos, 'DELETE')).toHaveLength(1);
      await act(async () => soltar(respuestaJson(204)));
      await screen.findByText('Listo, borramos el gasto de $45.000.');
    });

    it('un 500 dice «No pudimos borrar el movimiento.», deja la hoja abierta y se puede intentar de nuevo', async () => {
      let falla = true;
      const pedidos = apiFalsa(respuestaJson, {
        lista: listado({ movimientos: [gastoDeAyer] }),
        borrar: () => (falla ? respuestaJson(500, { error: 'interno' }) : respuestaJson(204)),
      });
      await abrirDetalle();
      await abrirLaHoja();
      await fireEvent.press(await screen.findByRole('button', { name: 'Borrar el movimiento' }));
      expect(await screen.findByText('No pudimos borrar el movimiento.')).toBeOnTheScreen();
      expect(screen.getByText('Sigue en tu lista. Intenta de nuevo.')).toBeOnTheScreen();
      expect(screen.getByText('¿Borrar este movimiento?')).toBeOnTheScreen();
      falla = false;
      await fireEvent.press(screen.getByRole('button', { name: 'Borrar el movimiento' }));
      await screen.findByText('Listo, borramos el gasto de $45.000.');
      expect(de(pedidos, 'DELETE')).toHaveLength(2);
    });

    it('sin conexión dice el aviso de siempre', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer] }), borrar: () => Promise.reject(new Error('sin red')) });
      await abrirDetalle();
      await abrirLaHoja();
      await fireEvent.press(await screen.findByRole('button', { name: 'Borrar el movimiento' }));
      expect(await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.')).toBeOnTheScreen();
    });

    it('un 401 lleva a PN-60', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer] }), borrar: () => respuestaJson(401, { error: 'sin_sesion' }) });
      await abrirDetalle();
      await abrirLaHoja();
      await fireEvent.press(await screen.findByRole('button', { name: 'Borrar el movimiento' }));
      expect(await screen.findByText('Tu sesión se cerró', { exact: false })).toBeOnTheScreen();
    });

    it('un 404: «Ese movimiento ya no está.» y «Ir a Movimientos» vuelve a PN-01, que ya no lo trae', async () => {
      let hay = true;
      apiFalsa(respuestaJson, {
        lista: () => listado({ movimientos: hay ? [gastoDeAyer] : [], meses: ['2026-11'] }),
        borrar: () => {
          hay = false;
          return respuestaJson(404, { error: 'no_encontrado' });
        },
      });
      await abrirDetalle();
      await abrirLaHoja();
      await fireEvent.press(await screen.findByRole('button', { name: 'Borrar el movimiento' }));
      expect(await screen.findByText('Ese movimiento ya no está.')).toBeOnTheScreen();
      expect(screen.queryByText('¿Borrar este movimiento?')).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Corregir' })).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Ir a Movimientos' }));
      await screen.findByText('No hay movimientos con este filtro.');
      expect(screen.getByRole('button', { name: 'Registrar' })).toBeOnTheScreen();
    });
  });
});
