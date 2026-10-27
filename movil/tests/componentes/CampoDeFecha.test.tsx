import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { CampoDeFecha } from '../../src/componentes/CampoDeFecha';
import { tokens } from '../../src/tokens/tokens.generated';

jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: jest.fn() } }));
const abrir = DateTimePickerAndroid.open as jest.Mock;

const propiedades = { etiqueta: 'Fecha de nacimiento', alCambiar: jest.fn() };

describe('CampoDeFecha (PN-65, E14-PCP 4.8)', () => {
  beforeEach(() => abrir.mockReset());

  it('empieza vacío: sin fecha por defecto ni año sugerido', async () => {
    await render(<CampoDeFecha {...propiedades} ayuda="Ayuda" />);
    expect(screen.getByText('Fecha de nacimiento')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Fecha de nacimiento' })).toBeOnTheScreen();
    expect(screen.queryByText(/de \d{4}/)).not.toBeOnTheScreen();
  });

  it('al tocarlo abre el selector de fecha nativo del sistema, sin fecha mínima ni máxima', async () => {
    await render(<CampoDeFecha {...propiedades} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Fecha de nacimiento' }));
    expect(abrir).toHaveBeenCalledTimes(1);
    const opciones = abrir.mock.calls[0][0];
    expect(opciones.mode).toBe('date');
    expect(opciones.value).toBeInstanceOf(Date);
    expect(opciones).not.toHaveProperty('maximumDate');
    expect(opciones).not.toHaveProperty('minimumDate');
    expect(opciones).not.toHaveProperty('onChange');
  });

  it('cuando la persona confirma, avisa la fecha elegida', async () => {
    const alCambiar = jest.fn();
    await render(<CampoDeFecha {...propiedades} alCambiar={alCambiar} />);
    await fireEvent.press(screen.getByRole('button'));
    const fecha = new Date(1990, 4, 14);
    abrir.mock.calls[0][0].onValueChange({ nativeEvent: { timestamp: fecha.getTime(), utcOffset: 0 } }, fecha);
    expect(alCambiar).toHaveBeenCalledTimes(1);
    expect(alCambiar).toHaveBeenCalledWith(fecha);
  });

  it('si cierra el selector sin elegir, no cambia nada', async () => {
    const alCambiar = jest.fn();
    await render(<CampoDeFecha {...propiedades} alCambiar={alCambiar} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(() => abrir.mock.calls[0][0].onDismiss()).not.toThrow();
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it('con una fecha la muestra en palabras, la dice al lector de pantalla y vuelve a abrir en ella', async () => {
    const fecha = new Date(1990, 4, 14);
    await render(<CampoDeFecha {...propiedades} valor={fecha} />);
    expect(screen.getByText('1990')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Fecha de nacimiento, 14 de mayo de 1990' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button'));
    expect(abrir.mock.calls[0][0].value).toBe(fecha);
  });

  it('mide al menos 48 dp, lleva la ayuda como pista y muestra el error', async () => {
    await render(<CampoDeFecha {...propiedades} ayuda="No la guardamos." error="Falta la fecha de nacimiento." />);
    expect(screen.getByRole('button')).toHaveStyle({ minHeight: tokens.tamano['tactil-minimo'] });
    expect(screen.getByRole('button').props.accessibilityHint).toBe('No la guardamos.');
    expect(screen.getByText('Falta la fecha de nacimiento.')).toBeOnTheScreen();
  });

  it('con el foco pinta el borde de foco', async () => {
    await render(<CampoDeFecha {...propiedades} />);
    await fireEvent(screen.getByRole('button'), 'focus');
    expect(JSON.stringify(screen.toJSON())).toContain(tokens.color.borde.foco);
    await fireEvent(screen.getByRole('button'), 'blur');
    expect(JSON.stringify(screen.toJSON())).not.toContain(tokens.color.borde.foco);
  });

  it('con `texto` dice eso en lugar de la fecha en palabras («Hoy», E14-PPN 3.1) y abre el selector en su fecha', async () => {
    const fecha = new Date(2026, 9, 26);
    await render(<CampoDeFecha {...propiedades} etiqueta="Fecha" valor={fecha} texto="Hoy" />);
    expect(screen.getByRole('button', { name: 'Fecha, Hoy' })).toBeOnTheScreen();
    expect(screen.queryByText('26 de octubre de 2026')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button'));
    expect(abrir.mock.calls[0][0].value).toBe(fecha);
  });
});
