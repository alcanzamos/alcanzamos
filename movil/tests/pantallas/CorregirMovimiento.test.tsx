import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { cambiarBorrador, reiniciarBorrador, useBorrador } from '../../src/borradorDeRegistro';
import type { Movimiento } from '../../src/api/movimientos';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { atras, instalarAtras } from '../ayudas/atras';
import { respuestaJson } from '../ayudas/fetchFalso';
import { apiFalsa, BASE, gastoDeAyer, listado, movimiento, type Pedido } from '../ayudas/movimientosFalsos';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;
jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: jest.fn() } }));

const PN71 = 'Este es tu primer ingreso.';
const SOLO_ESTA_FECHA = 'Este cambio es solo para esta fecha. Las demás siguen igual.';
const puts = (pedidos: Pedido[]) => pedidos.filter((p) => p.metodo === 'PUT');
// El cuerpo crudo del PUT: se mira el texto para ver todos los dígitos de los centavos.
const cuerpoDelPut = (pedidos: Pedido[]) => String(puts(pedidos)[0]?.cuerpo);
const recurrente = { recurrente_id: 'r1', fecha_programada: '2026-11-01', periodicidad: 'quincenal', vuelve_a_pendiente: true } as const;

// PN-71 → PN-01 → PN-02 → «Corregir».
async function abrirCorregir(textoDeLaFila = 'Alimentación · Mercado') {
  await render(<Navegacion />);
  await screen.findByText(PN71);
  await fireEvent.press(screen.getByRole('button', { name: 'Movimientos' }));
  await fireEvent.press(await screen.findByText(textoDeLaFila, { exact: false }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Corregir' }));
  await screen.findByLabelText('Monto');
}
const api = (movimientos: Movimiento[], opciones: Parameters<typeof apiFalsa>[1] = {}) =>
  apiFalsa(respuestaJson, { lista: listado({ movimientos }), ...opciones });
const marcado = (nombre: string) => screen.getByRole('radio', { name: nombre }).props.accessibilityState.checked;

describe('Corregir un movimiento, Android (E14-PRR 4.2)', () => {
  beforeEach(() => {
    instalarAtras();
    fijarHoy(new Date('2026-11-02T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    reiniciarBorrador();
  });
  afterEach(() => jest.useRealTimers());

  describe('los campos', () => {
    it('vienen llenos con lo que ya tiene el movimiento, con «Guardar los cambios» y «Ahora no», y sin «Se repite»', async () => {
      api([gastoDeAyer]);
      await abrirCorregir();
      expect(screen.getByLabelText('Monto').props.value).toBe('$45.000');
      expect(marcado('Gasto')).toBe(true);
      expect(marcado('Alimentación')).toBe(true);
      expect(marcado('Efectivo')).toBe(true);
      expect(screen.getByLabelText('Descripción (opcional)').props.value).toBe('Mercado');
      expect(screen.getByRole('button', { name: 'Fecha, 1 de noviembre de 2026' })).toBeOnTheScreen();
      expect(screen.getByText('Solo mío')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Guardar los cambios' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Ahora no' })).toBeOnTheScreen();
      expect(screen.queryByText('Se repite')).not.toBeOnTheScreen();
      expect(screen.queryByText(SOLO_ESTA_FECHA)).not.toBeOnTheScreen();
    });

    it('un movimiento compartido dice «Compartido con el hogar» en «De quién es»', async () => {
      api([{ ...gastoDeAyer, compartido: true }]);
      await abrirCorregir();
      expect(screen.getByRole('radio', { name: 'Compartido con el hogar' })).toBeOnTheScreen();
    });

    // D-168: en una fecha de un recurrente no hay Fecha (ni Tipo) y la frase va una vez, en todo el formulario.
    it('D-168: una fecha de un recurrente no muestra Fecha ni Tipo y lleva la frase «Este cambio es solo para esta fecha…» una vez', async () => {
      api([{ ...gastoDeAyer, recurrente }]);
      await abrirCorregir();
      expect(screen.getAllByText(SOLO_ESTA_FECHA)).toHaveLength(1);
      expect(screen.queryByRole('button', { name: /^Fecha/ })).not.toBeOnTheScreen();
      expect(screen.queryByText('Fecha')).not.toBeOnTheScreen();
      expect(screen.queryByRole('radio', { name: 'Ingreso' })).not.toBeOnTheScreen();
      // Monto, categoría, medio y descripción siguen ahí.
      expect(screen.getByLabelText('Monto')).toBeOnTheScreen();
      expect(screen.getByRole('radio', { name: 'Alimentación' })).toBeOnTheScreen();
      expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeOnTheScreen();
      expect(screen.getByLabelText('Descripción (opcional)')).toBeOnTheScreen();
    });

    it('un ingreso corrige con las categorías de ingreso', async () => {
      api([movimiento({ id: 'i1', tipo: 'ingreso', categoria_id: 17, medio: 'transferencia' })]);
      await abrirCorregir('Salario');
      expect(marcado('Ingreso')).toBe(true);
      expect(marcado('Salario')).toBe(true);
      expect(screen.queryByRole('radio', { name: 'Alimentación' })).not.toBeOnTheScreen();
    });

    // D-170: «Suscripciones» (10) no está en el catálogo de la persona porque la ocultó; «Ropa y calzado» (3) tampoco.
    describe('categoría oculta (D-170)', () => {
      const deSuscripciones = movimiento({ id: 'm-suscripcion', categoria_id: 10, descripcion: null });

      it('la incluye ya elegida, con el ícono y la palabra «Oculta», y las demás ocultas no aparecen', async () => {
        api([deSuscripciones]);
        await abrirCorregir('Suscripciones');
        expect(marcado('Suscripciones Oculta')).toBe(true);
        expect(screen.getAllByText('Oculta')).toHaveLength(1);
        expect(JSON.stringify(screen.getByRole('radio', { name: 'Suscripciones Oculta' }))).toContain('RNSVGSvgView');
        expect(screen.queryByRole('radio', { name: /Ropa y calzado/ })).not.toBeOnTheScreen();
        expect(marcado('Alimentación')).toBe(false);
      });

      it('«Ver todas» la lista con su marca y guardar sin cambiarla manda su categoría', async () => {
        const pedidos = api([deSuscripciones]);
        await abrirCorregir('Suscripciones');
        await fireEvent.press(screen.getByRole('button', { name: 'Ver todas' }));
        // El chip y la fila de la hoja: las dos con su marca.
        const filas = await screen.findAllByRole('radio', { name: 'Suscripciones Oculta' });
        expect(filas).toHaveLength(2);
        expect(screen.getAllByText('Oculta')).toHaveLength(2);
        await fireEvent.press(filas[1]!);
        await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
        await screen.findByText('Listo, guardamos los cambios.');
        expect(JSON.parse(cuerpoDelPut(pedidos))).toMatchObject({ categoria_id: 10 });
      });

      it('al cambiar de Tipo deja de ofrecerse, y al volver al del movimiento vuelve', async () => {
        api([deSuscripciones]);
        await abrirCorregir('Suscripciones');
        await fireEvent.press(screen.getByRole('radio', { name: 'Ingreso' }));
        expect(screen.queryByText('Oculta')).not.toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('radio', { name: 'Gasto' }));
        expect(screen.getByRole('radio', { name: 'Suscripciones Oculta' })).toBeOnTheScreen();
      });

      it('una categoría visible no lleva la marca «Oculta»', async () => {
        api([gastoDeAyer]);
        await abrirCorregir();
        expect(screen.queryByText('Oculta')).not.toBeOnTheScreen();
      });
    });

    it('no toca el borrador del registro: corregir lleva su propio estado', async () => {
      api([gastoDeAyer]);
      cambiarBorrador({ monto: '12.000', descripcion: 'otra cosa' });
      let delBorrador = { monto: '', descripcion: '' };
      function Espia() {
        delBorrador = useBorrador();
        return null;
      }
      await render(
        <>
          <Navegacion />
          <Espia />
        </>,
      );
      await screen.findByText(PN71);
      await fireEvent.press(screen.getByRole('button', { name: 'Movimientos' }));
      await fireEvent.press(await screen.findByText('Alimentación · Mercado', { exact: false }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Corregir' }));
      expect((await screen.findByLabelText('Monto')).props.value).toBe('$45.000');
      await fireEvent.changeText(screen.getByLabelText('Monto'), '40.000');
      expect(delBorrador).toMatchObject({ monto: '12.000', descripcion: 'otra cosa' });
    });
  });

  describe('guardar', () => {
    it('corregir el monto a $40.000 manda el PUT con todos los campos y vuelve a PN-01 con «Listo, guardamos los cambios.»', async () => {
      const pedidos = api([gastoDeAyer]);
      await abrirCorregir();
      await fireEvent.changeText(screen.getByLabelText('Monto'), '40.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      expect(await screen.findByText('Listo, guardamos los cambios.')).toBeOnTheScreen();
      expect(puts(pedidos).map((p) => p.ruta)).toEqual(['/api/v1/movimientos/m-ayer']);
      expect(cuerpoDelPut(pedidos)).toBe(
        '{"monto_centavos":4000000,"tipo":"gasto","fecha":"2026-11-01","categoria_id":1,"medio":"efectivo","descripcion":"Mercado"}',
      );
      expect(JSON.stringify(screen.toJSON())).toContain('"accessibilityLiveRegion":"polite"');
      expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Registrar' })).toBeOnTheScreen();
    });

    it('cambiar la categoría, el medio y la descripción (y borrarla) se manda; el monto con centavos exactos', async () => {
      const pedidos = api([gastoDeAyer]);
      await abrirCorregir();
      await fireEvent.changeText(screen.getByLabelText('Monto'), '$9.007.199.254.740.993,01');
      await fireEvent.press(screen.getByRole('radio', { name: 'Otros gastos' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'Transferencia' }));
      await fireEvent.changeText(screen.getByLabelText('Descripción (opcional)'), '   ');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      await screen.findByText('Listo, guardamos los cambios.');
      expect(cuerpoDelPut(pedidos)).toBe(
        '{"monto_centavos":900719925474099301,"tipo":"gasto","fecha":"2026-11-01","categoria_id":16,"medio":"transferencia"}',
      );
    });

    it('D-168: en una fecha de un recurrente el PUT no lleva la fecha', async () => {
      const pedidos = api([{ ...gastoDeAyer, recurrente }]);
      await abrirCorregir();
      await fireEvent.changeText(screen.getByLabelText('Monto'), '40.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      await screen.findByText('Listo, guardamos los cambios.');
      expect(JSON.parse(cuerpoDelPut(pedidos))).toEqual({
        monto_centavos: 4000000,
        tipo: 'gasto',
        categoria_id: 1,
        medio: 'efectivo',
        descripcion: 'Mercado',
      });
    });

  });

  describe('errores', () => {
    it('con el formulario incompleto salen los errores de E14-PPN 3.1 y no se manda nada', async () => {
      const pedidos = api([gastoDeAyer]);
      await abrirCorregir();
      await fireEvent.changeText(screen.getByLabelText('Monto'), '');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      expect(await screen.findByText('Falta el monto.')).toBeOnTheScreen();
      expect(puts(pedidos)).toEqual([]);
    });

    it('un 422 del API pone su texto en el campo', async () => {
      api([gastoDeAyer], {
        corregir: () => respuestaJson(422, { error: 'datos_invalidos', campos: { monto_centavos: 'monto_no_positivo' } }),
      });
      await abrirCorregir();
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      expect(await screen.findByText('El monto debe ser mayor que $0.')).toBeOnTheScreen();
      expect(screen.queryByText('No pudimos guardar los cambios.')).not.toBeOnTheScreen();
    });

    it('un 422 sin texto (un código nuevo) dice «No pudimos guardar los cambios.»', async () => {
      api([gastoDeAyer], {
        corregir: () => respuestaJson(422, { error: 'datos_invalidos', campos: { fecha: 'fecha_no_editable' } }),
      });
      await abrirCorregir();
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      expect(await screen.findByText('No pudimos guardar los cambios.')).toBeOnTheScreen();
    });

    it('un 500 dice «No pudimos guardar los cambios.», conserva lo escrito y «Intentar de nuevo» vuelve a mandar', async () => {
      let falla = true;
      const pedidos = api([gastoDeAyer], {
        corregir: () => (falla ? respuestaJson(500, { error: 'interno' }) : respuestaJson(200, {})),
      });
      await abrirCorregir();
      await fireEvent.changeText(screen.getByLabelText('Monto'), '40.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      expect(await screen.findByText('No pudimos guardar los cambios.')).toBeOnTheScreen();
      expect(screen.getByText('Tu movimiento sigue igual. Intenta de nuevo.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Monto').props.value).toBe('40.000');
      falla = false;
      await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
      await screen.findByText('Listo, guardamos los cambios.');
      expect(puts(pedidos)).toHaveLength(2);
    });

    it('sin conexión dice el aviso de siempre y lo escrito se conserva', async () => {
      api([gastoDeAyer], { corregir: () => Promise.reject(new Error('sin red')) });
      await abrirCorregir();
      await fireEvent.changeText(screen.getByLabelText('Monto'), '40.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      expect(await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Monto').props.value).toBe('40.000');
    });

    it('un 401 lleva a PN-60', async () => {
      api([gastoDeAyer], { corregir: () => respuestaJson(401, { error: 'sin_sesion' }) });
      await abrirCorregir();
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      expect(await screen.findByText('Tu sesión se cerró', { exact: false })).toBeOnTheScreen();
    });

    it('un 404 vuelve a PN-02 con «Ese movimiento ya no está.» y «Ir a Movimientos»', async () => {
      api([gastoDeAyer], { corregir: () => respuestaJson(404, { error: 'no_encontrado' }) });
      await abrirCorregir();
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      expect(await screen.findByText('Ese movimiento ya no está.')).toBeOnTheScreen();
      expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Ir a Movimientos' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Corregir' })).not.toBeOnTheScreen();
    });
  });

  describe('«Ahora no» y el Atrás', () => {
    it('«Ahora no» vuelve a PN-02 sin guardar nada', async () => {
      const pedidos = api([gastoDeAyer]);
      await abrirCorregir();
      await fireEvent.changeText(screen.getByLabelText('Monto'), '40.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Ahora no' }));
      await screen.findByRole('button', { name: 'Borrar este movimiento' });
      expect(screen.getByText('$45.000', { exact: false })).toBeOnTheScreen();
      expect(puts(pedidos)).toEqual([]);
    });

    it('el Atrás de «Corregir» vuelve a PN-02 y el de PN-02, a PN-01', async () => {
      api([gastoDeAyer]);
      await abrirCorregir();
      expect(await atras()).toBe(true);
      await screen.findByRole('button', { name: 'Borrar este movimiento' });
      expect(await atras()).toBe(true);
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Borrar este movimiento' })).not.toBeOnTheScreen());
      expect(screen.getByRole('button', { name: 'Registrar' })).toBeOnTheScreen();
    });

    it('después de guardar, el Atrás no vuelve a «Corregir» ni a PN-02: va a PN-01, a PN-71 y sale de la app', async () => {
      api([gastoDeAyer]);
      await abrirCorregir();
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar los cambios' }));
      await screen.findByText('Listo, guardamos los cambios.');
      // Atrás desde PN-01 es PN-71: ni el formulario ni el detalle quedan en la pila.
      expect(await atras()).toBe(true);
      await screen.findByText(PN71);
      expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Corregir' })).not.toBeOnTheScreen();
      expect(await atras()).toBe(false);
    });
  });
});
