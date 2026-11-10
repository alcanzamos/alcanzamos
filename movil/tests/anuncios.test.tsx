import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text, type TextInputInstance } from 'react-native';
import { anunciar, ESPERA_DEL_ANUNCIO_MS, useAvisarErrores } from '../src/anuncios';
import { Boton } from '../src/componentes/Boton';
import { CampoDeTexto } from '../src/componentes/CampoDeTexto';
import { HojaInferior } from '../src/componentes/HojaInferior';
import { MensajeDeEstado } from '../src/componentes/MensajeDeEstado';
import { Pantalla } from '../src/componentes/Pantalla';
import { RegionDeAnuncios } from '../src/componentes/RegionDeAnuncios';
import { avisos } from '../src/textos';
import { anunciados, focosDeTalkBack, regionesVivas, textoDe, textosDe } from './ayudas/anuncios';

const adelantar = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

const anunciarAhora = (texto: string) =>
  act(async () => {
    anunciar(texto);
    jest.advanceTimersByTime(ESPERA_DEL_ANUNCIO_MS);
  });

describe('ACC-004: los avisos de estado por una región viva que React Native no aplana (bug 225)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('la región es una vista nativa (collapsable={false}) con la región viva «polite», montada desde el principio y vacía', async () => {
    await render(<RegionDeAnuncios />);
    const [region, ...otras] = regionesVivas();
    expect(otras).toEqual([]);
    expect(region!.type).toBe('View');
    expect(region!.props.collapsable).toBe(false);
    expect(region!.props.accessibilityLiveRegion).toBe('polite');
    expect(textoDe(region!)).toBe('');
  });

  it('queda en el árbol de accesibilidad sin verse: 1 × 1 dp, recortada y con el texto transparente, nunca de tamaño cero, oculta ni sin opacidad', async () => {
    await render(<RegionDeAnuncios />);
    const region = regionesVivas()[0]!;
    expect(region).toHaveStyle({ position: 'absolute', width: 1, height: 1, overflow: 'hidden' });
    expect(region).not.toHaveStyle({ display: 'none' });
    expect(region).not.toHaveStyle({ opacity: 0 });
    expect(region.props.importantForAccessibility).toBeUndefined();
    expect(region.props.accessibilityElementsHidden).toBeUndefined();
    expect(textosDe(region)[0]).toHaveStyle({ color: 'transparent' });
  });

  it('anunciar cambia el texto de la región pasada la espera', async () => {
    await render(<RegionDeAnuncios />);
    await act(async () => {
      anunciar('Listo, guardamos los cambios.');
    });
    await adelantar(ESPERA_DEL_ANUNCIO_MS - 1);
    expect(textoDe(regionesVivas()[0]!)).toBe('');
    await adelantar(1);
    expect(textoDe(regionesVivas()[0]!)).toBe('Listo, guardamos los cambios.');
  });

  it('el mismo texto otra vez es un texto nuevo en la región (otra vista), para que TalkBack lo vuelva a decir', async () => {
    await render(<RegionDeAnuncios />);
    await anunciarAhora('Listo, guardamos los cambios.');
    const primero = textosDe(regionesVivas()[0]!)[0];
    await screen.rerender(<RegionDeAnuncios />);
    expect(textosDe(regionesVivas()[0]!)[0]).toBe(primero);
    await anunciarAhora('Listo, guardamos los cambios.');
    const segundo = textosDe(regionesVivas()[0]!)[0];
    expect(segundo).not.toBe(primero);
    expect(textoDe(regionesVivas()[0]!)).toBe('Listo, guardamos los cambios.');
  });

  it('cancelado antes de la espera, la región no cambia', async () => {
    await render(<RegionDeAnuncios />);
    await act(async () => {
      anunciar('No pudimos guardar.')();
    });
    await adelantar(ESPERA_DEL_ANUNCIO_MS * 2);
    expect(textoDe(regionesVivas()[0]!)).toBe('');
  });

  it('lo dice la última región montada (la pantalla o la hoja de arriba); al irse, vuelve a la anterior', async () => {
    const Dos = ({ hoja }: { hoja: boolean }) => (
      <>
        <RegionDeAnuncios />
        {hoja && <RegionDeAnuncios />}
      </>
    );
    await render(<Dos hoja />);
    await anunciarAhora('En la hoja.');
    expect(regionesVivas().map(textoDe)).toEqual(['', 'En la hoja.']);
    await screen.rerender(<Dos hoja={false} />);
    await anunciarAhora('En la pantalla.');
    expect(regionesVivas().map(textoDe)).toEqual(['En la pantalla.']);
  });

  it('sin ninguna región montada no pasa nada', async () => {
    await expect(anunciarAhora('Nadie lo oye.')).resolves.toBeUndefined();
  });

  it('Pantalla lleva su región fuera de lo que se desplaza, después del contenido', async () => {
    await render(
      <Pantalla titulo="Inicia sesión">
        <Text>Contenido</Text>
      </Pantalla>,
    );
    const [region, ...otras] = regionesVivas();
    expect(otras).toEqual([]);
    expect(region!.props.collapsable).toBe(false);
    expect(region!.parent!.type).toBe('');
    const raiz = screen.container.children as { type: string }[];
    expect(raiz.map((hijo) => hijo.type)).toEqual(['RCTScrollView', 'View']);
  });

  it('HojaInferior lleva su región dentro de la hoja (la ventana modal que TalkBack recorre)', async () => {
    await render(
      <HojaInferior visible alCerrar={jest.fn()} titulo="Cambiar el monto">
        <Text>Contenido</Text>
      </HojaInferior>,
    );
    const [region, ...otras] = regionesVivas();
    expect(otras).toEqual([]);
    expect(region!.props.collapsable).toBe(false);
    let ancestro = region!.parent;
    while (ancestro && !ancestro.props.accessibilityViewIsModal) ancestro = ancestro.parent;
    expect(ancestro).not.toBeNull();
  });

  it('el mensaje de estado de la llegada lo dice la región de la pantalla; el Aviso no lleva región propia', async () => {
    await render(<Pantalla titulo="Inicia sesión" estado={avisos.sesionCerrada} />);
    await adelantar(ESPERA_DEL_ANUNCIO_MS);
    const [region, ...otras] = regionesVivas();
    expect(otras).toEqual([]);
    expect(textoDe(region!)).toBe('Tu sesión se cerró. Entra de nuevo.');
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBeUndefined();
  });

  it('cada llegada se vuelve a decir, aunque repita el texto', async () => {
    const aviso = { tipo: 'logro' as const, titulo: 'Listo, guardamos los cambios.' };
    const Llegada = ({ estado }: { estado: typeof aviso }) => (
      <>
        <MensajeDeEstado aviso={estado} />
        <RegionDeAnuncios />
      </>
    );
    await render(<Llegada estado={aviso} />);
    await adelantar(ESPERA_DEL_ANUNCIO_MS);
    const primero = textosDe(regionesVivas()[0]!)[0];
    await screen.rerender(<Llegada estado={{ ...aviso }} />);
    await adelantar(ESPERA_DEL_ANUNCIO_MS);
    expect(textosDe(regionesVivas()[0]!)[0]).not.toBe(primero);
    expect(textoDe(regionesVivas()[0]!)).toBe('Listo, guardamos los cambios.');
  });
});

type Errores = { correo?: string; contrasena?: string };

// Un formulario mínimo: «Guardar» muestra los errores y llama a `avisarErrores`, como las pantallas.
function Formulario({ errores, conCampo = true }: { errores: Errores; conCampo?: boolean }) {
  const avisarErrores = useAvisarErrores();
  const correo = useRef<TextInputInstance>(null);
  const contrasena = useRef<TextInputInstance>(null);
  const [mostrados, setMostrados] = useState<Errores>({});
  return (
    <Pantalla>
      <CampoDeTexto ref={correo} etiqueta="Correo electrónico" valor="" alCambiar={jest.fn()} error={mostrados.correo} />
      <CampoDeTexto ref={contrasena} etiqueta="Contraseña" valor="" alCambiar={jest.fn()} error={mostrados.contrasena} />
      <Boton
        alTocar={() => {
          setMostrados(errores);
          avisarErrores([
            { error: errores.correo, campo: conCampo ? correo : undefined },
            { error: errores.contrasena, campo: contrasena },
          ]);
        }}
      >
        Guardar
      </Boton>
    </Pantalla>
  );
}

describe('ACC-004: los errores al guardar se leen en el campo, no en un anuncio aparte (bug 226)', () => {
  const ambos = { correo: 'Falta el correo electrónico.', contrasena: 'Falta la contraseña.' };
  const guardar = () => fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('el foco de TalkBack va al primer campo con error cuando ya dice su error: lo lee el campo («Correo electrónico, Falta el correo electrónico.»)', async () => {
    const placeholders: unknown[] = [];
    jest
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mockImplementationOnce((vista) => placeholders.push((vista as unknown as { props: Record<string, unknown> }).props.placeholder));
    await render(<Formulario errores={ambos} />);
    await guardar();
    expect(placeholders).toEqual(['Correo electrónico, Falta el correo electrónico.']);
    expect(focosDeTalkBack()).toHaveLength(1);
    expect(jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls[0]![1]).toBe('focus');
  });

  it('no anuncia los errores aparte: la región de la pantalla no los dice', async () => {
    await render(<Formulario errores={ambos} />);
    await guardar();
    await adelantar(ESPERA_DEL_ANUNCIO_MS * 3);
    expect(anunciados()).toEqual([]);
  });

  it('«Guardar» otra vez con los mismos errores vuelve a llevar el foco al campo, para que TalkBack lo lea de nuevo', async () => {
    await render(<Formulario errores={ambos} />);
    await guardar();
    await guardar();
    const focos = focosDeTalkBack();
    expect(focos).toHaveLength(2);
    expect(focos[1]).toBe(focos[0]);
    expect(focos[1]!.props.placeholder).toBe('Correo electrónico, Falta el correo electrónico.');
  });

  it('sin errores no mueve el foco', async () => {
    await render(<Formulario errores={{}} />);
    await guardar();
    expect(focosDeTalkBack()).toEqual([]);
  });

  it('el foco va al primero con error aunque no sea el primero de la pantalla', async () => {
    await render(<Formulario errores={{ contrasena: 'Falta la contraseña.' }} />);
    await guardar();
    expect(focosDeTalkBack().map((f) => f.props.placeholder)).toEqual(['Contraseña, Falta la contraseña.']);
  });

  it('un primer error sin campo no mueve el foco', async () => {
    await render(<Formulario errores={ambos} conCampo={false} />);
    await guardar();
    expect(focosDeTalkBack()).toEqual([]);
  });
});
