import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { PresupuestoDelPeriodo } from '../../src/api/presupuesto';
import { reiniciarBorrador } from '../../src/borradorDeRegistro';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { tokens } from '../../src/tokens/tokens.generated';
import { esperarAnuncio, focoDeTalkBack, focosDeTalkBack, limpiarAnuncios, nombreDe } from '../ayudas/anuncios';
import { atras, instalarAtras } from '../ayudas/atras';
import { buscarCampo, campo, quizasCampo } from '../ayudas/campos';
import { respuestaJson } from '../ayudas/fetchFalso';
import {
  apiDelPresupuesto,
  bajo,
  BASE,
  datos,
  fila,
  laura,
  nulo,
  type Pedido,
  salarioEsperado,
  salarioPorConfirmar,
  sinPresupuesto,
  transporte,
} from '../ayudas/presupuestoFalso';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const PN71 = 'Este es tu primer ingreso.';
const MONTO = 'Monto para noviembre en pesos';
const NULO = 'Puedes repartir lo que llegue o dejar el presupuesto en cero.';
const BAJO = 'Lo asignado supera por $10.000 lo que registraste. Se actualiza cuando registres más ingresos.';
const EN_CERO = 'Listo, tu presupuesto de noviembre queda en cero. Cuando llegue un ingreso, puedes repartirlo.';

async function abrirPresupuesto() {
  await render(<Navegacion />);
  await screen.findByText(PN71);
  await fireEvent.press(screen.getByRole('button', { name: 'Presupuesto' }));
  await screen.findByRole('header', { name: 'Tu presupuesto este mes' });
}

/** Lo que TalkBack lee de un elemento agrupado: su nombre accesible. */
const leido = (texto: string | RegExp) => screen.getByLabelText(texto);

/** El texto de los hijos de una vista (elementos de React), para nombrar la vista que recibió el foco. */
const textoDeHijos = (hijos: unknown): string => {
  if (typeof hijos === 'string' || typeof hijos === 'number') return String(hijos);
  if (Array.isArray(hijos)) return hijos.map(textoDeHijos).join('');
  if (hijos && typeof hijos === 'object' && 'props' in hijos)
    return textoDeHijos((hijos as { props: { children?: unknown } }).props.children);
  return '';
};

/** El rol y el nombre de la última vista a la que se llevó el foco de TalkBack (`sendAccessibilityEvent`). */
const enfocada = () => {
  const vista = focosDeTalkBack().at(-1);
  return (
    vista && {
      rol: vista.props.accessibilityRole,
      nombre: nombreDe(vista) ?? textoDeHijos(vista.props.children),
    }
  );
};
const AVISO_ENFOCADO = { rol: 'alert', nombre: 'No pudimos guardar el presupuesto.Tus datos están a salvo. Intenta de nuevo.' };

/** El aviso de error que queda en la pantalla, con la hoja ya cerrada (L17 de la US-77, punto 1). */
const avisoEnLaPantalla = () => {
  expect(screen.queryByRole('button', { name: 'Ahora no' })).not.toBeOnTheScreen();
  return screen.getByRole('alert', { name: /^No pudimos guardar el presupuesto\./ });
};

/** Los pedidos que escriben: poner, corregir, quitar o dejar en cero. */
const escrituras = (pedidos: Pedido[]) => pedidos.filter((p) => p.metodo !== 'GET');
const lecturasDelPresupuesto = (pedidos: Pedido[]) =>
  pedidos.filter((p) => p.metodo === 'GET' && p.ruta === '/api/v1/presupuestos').length;

/** La posición de un texto entre los textos de la pantalla, para comprobar el orden. */
const posicion = (texto: string) =>
  screen.container.queryAll((n) => n.type === 'Text').indexOf(screen.getByText(texto));

describe('PN-06 y PN-07 · Presupuesto, Android (E14-PPA 4.1 y 4.2, US-77)', () => {
  beforeEach(() => {
    instalarAtras();
    fijarHoy(new Date('2026-11-02T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    reiniciarBorrador();
    limpiarAnuncios();
  });
  afterEach(() => jest.useRealTimers());

  describe('la entrada desde PN-71 (L3 de la US-77, punto 3)', () => {
    it('«Presupuesto» va justo después de «Movimientos» y abre PN-06 con la barra «Presupuesto de noviembre»', async () => {
      const pedidos = apiDelPresupuesto(respuestaJson);
      await render(<Navegacion />);
      await screen.findByText(PN71);
      const botones = screen.getAllByRole('button');
      const posicion = (nombre: string) => botones.indexOf(screen.getByRole('button', { name: nombre }));
      expect(posicion('Presupuesto')).toBe(posicion('Movimientos') + 1);
      await fireEvent.press(screen.getByRole('button', { name: 'Presupuesto' }));
      await screen.findByRole('header', { name: 'Tu presupuesto este mes' });
      expect(JSON.stringify(screen.toJSON())).toContain('"title":"Presupuesto de noviembre"');
      expect(pedidos.filter((p) => p.ruta === '/api/v1/presupuestos')).toEqual([{ metodo: 'GET', ruta: '/api/v1/presupuestos', cuerpo: undefined }]);
    });

    it('Atrás vuelve a PN-71 y después sale de la app', async () => {
      apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      expect(await atras()).toBe(true);
      await screen.findByText(PN71);
      expect(await atras()).toBe(false);
    });

    it('«Registrar» fijo abre el formulario vacío, con Tipo «Gasto» (D-164)', async () => {
      apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Registrar' }));
      expect(await screen.findByRole('radio', { name: 'Gasto', checked: true })).toBeOnTheScreen();
    });
  });

  describe('PN-06 con Laura en noviembre (caso F)', () => {
    it('la tarjeta de resumen: registrado, asignado, «Sin asignar», «Llega después» y la nota del salario', async () => {
      apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      expect(screen.getByText('Ingreso registrado')).toBeOnTheScreen();
      expect(screen.getByText('$1.200.000')).toBeOnTheScreen();
      expect(screen.getByText('Asignado')).toBeOnTheScreen();
      expect(screen.getAllByText('$40.000').length).toBeGreaterThan(0);
      expect(screen.getByText('Sin asignar')).toBeOnTheScreen();
      expect(screen.getByText('$1.160.000')).toBeOnTheScreen();
      expect(screen.getByText('Llega después: $1.200.000 (esperado)')).toBeOnTheScreen();
      expect(
        screen.getByText('Sin asignar cuenta lo que ya registraste. Salario del 16 de noviembre de 2026 se suma cuando llegue.'),
      ).toBeOnTheScreen();
      expect(screen.queryByText('Registrar un ingreso')).not.toBeOnTheScreen();
      expect(screen.queryByText('Dejar el presupuesto en cero')).not.toBeOnTheScreen();
      // Sin «Para mirar con calma» ni la aclaración de la simulación (L3 de la US-77, puntos 1 y 2).
      expect(screen.queryByText('Para mirar con calma')).not.toBeOnTheScreen();
    });

    it('ACC-004 (D-187): cada cifra del resumen se lee con su etiqueta y el monto en pesos, nunca con «$»', async () => {
      apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      expect(leido('Ingreso registrado, 1200000 pesos')).toBeOnTheScreen();
      expect(leido('Asignado, 40000 pesos')).toBeOnTheScreen();
      expect(leido('Sin asignar, 1160000 pesos')).toBeOnTheScreen();
      expect(leido('Llega después: 1200000 pesos (esperado)')).toBeOnTheScreen();
      expect(screen.queryByLabelText(/\$/)).not.toBeOnTheScreen();
    });

    it('con dos fechas esperadas no dice cuál se suma: la fila «Llega después» basta', async () => {
      apiDelPresupuesto(respuestaJson, {
        presupuesto: { ...laura, llega_despues: [laura.llega_despues[0]!, { ...laura.llega_despues[0]!, fecha: '2026-11-30' }] },
      });
      await abrirPresupuesto();
      expect(screen.getByText('Sin asignar cuenta lo que ya registraste.')).toBeOnTheScreen();
    });

    // L14 de la US-77, puntos 2 y 3: «Llega después» separa lo esperado de lo por confirmar; cada línea sale solo si su
    // total es mayor que cero, se lee en pesos (D-187) y la frase de una sola fecha va por cada marca.
    const conLoQueLlega = (llega: string, porConfirmar: string, fechas: PresupuestoDelPeriodo['llega_despues']) => ({
      ...laura,
      resumen: { ...laura.resumen, llega_despues_centavos: llega, por_confirmar_centavos: porConfirmar },
      llega_despues: fechas,
    });

    it('solo con lo esperado: «Llega después» y la frase de la fecha esperada, sin «Por confirmar»', async () => {
      apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      expect(screen.getByText('Llega después: $1.200.000 (esperado)')).toBeOnTheScreen();
      expect(screen.queryByText(/Por confirmar/)).not.toBeOnTheScreen();
      expect(screen.queryByText(/cuando lo confirmes/)).not.toBeOnTheScreen();
    });

    it('solo con lo por confirmar: «Por confirmar: $X» leído en pesos, sin «Llega después», y «se suma cuando lo confirmes»', async () => {
      apiDelPresupuesto(respuestaJson, { presupuesto: conLoQueLlega('0', '120000000', [salarioPorConfirmar]) });
      await abrirPresupuesto();
      expect(screen.getByText('Por confirmar: $1.200.000')).toBeOnTheScreen();
      expect(leido('Por confirmar: 1200000 pesos')).toBeOnTheScreen();
      expect(
        screen.getByText(
          'Sin asignar cuenta lo que ya registraste. Salario del 1 de noviembre de 2026 se suma cuando lo confirmes.',
        ),
      ).toBeOnTheScreen();
      expect(screen.queryByText(/Llega después/)).not.toBeOnTheScreen();
      expect(screen.queryByText(/se suma cuando llegue/)).not.toBeOnTheScreen();
      expect(screen.queryByLabelText(/\$/)).not.toBeOnTheScreen();
    });

    it('con las dos marcas: dos líneas con su total exacto, en pesos para TalkBack, y la frase de la única fecha esperada', async () => {
      apiDelPresupuesto(respuestaJson, {
        presupuesto: conLoQueLlega('25000000', '123000000', [
          { ...salarioPorConfirmar, fecha: '2026-11-05', monto_centavos: '60000000' },
          { ...salarioPorConfirmar, fecha: '2026-11-16', monto_centavos: '63000000' },
          { ...salarioEsperado, fecha: '2026-11-25', categoria_id: 18, monto_centavos: '25000000' },
        ]),
      });
      await abrirPresupuesto();
      expect(screen.getByText('Llega después: $250.000 (esperado)')).toBeOnTheScreen();
      expect(leido('Llega después: 250000 pesos (esperado)')).toBeOnTheScreen();
      expect(screen.getByText('Por confirmar: $1.230.000')).toBeOnTheScreen();
      expect(leido('Por confirmar: 1230000 pesos')).toBeOnTheScreen();
      expect(
        screen.getByText(
          'Sin asignar cuenta lo que ya registraste. Trabajo independiente o ventas del 25 de noviembre de 2026 se suma cuando llegue.',
        ),
      ).toBeOnTheScreen();
      // Dos fechas por confirmar: la línea «Por confirmar» basta.
      expect(screen.queryByText(/cuando lo confirmes/)).not.toBeOnTheScreen();
    });

    it('una fecha de cada marca: las dos frases, primero la esperada', async () => {
      apiDelPresupuesto(respuestaJson, {
        presupuesto: conLoQueLlega('120000000', '30000000', [
          salarioEsperado,
          { ...salarioPorConfirmar, categoria_id: 18, fecha: '2026-11-05', monto_centavos: '30000000' },
        ]),
      });
      await abrirPresupuesto();
      expect(screen.getByText('Por confirmar: $300.000')).toBeOnTheScreen();
      expect(
        screen.getByText(
          'Sin asignar cuenta lo que ya registraste. Salario del 16 de noviembre de 2026 se suma cuando llegue. Trabajo independiente o ventas del 5 de noviembre de 2026 se suma cuando lo confirmes.',
        ),
      ).toBeOnTheScreen();
    });

    it('un total por confirmar que no cabe en un number se muestra y se lee exacto (D-082)', async () => {
      apiDelPresupuesto(respuestaJson, {
        presupuesto: conLoQueLlega('0', '9223372036854775807', [salarioPorConfirmar]),
      });
      await abrirPresupuesto();
      expect(screen.getByText('Por confirmar: $92.233.720.368.547.758,07')).toBeOnTheScreen();
      expect(leido('Por confirmar: 92233720368547758 pesos con 7 centavos')).toBeOnTheScreen();
    });

    it('«Por categoría» en el orden del API, cada fila agrupada para TalkBack y sus botones con el nombre de la categoría', async () => {
      apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      expect(screen.getByRole('header', { name: 'Por categoría' })).toBeOnTheScreen();
      const filas = screen.getAllByLabelText(/, (Presupuesto|Gastado) /).map((f) => f.props.accessibilityLabel as string);
      expect(filas).toEqual([
        'Transporte, Presupuesto 40000 pesos · Gastado 40000 pesos, Ya usaste todo lo presupuestado.',
        'Arriendo o cuota de vivienda, Gastado 650000 pesos · Sin presupuesto',
        'Alimentación, Gastado 120000 pesos · Sin presupuesto',
        'Restaurantes y hoteles, Gastado 25000 pesos · Sin presupuesto',
        'Recreación y cultura, Gastado 15000 pesos · Sin presupuesto',
      ]);
      expect(screen.getByText('Presupuesto $40.000 · Gastado $40.000')).toBeOnTheScreen();
      expect(screen.getByText('Ya usaste todo lo presupuestado.')).toBeOnTheScreen();
      expect(screen.getByText('Gastado $650.000 · Sin presupuesto')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Corregir el presupuesto de Transporte' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Quitar el presupuesto de Transporte' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Poner presupuesto a Arriendo o cuota de vivienda' })).toBeOnTheScreen();
      expect(screen.getAllByRole('button', { name: /^Poner presupuesto a / })).toHaveLength(4);
    });

    it('los estados de una categoría con presupuesto describen sin calificar', async () => {
      apiDelPresupuesto(respuestaJson, {
        presupuesto: datos({ modo: 'normal', ingreso_registrado_centavos: '120000000' }, [
          fila({ categoria_id: 1, presupuesto: { id: 'p1', monto_centavos: '30000000' }, gastado_centavos: '12000000', estado: 'quedan', quedan_centavos: '18000000' }),
          fila({ categoria_id: 13, presupuesto: { id: 'p13', monto_centavos: '10000000' }, gastado_centavos: '12000000', estado: 'superado' }),
        ]),
      });
      await abrirPresupuesto();
      expect(screen.getByText('Quedan $180.000 por gastar.')).toBeOnTheScreen();
      expect(screen.getByText('Gastado $120.000 de $100.000 presupuestados.')).toBeOnTheScreen();
      expect(leido('Alimentación, Presupuesto 300000 pesos · Gastado 120000 pesos, Quedan 180000 pesos por gastar.')).toBeOnTheScreen();
      expect(
        leido('Restaurantes y hoteles, Presupuesto 100000 pesos · Gastado 120000 pesos, Gastado 120000 pesos de 100000 pesos presupuestados.'),
      ).toBeOnTheScreen();
    });

    it('una categoría oculta con presupuesto sigue en la lista con el ícono y la palabra «Oculta» (RN-011)', async () => {
      apiDelPresupuesto(respuestaJson, {
        presupuesto: datos({ modo: 'normal', ingreso_registrado_centavos: '1' }, [{ ...transporte, oculta: true }]),
      });
      await abrirPresupuesto();
      expect(screen.getByText('Oculta')).toBeOnTheScreen();
      expect(leido('Transporte, Oculta, Presupuesto 40000 pesos · Gastado 40000 pesos, Ya usaste todo lo presupuestado.')).toBeOnTheScreen();
    });

    it('sin presupuestos: «Todavía no tienes presupuesto este mes.» y las categorías con gasto con «Poner presupuesto»', async () => {
      apiDelPresupuesto(respuestaJson, {
        presupuesto: datos({ modo: 'normal', ingreso_registrado_centavos: '120000000' }, [sinPresupuesto(4, '65000000')]),
      });
      await abrirPresupuesto();
      expect(screen.getByText('Todavía no tienes presupuesto este mes.')).toBeOnTheScreen();
      expect(screen.getByText('Elige una categoría y pon cuánto quieres gastar en ella.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Poner presupuesto a Arriendo o cuota de vivienda' })).toBeOnTheScreen();
    });

    it('un mes que no es el en curso no ofrece poner, corregir, quitar ni agregar (D-094)', async () => {
      apiDelPresupuesto(respuestaJson, { presupuesto: { ...laura, editable: false } });
      await abrirPresupuesto();
      expect(screen.queryByRole('button', { name: /^(Poner presupuesto a|Corregir el|Quitar el)/ })).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Agregar otra categoría' })).not.toBeOnTheScreen();
    });

    it('un error de carga dice el aviso de E14 y «Intentar de nuevo» vuelve a pedir', async () => {
      let veces = 0;
      apiDelPresupuesto(respuestaJson, {
        presupuesto: () => (++veces === 1 ? respuestaJson(500, { error: 'error_interno' }) : laura),
      });
      await render(<Navegacion />);
      await screen.findByText(PN71);
      await fireEvent.press(screen.getByRole('button', { name: 'Presupuesto' }));
      expect(await screen.findByText('No pudimos cargar tu presupuesto.')).toBeOnTheScreen();
      expect(screen.getByText('Tus datos están a salvo. Intenta de nuevo.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
      expect(await screen.findByRole('header', { name: 'Tu presupuesto este mes' })).toBeOnTheScreen();
      expect(screen.queryByText('No pudimos cargar tu presupuesto.')).not.toBeOnTheScreen();
    });

    it('un 401 lleva a PN-60', async () => {
      apiDelPresupuesto(respuestaJson, { presupuesto: () => respuestaJson(401, { error: 'sin_sesion' }) });
      await render(<Navegacion />);
      await screen.findByText(PN71);
      await fireEvent.press(screen.getByRole('button', { name: 'Presupuesto' }));
      expect(await screen.findByText('Tu sesión se cerró', { exact: false })).toBeOnTheScreen();
    });
  });

  describe('la hoja «Poner presupuesto» (E14-SDD 5.12)', () => {
    async function abrirPoner(nombre = 'Poner presupuesto a Arriendo o cuota de vivienda') {
      await fireEvent.press(screen.getByRole('button', { name: nombre }));
      return buscarCampo(MONTO);
    }

    it('trae el título, «Monto para noviembre», «Guardar», «Ahora no» y «Cerrar»; sin la aclaración ni «De quién es» (L3)', async () => {
      apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      await abrirPoner();
      expect(screen.getByRole('header', { name: 'Presupuesto de Arriendo o cuota de vivienda' })).toBeOnTheScreen();
      expect(screen.getByText('Monto para noviembre')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Ahora no' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Cerrar' })).toBeOnTheScreen();
      expect(screen.queryByText(/cuenta en tu simulación/)).not.toBeOnTheScreen();
      expect(screen.queryByText('Solo mío')).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
      await waitFor(() => expect(quizasCampo(MONTO)).not.toBeOnTheScreen());
    });

    it('«Guardar» manda el presupuesto del mes, dice el aviso por la región viva y vuelve a pedir el presupuesto', async () => {
      const pedidos = apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      await fireEvent.changeText(await abrirPoner(), '400.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      await esperarAnuncio('Listo, guardamos tu presupuesto de Arriendo o cuota de vivienda.');
      // El aviso queda arriba como mensaje de estado; la región viva (que no se ve) lo dijo.
      expect(within(screen.getByRole('alert')).getByText('Listo, guardamos tu presupuesto de Arriendo o cuota de vivienda.')).toBeOnTheScreen();
      expect(pedidos.find((p) => p.metodo === 'POST')).toEqual({
        metodo: 'POST',
        ruta: '/api/v1/presupuestos',
        cuerpo: '{"periodo":"2026-11","categoria_id":4,"monto_centavos":40000000}',
      });
      expect(quizasCampo(MONTO)).not.toBeOnTheScreen();
      expect(pedidos.filter((p) => p.ruta === '/api/v1/presupuestos' && p.metodo === 'GET')).toHaveLength(2);
    });

    it('un monto vacío dice «Falta el monto.» en el campo, le lleva el foco de TalkBack y no manda nada (US-63)', async () => {
      const pedidos = apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      await abrirPoner();
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      expect(await screen.findByText('Falta el monto.')).toBeOnTheScreen();
      await waitFor(() => expect(nombreDe(focoDeTalkBack())).toBe(`${MONTO}, Falta el monto.`));
      expect(campo(MONTO).props.placeholder).toBe(`${MONTO}, Falta el monto.`);
      expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
    });

    it('un 422 del monto va al campo con el texto de E14-PPN 3.1; otro fallo es un aviso en la hoja, que sigue abierta', async () => {
      let veces = 0;
      const pedidos = apiDelPresupuesto(respuestaJson, {
        poner: () =>
          ++veces === 1
            ? respuestaJson(422, { error: 'datos_invalidos', campos: { monto_centavos: 'monto_no_positivo' } })
            : respuestaJson(500, { error: 'error_interno' }),
      });
      await abrirPresupuesto();
      await fireEvent.changeText(await abrirPoner(), '1');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      expect(await screen.findByText('El monto debe ser mayor que $0.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      await esperarAnuncio('No pudimos guardar el presupuesto. Tus datos están a salvo. Intenta de nuevo.');
      expect(screen.getByText('No pudimos guardar el presupuesto.')).toBeOnTheScreen();
      expect(campo(MONTO)).toBeOnTheScreen();
      // Un 500 no dice que la hoja tenga datos viejos: sigue abierta, con lo escrito, y no se vuelve a pedir la pantalla.
      expect(campo(MONTO).props.value).toBe('1');
      expect(lecturasDelPresupuesto(pedidos)).toBe(1);
    });

    it('mientras guarda, «Guardar» queda deshabilitado y no se manda dos veces', async () => {
      let soltar: (r: Response) => void = () => undefined;
      const pedidos = apiDelPresupuesto(respuestaJson, { poner: () => new Promise<Response>((r) => (soltar = r)) });
      await abrirPresupuesto();
      await fireEvent.changeText(await abrirPoner(), '400000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      expect(screen.getByRole('button', { name: 'Guardar', disabled: true })).toBeOnTheScreen();
      soltar(respuestaJson(201, {}));
      await screen.findByText('Listo, guardamos tu presupuesto de Arriendo o cuota de vivienda.');
      expect(pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
    });

    it('«Corregir» abre «Corregir el presupuesto de Transporte» con el monto escrito y guarda con PUT', async () => {
      const pedidos = apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      const monto = await abrirPoner('Corregir el presupuesto de Transporte');
      expect(screen.getByRole('header', { name: 'Corregir el presupuesto de Transporte' })).toBeOnTheScreen();
      expect(monto.props.value).toBe('40.000');
      await fireEvent.changeText(monto, '45.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      expect(await screen.findByText('Listo, guardamos tu presupuesto de Transporte.')).toBeOnTheScreen();
      expect(pedidos.find((p) => p.metodo === 'PUT')).toEqual({
        metodo: 'PUT',
        ruta: '/api/v1/presupuestos/p8',
        cuerpo: '{"monto_centavos":4500000}',
      });
    });

    it('«Agregar otra categoría» lista las de gasto que no están y abre la hoja de la elegida', async () => {
      const pedidos = apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Agregar otra categoría' }));
      const opciones = (await screen.findAllByRole('radio')).map((r) => within(r).getByText(/./).props.children);
      expect(opciones).toEqual(['Servicios públicos', 'Otros gastos']);
      await fireEvent.press(screen.getByRole('radio', { name: 'Servicios públicos' }));
      await fireEvent.changeText(await buscarCampo(MONTO), '400.000');
      expect(screen.getByRole('header', { name: 'Presupuesto de Servicios públicos' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      expect(await screen.findByText('Listo, guardamos tu presupuesto de Servicios públicos.')).toBeOnTheScreen();
      expect(pedidos.find((p) => p.metodo === 'POST')?.cuerpo).toBe(
        '{"periodo":"2026-11","categoria_id":5,"monto_centavos":40000000}',
      );
    });
  });

  describe('la hoja «¿Quitar el presupuesto…?»', () => {
    it('pide confirmar; «Quitar presupuesto» lo quita con DELETE y dice el aviso', async () => {
      const pedidos = apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Quitar el presupuesto de Transporte' }));
      expect(await screen.findByRole('header', { name: '¿Quitar el presupuesto de Transporte?' })).toBeOnTheScreen();
      expect(screen.getByText('Lo que gastaste no cambia. Puedes poner otro cuando quieras.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Quitar presupuesto' }));
      await esperarAnuncio('Listo, quitamos tu presupuesto de Transporte.');
      expect(pedidos.find((p) => p.metodo === 'DELETE')).toEqual({
        metodo: 'DELETE',
        ruta: '/api/v1/presupuestos/p8',
        cuerpo: undefined,
      });
    });

    it('«Ahora no» la cierra sin mandar nada; un fallo deja la hoja con el aviso', async () => {
      const pedidos = apiDelPresupuesto(respuestaJson, { quitar: () => respuestaJson(500, { error: 'error_interno' }) });
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Quitar el presupuesto de Transporte' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Ahora no' }));
      await waitFor(() =>
        expect(screen.queryByRole('header', { name: '¿Quitar el presupuesto de Transporte?' })).not.toBeOnTheScreen(),
      );
      expect(pedidos.some((p) => p.metodo === 'DELETE')).toBe(false);
      await fireEvent.press(screen.getByRole('button', { name: 'Quitar el presupuesto de Transporte' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Quitar presupuesto' }));
      expect(await screen.findByText('No pudimos guardar el presupuesto.')).toBeOnTheScreen();
      expect(screen.getByRole('header', { name: '¿Quitar el presupuesto de Transporte?' })).toBeOnTheScreen();
    });
  });

  describe('PN-07 con un ingreso nulo o bajo (caso P)', () => {
    it('ingreso nulo: «Ingreso registrado $0», sin «Sin asignar», con «Registrar un ingreso» y «Dejar el presupuesto en cero»', async () => {
      apiDelPresupuesto(respuestaJson, { presupuesto: nulo() });
      await abrirPresupuesto();
      expect(leido('Ingreso registrado, 0 pesos')).toBeOnTheScreen();
      expect(screen.getByText(NULO)).toBeOnTheScreen();
      expect(screen.queryByText('Sin asignar')).not.toBeOnTheScreen();
      expect(screen.queryByText('Asignado')).not.toBeOnTheScreen();
      expect(screen.getByText('Todavía no hay gastos este mes.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Registrar un ingreso' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Dejar el presupuesto en cero' })).toBeOnTheScreen();
    });

    it('ingreso nulo con el salario por confirmar: la línea «Por confirmar» lo muestra y lo lee en pesos (L14 de la US-77)', async () => {
      const conSalario = nulo();
      apiDelPresupuesto(respuestaJson, {
        presupuesto: {
          ...conSalario,
          resumen: { ...conSalario.resumen, por_confirmar_centavos: '120000000' },
          llega_despues: [salarioPorConfirmar],
        },
      });
      await abrirPresupuesto();
      expect(screen.getByText('Por confirmar: $1.200.000')).toBeOnTheScreen();
      expect(leido('Por confirmar: 1200000 pesos')).toBeOnTheScreen();
      expect(screen.getByText(NULO)).toBeOnTheScreen();
      expect(screen.queryByText(/Llega después/)).not.toBeOnTheScreen();
    });

    // L17 de la US-77, punto 4: la frase de una sola fecha también en PN-07, sola, bajo «Llega después» o «Por confirmar».
    it('ingreso nulo con el salario por confirmar: debajo de «Por confirmar», «… se suma cuando lo confirmes.»', async () => {
      const conSalario = nulo();
      apiDelPresupuesto(respuestaJson, {
        presupuesto: {
          ...conSalario,
          resumen: { ...conSalario.resumen, por_confirmar_centavos: '120000000' },
          llega_despues: [salarioPorConfirmar],
        },
      });
      await abrirPresupuesto();
      const frase = 'Salario del 1 de noviembre de 2026 se suma cuando lo confirmes.';
      expect(screen.getByText(frase)).toBeOnTheScreen();
      expect(posicion(frase)).toBeGreaterThan(posicion('Por confirmar: $1.200.000'));
      expect(posicion(frase)).toBeLessThan(posicion(NULO));
      expect(screen.queryByText(/Sin asignar cuenta/)).not.toBeOnTheScreen();
    });

    it('ingreso bajo con una fecha esperada: debajo de «Llega después», «… se suma cuando llegue.», sin reproche', async () => {
      apiDelPresupuesto(respuestaJson, {
        presupuesto: { ...bajo, resumen: { ...bajo.resumen, llega_despues_centavos: '120000000' }, llega_despues: [salarioEsperado] },
      });
      await abrirPresupuesto();
      const frase = 'Salario del 16 de noviembre de 2026 se suma cuando llegue.';
      expect(screen.getByText(frase)).toBeOnTheScreen();
      expect(posicion(frase)).toBeGreaterThan(posicion('Llega después: $1.200.000 (esperado)'));
      expect(posicion(frase)).toBeLessThan(posicion(BAJO));
      expect(screen.queryByText(/Sin asignar cuenta/)).not.toBeOnTheScreen();
    });

    it('ingreso nulo con una fecha esperada y dos por confirmar: solo la frase de la esperada', async () => {
      const caso = nulo();
      apiDelPresupuesto(respuestaJson, {
        presupuesto: {
          ...caso,
          resumen: { ...caso.resumen, llega_despues_centavos: '120000000', por_confirmar_centavos: '60000000' },
          llega_despues: [
            salarioEsperado,
            { ...salarioPorConfirmar, monto_centavos: '30000000' },
            { ...salarioPorConfirmar, fecha: '2026-11-02', monto_centavos: '30000000' },
          ],
        },
      });
      await abrirPresupuesto();
      expect(screen.getByText('Salario del 16 de noviembre de 2026 se suma cuando llegue.')).toBeOnTheScreen();
      expect(screen.getByText('Por confirmar: $600.000')).toBeOnTheScreen();
      expect(screen.queryByText(/cuando lo confirmes/)).not.toBeOnTheScreen();
    });

    it('«Dejar el presupuesto en cero» guarda la marca sin confirmar, dice el aviso y el botón ya no vuelve', async () => {
      let enCero = false;
      const pedidos = apiDelPresupuesto(respuestaJson, {
        presupuesto: () => nulo(enCero),
        enCero: () => {
          enCero = true;
          return respuestaJson(204);
        },
      });
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Dejar el presupuesto en cero' }));
      await esperarAnuncio(EN_CERO);
      expect(within(screen.getByRole('alert')).getByText(EN_CERO)).toBeOnTheScreen();
      expect(pedidos.find((p) => p.metodo === 'POST')).toEqual({
        metodo: 'POST',
        ruta: '/api/v1/presupuestos/en-cero',
        cuerpo: '{"periodo":"2026-11"}',
      });
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Dejar el presupuesto en cero' })).not.toBeOnTheScreen());
      expect(screen.getByText(NULO)).toBeOnTheScreen();
    });

    it('con el mes ya en cero (`en_cero: true`) no ofrece el botón y la tarjeta sigue igual (L17 de la US-77, punto 5)', async () => {
      const pedidos = apiDelPresupuesto(respuestaJson, { presupuesto: nulo(true) });
      await abrirPresupuesto();
      expect(screen.getByText(NULO)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Registrar un ingreso' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Dejar el presupuesto en cero' })).not.toBeOnTheScreen();
      expect(escrituras(pedidos)).toEqual([]);
    });

    it('un 409 al dejar en cero dice el aviso y vuelve a pedir; si el mes ya quedó en cero, el botón se va', async () => {
      let veces = 0;
      const pedidos = apiDelPresupuesto(respuestaJson, {
        presupuesto: () => nulo(++veces > 1),
        enCero: () => respuestaJson(409, { error: 'periodo_con_ingreso_o_presupuesto' }),
      });
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Dejar el presupuesto en cero' }));
      expect(await screen.findByText('No pudimos guardar el presupuesto.')).toBeOnTheScreen();
      await waitFor(() => expect(lecturasDelPresupuesto(pedidos)).toBe(2));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Dejar el presupuesto en cero' })).not.toBeOnTheScreen());
      expect(escrituras(pedidos)).toHaveLength(1);
    });

    it('ingreso nulo con categorías con gasto: cada una con «Poner presupuesto»', async () => {
      apiDelPresupuesto(respuestaJson, { presupuesto: nulo(true, [sinPresupuesto(1, '1500000')]) });
      await abrirPresupuesto();
      expect(screen.queryByText('Todavía no hay gastos este mes.')).not.toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Poner presupuesto a Alimentación' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Dejar el presupuesto en cero' })).not.toBeOnTheScreen();
    });

    it('ingreso bajo: registrado, asignado y la frase del dato, leída en pesos; sin «Dejar el presupuesto en cero»', async () => {
      apiDelPresupuesto(respuestaJson, { presupuesto: bajo });
      await abrirPresupuesto();
      expect(leido('Ingreso registrado, 150000 pesos')).toBeOnTheScreen();
      expect(leido('Asignado, 160000 pesos')).toBeOnTheScreen();
      expect(screen.getByText(BAJO)).toBeOnTheScreen();
      expect(
        leido('Lo asignado supera por 10000 pesos lo que registraste. Se actualiza cuando registres más ingresos.'),
      ).toBeOnTheScreen();
      expect(screen.queryByText('Sin asignar')).not.toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Registrar un ingreso' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Dejar el presupuesto en cero' })).not.toBeOnTheScreen();
    });

    it.each([
      ['nulo', nulo()],
      ['bajo', bajo],
    ])('sin reproche con ingreso %s (RNF-017): sin Atención, sin rojo, sin signo menos y sin las frases prohibidas', async (_, caso) => {
      apiDelPresupuesto(respuestaJson, { presupuesto: caso });
      await abrirPresupuesto();
      const arbol = JSON.stringify(screen.toJSON());
      const { atencion } = tokens.color.estado;
      for (const color of [atencion.texto, atencion.fondo, atencion.icono, tokens.color.accion.destructiva.fondo])
        expect(arbol).not.toContain(color);
      expect(screen.queryByText(/-\s?\$|−/)).not.toBeOnTheScreen();
      expect(
        screen.queryByText(/sin ingresos|no tienes plata|no hay plata|te pasaste|de más|déficit|no alcanza|debes registrar|gasta menos|ahorra/i),
      ).not.toBeOnTheScreen();
    });

    it('«Registrar un ingreso» abre el formulario con Tipo «Ingreso»', async () => {
      apiDelPresupuesto(respuestaJson, { presupuesto: nulo() });
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Registrar un ingreso' }));
      expect(await screen.findByRole('radio', { name: 'Ingreso', checked: true })).toBeOnTheScreen();
      expect(await atras()).toBe(true);
      expect(await screen.findByRole('button', { name: 'Registrar un ingreso' })).toBeOnTheScreen();
    });
  });

  // L17 de la US-77, punto 3: el foco de TalkBack al cerrar una hoja, como en la web. Al cancelar vuelve al botón que la
  // abrió; después de guardar, al título; con datos viejos, al aviso de la pantalla (abajo).
  describe('el foco de TalkBack al cerrar una hoja (L17 de la US-77, punto 3)', () => {
    it.each([
      ['Poner presupuesto a Arriendo o cuota de vivienda', 'Ahora no'],
      ['Poner presupuesto a Arriendo o cuota de vivienda', 'Cerrar'],
      ['Corregir el presupuesto de Transporte', 'Ahora no'],
      ['Corregir el presupuesto de Transporte', 'Cerrar'],
      ['Quitar el presupuesto de Transporte', 'Ahora no'],
      ['Quitar el presupuesto de Transporte', 'Cerrar'],
    ])('«%s» y después «%s»: el foco vuelve a ese botón, sin mandar nada', async (abridor, cierre) => {
      const pedidos = apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: abridor }));
      await fireEvent.press(await screen.findByRole('button', { name: cierre }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Ahora no' })).not.toBeOnTheScreen());
      await waitFor(() => expect(enfocada()).toEqual({ rol: 'button', nombre: abridor }));
      expect(escrituras(pedidos)).toEqual([]);
    });

    it('la hoja que se abrió desde «Agregar otra categoría» devuelve el foco a «Agregar otra categoría»', async () => {
      apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Agregar otra categoría' }));
      await fireEvent.press(await screen.findByRole('radio', { name: 'Servicios públicos' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Ahora no' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Ahora no' })).not.toBeOnTheScreen());
      await waitFor(() => expect(enfocada()).toEqual({ rol: 'button', nombre: 'Agregar otra categoría' }));
    });

    it('cerrar «Ver todas» sin elegir devuelve el foco a «Agregar otra categoría»', async () => {
      apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Agregar otra categoría' }));
      await screen.findByRole('radio', { name: 'Servicios públicos' });
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
      await waitFor(() => expect(screen.queryByRole('radio')).not.toBeOnTheScreen());
      await waitFor(() => expect(enfocada()).toEqual({ rol: 'button', nombre: 'Agregar otra categoría' }));
    });

    it.each([
      ['Poner presupuesto a Arriendo o cuota de vivienda', '400.000', 'Guardar', 'Listo, guardamos tu presupuesto de Arriendo o cuota de vivienda.'],
      ['Corregir el presupuesto de Transporte', null, 'Guardar', 'Listo, guardamos tu presupuesto de Transporte.'],
      ['Quitar el presupuesto de Transporte', null, 'Quitar presupuesto', 'Listo, quitamos tu presupuesto de Transporte.'],
    ])('«%s» bien guardado: el foco va al título y el aviso, por la región viva', async (abridor, monto, confirmar, aviso) => {
      apiDelPresupuesto(respuestaJson);
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: abridor }));
      if (monto) await fireEvent.changeText(await buscarCampo(MONTO), monto);
      await fireEvent.press(await screen.findByRole('button', { name: confirmar }));
      await esperarAnuncio(aviso);
      expect(enfocada()).toEqual({ rol: 'header', nombre: 'Tu presupuesto este mes' });
      expect(focosDeTalkBack()).toHaveLength(1);
    });

    it('«Dejar el presupuesto en cero» bien guardado: el foco va al título (el botón ya no está)', async () => {
      let enCero = false;
      apiDelPresupuesto(respuestaJson, {
        presupuesto: () => nulo(enCero),
        enCero: () => {
          enCero = true;
          return respuestaJson(204);
        },
      });
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Dejar el presupuesto en cero' }));
      await esperarAnuncio(EN_CERO);
      expect(enfocada()).toEqual({ rol: 'header', nombre: 'Tu presupuesto este mes' });
    });

    it('un 500 deja la hoja abierta y el foco no sale de ella', async () => {
      apiDelPresupuesto(respuestaJson, { quitar: () => respuestaJson(500, { error: 'error_interno' }) });
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Quitar el presupuesto de Transporte' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Quitar presupuesto' }));
      await esperarAnuncio('No pudimos guardar el presupuesto. Tus datos están a salvo. Intenta de nuevo.');
      expect(screen.getByRole('header', { name: '¿Quitar el presupuesto de Transporte?' })).toBeOnTheScreen();
      expect(focosDeTalkBack()).toEqual([]);
    });
  });

  // L17 de la US-77, punto 1: un 404 o un 409 dice que la hoja tenía datos viejos (el presupuesto ya no existe, el mes
  // cambió o la categoría tiene uno compartido). La hoja se cierra, la pantalla se vuelve a pedir y el aviso de E14 queda
  // en la pantalla, arriba de «Por categoría», con el foco de TalkBack, como en la web. Repetir exige volver a abrir la hoja.
  describe('hoja con datos viejos: un 404 o un 409 al poner, corregir o quitar (L17 de la US-77, punto 1)', () => {
    const acciones = {
      poner: {
        abridor: 'Poner presupuesto a Arriendo o cuota de vivienda',
        hoja: 'Presupuesto de Arriendo o cuota de vivienda',
        monto: '650.000',
        confirmar: 'Guardar',
        pedido: { metodo: 'POST', ruta: '/api/v1/presupuestos' },
      },
      corregir: {
        abridor: 'Corregir el presupuesto de Transporte',
        hoja: 'Corregir el presupuesto de Transporte',
        monto: '45.000',
        confirmar: 'Guardar',
        pedido: { metodo: 'PUT', ruta: '/api/v1/presupuestos/p8' },
      },
      quitar: {
        abridor: 'Quitar el presupuesto de Transporte',
        hoja: '¿Quitar el presupuesto de Transporte?',
        monto: null,
        confirmar: 'Quitar presupuesto',
        pedido: { metodo: 'DELETE', ruta: '/api/v1/presupuestos/p8' },
      },
    };
    const fallos = [
      [404, 'no_encontrado'],
      [409, 'periodo_no_editable'],
      [409, 'presupuesto_compartido'],
    ] as const;

    describe.each(Object.entries(acciones))('«%s»', (accion, a) => {
      it.each(fallos)(
        'con %i %s: cierra la hoja, vuelve a pedir la pantalla y deja el aviso en ella, con el foco',
        async (estado, codigo) => {
          const contesta = () => respuestaJson(estado, { error: codigo });
          const pedidos = apiDelPresupuesto(respuestaJson, { [accion]: contesta });
          await abrirPresupuesto();
          await fireEvent.press(screen.getByRole('button', { name: a.abridor }));
          if (a.monto) await fireEvent.changeText(await buscarCampo(MONTO), a.monto);
          await fireEvent.press(await screen.findByRole('button', { name: a.confirmar }));
          await waitFor(() => expect(screen.queryByRole('header', { name: a.hoja })).not.toBeOnTheScreen());
          const aviso = avisoEnLaPantalla();
          expect(within(aviso).getByText('Tus datos están a salvo. Intenta de nuevo.')).toBeOnTheScreen();
          // Arriba de «Por categoría», fuera de la tarjeta de resumen.
          expect(posicion('No pudimos guardar el presupuesto.')).toBeLessThan(posicion('Por categoría'));
          await waitFor(() => expect(enfocada()).toEqual(AVISO_ENFOCADO));
          await waitFor(() => expect(lecturasDelPresupuesto(pedidos)).toBe(2));
          expect(escrituras(pedidos).map(({ metodo, ruta }) => ({ metodo, ruta }))).toEqual([a.pedido]);
          // No fue un éxito: ningún «Listo, …».
          expect(screen.queryByText(/^Listo,/)).not.toBeOnTheScreen();
          // Repetir exige volver a abrir la hoja.
          expect(screen.queryByRole('button', { name: a.confirmar })).not.toBeOnTheScreen();
        },
      );
    });

    it('el aviso se va con la siguiente escritura', async () => {
      let respuesta = () => respuestaJson(404, { error: 'no_encontrado' });
      apiDelPresupuesto(respuestaJson, { quitar: () => respuesta(), poner: () => respuesta() });
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Quitar el presupuesto de Transporte' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Quitar presupuesto' }));
      await waitFor(() => expect(avisoEnLaPantalla()).toBeOnTheScreen());
      respuesta = () => respuestaJson(201, {});
      await fireEvent.press(screen.getByRole('button', { name: 'Poner presupuesto a Arriendo o cuota de vivienda' }));
      await fireEvent.changeText(await buscarCampo(MONTO), '650.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      await screen.findByText('Listo, guardamos tu presupuesto de Arriendo o cuota de vivienda.');
      expect(screen.queryByText('No pudimos guardar el presupuesto.')).not.toBeOnTheScreen();
    });

    // Diciembre empezó entre abrir la hoja y «Guardar»: el API responde 409 y la pantalla vuelve con diciembre.
    const diciembre = { ...laura, periodo_actual: '2026-12', periodo: '2026-12' };
    const titulo = (mes: string) => `"title":"Presupuesto de ${mes}"`;

    it('si cambió el mes, la pantalla muestra el mes nuevo y nada se guarda en él hasta que la persona vuelva a poner', async () => {
      let lecturas = 0;
      let escrito = 0;
      const pedidos = apiDelPresupuesto(respuestaJson, {
        presupuesto: () => (++lecturas === 1 ? laura : diciembre),
        poner: () => (++escrito === 1 ? respuestaJson(409, { error: 'periodo_no_editable' }) : respuestaJson(201, {})),
      });
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Poner presupuesto a Arriendo o cuota de vivienda' }));
      await fireEvent.changeText(await buscarCampo(MONTO), '650.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(JSON.stringify(screen.toJSON())).toContain(titulo('diciembre')));
      expect(quizasCampo(MONTO)).not.toBeOnTheScreen();
      expect(avisoEnLaPantalla()).toBeOnTheScreen();
      expect(escrituras(pedidos)).toHaveLength(1);
      // La persona vuelve a poner: ahora sí, en diciembre.
      await fireEvent.press(screen.getByRole('button', { name: 'Poner presupuesto a Arriendo o cuota de vivienda' }));
      const enDiciembre = await buscarCampo('Monto para diciembre en pesos');
      expect(screen.getByText('Monto para diciembre')).toBeOnTheScreen();
      expect(enDiciembre.props.value).toBe('');
      await fireEvent.changeText(enDiciembre, '650.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      await screen.findByText('Listo, guardamos tu presupuesto de Arriendo o cuota de vivienda.');
      expect(escrituras(pedidos).map((p) => p.cuerpo)).toEqual([
        '{"periodo":"2026-11","categoria_id":4,"monto_centavos":65000000}',
        '{"periodo":"2026-12","categoria_id":4,"monto_centavos":65000000}',
      ]);
    });

    it('una hoja abierta antes de que llegue el mes nuevo sigue con su mes: «Guardar» no pone nada en el mes nuevo', async () => {
      let lecturas = 0;
      let soltar: (r: Response) => void = () => undefined;
      const pedidos = apiDelPresupuesto(respuestaJson, {
        presupuesto: () => {
          lecturas++;
          if (lecturas === 1) return laura;
          if (lecturas === 2) return new Promise<Response>((r) => (soltar = r));
          return diciembre;
        },
        poner: () => respuestaJson(409, { error: 'periodo_no_editable' }),
      });
      await abrirPresupuesto();
      await fireEvent.press(screen.getByRole('button', { name: 'Poner presupuesto a Arriendo o cuota de vivienda' }));
      await fireEvent.changeText(await buscarCampo(MONTO), '650.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(quizasCampo(MONTO)).not.toBeOnTheScreen());
      // Con noviembre todavía a la vista, la persona abre otra vez la hoja; después llega diciembre.
      await fireEvent.press(screen.getByRole('button', { name: 'Poner presupuesto a Arriendo o cuota de vivienda' }));
      const monto = await buscarCampo(MONTO);
      soltar(respuestaJson(200, diciembre));
      await waitFor(() => expect(JSON.stringify(screen.toJSON())).toContain(titulo('diciembre')));
      expect(screen.getByText('Monto para noviembre')).toBeOnTheScreen();
      await fireEvent.changeText(monto, '650.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(quizasCampo(MONTO)).not.toBeOnTheScreen());
      expect(escrituras(pedidos).map((p) => (JSON.parse(p.cuerpo!) as { periodo: string }).periodo)).toEqual([
        '2026-11',
        '2026-11',
      ]);
    });
  });
});
