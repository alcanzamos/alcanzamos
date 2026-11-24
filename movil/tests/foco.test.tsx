import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text, type HostInstance } from 'react-native';
import { useLlevarFoco } from '../src/anuncios';
import { Boton } from '../src/componentes/Boton';
import { HojaInferior } from '../src/componentes/HojaInferior';
import { HojaQueSale } from '../src/componentes/HojaQueSale';
import { Pantalla } from '../src/componentes/Pantalla';
import { focosDeTalkBack, limpiarAnuncios, nombreDe } from './ayudas/anuncios';
import { animacionesAMano, terminarAnimaciones } from './ayudas/animacion';

// Bugs 303 y 304 (ACC-004, I07): el foco de TalkBack al cerrar una hoja. Se pide cuando termina la animación de cierre de
// la hoja y la pantalla ya se dibujó de nuevo, sin InteractionManager ni tiempos fijos: lo que se espera son eventos (el
// final de la animación y el cuadro siguiente al dibujo). Con relojes falsos, la animación y el cuadro avanzan cuando la
// prueba los adelanta.
const CUADRO_MS = 16;
const adelantar = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

/** Una pantalla con un botón que abre la hoja y a donde vuelve el foco al cerrarla. */
function Escena({ conSalida = false }: { conSalida?: boolean }) {
  const [abierta, setAbierta] = useState(true);
  const abridor = useRef<HostInstance>(null);
  const llevarFoco = useLlevarFoco();
  const cerrar = () => {
    setAbierta(false);
    llevarFoco(abridor);
  };
  const hoja = (
    <HojaInferior visible={abierta || conSalida} titulo="Una hoja" alCerrar={cerrar}>
      <Text>Contenido de la hoja</Text>
    </HojaInferior>
  );
  return (
    <>
      <Pantalla>
        <Boton ref={abridor} nombre="Abrir la hoja" alTocar={() => setAbierta(true)}>
          Abrir
        </Boton>
        <Text>Fondo de la pantalla</Text>
      </Pantalla>
      {conSalida ? <HojaQueSale>{abierta && hoja}</HojaQueSale> : hoja}
    </>
  );
}

describe('el foco de TalkBack espera a que la hoja termine de cerrarse (bug 303, E14-SDD v2.5, 5.12)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    animacionesAMano();
    limpiarAnuncios();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const cerrarLaHoja = () => fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));

  it.each([
    ['con `visible`', false],
    ['una hoja que se deja de dibujar al cerrar (HojaQueSale)', true],
  ])('%s: sigue en pantalla mientras sale, el foco no se pide hasta que termina y llega al botón que la abrió', async (_, conSalida) => {
    await render(<Escena conSalida={conSalida} />);
    await terminarAnimaciones();
    await cerrarLaHoja();
    // Mientras la animación de cierre corre, la hoja sigue y el foco no se mueve, pase lo que pase en los cuadros.
    await adelantar(CUADRO_MS * 60);
    expect(screen.getByText('Contenido de la hoja')).toBeOnTheScreen();
    expect(focosDeTalkBack()).toEqual([]);
    // Termina la animación: la hoja se va y el foco se pide en el cuadro siguiente, ya con la pantalla dibujada.
    await terminarAnimaciones();
    expect(screen.queryByText('Contenido de la hoja')).not.toBeOnTheScreen();
    expect(focosDeTalkBack()).toEqual([]);
    await adelantar(CUADRO_MS);
    expect(focosDeTalkBack().map(nombreDe)).toEqual(['Abrir la hoja']);
  });

  it('sin ninguna hoja que cierre, el foco se pide en el cuadro siguiente al dibujo, no antes ni con una espera', async () => {
    function SinHoja() {
      const destino = useRef<HostInstance>(null);
      const llevarFoco = useLlevarFoco();
      return (
        <>
          <Boton ref={destino} nombre="Destino" alTocar={() => undefined}>
            Destino
          </Boton>
          <Boton alTocar={() => llevarFoco(destino)}>Pedir</Boton>
        </>
      );
    }
    await render(<SinHoja />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pedir' }));
    expect(focosDeTalkBack()).toEqual([]);
    await adelantar(CUADRO_MS);
    expect(focosDeTalkBack().map(nombreDe)).toEqual(['Destino']);
    await adelantar(60_000);
    expect(focosDeTalkBack()).toHaveLength(1);
  });

  it('si la pantalla se va antes de que termine la hoja, el foco no se pide', async () => {
    const { unmount } = await render(<Escena />);
    await terminarAnimaciones();
    await cerrarLaHoja();
    await unmount();
    await terminarAnimaciones();
    await adelantar(CUADRO_MS * 2);
    expect(focosDeTalkBack()).toEqual([]);
  });

  it('un pedido nuevo reemplaza al anterior: llega un solo foco, al último destino', async () => {
    function DosPedidos() {
      const a = useRef<HostInstance>(null);
      const b = useRef<HostInstance>(null);
      const llevarFoco = useLlevarFoco();
      return (
        <>
          <Boton ref={a} nombre="A" alTocar={() => undefined}>
            A
          </Boton>
          <Boton ref={b} nombre="B" alTocar={() => undefined}>
            B
          </Boton>
          <Boton
            alTocar={() => {
              llevarFoco(a);
              llevarFoco(b);
            }}
          >
            Pedir
          </Boton>
        </>
      );
    }
    await render(<DosPedidos />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pedir' }));
    await adelantar(CUADRO_MS);
    expect(focosDeTalkBack().map(nombreDe)).toEqual(['B']);
  });
});

describe('mientras una hoja está abierta, TalkBack no lee lo de atrás (bug 304, 67.6 y 67.7)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    animacionesAMano();
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
  });
  afterEach(() => {
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(false);
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const fondo = () => screen.container.queryAll((v) => v.props.keyboardShouldPersistTaps === 'handled')[0]!;

  it('el contenido de la pantalla pasa a no-hide-descendants con la hoja abierta y vuelve a `auto` cuando la hoja termina de salir', async () => {
    await render(<Escena />);
    await terminarAnimaciones();
    await adelantar(0);
    expect(fondo().props.importantForAccessibility).toBe('no-hide-descendants');
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    // Mientras la hoja sale, su ventana sigue ahí: lo de atrás sigue oculto.
    await adelantar(CUADRO_MS * 60);
    expect(fondo().props.importantForAccessibility).toBe('no-hide-descendants');
    await terminarAnimaciones();
    expect(fondo().props.importantForAccessibility).toBe('auto');
  });

  it('no oculta la hoja ni su región viva: no están dentro de lo oculto', async () => {
    await render(<Escena />);
    await terminarAnimaciones();
    await adelantar(0);
    const ocultos = screen.container.queryAll((v) => v.props.importantForAccessibility === 'no-hide-descendants');
    expect(ocultos.length).toBeGreaterThan(0);
    const hoja = screen.getByRole('header', { name: 'Una hoja' });
    // Las dos regiones vivas (la de la pantalla, fuera de lo que se desplaza, y la de la hoja) quedan fuera de lo oculto.
    const regiones = screen.container.queryAll((v) => v.props.accessibilityLiveRegion === 'polite');
    expect(regiones).toHaveLength(2);
    for (const oculto of ocultos) {
      expect(oculto.queryAll((v) => v === hoja || regiones.includes(v))).toEqual([]);
    }
  });

  it('sin TalkBack no se oculta nada: no hay a quién ocultárselo', async () => {
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(false);
    await render(<Escena />);
    await terminarAnimaciones();
    await adelantar(0);
    expect(fondo().props.importantForAccessibility).toBe('auto');
  });

  it('sin ninguna hoja, la pantalla no oculta nada', async () => {
    await render(
      <Pantalla>
        <Text>Contenido</Text>
      </Pantalla>,
    );
    expect(fondo().props.importantForAccessibility).toBe('auto');
  });
});
