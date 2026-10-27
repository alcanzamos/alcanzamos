import { Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { cambiarBorrador, reiniciarBorrador, useBorrador } from '../../src/borradorDeRegistro';
import { SeRepite } from '../../src/pantallas/SeRepite';
import { respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const BASE = 'http://api.prueba:18090';
const RUTA = '/api/v1/repeticiones/proximas';
const SIN_CONEXION = 'Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.';

// Cada prueba dice qué contesta el endpoint de L6 para cada pedido (las fechas las calcula el API, D-165) y recibe la
// lista de rutas que se pidieron. `fetch` se reemplaza por una función que decide por pedido, para poder dejar uno en el aire.
type Contestar = (ruta: string) => Response | Promise<Response>;
function simularApi(contestar: Contestar) {
  const rutas: string[] = [];
  global.fetch = jest.fn(async (url: string) => {
    rutas.push(url.replace(BASE, ''));
    return contestar(url.replace(BASE, ''));
  }) as unknown as typeof fetch;
  return rutas;
}
const responderCon = (proximas: string[]) => simularApi(() => respuestaJson(200, { proximas }));

const opcion = (nombre: string) => screen.getByRole('radio', { name: nombre });
const listo = () => fireEvent.press(screen.getByRole('button', { name: 'Listo' }));

async function mostrar() {
  const navegacion = navegacionFalsa();
  await render(<SeRepite {...propiedades('SeRepite', navegacion)} />);
  return navegacion;
}

function Borrador() {
  const b = useBorrador();
  return <Text>{b.periodicidad ?? 'ninguna'}</Text>;
}

describe('PN-03 · Se repite (E14-PRR 4.3)', () => {
  beforeEach(() => {
    // Hoy es el 26 de octubre de 2026 (el día de la prueba del dueño, S4).
    fijarHoy(new Date('2026-10-26T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    reiniciarBorrador();
  });
  afterEach(() => jest.useRealTimers());

  it('trae la explicación y las seis opciones en el orden de la tabla, sin «Dejar de repetir»', async () => {
    const rutas = responderCon([]);
    await mostrar();
    expect(screen.getByText('Lo registras una vez. En cada fecha te pedimos confirmarlo con un toque.')).toBeOnTheScreen();
    expect(screen.getByText('Cada cuánto')).toBeOnTheScreen();
    const nombres = ['No se repite', 'Cada semana', 'Cada quincena', 'Cada mes', 'Cada semestre', 'Cada año'];
    const chips = screen.getAllByRole('radio');
    expect(chips).toHaveLength(6);
    chips.forEach((chip, i) => expect(chip).toHaveTextContent(nombres[i]!));
    expect(screen.queryByRole('button', { name: 'Dejar de repetir' })).not.toBeOnTheScreen();
    expect(rutas).toEqual([]);
  });

  it('sin repetir: «No se repite» elegido, su explicación, sin las filas 5 a 7 y sin llamar al API', async () => {
    const rutas = responderCon([]);
    await mostrar();
    expect(opcion('No se repite')).toBeChecked();
    expect(screen.getByText('Se cuenta solo en su fecha.')).toBeOnTheScreen();
    expect(screen.queryByText('Empieza el')).not.toBeOnTheScreen();
    expect(screen.queryByText('Próximas fechas')).not.toBeOnTheScreen();
    expect(screen.queryByText(/El monto es el mismo/)).not.toBeOnTheScreen();
    expect(rutas).toEqual([]);
  });

  it.each([
    ['Cada semana', 'Cada 7 días, desde la fecha en que empieza.'],
    ['Cada quincena', 'Dos fechas al mes, separadas por 15 días. Si el mes es más corto, usamos su último día.'],
    ['Cada mes', 'El mismo día de cada mes. Si el mes es más corto, usamos su último día.'],
    ['Cada semestre', 'El mismo día, cada seis meses.'],
    ['Cada año', 'El mismo día y el mismo mes, cada año.'],
  ])('«%s» explica «%s»', async (nombre, explicacion) => {
    responderCon(['2026-11-26']);
    await mostrar();
    await fireEvent.press(opcion(nombre));
    expect(screen.getByText(explicacion)).toBeOnTheScreen();
    expect(screen.getByText('Empieza el')).toBeOnTheScreen();
    expect(
      screen.getByText('El monto es el mismo en cada fecha. Al confirmar una fecha puedes escribir otro monto, sin cambiar las demás.'),
    ).toBeOnTheScreen();
    expect(await screen.findByText('noviembre de', { exact: false })).toBeOnTheScreen();
  });

  it('«Empieza el» es la fecha del formulario, en palabras, y esa fecha va al API con la periodicidad', async () => {
    cambiarBorrador({ fecha: '2026-10-01' });
    const rutas = responderCon(['2026-11-16', '2026-12-01', '2026-12-16']);
    await mostrar();
    await fireEvent.press(opcion('Cada quincena'));
    expect(screen.getByText('octubre de', { exact: false })).toHaveTextContent('1 de octubre de 2026');
    expect(screen.getByRole('header', { name: 'Próximas fechas' })).toBeOnTheScreen();
    expect(await screen.findByText('16 de noviembre de 2026', { exact: false })).toBeOnTheScreen();
    expect(screen.getByText('1 de diciembre de 2026', { exact: false })).toBeOnTheScreen();
    expect(screen.getByText('16 de diciembre de 2026', { exact: false })).toBeOnTheScreen();
    expect(rutas).toEqual([`${RUTA}?periodicidad=quincenal&inicio=2026-10-01`]);
  });

  // S4 (D-164, D-165): el arriendo del 15 de agosto escrito el 26 de octubre; septiembre y octubre son historia.
  it('el arriendo del 15 de agosto, mensual, escrito el 26 de octubre: muestra lo que manda el API, el 15 de noviembre, el 15 de diciembre y el 15 de enero', async () => {
    cambiarBorrador({ fecha: '2026-08-15' });
    const rutas = responderCon(['2026-11-15', '2026-12-15', '2027-01-15']);
    await mostrar();
    await fireEvent.press(opcion('Cada mes'));
    expect(screen.getByText('agosto de', { exact: false })).toHaveTextContent('15 de agosto de 2026');
    expect(await screen.findByText('15 de noviembre de 2026', { exact: false })).toBeOnTheScreen();
    expect(screen.getByText('15 de diciembre de 2026', { exact: false })).toBeOnTheScreen();
    expect(screen.getByText('15 de enero de 2027', { exact: false })).toBeOnTheScreen();
    expect(screen.queryByText('septiembre', { exact: false })).not.toBeOnTheScreen();
    expect(screen.queryByText('15 de octubre', { exact: false })).not.toBeOnTheScreen();
    expect(rutas).toEqual([`${RUTA}?periodicidad=mensual&inicio=2026-08-15`]);
  });

  it('sin cambiar la fecha del formulario, «Empieza el» es hoy y se manda hoy', async () => {
    const rutas = responderCon(['2026-11-26']);
    await mostrar();
    await fireEvent.press(opcion('Cada mes'));
    expect(screen.getByText('octubre de', { exact: false })).toHaveTextContent('26 de octubre de 2026');
    await screen.findByText('26 de noviembre de 2026', { exact: false });
    expect(rutas).toEqual([`${RUTA}?periodicidad=mensual&inicio=2026-10-26`]);
  });

  it('muestra solo lo que recibe: sin fechas, «No hay fechas próximas.»', async () => {
    responderCon([]);
    await mostrar();
    await fireEvent.press(opcion('Cada mes'));
    expect(await screen.findByText('No hay fechas próximas.')).toBeOnTheScreen();
  });

  it('una fecha de inicio que el API no acepta (antes de 1900) no llama al API y dice «No hay fechas próximas.»', async () => {
    cambiarBorrador({ fecha: '1899-12-31' });
    const rutas = responderCon([]);
    await mostrar();
    await fireEvent.press(opcion('Cada mes'));
    expect(screen.getByText('No hay fechas próximas.')).toBeOnTheScreen();
    expect(rutas).toEqual([]);
  });

  it('mientras llegan las fechas la tarjeta está ocupada y no dice nada', async () => {
    let contestar: (r: Response) => void = () => undefined;
    simularApi(() => new Promise<Response>((r) => (contestar = r)));
    await mostrar();
    await fireEvent.press(opcion('Cada mes'));
    expect(JSON.stringify(screen.toJSON())).toContain('"busy":true');
    expect(screen.queryByText('No hay fechas próximas.')).not.toBeOnTheScreen();
    await act(async () => contestar(respuestaJson(200, { proximas: ['2026-11-26'] })));
    await screen.findByText('26 de noviembre de 2026', { exact: false });
    expect(JSON.stringify(screen.toJSON())).not.toContain('"busy":true');
  });

  it('al cambiar de periodicidad no deja las fechas de la elección anterior ni una respuesta tardía', async () => {
    const respuestas: Record<string, (r: Response) => void> = {};
    simularApi(
      (ruta) =>
        new Promise<Response>((r) => {
          respuestas[ruta.includes('semanal') ? 'semanal' : 'anual'] = r;
        }),
    );
    await mostrar();
    await fireEvent.press(opcion('Cada semana'));
    await fireEvent.press(opcion('Cada año'));
    await act(async () => respuestas.anual?.(respuestaJson(200, { proximas: ['2027-10-26'] })));
    await screen.findByText('26 de octubre de 2027', { exact: false });
    await act(async () => respuestas.semanal?.(respuestaJson(200, { proximas: ['2026-11-02'] })));
    expect(screen.queryByText('2 de noviembre de 2026', { exact: false })).not.toBeOnTheScreen();
    expect(screen.getByText('26 de octubre de 2027', { exact: false })).toBeOnTheScreen();
  });

  it('los números de las fechas van en Figtree con cifras tabulares y sin ss02 (D-123)', async () => {
    cambiarBorrador({ fecha: '2026-10-01' });
    responderCon(['2026-11-01']);
    await mostrar();
    await fireEvent.press(opcion('Cada mes'));
    await screen.findByText('1 de noviembre de 2026', { exact: false });
    for (const numero of ['1', '2026']) {
      screen.getAllByText(numero).forEach((n) => expect(n).toHaveStyle({ fontFamily: 'Figtree-SemiBold', fontVariant: ['tabular-nums'] }));
    }
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/stylistic|ss02/);
  });

  describe('cuando el API no contesta bien', () => {
    it('sin conexión: el aviso de siempre y «Intentar de nuevo» vuelve a pedir; «Listo» no se bloquea', async () => {
      let falla = true;
      const rutas = simularApi(() => {
        if (falla) throw new Error('sin red');
        return respuestaJson(200, { proximas: ['2026-11-26'] });
      });
      const navegacion = await mostrar();
      await fireEvent.press(opcion('Cada mes'));
      expect(await screen.findByText(SIN_CONEXION)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Listo' })).not.toBeDisabled();
      falla = false;
      await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
      await screen.findByText('26 de noviembre de 2026', { exact: false });
      expect(screen.queryByText(SIN_CONEXION)).not.toBeOnTheScreen();
      expect(rutas).toHaveLength(2);
      await listo();
      expect(navegacion.goBack).toHaveBeenCalledTimes(1);
    });

    it('un error del servidor da «No pudimos cargar la información.» y «Listo» sigue sirviendo', async () => {
      simularApi(() => respuestaJson(500, { error: 'interno' }));
      const navegacion = await mostrar();
      await fireEvent.press(opcion('Cada mes'));
      expect(await screen.findByText('No pudimos cargar la información.')).toBeOnTheScreen();
      await listo();
      expect(navegacion.goBack).toHaveBeenCalledTimes(1);
    });

    it('un 422 del endpoint y una respuesta que no son fechas dan el mismo aviso', async () => {
      simularApi(() => respuestaJson(422, { error: 'datos_invalidos', campos: { inicio: 'fecha_invalida' } }));
      await mostrar();
      await fireEvent.press(opcion('Cada mes'));
      expect(await screen.findByText('No pudimos cargar la información.')).toBeOnTheScreen();
      await screen.unmount();
      simularApi(() => respuestaJson(200, { proximas: ['no es una fecha'] }));
      await mostrar();
      await fireEvent.press(opcion('Cada mes'));
      expect(await screen.findByText('No pudimos cargar la información.')).toBeOnTheScreen();
    });

    it('sin sesión (401) va a PN-60 con «Tu sesión se cerró»', async () => {
      simularApi(() => respuestaJson(401, { error: 'sin_sesion' }));
      const navegacion = await mostrar();
      await fireEvent.press(opcion('Cada mes'));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledTimes(1));
      expect(navegacion.dispatch.mock.calls[0][0].payload.routes[0]).toEqual({
        name: 'Entrar',
        params: { llegada: 'sesion_cerrada' },
      });
    });
  });

  describe('«Listo» y Atrás', () => {
    it('«Listo» guarda la periodicidad en el borrador y vuelve al formulario', async () => {
      responderCon([]);
      const navegacion = navegacionFalsa();
      await render(
        <>
          <SeRepite {...propiedades('SeRepite', navegacion)} />
          <Borrador />
        </>,
      );
      await fireEvent.press(opcion('Cada mes'));
      expect(screen.getByText('ninguna')).toBeOnTheScreen();
      await listo();
      expect(screen.getByText('mensual')).toBeOnTheScreen();
      expect(navegacion.goBack).toHaveBeenCalledTimes(1);
    });

    it('con «No se repite» vuelve sin repetición, también si había una', async () => {
      responderCon([]);
      cambiarBorrador({ periodicidad: 'anual' });
      const navegacion = navegacionFalsa();
      await render(
        <>
          <SeRepite {...propiedades('SeRepite', navegacion)} />
          <Borrador />
        </>,
      );
      expect(opcion('Cada año')).toBeChecked();
      await fireEvent.press(opcion('No se repite'));
      await listo();
      expect(screen.getByText('ninguna')).toBeOnTheScreen();
      expect(navegacion.goBack).toHaveBeenCalledTimes(1);
    });

    it('elegir sin tocar «Listo» no cambia el borrador (el Atrás del sistema vuelve sin cambiar nada)', async () => {
      responderCon([]);
      cambiarBorrador({ periodicidad: 'semanal' });
      await render(
        <>
          <SeRepite {...propiedades('SeRepite', navegacionFalsa())} />
          <Borrador />
        </>,
      );
      await fireEvent.press(opcion('Cada año'));
      expect(screen.getByText('semanal')).toBeOnTheScreen();
    });
  });
});
