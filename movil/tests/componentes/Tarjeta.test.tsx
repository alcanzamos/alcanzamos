import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { IconoPropio } from '../../src/componentes/Iconos';
import { Tarjeta } from '../../src/componentes/Tarjeta';

describe('Tarjeta (E14-SDD 5.7)', () => {
  it('lleva su título como encabezado y su contenido', async () => {
    await render(
      <Tarjeta titulo="Lo que guardamos">
        <Text>Contenido</Text>
      </Tarjeta>,
    );
    expect(screen.getByRole('header', { name: 'Lo que guardamos' })).toBeOnTheScreen();
    expect(screen.getByText('Contenido')).toBeOnTheScreen();
  });

  it('con ícono lo dibuja junto al título', async () => {
    await render(
      <Tarjeta titulo="Lo tuyo es solo tuyo" Icono={IconoPropio}>
        <Text>x</Text>
      </Tarjeta>,
    );
    expect(JSON.stringify(screen.toJSON())).toContain('no-hide-descendants');
  });
});
