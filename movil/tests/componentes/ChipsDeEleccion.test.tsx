import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChipsDeEleccion } from '../../src/componentes/ChipsDeEleccion';
import { tokens } from '../../src/tokens/tokens.generated';

const opciones = [
  { valor: 'gasto', etiqueta: 'Gasto' },
  { valor: 'ingreso', etiqueta: 'Ingreso' },
];

describe('ChipsDeEleccion (Chip de categoría, E14-SDD)', () => {
  it('es un grupo de botones de radio con su etiqueta y el elegido marcado', async () => {
    await render(<ChipsDeEleccion etiqueta="Tipo" opciones={opciones} valor="ingreso" alElegir={jest.fn()} />);
    expect(screen.getByText('Tipo')).toBeOnTheScreen();
    expect(screen.getAllByRole('radio').map((c) => c.props.accessibilityState.checked)).toEqual([false, true]);
    expect(screen.getByRole('radio', { name: 'Ingreso' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Gasto' })).not.toBeChecked();
  });

  it('tocar un chip avisa su valor', async () => {
    const alElegir = jest.fn();
    await render(<ChipsDeEleccion etiqueta="Tipo" opciones={opciones} valor="gasto" alElegir={alElegir} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Ingreso' }));
    expect(alElegir).toHaveBeenCalledWith('ingreso');
  });

  it('sin elección, ningún chip está marcado', async () => {
    await render(<ChipsDeEleccion etiqueta="Medio de pago" opciones={opciones} valor={null} alElegir={jest.fn()} />);
    screen.getAllByRole('radio').forEach((chip) => expect(chip).not.toBeChecked());
  });

  it('el elegido lleva fondo de marca y una marca de verificación, no solo color', async () => {
    await render(<ChipsDeEleccion etiqueta="Tipo" opciones={opciones} valor="gasto" alElegir={jest.fn()} />);
    expect(screen.getByRole('radio', { name: 'Gasto' })).toHaveStyle({
      backgroundColor: tokens.color.accion.primaria.fondo,
    });
    expect(screen.getByRole('radio', { name: 'Ingreso' })).toHaveStyle({
      backgroundColor: tokens.color.fondo.superficie,
    });
    // Solo el elegido dibuja el ícono de la marca de verificación, antes del texto.
    expect(screen.getByRole('radio', { name: 'Gasto' }).children).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Ingreso' }).children).toHaveLength(1);
  });

  it('cada chip mide al menos 48 dp', async () => {
    await render(<ChipsDeEleccion etiqueta="Tipo" opciones={opciones} valor="gasto" alElegir={jest.fn()} />);
    screen.getAllByRole('radio').forEach((chip) =>
      expect(chip).toHaveStyle({ minHeight: tokens.tamano['tactil-minimo'] }),
    );
  });

  it('con el foco pinta el borde de foco', async () => {
    await render(<ChipsDeEleccion etiqueta="Tipo" opciones={opciones} valor="gasto" alElegir={jest.fn()} />);
    const chip = screen.getByRole('radio', { name: 'Ingreso' });
    await fireEvent(chip, 'focus');
    expect(chip).toHaveStyle({ borderColor: tokens.color.borde.foco });
    await fireEvent(chip, 'blur');
    expect(chip).not.toHaveStyle({ borderColor: tokens.color.borde.foco });
  });

  it('el error sale con su ícono en una región viva cortés', async () => {
    await render(
      <ChipsDeEleccion etiqueta="Categoría" opciones={opciones} valor={null} alElegir={jest.fn()} error="Falta elegir la categoría." />,
    );
    const error = screen.getByText('Falta elegir la categoría.');
    expect(error).toBeOnTheScreen();
    expect(error.parent?.parent?.props.accessibilityLiveRegion).toBe('polite');
  });

  it('en fila se desplaza a lo ancho, sin barra', async () => {
    await render(<ChipsDeEleccion etiqueta="Categoría" enFila opciones={opciones} valor={null} alElegir={jest.fn()} />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(JSON.stringify(screen.toJSON())).toContain('"horizontal":true');
  });

  it('sin alElegir el chip es de solo lectura: tocarlo no hace nada', async () => {
    await render(<ChipsDeEleccion etiqueta="De quién es" opciones={[opciones[0]!]} valor="gasto" />);
    await expect(fireEvent.press(screen.getByRole('radio', { name: 'Gasto' }))).resolves.not.toThrow();
    expect(screen.getByRole('radio', { name: 'Gasto' })).toBeChecked();
  });
});
