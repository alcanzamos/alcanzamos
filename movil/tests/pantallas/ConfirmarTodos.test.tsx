import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { reiniciarBorrador } from '../../src/borradorDeRegistro';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { atras, instalarAtras } from '../ayudas/atras';
import { anunciados, esperarAnuncio, esperarSinAnuncios, focosDeTalkBack, limpiarAnuncios, nombreDe } from '../ayudas/anuncios';
import { respuestaJson } from '../ayudas/fetchFalso';
import { apiFalsa, BASE, celular, energia, listado, pendiente, pendientes } from '../ayudas/movimientosFalsos';
import { fijarHoy } from '../ayudas/reloj';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';
import { buscarCampo, campo, quizasCampo } from '../ayudas/campos';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const PN71 = 'Este es tu primer ingreso.';
const salario = pendiente({ fecha: '2026-12-01' });
const arriendo = pendiente({
  recurrente_id: 'r-arriendo',
  fecha: '2026-12-01',
  tipo: 'gasto',
  categoria_id: 4,
  monto_habitual_centavos: '80000000',
});

const resultado = (guardados: number, omitidas: number) =>
  respuestaJson(200, { movimientos: [], omitidas: [], siguen_pendientes: 0, resumen: { guardados, omitidas } });

async function abrirTodos() {
  await render(<Navegacion />);
  await screen.findByText(PN71);
  await fireEvent.press(screen.getByRole('button', { name: 'Movimientos' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar todos' }));
  await screen.findByText(/de \d+ marcados/);
}
const casilla = (fila: string, opciones: { checked?: boolean; disabled?: boolean } = {}) =>
  screen.getByRole('checkbox', { name: new RegExp(`^${fila}`), ...opciones });
const mas = (fila: string) => screen.getByRole('button', { name: new RegExp(`^Más opciones de ${fila}`) });
const elegir = async (fila: string, opcion: string) => {
  await fireEvent.press(mas(fila));
  await fireEvent.press(await screen.findByRole('button', { name: opcion }));
};
const cambiarMonto = async (fila: string, valor: string) => {
  await elegir(fila, 'Cambiar el monto');
  await fireEvent.changeText(await buscarCampo('Monto en pesos'), valor);
  await fireEvent.press(screen.getByRole('button', { name: 'Listo' }));
  await waitFor(() => expect(quizasCampo('Monto en pesos')).not.toBeOnTheScreen());
};
const guardar = (nombre: string | RegExp, opciones: { disabled?: boolean } = {}) =>
  screen.getByRole('button', { name: nombre, ...opciones });
const publicaciones = (pedidos: { metodo: string; cuerpo?: string }[]) => pedidos.filter((p) => p.metodo === 'POST');

describe('«Confirmar todos», Android (E14-PRR 4.8, US-60)', () => {
  beforeEach(() => {
    instalarAtras();
    fijarHoy(new Date('2026-12-14T15:00:00Z'));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    reiniciarBorrador();
  });
  afterEach(() => jest.useRealTimers());

  describe('la pantalla', () => {
    it('abre con todo marcado, el recuento, las aclaraciones y «Guardar 3 movimientos»', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario) });
      await abrirTodos();
      expect(
        screen.getByText(
          'Todo viene marcado. Desmarca lo que no quieras confirmar ahora, o toca «Más» si no pasó o cambió el monto.',
        ),
      ).toBeOnTheScreen();
      expect(screen.getByText('3 de 3 marcados')).toBeOnTheScreen();
      expect(
        screen.getByText('Lo que desmarques sigue por confirmar. Una fecha que marques «No pasó» deja de contarse.'),
      ).toBeOnTheScreen();
      expect(guardar('Guardar 3 movimientos')).toBeOnTheScreen();
      // «Sin botón Confirmar»: cada fila trae la casilla y «Más».
      expect(screen.queryByRole('button', { name: /^Confirmar / })).not.toBeOnTheScreen();
      expect(casilla('Servicios públicos', { checked: true })).toBeOnTheScreen();
      expect(screen.getByText('Gasto · 5 de noviembre de 2026')).toBeOnTheScreen();
      expect(screen.getByText('$120.000')).toBeOnTheScreen();
      expect(screen.getByText('Ingreso · 1 de diciembre de 2026')).toBeOnTheScreen();
    });

    it('ACC-004: el nombre de cada casilla dice el monto en pesos, sin «$» ni puntos de miles', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario) });
      await abrirTodos();
      const etiquetas = screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel);
      expect(etiquetas).toEqual([
        'Servicios públicos, Gasto · 5 de noviembre de 2026, 120000 pesos',
        'Comunicaciones, Gasto · 12 de noviembre de 2026, 60000 pesos',
        'Salario, Ingreso · 1 de diciembre de 2026, 1200000 pesos',
      ]);
      expect(screen.getByText('$120.000')).toBeOnTheScreen();
    });

    it('ACC-004 (bug 231): tres filas iguales salvo el monto se distinguen en la casilla y en «Más»', async () => {
      const otros = (id: string, centavos: string) =>
        pendiente({
          recurrente_id: id,
          fecha: '2026-11-05',
          tipo: 'gasto',
          categoria_id: 16,
          medio: 'efectivo',
          monto_habitual_centavos: centavos,
        });
      apiFalsa(respuestaJson, {
        pendientes: pendientes(otros('r-a', '5500000'), otros('r-b', '3000000'), otros('r-c', '1250050')),
      });
      await abrirTodos();
      // Cada fila es una unidad: la casilla, con un solo nombre que dice todo lo de la fila; «Más» va aparte.
      const casillas = screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel as string);
      expect(casillas).toEqual([
        'Otros gastos, Gasto · 5 de noviembre de 2026, 55000 pesos',
        'Otros gastos, Gasto · 5 de noviembre de 2026, 30000 pesos',
        'Otros gastos, Gasto · 5 de noviembre de 2026, 12500 pesos con 50 centavos',
      ]);
      const mas = screen.getAllByRole('button', { name: /^Más opciones de Otros gastos/ });
      expect(mas.map((b) => b.props.accessibilityLabel)).toEqual([
        'Más opciones de Otros gastos de 55000 pesos del 5 de noviembre de 2026',
        'Más opciones de Otros gastos de 30000 pesos del 5 de noviembre de 2026',
        'Más opciones de Otros gastos de 12500 pesos con 50 centavos del 5 de noviembre de 2026',
      ]);
      expect(screen.getAllByText('Otros gastos')).toHaveLength(3);
    });

    it('ACC-004 (bug 231): «Más» dice el monto cambiado de su fila', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario) });
      await abrirTodos();
      await cambiarMonto('Salario', '1.100.000');
      expect(mas('Salario').props.accessibilityLabel).toBe(
        'Más opciones de Salario de 1100000 pesos del 1 de diciembre de 2026',
      );
    });

    it('ACC-004: con «Cambiar el monto» la casilla dice el monto nuevo en pesos', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario) });
      await abrirTodos();
      await cambiarMonto('Salario', '1.250.000,50');
      expect(casilla('Salario').props.accessibilityLabel).toBe(
        'Salario, Ingreso · 1 de diciembre de 2026, Monto cambiado, 1250000 pesos con 50 centavos',
      );
    });

    it('desmarcar deja la fila en «Sigue por confirmar» y sale de la cuenta; volver a marcar la cuenta otra vez', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario) });
      await abrirTodos();
      await fireEvent.press(casilla('Servicios públicos'));
      expect(screen.getByText('2 de 3 marcados')).toBeOnTheScreen();
      expect(screen.getByText('Sigue por confirmar')).toBeOnTheScreen();
      expect(guardar('Guardar 2 movimientos')).toBeOnTheScreen();
      await fireEvent.press(casilla('Servicios públicos'));
      expect(screen.getByText('3 de 3 marcados')).toBeOnTheScreen();
      expect(screen.queryByText('Sigue por confirmar')).not.toBeOnTheScreen();
    });

    it('ACC-004 (bug 225): al desmarcar, TalkBack anuncia la cuenta «2 de 3 marcados»; al abrir no la anuncia', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario) });
      limpiarAnuncios();
      await abrirTodos();
      await new Promise((listo) => setTimeout(listo, 1100));
      expect(anunciados()).not.toContain('3 de 3 marcados');
      await fireEvent.press(casilla('Servicios públicos'));
      await esperarAnuncio('2 de 3 marcados');
    });

    it('«Cambiar el monto» → «Listo» muestra el monto nuevo y «Monto cambiado», sigue marcada y no guarda', async () => {
      const pedidos = apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario) });
      await abrirTodos();
      await elegir('Salario', 'Cambiar el monto');
      expect(await screen.findByRole('header', { name: '¿Cuánto llegó?' })).toBeOnTheScreen();
      expect(campo('Monto en pesos').props.value).toBe('1.200.000');
      await fireEvent.changeText(campo('Monto en pesos'), '1.100.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Listo' }));
      await waitFor(() => expect(quizasCampo('Monto en pesos')).not.toBeOnTheScreen());
      expect(screen.getByText('$1.100.000')).toBeOnTheScreen();
      expect(screen.getByText('Monto cambiado')).toBeOnTheScreen();
      expect(casilla('Salario', { checked: true })).toBeOnTheScreen();
      expect(publicaciones(pedidos)).toHaveLength(0);
    });

    it('un monto igual al habitual no cuenta como cambiado', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario) });
      await abrirTodos();
      await cambiarMonto('Salario', '1.100.000');
      await cambiarMonto('Salario', '1.200.000');
      expect(screen.queryByText('Monto cambiado')).not.toBeOnTheScreen();
      expect(screen.getByText('$1.200.000')).toBeOnTheScreen();
    });

    it('un monto que no se lee da el error de E14-PPN 3.1 y la hoja sigue abierta', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular) });
      await abrirTodos();
      await elegir('Servicios públicos', 'Cambiar el monto');
      await fireEvent.changeText(await buscarCampo('Monto en pesos'), '0');
      await fireEvent.press(screen.getByRole('button', { name: 'Listo' }));
      expect(await screen.findByText('El monto debe ser mayor que $0.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Ahora no' }));
      await waitFor(() => expect(quizasCampo('Monto en pesos')).not.toBeOnTheScreen());
      expect(screen.queryByText('Monto cambiado')).not.toBeOnTheScreen();
    });

    it('«No pasó» no pide confirmación: la fila lo dice, su casilla se deshabilita y no cuenta en «Guardar»', async () => {
      const pedidos = apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario) });
      await abrirTodos();
      await elegir('Comunicaciones', 'No pasó');
      expect(screen.getByText('No pasó')).toBeOnTheScreen();
      expect(casilla('Comunicaciones', { disabled: true })).toBeOnTheScreen();
      expect(screen.getByText('2 de 3 marcados')).toBeOnTheScreen();
      expect(guardar('Guardar 2 movimientos')).toBeOnTheScreen();
      expect(publicaciones(pedidos)).toHaveLength(0);
    });

    it('«Más» en una fila «No pasó» solo ofrece «Volver a incluirla», que la deja marcada', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario) });
      await abrirTodos();
      await elegir('Comunicaciones', 'No pasó');
      await fireEvent.press(mas('Comunicaciones'));
      expect(await screen.findByRole('button', { name: 'Volver a incluirla' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Cambiar el monto' })).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Volver a incluirla' }));
      await waitFor(() => expect(casilla('Comunicaciones', { checked: true, disabled: false })).toBeOnTheScreen());
      expect(screen.getByText('3 de 3 marcados')).toBeOnTheScreen();
    });

    it('«Cerrar» cierra la hoja «Más» sin cambiar nada', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular) });
      await abrirTodos();
      await fireEvent.press(mas('Servicios públicos'));
      await fireEvent.press(await screen.findByRole('button', { name: 'Cerrar' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Cambiar el monto' })).not.toBeOnTheScreen());
      expect(screen.getByText('2 de 2 marcados')).toBeOnTheScreen();
    });

    it('solo «No pasó»: el botón dice «Guardar»; sin nada marcado, «Guardar 0 movimientos» queda deshabilitado', async () => {
      const pedidos = apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular) });
      await abrirTodos();
      await fireEvent.press(casilla('Servicios públicos'));
      await fireEvent.press(casilla('Comunicaciones'));
      expect(screen.getByText('0 de 2 marcados')).toBeOnTheScreen();
      expect(guardar('Guardar 0 movimientos', { disabled: true })).toBeOnTheScreen();
      await fireEvent.press(guardar('Guardar 0 movimientos', { disabled: true }));
      expect(publicaciones(pedidos)).toHaveLength(0);
      await elegir('Servicios públicos', 'No pasó');
      expect(screen.getByText('0 de 2 marcados')).toBeOnTheScreen();
      expect(guardar('Guardar', { disabled: false })).toBeOnTheScreen();
    });
  });

  describe('«Guardar»', () => {
    it('manda solo lo marcado y lo «No pasó», con el monto cambiado, y dice el aviso con las dos cuentas', async () => {
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: pendientes(energia, celular, salario, arriendo),
        publicar: () => resultado(2, 1),
      });
      await abrirTodos();
      await fireEvent.press(casilla('Arriendo')); // desmarcada: sigue pendiente
      await elegir('Comunicaciones', 'No pasó');
      await cambiarMonto('Salario', '1.100.000');
      expect(guardar('Guardar 2 movimientos')).toBeOnTheScreen();
      await fireEvent.press(guardar('Guardar 2 movimientos'));
      expect(await screen.findByText('Listo, guardamos 2 movimientos y dejamos de contar 1 fecha.')).toBeOnTheScreen();
      expect(publicaciones(pedidos)).toEqual([
        {
          metodo: 'POST',
          ruta: '/api/v1/repeticiones/decisiones',
          cuerpo:
            '{"decisiones":[{"recurrente_id":"r-energia","fecha":"2026-11-05"},{"recurrente_id":"r-celular","fecha":"2026-11-12","omitida":true},{"recurrente_id":"r-salario","fecha":"2026-12-01","monto_centavos":110000000}]}',
        },
      ]);
    });

    it('con 1 movimiento y 2 fechas dice «Listo, guardamos 1 movimiento y dejamos de contar 2 fechas.»', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario), publicar: () => resultado(1, 2) });
      await abrirTodos();
      await elegir('Comunicaciones', 'No pasó');
      await elegir('Servicios públicos', 'No pasó');
      await fireEvent.press(guardar('Guardar 1 movimiento'));
      expect(await screen.findByText('Listo, guardamos 1 movimiento y dejamos de contar 2 fechas.')).toBeOnTheScreen();
    });

    it('con 2 movimientos y 1 fecha dice «Listo, guardamos 2 movimientos y dejamos de contar 1 fecha.»', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular, salario), publicar: () => resultado(2, 1) });
      await abrirTodos();
      await elegir('Comunicaciones', 'No pasó');
      await fireEvent.press(guardar('Guardar 2 movimientos'));
      expect(await screen.findByText('Listo, guardamos 2 movimientos y dejamos de contar 1 fecha.')).toBeOnTheScreen();
      // ACC-004 (bug 225): de vuelta en PN-01, TalkBack lo anuncia.
      await esperarAnuncio('Listo, guardamos 2 movimientos y dejamos de contar 1 fecha.');
    });

    it('sin «No pasó» y solo con «No pasó» dicen cada aviso de E14', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular), publicar: () => resultado(2, 0) });
      await abrirTodos();
      await fireEvent.press(guardar('Guardar 2 movimientos'));
      expect(await screen.findByText('Listo, guardamos 2 movimientos.')).toBeOnTheScreen();
    });

    it('solo «No pasó» manda esas fechas como omitidas y dice «Listo, dejamos de contar 1 fecha.»', async () => {
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: pendientes(energia, celular),
        publicar: () => resultado(0, 1),
      });
      await abrirTodos();
      await fireEvent.press(casilla('Servicios públicos'));
      await elegir('Comunicaciones', 'No pasó');
      await fireEvent.press(guardar('Guardar'));
      expect(await screen.findByText('Listo, dejamos de contar 1 fecha.')).toBeOnTheScreen();
      expect(publicaciones(pedidos)[0]?.cuerpo).toBe(
        '{"decisiones":[{"recurrente_id":"r-celular","fecha":"2026-11-12","omitida":true}]}',
      );
    });

    it('al guardar vuelve a PN-01, que pide la lista otra vez, y el Atrás ya no vuelve a «Confirmar todos»', async () => {
      let guardado = false;
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: () => pendientes(...(guardado ? [] : [energia, celular])),
        publicar: () => {
          guardado = true;
          return resultado(2, 0);
        },
      });
      await abrirTodos();
      await fireEvent.press(guardar('Guardar 2 movimientos'));
      expect(await screen.findByText('Listo, guardamos 2 movimientos.')).toBeOnTheScreen();
      await waitFor(() => expect(screen.queryByRole('header', { name: 'Por confirmar' })).not.toBeOnTheScreen());
      expect(screen.getByRole('button', { name: 'Registrar' })).toBeOnTheScreen();
      expect(pedidos.filter((p) => p.ruta === '/api/v1/repeticiones/pendientes')).toHaveLength(2);
      expect(await atras()).toBe(true);
      expect(await screen.findByText(PN71)).toBeOnTheScreen();
    });

    it('mientras guarda no se toca dos veces', async () => {
      let soltar: (r: Response) => void = () => undefined;
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: pendientes(energia, celular),
        publicar: () => new Promise<Response>((resolver) => (soltar = resolver)),
      });
      await abrirTodos();
      await fireEvent.press(guardar('Guardar 2 movimientos'));
      await fireEvent.press(guardar('Guardar 2 movimientos'));
      soltar(resultado(2, 0));
      await screen.findByText('Listo, guardamos 2 movimientos.');
      expect(publicaciones(pedidos)).toHaveLength(1);
    });

    it('un error no guarda ninguno, lo dice y deja la lista y lo marcado como estaban', async () => {
      apiFalsa(respuestaJson, {
        pendientes: pendientes(energia, celular, salario),
        publicar: () => respuestaJson(500, { error: 'interno' }),
      });
      await abrirTodos();
      await fireEvent.press(casilla('Servicios públicos'));
      await elegir('Comunicaciones', 'No pasó');
      await fireEvent.press(guardar('Guardar 1 movimiento'));
      expect(await screen.findByText('No pudimos guardar tus movimientos.')).toBeOnTheScreen();
      expect(screen.getByText('No se guardó ninguno. Intenta de nuevo.')).toBeOnTheScreen();
      expect(screen.getByText('1 de 3 marcados')).toBeOnTheScreen();
      expect(casilla('Servicios públicos', { checked: false })).toBeOnTheScreen();
      expect(casilla('Comunicaciones', { disabled: true })).toBeOnTheScreen();
      expect(guardar('Guardar 1 movimiento', { disabled: false })).toBeOnTheScreen();
    });

    it('sin conexión dice el aviso de siempre y conserva lo marcado', async () => {
      apiFalsa(respuestaJson, {
        pendientes: pendientes(energia, celular),
        publicar: () => Promise.reject(new Error('sin red')),
      });
      await abrirTodos();
      await fireEvent.press(casilla('Servicios públicos'));
      await fireEvent.press(guardar('Guardar 1 movimiento'));
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
      expect(screen.getByText('1 de 2 marcados')).toBeOnTheScreen();
    });

    it('un 409 conflicto_concurrente dice el error y vuelve a pedir lo pendiente, sin perder lo que sigue pendiente', async () => {
      let ya = false;
      const pedidos = apiFalsa(respuestaJson, {
        pendientes: () => pendientes(...(ya ? [celular, salario] : [energia, celular, salario])),
        publicar: () => {
          ya = true;
          return respuestaJson(409, { error: 'conflicto_concurrente' });
        },
      });
      await abrirTodos();
      await fireEvent.press(casilla('Comunicaciones'));
      await fireEvent.press(guardar('Guardar 2 movimientos'));
      expect(await screen.findByText('No pudimos guardar tus movimientos.')).toBeOnTheScreen();
      await waitFor(() =>
        expect(screen.queryByRole('checkbox', { name: /^Servicios públicos/ })).not.toBeOnTheScreen(),
      );
      expect(pedidos.filter((p) => p.ruta === '/api/v1/repeticiones/pendientes')).toHaveLength(2);
      expect(screen.getByText('1 de 2 marcados')).toBeOnTheScreen();
      expect(casilla('Comunicaciones', { checked: false })).toBeOnTheScreen();
    });

    it('un 409 con la lista de nuevo sin fallar la pide aunque falle la segunda lectura', async () => {
      let lecturas = 0;
      apiFalsa(respuestaJson, {
        pendientes: () => {
          if (++lecturas > 1) throw new Error('sin red');
          return pendientes(energia, celular);
        },
        publicar: () => respuestaJson(409, { error: 'conflicto_concurrente' }),
      });
      await abrirTodos();
      await fireEvent.press(guardar('Guardar 2 movimientos'));
      expect(await screen.findByText('No pudimos guardar tus movimientos.')).toBeOnTheScreen();
      expect(screen.getByText('2 de 2 marcados')).toBeOnTheScreen();
    });

    it('un 401 lleva a PN-60', async () => {
      apiFalsa(respuestaJson, {
        pendientes: pendientes(energia, celular),
        publicar: () => respuestaJson(401, { error: 'sin_sesion' }),
      });
      await abrirTodos();
      await fireEvent.press(guardar('Guardar 2 movimientos'));
      expect(await screen.findByText('Tu sesión se cerró', { exact: false })).toBeOnTheScreen();
    });
  });

  it('el Atrás del sistema vuelve a PN-01 sin guardar nada y descarta lo cambiado', async () => {
    const pedidos = apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular), lista: listado() });
    await abrirTodos();
    await fireEvent.press(casilla('Servicios públicos'));
    await elegir('Comunicaciones', 'No pasó');
    expect(await atras()).toBe(true);
    await waitFor(() => expect(screen.queryByText(/de 2 marcados/)).not.toBeOnTheScreen());
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeOnTheScreen();
    expect(publicaciones(pedidos)).toHaveLength(0);
    // Al abrirla otra vez todo viene marcado.
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar todos' }));
    expect(await screen.findByText('2 de 2 marcados')).toBeOnTheScreen();
    expect(
      within(screen.getByRole('button', { name: 'Guardar 2 movimientos' })).getByText('Guardar 2 movimientos'),
    ).toBeOnTheScreen();
  });

  describe('ACC-004 (bug 226)', () => {
    beforeEach(() => limpiarAnuncios());

    it('el error de la hoja del monto lo lee el campo al recibir el foco; ni la hoja ni la pantalla lo anuncian', async () => {
      apiFalsa(respuestaJson, { pendientes: pendientes(energia, celular) });
      await abrirTodos();
      await elegir('Servicios públicos', 'Cambiar el monto');
      await fireEvent.changeText(await buscarCampo('Monto en pesos'), '0');
      await fireEvent.press(screen.getByRole('button', { name: 'Listo' }));
      await screen.findByText('El monto debe ser mayor que $0.');
      expect(focosDeTalkBack().map(nombreDe)).toEqual(['Monto en pesos, El monto debe ser mayor que $0.']);
      await esperarSinAnuncios();
    });
  });
});
