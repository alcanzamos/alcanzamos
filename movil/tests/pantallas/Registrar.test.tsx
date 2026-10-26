import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { cambiarBorrador, reiniciarBorrador } from '../../src/borradorDeRegistro';
import { Registrar } from '../../src/pantallas/Registrar';
import { respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;
jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: jest.fn() } }));
const abrirSelector = DateTimePickerAndroid.open as jest.Mock;

const BASE = 'http://api.prueba:18090';

// El API manda `id` y `nombre`; el texto de la pantalla sale de es.json por `id` (el 99 no tiene texto de E14).
const catalogo = {
  gasto: [
    { id: 1, nombre: 'x', general: false },
    { id: 4, nombre: 'x', general: false },
    { id: 99, nombre: 'Sin texto', general: false },
    { id: 16, nombre: 'x', general: true },
    { id: 26, nombre: 'x', general: false },
  ],
  ingreso: [
    { id: 17, nombre: 'x', general: false },
    { id: 25, nombre: 'x', general: true },
  ],
};
const creado = { movimiento_id: 'm1', recurrente_id: null, proximas: [], pendientes: [] };

type Pedido = { metodo: string; ruta: string; cuerpo: string | undefined };
// Un API de mentira: el catálogo para las categorías y lo que diga `guardar` para el POST. Devuelve los pedidos.
function api(guardar: (p: Pedido) => Response | Promise<Response> = () => respuestaJson(201, creado)) {
  const pedidos: Pedido[] = [];
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const pedido = { metodo: String(init.method), ruta: url.replace(BASE, ''), cuerpo: init.body as string | undefined };
    pedidos.push(pedido);
    return pedido.metodo === 'GET' ? respuestaJson(200, catalogo) : guardar(pedido);
  }) as unknown as typeof fetch;
  return pedidos;
}
const guardados = (pedidos: Pedido[]) => pedidos.filter((p) => p.metodo === 'POST');
const enviado = (pedidos: Pedido[]) => JSON.parse(guardados(pedidos)[0]!.cuerpo!) as Record<string, unknown>;

async function abrir() {
  const navegacion = navegacionFalsa();
  await render(<Registrar {...propiedades('FormularioDeRegistro', navegacion)} />);
  await screen.findByLabelText('Monto');
  return navegacion;
}
const escribirMonto = (valor: string) => fireEvent.changeText(screen.getByLabelText('Monto'), valor);
const elegir = (nombre: string) => fireEvent.press(screen.getByRole('radio', { name: nombre }));
const guardar = () => fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
const nombresDe = (etiqueta: string) => {
  // Los chips de un grupo son los radios que siguen a su etiqueta: se toman del grupo que la contiene.
  const grupo = screen.getByText(etiqueta).parent!;
  return within(grupo).getAllByRole('radio').map((c) => c.props.accessibilityState.checked);
};
const aviso = (navegacion: ReturnType<typeof navegacionFalsa>) => navegacion.dispatch.mock.calls[0][0].payload.routes[0];

describe('PN-01 · Formulario de registro, Android (E14-PPN 3.1, D-164)', () => {
  beforeEach(() => {
    fijarHoy(new Date('2026-10-26T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    abrirSelector.mockReset();
    reiniciarBorrador();
    jest.mocked(TextInput.prototype.focus).mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('trae los campos de D-164 con «Gasto», «Hoy» y «Solo mío» elegidos, y el botón «Guardar»', async () => {
    api();
    await abrir();
    for (const texto of ['Tipo', 'Monto', 'Fecha', 'Categoría', 'Medio de pago', 'De quién es', 'Descripción (opcional)']) {
      expect(screen.getByText(texto)).toBeOnTheScreen();
    }
    expect(screen.getByRole('radio', { name: 'Gasto' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Solo mío' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Fecha, Hoy' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Monto').props.keyboardType).toBe('decimal-pad');
    expect(screen.getByLabelText('Descripción (opcional)').props.maxLength).toBe(280);
    expect(screen.getByText('No escribas datos de salud, religión ni de otras personas.')).toBeOnTheScreen();
    expect(screen.getByText('Se repite')).toBeOnTheScreen();
    expect(screen.getByText('No se repite')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ver todas' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeOnTheScreen();
  });

  it('no dibuja las filas omitidas por D-164', async () => {
    api();
    await abrir();
    for (const omitido of [
      'Llenar el formulario',
      'Escribe el gasto o el ingreso',
      'Cuotas',
      'Tarjeta',
      'Compartido con el hogar',
      'Prima, cesantías o intereses',
      'Elegir cuáles ver',
      'Revisar y guardar',
    ]) {
      expect(screen.queryByText(omitido)).not.toBeOnTheScreen();
    }
    expect(screen.queryByText(/Este mes faltan/)).not.toBeOnTheScreen();
  });

  it('el monto, la fecha y las cifras van en Figtree (D-123) y no hay ss02', async () => {
    api();
    await abrir();
    expect(screen.getByLabelText('Monto')).toHaveStyle({ fontFamily: 'Figtree-SemiBold', fontVariant: ['tabular-nums'] });
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/stylistic|ss02/);
  });

  it('el medio de pago es solo «Efectivo» y «Transferencia», con gasto y con ingreso', async () => {
    api();
    await abrir();
    expect(nombresDe('Medio de pago')).toEqual([false, false]);
    await elegir('Ingreso');
    expect(nombresDe('Medio de pago')).toEqual([false, false]);
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Tarjeta' })).not.toBeOnTheScreen();
  });

  it('las categorías salen del API por id, con el texto de E14, ninguna llega elegida y cambian con el tipo', async () => {
    api();
    await abrir();
    const grupo = () => within(screen.getByText('Categoría').parent!).getAllByRole('radio');
    expect(grupo().map((c) => c.children.at(-1))).toHaveLength(4);
    ['Alimentación', 'Arriendo o cuota de vivienda', 'Otros gastos', 'Ayuda a la familia'].forEach((n, i) =>
      expect(grupo()[i]).toHaveTextContent(n),
    );
    grupo().forEach((c) => expect(c).not.toBeChecked());
    await elegir('Ingreso');
    expect(grupo()).toHaveLength(2);
    expect(grupo()[0]).toHaveTextContent('Salario');
    expect(grupo()[1]).toHaveTextContent('Otros ingresos');
    grupo().forEach((c) => expect(c).not.toBeChecked());
  });

  it('«Ver todas» abre la hoja, elegir una categoría la selecciona y la cierra', async () => {
    api();
    await abrir();
    expect(screen.queryAllByRole('radio', { name: 'Otros gastos' })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Ver todas' }));
    // La hoja repite las categorías en una lista: ahora cada una sale dos veces (la fila y la hoja).
    expect(screen.getAllByRole('radio', { name: 'Ayuda a la familia' })).toHaveLength(2);
    await fireEvent.press(screen.getAllByRole('radio', { name: 'Ayuda a la familia' })[1]!);
    expect(screen.getAllByRole('radio', { name: 'Ayuda a la familia' })).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Ayuda a la familia' })).toBeChecked();
    // Con una elegida, la hoja la marca con su verificación.
    await fireEvent.press(screen.getByRole('button', { name: 'Ver todas' }));
    expect(screen.getAllByRole('radio', { name: 'Ayuda a la familia' })[1]).toBeChecked();
    expect(screen.getAllByRole('radio', { name: 'Otros gastos' })[1]).not.toBeChecked();
  });

  it('el Atrás de Android cierra la hoja y deja la categoría como estaba', async () => {
    api();
    await abrir();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver todas' }));
    expect(screen.getAllByRole('radio', { name: 'Otros gastos' })).toHaveLength(2);
    const [hoja] = screen.root!.queryAll((instancia) => instancia.type === 'Modal');
    await fireEvent(hoja!, 'requestClose');
    expect(screen.getAllByRole('radio', { name: 'Otros gastos' })).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Otros gastos' })).not.toBeChecked();
  });

  describe('fecha', () => {
    it('«Hoy» es el valor inicial y al tocarla se abre el selector nativo en la fecha de hoy', async () => {
      api();
      await abrir();
      await fireEvent.press(screen.getByRole('button', { name: 'Fecha, Hoy' }));
      expect(abrirSelector).toHaveBeenCalledTimes(1);
      const fecha = abrirSelector.mock.calls[0][0].value as Date;
      expect([fecha.getFullYear(), fecha.getMonth(), fecha.getDate()]).toEqual([2026, 9, 26]);
    });

    it('una fecha elegida se muestra en palabras y se manda tal cual; una futura sin repetición se acepta (L3)', async () => {
      const pedidos = api();
      await abrir();
      await fireEvent.press(screen.getByRole('button', { name: 'Fecha, Hoy' }));
      const diciembre = new Date(2026, 11, 20);
      await act(async () => abrirSelector.mock.calls[0][0].onValueChange({}, diciembre));
      expect(screen.getByRole('button', { name: 'Fecha, 20 de diciembre de 2026' })).toBeOnTheScreen();
      expect(screen.queryByText('Hoy')).not.toBeOnTheScreen();
      await escribirMonto('90.000');
      await elegir('Ayuda a la familia');
      await elegir('Efectivo');
      await guardar();
      expect(enviado(pedidos)).toMatchObject({ fecha: '2026-12-20', monto_centavos: 9000000 });
      expect(enviado(pedidos)).not.toHaveProperty('repeticion');
    });

    it('elegir de nuevo el día de hoy vuelve a decir «Hoy»', async () => {
      api();
      await abrir();
      await fireEvent.press(screen.getByRole('button', { name: 'Fecha, Hoy' }));
      await act(async () => abrirSelector.mock.calls[0][0].onValueChange({}, new Date(2026, 11, 20)));
      await fireEvent.press(screen.getByRole('button', { name: /^Fecha, 20/ }));
      await act(async () => abrirSelector.mock.calls[1][0].onValueChange({}, new Date(2026, 9, 26)));
      expect(screen.getByRole('button', { name: 'Fecha, Hoy' })).toBeOnTheScreen();
    });
  });

  it('el monto se muestra con la regla de E14-SDD 5.5 al salir del campo, y una lectura ambigua se deja como está', async () => {
    api();
    await abrir();
    await escribirMonto('123456,78');
    await fireEvent(screen.getByLabelText('Monto'), 'blur');
    expect(screen.getByLabelText('Monto').props.value).toBe('$123.456,78');
    await escribirMonto('12.5');
    await fireEvent(screen.getByLabelText('Monto'), 'blur');
    expect(screen.getByLabelText('Monto').props.value).toBe('12.5');
  });

  describe('validación antes de enviar', () => {
    it('muestra todos los errores a la vez, lleva el foco al monto y no llama al API', async () => {
      const pedidos = api();
      await abrir();
      await guardar();
      expect(screen.getByText('Falta el monto.')).toBeOnTheScreen();
      expect(screen.getByText('Falta elegir la categoría.')).toBeOnTheScreen();
      expect(screen.getByText('Falta elegir el medio de pago.')).toBeOnTheScreen();
      expect(TextInput.prototype.focus).toHaveBeenCalledTimes(1);
      expect(jest.mocked(TextInput.prototype.focus).mock.contexts[0].props.accessibilityLabel).toBe('Monto');
      expect(guardados(pedidos)).toEqual([]);
    });

    it('sin categoría (D-165): «Falta elegir la categoría.» y no se manda nada', async () => {
      const pedidos = api();
      await abrir();
      await escribirMonto('45.000');
      await elegir('Efectivo');
      await guardar();
      expect(screen.getByText('Falta elegir la categoría.')).toBeOnTheScreen();
      expect(screen.queryByText('Falta el monto.')).not.toBeOnTheScreen();
      expect(guardados(pedidos)).toEqual([]);
    });

    it('elegir la categoría y guardar de nuevo quita el error', async () => {
      api();
      await abrir();
      await escribirMonto('45.000');
      await elegir('Efectivo');
      await guardar();
      await elegir('Otros gastos');
      await guardar();
      expect(screen.queryByText('Falta elegir la categoría.')).not.toBeOnTheScreen();
    });

    it('la categoría de un tipo no vale para el otro: al cambiar de tipo vuelve a faltar', async () => {
      const pedidos = api();
      await abrir();
      await escribirMonto('45.000');
      await elegir('Otros gastos');
      await elegir('Efectivo');
      await elegir('Ingreso');
      await guardar();
      expect(screen.getByText('Falta elegir la categoría.')).toBeOnTheScreen();
      expect(guardados(pedidos)).toEqual([]);
    });

    it('el borrador conserva una categoría que ya no está en el catálogo como si no hubiera ninguna', async () => {
      const pedidos = api();
      cambiarBorrador({ categoriaId: 999, monto: '45.000', medio: 'efectivo' });
      await abrir();
      await guardar();
      expect(screen.getByText('Falta elegir la categoría.')).toBeOnTheScreen();
      expect(guardados(pedidos)).toEqual([]);
    });

    it('un monto con letras, ambiguo o demasiado grande dice lo de E14-PPN 1.11 y D-084', async () => {
      api();
      await abrir();
      await elegir('Otros gastos');
      await elegir('Efectivo');
      await escribirMonto('mucho');
      await guardar();
      expect(screen.getByText('Escribe el monto con números, por ejemplo $45.000.')).toBeOnTheScreen();
      await escribirMonto('12.5');
      await guardar();
      expect(screen.getByText('¿Quisiste decir $12.500 o $12,50?')).toBeOnTheScreen();
      await escribirMonto('99999999999999999999');
      await guardar();
      expect(screen.getByText('El monto es demasiado grande. Revisa que no sobren ceros.')).toBeOnTheScreen();
    });

    it('una fecha anterior a 1900 dice «Falta la fecha.»', async () => {
      const pedidos = api();
      cambiarBorrador({ fecha: '1899-12-31' });
      await abrir();
      await escribirMonto('45.000');
      await elegir('Otros gastos');
      await elegir('Efectivo');
      await guardar();
      expect(screen.getByText('Falta la fecha.')).toBeOnTheScreen();
      expect(guardados(pedidos)).toEqual([]);
    });
  });

  describe('guardar', () => {
    async function llenar(monto = '45.000') {
      await escribirMonto(monto);
      await elegir('Otros gastos');
      await elegir('Efectivo');
    }

    it('un gasto en efectivo: manda centavos enteros y vuelve a PN-71 con «Listo, registramos tu gasto de $45.000.» como mensaje de estado', async () => {
      const pedidos = api();
      const navegacion = await abrir();
      await llenar();
      await guardar();
      expect(guardados(pedidos)).toHaveLength(1);
      expect(guardados(pedidos)[0]).toMatchObject({ metodo: 'POST', ruta: '/api/v1/movimientos' });
      expect(enviado(pedidos)).toEqual({
        monto_centavos: 4500000,
        tipo: 'gasto',
        fecha: '2026-10-26',
        categoria_id: 16,
        medio: 'efectivo',
      });
      // PN-71 queda como la única pantalla de la pila: el Atrás no vuelve al formulario.
      expect(aviso(navegacion)).toEqual({
        name: 'SeguridadDeLaCuenta',
        params: { aviso: { tipo: 'informacion', titulo: 'Listo, registramos tu gasto de $45.000.' } },
      });
    });

    it('con centavos y descripción: «Listo, registramos tu gasto de $123.456,78.»', async () => {
      const pedidos = api();
      const navegacion = await abrir();
      await llenar('$123.456,78');
      await fireEvent.changeText(screen.getByLabelText('Descripción (opcional)'), '  Mercado  ');
      await guardar();
      expect(enviado(pedidos)).toMatchObject({ monto_centavos: 12345678, descripcion: 'Mercado' });
      expect(aviso(navegacion).params.aviso.titulo).toBe('Listo, registramos tu gasto de $123.456,78.');
    });

    it('un ingreso usa las categorías de ingreso y su aviso de E14-PPN 1.11', async () => {
      const pedidos = api();
      const navegacion = await abrir();
      await elegir('Ingreso');
      await escribirMonto('1.500.000');
      await elegir('Salario');
      await elegir('Transferencia');
      await guardar();
      expect(enviado(pedidos)).toMatchObject({
        tipo: 'ingreso',
        categoria_id: 17,
        medio: 'transferencia',
        monto_centavos: 150000000,
      });
      expect(aviso(navegacion).params.aviso.titulo).toBe('Listo, registramos tu ingreso de $1.500.000.');
    });

    it('un monto de 64 bits viaja con todos sus dígitos', async () => {
      const pedidos = api();
      await abrir();
      await llenar('92.233.720.368.547.758,07');
      await guardar();
      expect(guardados(pedidos)[0]?.cuerpo).toContain('"monto_centavos":9223372036854775807,');
    });

    it('el borrador se borra al guardar: el formulario siguiente sale vacío', async () => {
      api();
      await abrir();
      await llenar();
      await guardar();
      await screen.unmount();
      await abrir();
      expect(screen.getByLabelText('Monto').props.value).toBe('');
    });

    it('no manda dos veces si se toca otra vez mientras guarda', async () => {
      let terminar: (r: Response) => void = () => undefined;
      const pedidos = api(() => new Promise<Response>((r) => (terminar = r)));
      await abrir();
      await llenar();
      await guardar();
      await guardar();
      expect(guardados(pedidos)).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
      await act(async () => terminar(respuestaJson(201, creado)));
    });
  });

  describe('«Se repite»', () => {
    it('«Cambiar» abre PN-03 sin perder lo escrito', async () => {
      api();
      const navegacion = await abrir();
      await escribirMonto('45.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Cambiar' }));
      expect(navegacion.navigate).toHaveBeenCalledWith('SeRepite');
      expect(screen.getByLabelText('Monto').props.value).toBe('45.000');
    });

    it('con una periodicidad la fila dice «Se repite: Cada mes» y se manda la repetición', async () => {
      const pedidos = api();
      cambiarBorrador({ periodicidad: 'mensual' });
      const navegacion = await abrir();
      expect(screen.getByText('Se repite: Cada mes')).toBeOnTheScreen();
      expect(screen.queryByText('No se repite')).not.toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Cambiar' }).props.accessibilityHint).toBe('Se repite: Cada mes');
      await escribirMonto('1.200.000');
      await elegir('Arriendo o cuota de vivienda');
      await elegir('Transferencia');
      await guardar();
      expect(enviado(pedidos)).toMatchObject({ repeticion: { periodicidad: 'mensual' } });
      expect(aviso(navegacion).params.aviso.titulo).toBe('Listo, registramos tu gasto de $1.200.000.');
    });

    // S4 (D-164, D-165): el arriendo del 15 de agosto, mensual, escrito el 26 de octubre.
    it('el arriendo del 15 de agosto, mensual: el POST lleva la fecha 2026-08-15 y la repetición', async () => {
      const pedidos = api(() =>
        respuestaJson(201, { movimiento_id: 'm1', recurrente_id: 'r1', proximas: ['2026-11-15'], pendientes: [] }),
      );
      cambiarBorrador({ fecha: '2026-08-15', periodicidad: 'mensual' });
      const navegacion = await abrir();
      await escribirMonto('1.200.000');
      await elegir('Arriendo o cuota de vivienda');
      await elegir('Efectivo');
      await guardar();
      expect(enviado(pedidos)).toMatchObject({
        fecha: '2026-08-15',
        categoria_id: 4,
        repeticion: { periodicidad: 'mensual' },
      });
      expect(aviso(navegacion).params.aviso.titulo).toBe('Listo, registramos tu gasto de $1.200.000.');
    });

    it('con un gasto de fecha futura que se repite solo se guarda la repetición: «queda por confirmar el {fecha}»', async () => {
      api(() => respuestaJson(201, { movimiento_id: null, recurrente_id: 'r1', proximas: [], pendientes: ['2026-12-20'] }));
      cambiarBorrador({ fecha: '2026-12-20', periodicidad: 'mensual' });
      const navegacion = await abrir();
      await escribirMonto('90.000');
      await elegir('Otros gastos');
      await elegir('Efectivo');
      await guardar();
      expect(aviso(navegacion).params.aviso.titulo).toBe(
        'Listo. Tu gasto de $90.000 queda por confirmar el 20 de diciembre de 2026.',
      );
    });

    it('con un ingreso futuro que se repite dice «Listo. Tu ingreso de… queda por confirmar el…»', async () => {
      api(() => respuestaJson(201, { movimiento_id: null, recurrente_id: 'r1', proximas: [], pendientes: ['2026-12-20'] }));
      cambiarBorrador({ tipo: 'ingreso', fecha: '2026-12-20', periodicidad: 'semestral' });
      const navegacion = await abrir();
      await escribirMonto('2.000.000');
      await elegir('Salario');
      await elegir('Transferencia');
      await guardar();
      expect(aviso(navegacion).params.aviso.titulo).toBe(
        'Listo. Tu ingreso de $2.000.000 queda por confirmar el 20 de diciembre de 2026.',
      );
    });
  });

  describe('fallos del API', () => {
    async function llenarYGuardar() {
      const navegacion = await abrir();
      await escribirMonto('45.000');
      await elegir('Otros gastos');
      await elegir('Efectivo');
      await guardar();
      return navegacion;
    }

    it.each([
      [{ tipo: 'tipo_requerido' }, 'Falta elegir si es un gasto o un ingreso.'],
      [{ monto_centavos: 'monto_requerido' }, 'Falta el monto.'],
      [{ monto_centavos: 'monto_no_positivo' }, 'El monto debe ser mayor que $0.'],
      [{ monto_centavos: 'monto_invalido' }, 'Escribe el monto con números, por ejemplo $45.000.'],
      [{ categoria_id: 'categoria_requerida' }, 'Falta elegir la categoría.'],
      [{ fecha: 'fecha_requerida' }, 'Falta la fecha.'],
      [{ fecha: 'fecha_invalida' }, 'Falta la fecha.'],
      [{ medio: 'medio_requerido' }, 'Falta elegir el medio de pago.'],
      [{ repeticion: 'periodicidad_requerida' }, 'Falta elegir cada cuánto se repite.'],
    ])('un 422 %o muestra «%s» en su campo', async (campos, texto) => {
      api(() => respuestaJson(422, { error: 'datos_invalidos', campos }));
      const navegacion = await llenarYGuardar();
      expect(await screen.findByText(texto)).toBeOnTheScreen();
      expect(navegacion.dispatch).not.toHaveBeenCalled();
      expect(screen.queryByText('No pudimos guardar tu gasto.')).not.toBeOnTheScreen();
    });

    it('un 422 con el monto lleva el foco al monto', async () => {
      api(() => respuestaJson(422, { error: 'datos_invalidos', campos: { monto_centavos: 'monto_requerido' } }));
      jest.mocked(TextInput.prototype.focus).mockClear();
      await llenarYGuardar();
      await screen.findByText('Falta el monto.');
      expect(jest.mocked(TextInput.prototype.focus).mock.contexts[0].props.accessibilityLabel).toBe('Monto');
    });

    it.each([
      [{ categoria_id: 'categoria_invalida' }],
      [{ descripcion: 'descripcion_larga' }],
      [{ tipo: 'tipo_invalido' }],
      [{ medio: 'medio_requerido', categoria_id: 'categoria_invalida' }],
    ])('un 422 con un código sin texto de E14 (%o) da el aviso de error al guardar', async (campos) => {
      api(() => respuestaJson(422, { error: 'datos_invalidos', campos }));
      await llenarYGuardar();
      expect(await screen.findByText('No pudimos guardar tu gasto.')).toBeOnTheScreen();
      expect(screen.getByText('Lo que escribiste sigue ahí. Intenta de nuevo.')).toBeOnTheScreen();
    });

    it('un 422 sin campos también da el aviso', async () => {
      api(() => respuestaJson(422, { error: 'datos_invalidos' }));
      await llenarYGuardar();
      expect(await screen.findByText('No pudimos guardar tu gasto.')).toBeOnTheScreen();
    });

    it('un 500 con un ingreso dice «No pudimos guardar tu ingreso.», conserva lo escrito y «Intentar de nuevo» vuelve a mandar', async () => {
      let falla = true;
      const pedidos = api(() => (falla ? respuestaJson(500, { error: 'interno' }) : respuestaJson(201, creado)));
      const navegacion = await abrir();
      await elegir('Ingreso');
      await escribirMonto('1.500.000');
      await elegir('Salario');
      await elegir('Transferencia');
      await guardar();
      expect(await screen.findByText('No pudimos guardar tu ingreso.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Monto').props.value).toBe('1.500.000');
      falla = false;
      await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
      expect(guardados(pedidos)).toHaveLength(2);
      expect(aviso(navegacion).params.aviso.titulo).toBe('Listo, registramos tu ingreso de $1.500.000.');
    });

    it('un 500 con un gasto dice «No pudimos guardar tu gasto.» y no vuelve a PN-71', async () => {
      api(() => respuestaJson(500, { error: 'interno' }));
      const navegacion = await llenarYGuardar();
      expect(await screen.findByText('No pudimos guardar tu gasto.')).toBeOnTheScreen();
      expect(navegacion.dispatch).not.toHaveBeenCalled();
    });

    it('sin conexión y demasiados intentos (429) dicen el aviso de siempre', async () => {
      api(() => {
        throw new TypeError('Network request failed');
      });
      await llenarYGuardar();
      expect(await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.')).toBeOnTheScreen();
      await screen.unmount();
      api(() => respuestaJson(429, { error: 'demasiados_intentos' }));
      await llenarYGuardar();
      expect(await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.')).toBeOnTheScreen();
    });

    it('un 401 al guardar lleva a PN-60 con «Tu sesión se cerró» y un 403 sin autorización, a PN-63', async () => {
      api(() => respuestaJson(401, { error: 'sin_sesion' }));
      const sinSesion = await llenarYGuardar();
      await act(async () => undefined);
      expect(aviso(sinSesion)).toEqual({ name: 'Entrar', params: { llegada: 'sesion_cerrada' } });
      await screen.unmount();
      api(() => respuestaJson(403, { error: 'autorizacion_pendiente' }));
      const sinAutorizar = await llenarYGuardar();
      await act(async () => undefined);
      expect(aviso(sinAutorizar).name).toBe('InformacionDePrivacidad');
    });
  });

  describe('las categorías', () => {
    it('un 401 al pedirlas lleva a PN-60', async () => {
      global.fetch = jest.fn(async () => respuestaJson(401, { error: 'sin_sesion' })) as unknown as typeof fetch;
      const navegacion = navegacionFalsa();
      await render(<Registrar {...propiedades('FormularioDeRegistro', navegacion)} />);
      await act(async () => undefined);
      expect(aviso(navegacion)).toEqual({ name: 'Entrar', params: { llegada: 'sesion_cerrada' } });
    });

    it('un fallo muestra el error de carga y «Intentar de nuevo» las pide otra vez', async () => {
      let falla = true;
      const pedidos: string[] = [];
      global.fetch = jest.fn(async (url: string) => {
        pedidos.push(url);
        return falla ? respuestaJson(500, { error: 'interno' }) : respuestaJson(200, catalogo);
      }) as unknown as typeof fetch;
      await render(<Registrar {...propiedades('FormularioDeRegistro', navegacionFalsa())} />);
      expect(await screen.findByText('No pudimos cargar la información.')).toBeOnTheScreen();
      expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen();
      falla = false;
      await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
      expect(await screen.findByLabelText('Monto')).toBeOnTheScreen();
      expect(pedidos).toEqual([`${BASE}/api/v1/categorias`, `${BASE}/api/v1/categorias`]);
    });

    it('sin conexión lo dice y mientras cargan solo hay la pantalla vacía', async () => {
      global.fetch = jest.fn(async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch;
      await render(<Registrar {...propiedades('FormularioDeRegistro', navegacionFalsa())} />);
      expect(screen.queryByLabelText('Monto')).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeOnTheScreen();
      expect(await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.')).toBeOnTheScreen();
    });
  });
});
