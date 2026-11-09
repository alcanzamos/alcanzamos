import { createRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, type TextInputInstance } from 'react-native';
import { CampoDeMonto } from '../../src/componentes/CampoDeMonto';
import { leerMonto } from '../../src/dinero';
import { campo } from '../ayudas/campos';

// El campo de monto de Registrar, «Corregir» y «Cambiar el monto» (ACC-004, opción A del dueño, L6): TalkBack leía
// «$15.000» como «15 dólares cero cero cero» y «15000» como «quince mil».
function ConEstado({ inicial, error, avisar }: { inicial: string; error?: string; avisar?: (valor: string) => void }) {
  const [valor, setValor] = useState(inicial);
  return (
    <CampoDeMonto
      valor={valor}
      alCambiar={(nuevo) => {
        setValor(nuevo);
        avisar?.(nuevo);
      }}
      error={error}
    />
  );
}

const monto = () => campo('Monto');

/** El que escucha los cambios del lector de pantalla (`screenReaderChanged`). */
function escuchaDelLector() {
  const llamada = jest
    .mocked(AccessibilityInfo.addEventListener)
    .mock.calls.findLast(([evento]) => evento === 'screenReaderChanged');
  return llamada![1] as (activo: boolean) => void;
}

describe('CampoDeMonto (E14-PPN 3.1, ACC-004)', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('sin lector de pantalla', () => {
    it('fuera de la edición muestra el monto con puntos de miles y sin «$»; el «$» es un prefijo fijo fuera del campo', async () => {
      await render(<ConEstado inicial="$15.000" />);
      expect(monto().props.value).toBe('15.000');
      expect(screen.getByText('$')).toBeOnTheScreen();
    });

    it('el prefijo «$» no lo lee TalkBack', async () => {
      await render(<ConEstado inicial="$15.000" />);
      expect(screen.getByText('$').props.importantForAccessibility).toBe('no');
      expect(monto().props.value).not.toContain('$');
    });

    it('mientras se edita muestra el número sin «$» ni puntos («15000»); al salir vuelve a «15.000»', async () => {
      await render(<ConEstado inicial="$15.000" />);
      await fireEvent(monto(), 'focus');
      expect(monto().props.value).toBe('15000');
      await fireEvent(monto(), 'blur');
      expect(monto().props.value).toBe('15.000');
    });

    it('con decimales los muestra con coma: «15000,50» al editar y «15.000,50» al salir', async () => {
      await render(<ConEstado inicial="$15.000,50" />);
      await fireEvent(monto(), 'focus');
      expect(monto().props.value).toBe('15000,50');
      await fireEvent.changeText(monto(), '15000,5');
      expect(monto().props.value).toBe('15000,5');
      await fireEvent(monto(), 'blur');
      expect(monto().props.value).toBe('15.000,50');
    });

    it('lo que se escribe se muestra tal cual mientras se edita, también con puntos', async () => {
      await render(<ConEstado inicial="" />);
      await fireEvent(monto(), 'focus');
      await fireEvent.changeText(monto(), '45.000');
      expect(monto().props.value).toBe('45.000');
      await fireEvent(monto(), 'blur');
      expect(monto().props.value).toBe('45.000');
    });

    it('un texto que no se lee («12.5») queda como se escribió al salir', async () => {
      await render(<ConEstado inicial="" />);
      await fireEvent(monto(), 'focus');
      await fireEvent.changeText(monto(), '12.5');
      await fireEvent(monto(), 'blur');
      expect(monto().props.value).toBe('12.5');
    });

    it('el monto que se guarda no cambia: las dos formas son los mismos centavos', async () => {
      const avisar = jest.fn();
      await render(<ConEstado inicial="$123.456,78" avisar={avisar} />);
      await fireEvent(monto(), 'focus');
      await fireEvent(monto(), 'blur');
      for (const [valor] of avisar.mock.calls) expect(leerMonto(valor)).toEqual({ ok: true, centavos: 12345678n });
      expect(leerMonto(monto().props.value)).toEqual({ ok: true, centavos: 12345678n });
    });

    it('vacío no escribe nada al entrar', async () => {
      const avisar = jest.fn();
      await render(<ConEstado inicial="" avisar={avisar} />);
      await fireEvent(monto(), 'focus');
      expect(avisar).not.toHaveBeenCalled();
      expect(monto().props.value).toBe('');
    });
  });

  describe('con el lector de pantalla activo', () => {
    it('muestra el número sin puntos también fuera de la edición: el foco de TalkBack no es el de edición', async () => {
      jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValueOnce(true);
      await render(<ConEstado inicial="$15.000" />);
      expect(await screen.findByDisplayValue('15000')).toBe(monto());
      await fireEvent(monto(), 'focus');
      expect(monto().props.value).toBe('15000');
      await fireEvent(monto(), 'blur');
      expect(monto().props.value).toBe('15000');
      expect(screen.getByText('$').props.importantForAccessibility).toBe('no');
    });

    it('sigue al lector: al encenderlo el campo pasa a «15000» y al apagarlo vuelve a «15.000»', async () => {
      await render(<ConEstado inicial="$15.000" />);
      expect(monto().props.value).toBe('15.000');
      await act(async () => escuchaDelLector()(true));
      expect(monto().props.value).toBe('15000');
      await act(async () => escuchaDelLector()(false));
      expect(monto().props.value).toBe('15.000');
    });

    it('deja de escuchar al lector cuando el campo se va', async () => {
      await render(<ConEstado inicial="$15.000" />);
      const suscripcion = jest
        .mocked(AccessibilityInfo.addEventListener)
        .mock.results.findLast((_r, i) => jest.mocked(AccessibilityInfo.addEventListener).mock.calls[i]![0] === 'screenReaderChanged')!
        .value as { remove: jest.Mock };
      await screen.unmount();
      expect(suscripcion.remove).toHaveBeenCalledTimes(1);
    });
  });

  it('se nombra con su etiqueta, y con el error si lo hay (ACC-004, bugs 226 y 227)', async () => {
    await render(<ConEstado inicial="" />);
    expect(screen.getByPlaceholderText('Monto')).toBeOnTheScreen();
    await screen.rerender(<ConEstado inicial="" error="Falta el monto." />);
    expect(screen.getByPlaceholderText('Monto, Falta el monto.')).toBeOnTheScreen();
  });

  it('es un campo de cifras con el teclado decimal y deja la referencia para llevarle el foco', async () => {
    const ref = createRef<TextInputInstance>();
    await render(<CampoDeMonto ref={ref} valor="" alCambiar={jest.fn()} />);
    expect(monto().props.keyboardType).toBe('decimal-pad');
    expect(monto()).toHaveStyle({ fontFamily: 'Figtree-SemiBold' });
    expect(ref.current).not.toBeNull();
  });
});
