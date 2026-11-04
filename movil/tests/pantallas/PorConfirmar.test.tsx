import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { reiniciarBorrador } from '../../src/borradorDeRegistro';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { instalarAtras } from '../ayudas/atras';
import { respuestaJson } from '../ayudas/fetchFalso';
import {
  apiFalsa,
  BASE,
  celular,
  energia,
  gastoDeAyer,
  listado,
  movimiento,
  pendiente,
  pendientes,
} from '../ayudas/movimientosFalsos';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const PN71 = 'Este es tu primer ingreso.';
const salario = pendiente();
const CONFIRMAR_SALARIO = 'Confirmar Salario del 16 de noviembre de 2026';
const MAS_SALARIO = 'Más opciones de Salario del 16 de noviembre de 2026';
const TEXTO_UNA =
  'Esta fecha de un movimiento que se repite ya llegó. Confírmala con un toque, o toca «Más» si no pasó o cambió el monto.';
const TEXTO_VARIAS =
  'Estos movimientos que se repiten ya llegaron a su fecha. Confírmalos con un toque, o toca «Más» si no pasaron o cambió el monto.';

async function abrirLista() {
  await render(<Navegacion />);
  await screen.findByText(PN71);
  await fireEvent.press(screen.getByRole('button', { name: 'Movimientos' }));
}

// El movimiento que guarda el API al confirmar: el aviso dice su tipo y su monto.
const confirmado = (monto = '120000000', tipo: 'ingreso' | 'gasto' = 'ingreso') =>
  respuestaJson(201, movimiento({ id: 'm-nuevo', tipo, monto_centavos: monto, categoria_id: 17 }));

describe('PN-01 · «Por confirmar», Android (E14-PRR 4.1, US-60)', () => {
  beforeEach(() => {
    instalarAtras();
    fijarHoy(new Date('2026-12-14T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    reiniciarBorrador();
  });
  afterEach(() => jest.useRealTimers());

  describe('la sección', () => {
    it('sin fechas pendientes no aparece', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer] }) });
      await abrirLista();
      await screen.findByText('Mercado', { exact: false });
      expect(screen.queryByText('Por confirmar')).not.toBeOnTheScreen();
    });

    it('con una fecha: título, el texto de una sola fecha (D-179), la fila y sin resumen ni «Confirmar todos»', async () => {
      apiFalsa(respuestaJson, { lista: listado({ movimientos: [gastoDeAyer] }), pendientes: pendientes(salario) });
      await abrirLista();
      expect(await screen.findByRole('header', { name: 'Por confirmar' })).toBeOnTheScreen();
      expect(screen.getByText(TEXTO_UNA)).toBeOnTheScreen();
      expect(screen.getByText('Salario')).toBeOnTheScreen();
      expect(screen.getByText('Ingreso · Transferencia · 16 de noviembre de 2026')).toBeOnTheScreen();
      expect(screen.getByText('$1.200.000')).toBeOnTheScreen();
      // La marca es texto, nunca solo color; el título es el otro «Por confirmar».
      expect(screen.getAllByText('Por confirmar')).toHaveLength(2);
      expect(screen.getByRole('button', { name: CONFIRMAR_SALARIO })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: MAS_SALARIO })).toBeOnTheScreen();
    });

    it('con más de una: el texto de varias y una fila por fecha, cada una con «Confirmar» y «Más»', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, salario, celular) });
      await abrirLista();
      expect(await screen.findByText(TEXTO_VARIAS)).toBeOnTheScreen();
      expect(
        screen.getAllByRole('button', { name: /^Confirmar (Servicios públicos|Salario|Comunicaciones) del/ }),
      ).toHaveLength(3);
      expect(
        screen.getByRole('button', { name: 'Más opciones de Servicios públicos del 5 de noviembre de 2026' }),
      ).toBeOnTheScreen();
      expect(screen.getByText('Gasto · Efectivo · 5 de noviembre de 2026')).toBeOnTheScreen();
    });

    it('con una categoría elegida no se muestra', async () => {
      apiFalsa(respuestaJson, {
        lista: listado({
          movimientos: [gastoDeAyer],
          categorias: [{ categoria_id: 1, movimientos: 1, oculta: false }],
        }),
        pendientes: pendientes(salario),
      });
      await abrirLista();
      await screen.findByRole('header', { name: 'Por confirmar' });
      await fireEvent.press(screen.getByRole('radio', { name: 'Alimentación' }));
      await waitFor(() => expect(screen.queryByRole('header', { name: 'Por confirmar' })).not.toBeOnTheScreen());
    });

    it('un fallo al pedir las fechas pendientes da el error de carga de la lista', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(salario) });
      const delApi = global.fetch;
      global.fetch = jest.fn(async (url: string, init: RequestInit) =>
        String(url).includes('pendientes') ? respuestaJson(500, { error: 'interno' }) : delApi(url, init),
      ) as unknown as typeof fetch;
      await abrirLista();
      expect(await screen.findByText('No pudimos cargar tus movimientos.')).toBeOnTheScreen();
    });
  });

  describe('«Confirmar»', () => {
    it('crea el movimiento con el monto habitual, dice el aviso exacto y vuelve a pedir la lista', async () => {
      let hayPendiente = true;
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: () => pendientes(...(hayPendiente ? [salario] : [])),
        publicar: () => {
          hayPendiente = false;
          return confirmado();
        },
      });
      await abrirLista();
      await fireEvent.press(await screen.findByRole('button', { name: CONFIRMAR_SALARIO }));
      expect(await screen.findByText('Listo, confirmamos tu ingreso de $1.200.000.')).toBeOnTheScreen();
      const envio = pedidos.find((p) => p.metodo === 'POST');
      expect(envio).toEqual({
        metodo: 'POST',
        ruta: '/api/v1/repeticiones/r-salario/confirmacion',
        cuerpo: '{"fecha":"2026-11-16"}',
      });
      await waitFor(() => expect(screen.queryByRole('header', { name: 'Por confirmar' })).not.toBeOnTheScreen());
      expect(pedidos.filter((p) => p.ruta === '/api/v1/repeticiones/pendientes')).toHaveLength(2);
    });

    it('un gasto dice «Listo, confirmamos tu gasto de …»', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia), publicar: () => confirmado('12000000', 'gasto') });
      await abrirLista();
      await fireEvent.press(await screen.findByRole('button', { name: /^Confirmar Servicios públicos/ }));
      expect(await screen.findByText('Listo, confirmamos tu gasto de $120.000.')).toBeOnTheScreen();
    });

    it('mientras guarda no se toca dos veces', async () => {
      let soltar: (r: Response) => void = () => undefined;
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: pendientes(salario),
        publicar: () => new Promise<Response>((resolver) => (soltar = resolver)),
      });
      await abrirLista();
      const boton = await screen.findByRole('button', { name: CONFIRMAR_SALARIO });
      await fireEvent.press(boton);
      await fireEvent.press(screen.getByRole('button', { name: CONFIRMAR_SALARIO }));
      expect(screen.getByRole('button', { name: CONFIRMAR_SALARIO, disabled: true })).toBeOnTheScreen();
      soltar(confirmado());
      await screen.findByText('Listo, confirmamos tu ingreso de $1.200.000.');
      expect(pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
    });

    it('un error deja la fila como estaba y dice «No pudimos confirmar el movimiento.»', async () => {
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: pendientes(salario),
        publicar: () => respuestaJson(500, { error: 'interno' }),
      });
      await abrirLista();
      await fireEvent.press(await screen.findByRole('button', { name: CONFIRMAR_SALARIO }));
      expect(await screen.findByText('No pudimos confirmar el movimiento.')).toBeOnTheScreen();
      expect(screen.getByText('Sigue por confirmar. Intenta de nuevo.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: CONFIRMAR_SALARIO })).toBeOnTheScreen();
      expect(pedidos.filter((p) => p.ruta === '/api/v1/repeticiones/pendientes')).toHaveLength(1);
    });

    it('sin conexión dice el aviso de siempre', async () => {
      apiFalsa(respuestaJson, {
        pendientes: pendientes(salario),
        publicar: () => Promise.reject(new Error('sin red')),
      });
      await abrirLista();
      await fireEvent.press(await screen.findByRole('button', { name: CONFIRMAR_SALARIO }));
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
    });

    it('un 409 pide la lista otra vez y dice el error', async () => {
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: pendientes(salario),
        publicar: () => respuestaJson(409, { error: 'fecha_no_pendiente' }),
      });
      await abrirLista();
      await fireEvent.press(await screen.findByRole('button', { name: CONFIRMAR_SALARIO }));
      expect(await screen.findByText('No pudimos confirmar el movimiento.')).toBeOnTheScreen();
      await waitFor(() => expect(pedidos.filter((p) => p.ruta === '/api/v1/repeticiones/pendientes')).toHaveLength(2));
    });

    it('un 401 lleva a PN-60', async () => {
      apiFalsa(respuestaJson, {
        pendientes: pendientes(salario),
        publicar: () => respuestaJson(401, { error: 'sin_sesion' }),
      });
      await abrirLista();
      await fireEvent.press(await screen.findByRole('button', { name: CONFIRMAR_SALARIO }));
      expect(await screen.findByText('Tu sesión se cerró', { exact: false })).toBeOnTheScreen();
    });
  });

  describe('«Más»', () => {
    async function abrirMas() {
      await fireEvent.press(await screen.findByRole('button', { name: MAS_SALARIO }));
      return screen.findByRole('header', { name: 'Salario · 16 de noviembre de 2026' });
    }

    it('abre la hoja con «Cambiar el monto» y «No pasó», y «Cerrar» la cierra', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(salario) });
      await abrirLista();
      await abrirMas();
      expect(screen.getByRole('button', { name: 'Cambiar el monto' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'No pasó' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Cambiar el monto' })).not.toBeOnTheScreen());
    });

    it('«Cambiar el monto»: pregunta «¿Cuánto llegó?» con el habitual escrito y confirma con el monto nuevo', async () => {
      let hayPendiente = true;
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: () => pendientes(...(hayPendiente ? [salario] : [])),
        publicar: () => {
          hayPendiente = false;
          return confirmado('110000000');
        },
      });
      await abrirLista();
      await abrirMas();
      await fireEvent.press(screen.getByRole('button', { name: 'Cambiar el monto' }));
      expect(await screen.findByRole('header', { name: '¿Cuánto llegó?' })).toBeOnTheScreen();
      const campo = screen.getByLabelText('Monto');
      expect(campo.props.value).toBe('$1.200.000');
      expect(screen.getByText('Este cambio es solo para esta fecha. Las demás siguen igual.')).toBeOnTheScreen();
      await fireEvent.changeText(campo, '1.100.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Confirmar' }));
      expect(await screen.findByText('Listo, confirmamos tu ingreso de $1.100.000.')).toBeOnTheScreen();
      expect(pedidos.find((p) => p.metodo === 'POST')).toEqual({
        metodo: 'POST',
        ruta: '/api/v1/repeticiones/r-salario/confirmacion',
        cuerpo: '{"fecha":"2026-11-16","monto_centavos":110000000}',
      });
      await waitFor(() => expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen());
    });

    it('un gasto pregunta «¿Cuánto pagaste?»', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia) });
      await abrirLista();
      await fireEvent.press(await screen.findByRole('button', { name: /^Más opciones de Servicios públicos/ }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Cambiar el monto' }));
      expect(await screen.findByRole('header', { name: '¿Cuánto pagaste?' })).toBeOnTheScreen();
    });

    it('un monto que no se lee da el error de E14-PPN 3.1 y no manda nada; al salir del campo lo formatea', async () => {
      const pedidos = apiFalsa(respuestaJson, { pendientes: pendientes(salario) });
      await abrirLista();
      await abrirMas();
      await fireEvent.press(screen.getByRole('button', { name: 'Cambiar el monto' }));
      const campo = await screen.findByLabelText('Monto');
      await fireEvent.changeText(campo, '');
      await fireEvent.press(screen.getByRole('button', { name: 'Confirmar' }));
      expect(await screen.findByText('Falta el monto.')).toBeOnTheScreen();
      expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
      await fireEvent.changeText(campo, '45000');
      await fireEvent(campo, 'blur');
      expect(screen.getByLabelText('Monto').props.value).toBe('$45.000');
      await fireEvent.changeText(campo, 'abc');
      await fireEvent(campo, 'blur');
      expect(screen.getByLabelText('Monto').props.value).toBe('abc');
    });

    it('«Ahora no» cierra la hoja del monto sin mandar nada', async () => {
      const pedidos = apiFalsa(respuestaJson, { pendientes: pendientes(salario) });
      await abrirLista();
      await abrirMas();
      await fireEvent.press(screen.getByRole('button', { name: 'Cambiar el monto' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Ahora no' }));
      await waitFor(() => expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen());
      expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
    });

    it('«No pasó» pide confirmar en su hoja, guarda la fecha omitida y dice «Listo, ya no contamos esa fecha.»', async () => {
      let hayPendiente = true;
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: () => pendientes(...(hayPendiente ? [salario] : [])),
        publicar: () => {
          hayPendiente = false;
          return respuestaJson(204);
        },
      });
      await abrirLista();
      await abrirMas();
      await fireEvent.press(screen.getByRole('button', { name: 'No pasó' }));
      expect(await screen.findByRole('header', { name: '¿Esta fecha no pasó?' })).toBeOnTheScreen();
      expect(
        screen.getByText(
          'Dejamos de contarla en tu simulación. Las demás fechas siguen igual. Si después pasó, la registras a mano.',
        ),
      ).toBeOnTheScreen();
      // El botón «No pasó» de la hoja es el único que queda a la vista (la hoja «Más» se cerró).
      await fireEvent.press(screen.getByRole('button', { name: 'No pasó' }));
      expect(await screen.findByText('Listo, ya no contamos esa fecha.')).toBeOnTheScreen();
      expect(pedidos.find((p) => p.metodo === 'POST')).toEqual({
        metodo: 'POST',
        ruta: '/api/v1/repeticiones/r-salario/omision',
        cuerpo: '{"fecha":"2026-11-16"}',
      });
      await waitFor(() => expect(screen.queryByRole('header', { name: 'Por confirmar' })).not.toBeOnTheScreen());
    });

    it('«Ahora no» en la hoja «No pasó» no manda nada', async () => {
      const pedidos = apiFalsa(respuestaJson, { pendientes: pendientes(salario) });
      await abrirLista();
      await abrirMas();
      await fireEvent.press(screen.getByRole('button', { name: 'No pasó' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Ahora no' }));
      await waitFor(() => expect(screen.queryByRole('header', { name: '¿Esta fecha no pasó?' })).not.toBeOnTheScreen());
      expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
    });

    it('un error al marcar «No pasó» dice «No pudimos guardar el cambio.» y la fila sigue', async () => {
      apiFalsa(respuestaJson, {
        pendientes: pendientes(salario),
        publicar: () => respuestaJson(500, { error: 'interno' }),
      });
      await abrirLista();
      await abrirMas();
      await fireEvent.press(screen.getByRole('button', { name: 'No pasó' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'No pasó' }));
      expect(await screen.findByText('No pudimos guardar el cambio.')).toBeOnTheScreen();
      expect(screen.getByText('Sigue por confirmar. Intenta de nuevo.')).toBeOnTheScreen();
      expect(screen.queryByRole('header', { name: '¿Esta fecha no pasó?' })).not.toBeOnTheScreen();
      expect(screen.getByRole('button', { name: CONFIRMAR_SALARIO })).toBeOnTheScreen();
    });
  });
});
