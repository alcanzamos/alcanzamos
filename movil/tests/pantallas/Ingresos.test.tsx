import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { reiniciarBorrador } from '../../src/borradorDeRegistro';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { esperarAnuncio, limpiarAnuncios } from '../ayudas/anuncios';
import { atras, instalarAtras } from '../ayudas/atras';
import { respuestaJson } from '../ayudas/fetchFalso';
import { listado, movimiento } from '../ayudas/movimientosFalsos';
import {
  apiDelPresupuesto,
  BASE,
  casoPDeOctubre,
  esperado,
  fuente,
  ingreso,
  ingresosDe,
} from '../ayudas/presupuestoFalso';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const PN71 = 'Este es tu primer ingreso.';
const CONFIRMAR_SALARIO = 'Confirmar Salario del 16 de noviembre de 2026';

// El 17 de noviembre de 2026 el salario del 16 ya llegó: es «Por confirmar» (E14-PPA 4.3, estado «Con fechas por confirmar»).
const salarioPorConfirmar = esperado({ marca: 'por_confirmar' });
const conUnaPorConfirmar = ingresosDe([fuente(17, [ingreso(), salarioPorConfirmar])]);
const conDosPorConfirmar = ingresosDe([
  fuente(17, [ingreso(), salarioPorConfirmar]),
  fuente(18, [
    esperado({ fecha: '2026-11-15', marca: 'por_confirmar', recurrente_id: 'r-venta', monto_centavos: '30000000', medio: 'efectivo' }),
  ]),
]);

async function abrirIngresos() {
  await render(<Navegacion />);
  await screen.findByText(PN71);
  await fireEvent.press(screen.getByRole('button', { name: 'Presupuesto' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Ver mis ingresos' }));
  await screen.findAllByRole('header', { name: /^(Entran|Entraron) este mes$/ });
}

const pedidosDeIngresos = (pedidos: { ruta: string }[]) => pedidos.filter((p) => p.ruta.startsWith('/api/v1/ingresos'));

describe('PN-08 · Ingresos del periodo, Android (E14-PPA 4.3, US-77)', () => {
  beforeEach(() => {
    instalarAtras();
    fijarHoy(new Date('2026-11-17T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    reiniciarBorrador();
    limpiarAnuncios();
  });
  afterEach(() => jest.useRealTimers());

  it('«Ver mis ingresos» de PN-06 abre PN-08 con la barra «Ingresos»; su Atrás vuelve a PN-06', async () => {
    const pedidos = apiDelPresupuesto(respuestaJson);
    await abrirIngresos();
    expect(JSON.stringify(screen.toJSON())).toContain('"title":"Ingresos"');
    expect(pedidosDeIngresos(pedidos).map((p) => p.ruta)).toEqual(['/api/v1/ingresos']);
    expect(await atras()).toBe(true);
    expect(await screen.findByRole('header', { name: 'Tu presupuesto este mes' })).toBeOnTheScreen();
  });

  it('Laura en noviembre: el periodo, el total con lo registrado y lo esperado, la fuente y sus fechas', async () => {
    apiDelPresupuesto(respuestaJson, { ingresos: () => ingresosDe([fuente(17, [ingreso(), esperado()])]) });
    await abrirIngresos();
    expect(screen.getByText('Periodo')).toBeOnTheScreen();
    const chips = screen.getAllByRole('radio');
    expect(['Octubre', 'Noviembre', 'Diciembre'].map((mes) => chips.indexOf(screen.getByRole('radio', { name: mes })))).toEqual([0, 1, 2]);
    expect(chips).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Noviembre', checked: true })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Otro mes' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Entran este mes' })).toBeOnTheScreen();
    // El total del mes y el de la única fuente.
    expect(screen.getAllByText('$2.400.000')).toHaveLength(2);
    expect(screen.getByText('Ya registrado')).toBeOnTheScreen();
    expect(screen.getAllByText('Esperado')).toHaveLength(2);
    expect(screen.getByText('Registrado')).toBeOnTheScreen();
    expect(screen.getByText('1 de noviembre de 2026')).toBeOnTheScreen();
    expect(screen.getByText('16 de noviembre de 2026')).toBeOnTheScreen();
    expect(screen.getAllByText('Transferencia')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Registrar un ingreso' })).toBeOnTheScreen();
    expect(screen.queryByText('Confirmar todos')).not.toBeOnTheScreen();
    // Sin el botón a PN-04 (L3 de la US-77, punto 4) ni «Registrar» fijo.
    expect(screen.queryByText('Prima, cesantías o intereses')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Registrar' })).not.toBeOnTheScreen();
  });

  it('ACC-004 (D-187): el total, sus filas, la fuente y cada fecha se leen con el monto en pesos, nunca con «$»', async () => {
    apiDelPresupuesto(respuestaJson, { ingresos: () => ingresosDe([fuente(17, [ingreso(), esperado()])]) });
    await abrirIngresos();
    expect(screen.getByLabelText('Entran este mes, 2400000 pesos')).toBeOnTheScreen();
    expect(screen.getByLabelText('Ya registrado, 1200000 pesos')).toBeOnTheScreen();
    expect(screen.getByLabelText('Esperado, 1200000 pesos')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Salario, 2400000 pesos' })).toBeOnTheScreen();
    expect(screen.getByLabelText('1 de noviembre de 2026, Transferencia, Registrado, 1200000 pesos')).toBeOnTheScreen();
    expect(screen.getByLabelText('16 de noviembre de 2026, Transferencia, Esperado, 1200000 pesos')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/\$/)).not.toBeOnTheScreen();
  });

  it('el chip «Octubre» pide ese periodo: «Entraron este mes» y el caso P con dos fuentes de mayor a menor', async () => {
    const pedidos = apiDelPresupuesto(respuestaJson, {
      ingresos: (periodo) => (periodo === '2026-10' ? casoPDeOctubre : ingresosDe([fuente(17, [ingreso()])])),
    });
    await abrirIngresos();
    await fireEvent.press(screen.getByRole('radio', { name: 'Octubre' }));
    expect(await screen.findByRole('header', { name: 'Entraron este mes' })).toBeOnTheScreen();
    expect(pedidosDeIngresos(pedidos).at(-1)?.ruta).toBe('/api/v1/ingresos?periodo=2026-10');
    expect(screen.getByRole('radio', { name: 'Octubre', checked: true })).toBeOnTheScreen();
    expect(screen.getByLabelText('Entraron este mes, 550000 pesos')).toBeOnTheScreen();
    expect(screen.getAllByRole('header', { name: /pesos$/ }).map((h) => h.props.accessibilityLabel)).toEqual([
      'Trabajo independiente o ventas, 390000 pesos',
      'Ayudas y subsidios, 160000 pesos',
    ]);
    expect(screen.getAllByText('Transferencia · Venta de artesanías')).toHaveLength(2);
    expect(screen.getByText('Efectivo · Subsidio')).toBeOnTheScreen();
  });

  it('«Otro mes» abre la hoja con los meses con ingresos registrados y pide el elegido, que queda como chip', async () => {
    const pedidos = apiDelPresupuesto(respuestaJson, {
      ingresos: (periodo) => ingresosDe([fuente(17, [ingreso()])], { periodo: periodo ?? '2026-11' }),
    });
    await abrirIngresos();
    await fireEvent.press(screen.getByRole('button', { name: 'Otro mes' }));
    expect(await screen.findByRole('radio', { name: 'Noviembre de 2026', checked: true })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Octubre de 2026' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Agosto de 2026' }));
    await waitFor(() => expect(pedidosDeIngresos(pedidos).at(-1)?.ruta).toBe('/api/v1/ingresos?periodo=2026-08'));
    expect(await screen.findByRole('radio', { name: 'Agosto', checked: true })).toBeOnTheScreen();
  });

  it('sin ingresos en el periodo: la tarjeta de E14, sin Atención ni reproche', async () => {
    apiDelPresupuesto(respuestaJson, { ingresos: () => ingresosDe([]) });
    await abrirIngresos();
    expect(screen.getByRole('header', { name: 'Todavía no registras ingresos este mes.' })).toBeOnTheScreen();
    expect(screen.getByText('Cuando registres uno, aquí lo verás.')).toBeOnTheScreen();
  });

  it('una fuente oculta lleva el ícono y la palabra «Oculta»', async () => {
    apiDelPresupuesto(respuestaJson, { ingresos: () => ingresosDe([fuente(17, [ingreso()], true)]) });
    await abrirIngresos();
    expect(screen.getByText('Oculta')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Salario, Oculta, 1200000 pesos' })).toBeOnTheScreen();
  });

  it('un error de carga dice el aviso de E14 y «Intentar de nuevo» vuelve a pedir', async () => {
    let veces = 0;
    apiDelPresupuesto(respuestaJson, {
      ingresos: () => (++veces === 1 ? respuestaJson(500, { error: 'error_interno' }) : ingresosDe([fuente(17, [ingreso()])])),
    });
    await render(<Navegacion />);
    await screen.findByText(PN71);
    await fireEvent.press(screen.getByRole('button', { name: 'Presupuesto' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Ver mis ingresos' }));
    expect(await screen.findByText('No pudimos cargar tus ingresos.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(await screen.findByRole('header', { name: 'Entran este mes' })).toBeOnTheScreen();
  });

  it('«Registrar un ingreso» abre el formulario con Tipo «Ingreso»', async () => {
    apiDelPresupuesto(respuestaJson);
    await abrirIngresos();
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar un ingreso' }));
    expect(await screen.findByRole('radio', { name: 'Ingreso', checked: true })).toBeOnTheScreen();
  });

  it('una fecha registrada abre su movimiento en PN-02, sobre PN-01 del mismo periodo; Atrás vuelve por PN-01 a PN-08', async () => {
    const salario = movimiento({ id: 'm-salario', tipo: 'ingreso', monto_centavos: '120000000', categoria_id: 17, medio: 'transferencia' });
    const pedidos = apiDelPresupuesto(respuestaJson, { lista: listado({ movimientos: [salario] }) });
    await abrirIngresos();
    await fireEvent.press(screen.getByRole('button', { name: '1 de noviembre de 2026, Transferencia, Registrado, 1200000 pesos' }));
    expect(await screen.findByRole('button', { name: 'Borrar este movimiento' })).toBeOnTheScreen();
    expect(screen.getByText('Ingreso por Salario')).toBeOnTheScreen();
    expect(pedidos.some((p) => p.ruta === '/api/v1/movimientos?periodo=2026-11')).toBe(true);
    expect(await atras()).toBe(true);
    expect(await screen.findByRole('button', { name: 'Registrar' })).toBeOnTheScreen();
    expect(await atras()).toBe(true);
    expect(await screen.findByRole('button', { name: 'Registrar un ingreso' })).toBeOnTheScreen();
  });

  describe('lo por confirmar de la US-60', () => {
    it('la fecha lleva la marca «Por confirmar», «Confirmar» y «Más» con los nombres de E14-PRR', async () => {
      apiDelPresupuesto(respuestaJson, { ingresos: () => conUnaPorConfirmar });
      await abrirIngresos();
      expect(screen.getByText('Por confirmar')).toBeOnTheScreen();
      expect(screen.getByLabelText('16 de noviembre de 2026, Transferencia, Por confirmar, 1200000 pesos')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: CONFIRMAR_SALARIO })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Más opciones de Salario del 16 de noviembre de 2026' })).toBeOnTheScreen();
      // Con una sola fecha por confirmar no hay «Confirmar todos» (D-093).
      expect(screen.queryByText('Confirmar todos')).not.toBeOnTheScreen();
    });

    it('«Confirmar» confirma con el monto habitual, dice el aviso en pesos y vuelve a pedir el periodo', async () => {
      let confirmada = false;
      const pedidos = apiDelPresupuesto(respuestaJson, {
        ingresos: () => (confirmada ? ingresosDe([fuente(17, [ingreso(), ingreso({ fecha: '2026-11-16' })])]) : conUnaPorConfirmar),
        publicar: () => {
          confirmada = true;
          return respuestaJson(201, movimiento({ tipo: 'ingreso', monto_centavos: '120000000', categoria_id: 17 }));
        },
      });
      await abrirIngresos();
      await fireEvent.press(screen.getByRole('button', { name: CONFIRMAR_SALARIO }));
      await esperarAnuncio('Listo, confirmamos tu ingreso de 1200000 pesos.');
      expect(within(screen.getByRole('alert')).getByText('Listo, confirmamos tu ingreso de $1.200.000.')).toBeOnTheScreen();
      expect(pedidos.find((p) => p.metodo === 'POST')).toEqual({
        metodo: 'POST',
        ruta: '/api/v1/repeticiones/r-salario/confirmacion',
        cuerpo: '{"fecha":"2026-11-16"}',
      });
      await waitFor(() => expect(screen.queryByRole('button', { name: CONFIRMAR_SALARIO })).not.toBeOnTheScreen());
      expect(pedidosDeIngresos(pedidos)).toHaveLength(2);
    });

    it('un error al confirmar dice «No pudimos confirmar el movimiento.» y la fecha sigue', async () => {
      apiDelPresupuesto(respuestaJson, {
        ingresos: () => conUnaPorConfirmar,
        publicar: () => respuestaJson(500, { error: 'interno' }),
      });
      await abrirIngresos();
      await fireEvent.press(screen.getByRole('button', { name: CONFIRMAR_SALARIO }));
      expect(await screen.findByText('No pudimos confirmar el movimiento.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: CONFIRMAR_SALARIO })).toBeOnTheScreen();
    });

    it('«Más» → «No pasó» guarda la fecha omitida', async () => {
      const pedidos = apiDelPresupuesto(respuestaJson, {
        ingresos: () => conUnaPorConfirmar,
        publicar: () => respuestaJson(204),
      });
      await abrirIngresos();
      await fireEvent.press(screen.getByRole('button', { name: 'Más opciones de Salario del 16 de noviembre de 2026' }));
      expect(await screen.findByRole('header', { name: 'Salario · 16 de noviembre de 2026' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'No pasó' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'No pasó' }));
      await esperarAnuncio('Listo, ya no contamos esa fecha.');
      expect(pedidos.find((p) => p.metodo === 'POST')?.ruta).toBe('/api/v1/repeticiones/r-salario/omision');
    });

    it('con dos o más, «Confirmar todos» abre su pantalla con las del periodo y al guardar vuelve a PN-08 con el aviso', async () => {
      let guardadas = false;
      const pedidos = apiDelPresupuesto(respuestaJson, {
        ingresos: () => (guardadas ? ingresosDe([fuente(17, [ingreso()])]) : conDosPorConfirmar),
        publicar: () => {
          guardadas = true;
          return respuestaJson(200, { movimientos: [], omitidas: [], siguen_pendientes: 0, resumen: { guardados: 2, omitidas: 0 } });
        },
      });
      await abrirIngresos();
      await fireEvent.press(screen.getByRole('button', { name: 'Confirmar todos' }));
      expect(await screen.findByText('2 de 2 marcados')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar 2 movimientos' }));
      await esperarAnuncio('Listo, guardamos 2 movimientos.');
      expect(within(screen.getByRole('alert')).getByText('Listo, guardamos 2 movimientos.')).toBeOnTheScreen();
      expect(screen.getByRole('header', { name: 'Entran este mes' })).toBeOnTheScreen();
      expect(JSON.parse(pedidos.find((p) => p.metodo === 'POST')?.cuerpo ?? '{}')).toEqual({
        decisiones: [
          { recurrente_id: 'r-salario', fecha: '2026-11-16' },
          { recurrente_id: 'r-venta', fecha: '2026-11-15' },
        ],
      });
      // «Confirmar todos» salió de la pila: Atrás va a PN-06.
      expect(await atras()).toBe(true);
      expect(await screen.findByRole('header', { name: 'Tu presupuesto este mes' })).toBeOnTheScreen();
    });

    it('un 409 en «Confirmar todos» vuelve a pedir las fechas del periodo de PN-08', async () => {
      const pedidos = apiDelPresupuesto(respuestaJson, {
        ingresos: () => conDosPorConfirmar,
        publicar: () => respuestaJson(409, { error: 'conflicto_concurrente' }),
      });
      await abrirIngresos();
      await fireEvent.press(screen.getByRole('button', { name: 'Confirmar todos' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Guardar 2 movimientos' }));
      expect(await screen.findByText('No pudimos guardar tus movimientos.')).toBeOnTheScreen();
      await waitFor(() => expect(pedidosDeIngresos(pedidos).at(-1)?.ruta).toBe('/api/v1/ingresos?periodo=2026-11'));
      expect(pedidos.some((p) => p.ruta === '/api/v1/repeticiones/pendientes')).toBe(false);
    });
  });
});
