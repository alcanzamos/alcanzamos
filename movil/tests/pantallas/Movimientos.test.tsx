import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { cambiarBorrador, reiniciarBorrador, useBorrador } from '../../src/borradorDeRegistro';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { arriendoDeEnero, gastoDeAyer, gastoDeHoy, listado, movimiento } from '../ayudas/movimientosFalsos';
import { respuestaJson } from '../ayudas/fetchFalso';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const BASE = 'http://api.prueba:18090';
const PN71 = 'Este es tu primer ingreso.';

// El Atrás de Android, como en flujoDeRegistro.test.tsx.
const suscripciones = new Set<(evento: never) => boolean | null | undefined>();
const atras = () => act(async () => void [...suscripciones].reverse().some((alTocar) => alTocar(undefined as never)));

type Responder = (ruta: string) => Response | Promise<Response>;
// El API de mentira: PN-71 y PN-01. `responder` decide lo que contesta la lista; se guardan las rutas que pidió.
function api(responder: Responder) {
  const lista: string[] = [];
  global.fetch = jest.fn(async (url: string) => {
    const ruta = url.replace(BASE, '');
    if (ruta.startsWith('/api/v1/cuenta/seguridad')) return respuestaJson(200, { ingreso_anterior: null });
    if (ruta === '/api/v1/categorias') return respuestaJson(200, { gasto: [{ id: 1, nombre: 'x', general: false }], ingreso: [] });
    lista.push(ruta);
    return responder(ruta);
  }) as unknown as typeof fetch;
  return lista;
}
const conLista = (datos = listado()) => api(() => respuestaJson(200, datos));

async function abrirLista() {
  await render(<Navegacion />);
  await screen.findByText(PN71);
  await fireEvent.press(screen.getByRole('button', { name: 'Movimientos' }));
}

describe('PN-01 · Movimientos, Android (E14-PRR 4.1)', () => {
  beforeEach(() => {
    suscripciones.clear();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_evento, alTocar) => {
      suscripciones.add(alTocar);
      return { remove: () => suscripciones.delete(alTocar) };
    });
    fijarHoy(new Date('2026-11-02T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    reiniciarBorrador();
  });
  afterEach(() => jest.useRealTimers());

  describe('la lista', () => {
    it('agrupa por día («Hoy, …», «Ayer, …») y cada fila lleva su categoría, tipo, medio y monto', async () => {
      conLista(listado({ movimientos: [gastoDeHoy, gastoDeAyer], categorias: [] }));
      await abrirLista();
      expect(await screen.findByText('Hoy, 2 de noviembre de 2026', { exact: false })).toBeOnTheScreen();
      expect(screen.getByText('Ayer, 1 de noviembre de 2026', { exact: false })).toBeOnTheScreen();
      expect(screen.getByText('Transporte', { exact: false })).toBeOnTheScreen();
      expect(screen.getAllByText('Gasto · Efectivo', { exact: false })).toHaveLength(2);
      expect(screen.getByText('$15.000', { exact: false })).toBeOnTheScreen();
      expect(screen.getByText('Alimentación · Mercado', { exact: false })).toBeOnTheScreen();
      expect(screen.getAllByRole('header', { name: /de noviembre de 2026/ })).toHaveLength(2);
    });

    it('un día anterior a ayer dice solo la fecha en palabras, como «5 de octubre de 2026»', async () => {
      conLista(listado({ movimientos: [movimiento({ fecha: '2026-10-05', categoria_id: 10, monto_centavos: '1990000' })] }));
      await abrirLista();
      expect(await screen.findByRole('header', { name: '5 de octubre de 2026' })).toBeOnTheScreen();
      expect(screen.getByText('$19.900', { exact: false })).toBeOnTheScreen();
    });

    // SEG-002 (NC-E16-40, NM-05): la fila «Arriendo de enero» ($100.000) dice «Compartido con el hogar», con la
    // Marca de propiedad (E14-PRR 2.2, fila 7); un movimiento propio no lleva la marca.
    it('SEG-002: la fila «Arriendo de enero» muestra «Compartido con el hogar»', async () => {
      conLista(listado({ movimientos: [arriendoDeEnero, gastoDeAyer] }));
      await abrirLista();
      const fila = (await screen.findByText('Arriendo de enero', { exact: false })).parent!.parent!;
      expect(within(fila.parent!).getByText('Compartido con el hogar')).toBeOnTheScreen();
      expect(within(fila.parent!).getByText('Aporte a una meta · Transferencia', { exact: false })).toBeOnTheScreen();
      expect(within(fila.parent!).getByText('$100.000', { exact: false })).toBeOnTheScreen();
      expect(screen.getAllByText('Compartido con el hogar')).toHaveLength(1);
    });

    it('un retiro de una meta dice «Retiro de una meta» y un ingreso, «Ingreso · Transferencia»', async () => {
      conLista(
        listado({
          movimientos: [
            { ...arriendoDeEnero, sentido: 'salida', compartido: false },
            movimiento({ id: 'i1', tipo: 'ingreso', categoria_id: 17, medio: 'transferencia' }),
          ],
        }),
      );
      await abrirLista();
      expect(await screen.findByText('Retiro de una meta · Transferencia', { exact: false })).toBeOnTheScreen();
      expect(screen.getByText('Ingreso · Transferencia', { exact: false })).toBeOnTheScreen();
      expect(screen.queryByText('Compartido con el hogar')).not.toBeOnTheScreen();
    });

    it('no hay sección «Por confirmar» (US-60, D-168)', async () => {
      conLista(listado({ movimientos: [gastoDeAyer] }));
      await abrirLista();
      await screen.findByText('Mercado', { exact: false });
      expect(screen.queryByText('Por confirmar')).not.toBeOnTheScreen();
      expect(screen.queryByText('Confirmar todos')).not.toBeOnTheScreen();
    });
  });

  describe('los filtros', () => {
    const categorias = [
      { categoria_id: 1, movimientos: 2, oculta: false },
      { categoria_id: 4, movimientos: 2, oculta: false },
      { categoria_id: 8, movimientos: 1, oculta: false },
      { categoria_id: 10, movimientos: 1, oculta: false },
      { categoria_id: 3, movimientos: 1, oculta: true },
    ];
    const base = listado({ movimientos: [gastoDeAyer], categorias, meses: ['2026-12', '2026-11', '2026-10', '2026-09'] });

    it('el periodo: «Noviembre» llega elegido, «Octubre» es el anterior y la lista se pide sin filtros', async () => {
      const pedidos = conLista(base);
      await abrirLista();
      const periodo = (await screen.findByText('Periodo')).parent!;
      expect(within(periodo).getByRole('radio', { name: 'Noviembre' }).props.accessibilityState.checked).toBe(true);
      expect(within(periodo).getByRole('radio', { name: 'Octubre' }).props.accessibilityState.checked).toBe(false);
      expect(pedidos).toEqual(['/api/v1/movimientos?']);
    });

    it('tocar «Octubre» pide el periodo 2026-10 y el chip cambia al toque', async () => {
      const pedidos = conLista(base);
      await abrirLista();
      await fireEvent.press(await screen.findByRole('radio', { name: 'Octubre' }));
      await waitFor(() => expect(pedidos.at(-1)).toBe('/api/v1/movimientos?periodo=2026-10'));
      expect(screen.getByRole('radio', { name: 'Octubre' }).props.accessibilityState.checked).toBe(true);
    });

    it('«Otro mes» abre una hoja con los meses que tienen movimientos y elegir uno lo pide', async () => {
      const pedidos = conLista(base);
      await abrirLista();
      await fireEvent.press(await screen.findByRole('button', { name: 'Otro mes' }));
      expect(await screen.findByRole('radio', { name: 'Diciembre de 2026' })).toBeOnTheScreen();
      expect(screen.getByRole('radio', { name: 'Septiembre de 2026' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('radio', { name: 'Septiembre de 2026' }));
      await waitFor(() => expect(pedidos.at(-1)).toBe('/api/v1/movimientos?periodo=2026-09'));
      expect(screen.getByRole('radio', { name: 'Septiembre' }).props.accessibilityState.checked).toBe(true);
    });

    it('el Atrás de Android cierra la hoja abierta, sin cambiar el filtro', async () => {
      const pedidos = conLista(base);
      await abrirLista();
      await fireEvent.press(await screen.findByRole('button', { name: 'Otro mes' }));
      // El Atrás de Android llega a la hoja como `onRequestClose` del Modal.
      await fireEvent(await screen.findByRole('radio', { name: 'Diciembre de 2026' }), 'requestClose');
      await waitFor(() => expect(screen.queryByRole('radio', { name: 'Diciembre de 2026' })).not.toBeOnTheScreen());
      await fireEvent.press(screen.getByRole('button', { name: 'Ver todas' }));
      await fireEvent(await screen.findByRole('radio', { name: 'Ropa y calzado' }), 'requestClose');
      await waitFor(() => expect(screen.queryByRole('radio', { name: 'Ropa y calzado' })).not.toBeOnTheScreen());
      expect(pedidos).toEqual(['/api/v1/movimientos?']);
    });

    it('la categoría: «Todas» y las tres con más movimientos; las ocultas solo salen en «Ver todas»', async () => {
      conLista(base);
      await abrirLista();
      const grupo = (await screen.findByText('Categoría')).parent!;
      for (const nombre of ['Todas', 'Alimentación', 'Arriendo o cuota de vivienda', 'Transporte'])
        expect(within(grupo).getByRole('radio', { name: nombre })).toBeOnTheScreen();
      expect(within(grupo).queryByRole('radio', { name: 'Suscripciones' })).not.toBeOnTheScreen();
      expect(within(grupo).queryByRole('radio', { name: 'Ropa y calzado' })).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Ver todas' }));
      expect(await screen.findByRole('radio', { name: 'Ropa y calzado' })).toBeOnTheScreen();
      expect(screen.getByRole('radio', { name: 'Suscripciones' })).toBeOnTheScreen();
    });

    it('elegir una categoría la pide y el resumen dice «Alimentación: 2 movimientos, $120.000»', async () => {
      const filtrada = listado({
        movimientos: [gastoDeAyer, movimiento({ id: 'm2', monto_centavos: '7500000' })],
        resumen: { movimientos: 2, total_centavos: '12000000' },
        categorias,
      });
      const pedidos = api((ruta) => respuestaJson(200, ruta.includes('categoria=1') ? filtrada : base));
      await abrirLista();
      await fireEvent.press(await screen.findByRole('radio', { name: 'Alimentación' }));
      expect(await screen.findByText('Alimentación: 2 movimientos, $120.000')).toBeOnTheScreen();
      expect(pedidos.at(-1)).toBe('/api/v1/movimientos?periodo=2026-11&categoria=1');
      await fireEvent.press(screen.getByRole('radio', { name: 'Todas' }));
      await waitFor(() => expect(pedidos.at(-1)).toBe('/api/v1/movimientos?periodo=2026-11'));
    });

    it('una categoría de «Ver todas» que no es de los chips se suma a los chips', async () => {
      const pedidos = conLista(base);
      await abrirLista();
      await fireEvent.press(await screen.findByRole('button', { name: 'Ver todas' }));
      await fireEvent.press(await screen.findByRole('radio', { name: 'Suscripciones' }));
      await waitFor(() => expect(pedidos.at(-1)).toBe('/api/v1/movimientos?periodo=2026-11&categoria=10'));
      const grupo = screen.getByText('Categoría').parent!;
      expect(within(grupo).getByRole('radio', { name: 'Suscripciones' }).props.accessibilityState.checked).toBe(true);
    });

    it('la suma del resumen pasa de 2^53 sin perder un centavo (D-082) y un solo movimiento dice «1 movimiento»', async () => {
      const cuerpo =
        '{"periodo_actual":"2026-11","periodo":"2026-11","resumen":{"movimientos":1,"total_centavos":9007199254740993},' +
        '"meses":["2026-11"],"categorias":[{"categoria_id":1,"movimientos":1,"oculta":false}],"movimientos":[' +
        '{"id":"g","tipo":"gasto","monto_centavos":9007199254740993,"fecha":"2026-11-01","categoria_id":1,"medio":"efectivo",' +
        '"descripcion":null,"compartido":false,"meta":null,"sentido":null,"recurrente":null}]}';
      api(() => respuestaJson(200, cuerpo));
      await abrirLista();
      await fireEvent.press(await screen.findByRole('radio', { name: 'Alimentación' }));
      expect(await screen.findByText('Alimentación: 1 movimiento, $90.071.992.547.409,93')).toBeOnTheScreen();
      expect(screen.getAllByText('$90.071.992.547.409,93', { exact: false }).length).toBeGreaterThan(0);
    });

    it('sin categoría el resumen es solo la cuenta: «1 movimiento»', async () => {
      conLista(listado({ movimientos: [gastoDeAyer] }));
      await abrirLista();
      expect(await screen.findByText('1 movimiento')).toBeOnTheScreen();
    });

    it('una respuesta tardía de un filtro anterior no pisa la del filtro de ahora', async () => {
      let soltar: (r: Response) => void = () => undefined;
      const tarde = new Promise<Response>((resolver) => (soltar = resolver));
      let pedidos = 0;
      api(() => (++pedidos === 2 ? tarde : respuestaJson(200, listado({ movimientos: [gastoDeAyer], categorias }))));
      await abrirLista();
      await fireEvent.press(await screen.findByRole('radio', { name: 'Octubre' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'Noviembre' }));
      await waitFor(() => expect(pedidos).toBe(3));
      await act(async () => {
        soltar(respuestaJson(200, listado({ movimientos: [arriendoDeEnero] })));
      });
      expect(screen.getByText('Mercado', { exact: false })).toBeOnTheScreen();
      expect(screen.queryByText('Arriendo de enero', { exact: false })).not.toBeOnTheScreen();
    });
  });

  describe('estados', () => {
    it('sin resultados con el filtro: «No hay movimientos con este filtro.» y «Quitar los filtros» los quita', async () => {
      const vacio = listado({ movimientos: [], resumen: { movimientos: 0, total_centavos: null } });
      const pedidos = api((ruta) => respuestaJson(200, ruta.includes('periodo=2026-10') ? vacio : listado({ movimientos: [gastoDeAyer], categorias: [] })));
      await abrirLista();
      await fireEvent.press(await screen.findByRole('radio', { name: 'Octubre' }));
      expect(await screen.findByText('No hay movimientos con este filtro.')).toBeOnTheScreen();
      expect(screen.getByText('Cambia el periodo o la categoría.')).toBeOnTheScreen();
      expect(screen.queryByText(/movimientos?$/)).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Quitar los filtros' }));
      await waitFor(() => expect(pedidos.at(-1)).toBe('/api/v1/movimientos?'));
      expect(await screen.findByText('Mercado', { exact: false })).toBeOnTheScreen();
    });

    it('sin ningún movimiento: «Todavía no hay movimientos» y sin botón dentro de la tarjeta', async () => {
      conLista(listado({ meses: [] }));
      await abrirLista();
      expect(await screen.findByText('Todavía no hay movimientos')).toBeOnTheScreen();
      expect(screen.getByText('Registra el primero y aquí lo verás.')).toBeOnTheScreen();
      expect(screen.getAllByRole('button', { name: 'Registrar' })).toHaveLength(1);
    });

    it('error de carga: «No pudimos cargar tus movimientos.» y «Intentar de nuevo» la pide otra vez', async () => {
      let falla = true;
      const pedidos = api(() => (falla ? respuestaJson(500, { error: 'interno' }) : respuestaJson(200, listado({ movimientos: [gastoDeAyer] }))));
      await abrirLista();
      expect(await screen.findByText('No pudimos cargar tus movimientos.')).toBeOnTheScreen();
      expect(screen.getByText('Tus datos están a salvo. Intenta de nuevo.')).toBeOnTheScreen();
      falla = false;
      await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
      expect(await screen.findByText('Mercado', { exact: false })).toBeOnTheScreen();
      expect(pedidos).toHaveLength(2);
      expect(screen.queryByText('No pudimos cargar tus movimientos.')).not.toBeOnTheScreen();
    });

    it('sin conexión dice el aviso de siempre, con «Intentar de nuevo»', async () => {
      api(() => Promise.reject(new Error('sin red')));
      await abrirLista();
      expect(await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeOnTheScreen();
    });

    it('un 401 lleva a PN-60 («Tu sesión se cerró…»)', async () => {
      api(() => respuestaJson(401, { error: 'sin_sesion' }));
      await abrirLista();
      expect(await screen.findByText('Tu sesión se cerró', { exact: false })).toBeOnTheScreen();
      expect(screen.queryByText('Movimientos')).not.toBeOnTheScreen();
    });
  });

  describe('«Registrar» y el Atrás', () => {
    it('«Registrar» está siempre a la vista, abre el formulario vacío (D-164, L10) y su Atrás vuelve con el filtro', async () => {
      const pedidos = conLista(listado({ movimientos: [gastoDeAyer], categorias: [] }));
      cambiarBorrador({ monto: '45.000', periodicidad: 'mensual' });
      let monto = '';
      function Espia() {
        monto = useBorrador().monto;
        return null;
      }
      await render(
        <>
          <Navegacion />
          <Espia />
        </>,
      );
      await fireEvent.press(await screen.findByRole('button', { name: 'Movimientos' }));
      await fireEvent.press(await screen.findByRole('radio', { name: 'Octubre' }));
      await waitFor(() => expect(pedidos.at(-1)).toBe('/api/v1/movimientos?periodo=2026-10'));
      await fireEvent.press(screen.getByRole('button', { name: 'Registrar' }));
      expect((await screen.findByLabelText('Monto')).props.value).toBe('');
      expect(monto).toBe('');
      await atras();
      await waitFor(() => expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen());
      // PN-01 sigue en octubre: los filtros viajan en la ruta y la lista se pide otra vez al volver.
      await waitFor(() => expect(pedidos.at(-1)).toBe('/api/v1/movimientos?periodo=2026-10'));
      expect(screen.getByRole('radio', { name: 'Octubre' }).props.accessibilityState.checked).toBe(true);
    });

    it('el Atrás de PN-01 vuelve a PN-71, donde «Movimientos» ocupa el lugar del botón provisional', async () => {
      conLista(listado({ meses: [] }));
      await render(<Navegacion />);
      await screen.findByText(PN71);
      expect(screen.queryByRole('button', { name: 'Registrar un movimiento' })).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Movimientos' }));
      await screen.findByText('Todavía no hay movimientos');
      await atras();
      expect(await screen.findByText(PN71)).toBeOnTheScreen();
    });
  });
});
