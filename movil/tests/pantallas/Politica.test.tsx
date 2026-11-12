import { render, screen, fireEvent, within } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { Politica } from '../../src/pantallas/Politica';
import { VERSION_DE_LA_POLITICA } from '../../src/politica';
import { instalarFetchFalso } from '../ayudas/fetchFalso';

// PN-68 · Política de tratamiento (E14-PCP 4.11, RF-059, RF-060): informa, sin formulario y sin sesión. Los textos son de
// E14-PCP 4.11, SC-E21-25 (la viñeta de los avisos), D-200 (2) y la frase de D-200, primera respuesta. Igual que la web.
const mostrar = () => render(<Politica />);

const encabezado = (nombre: string) => screen.getByRole('header', { name: nombre });
// Una lista para TalkBack es una vista con `accessibilityRole="list"` (no es un elemento accesible por sí sola: sus frases
// se recorren una a una).
const listas = () => screen.container.queryAll((vista) => vista.props.accessibilityRole === 'list');

describe('PN-68 · lo que dice', () => {
  it('la versión sale de la constante, en palabras (D-090), y lleva las cifras en Figtree (D-123)', async () => {
    await mostrar();
    expect(VERSION_DE_LA_POLITICA).toEqual({ numero: '1.1', fecha: '2026-11-12' });
    expect(screen.getByText(/^Versión/)).toHaveTextContent('Versión 1.1 del 12 de noviembre de 2026.', { exact: true });
    expect(screen.getByText('2026')).toHaveStyle({ fontFamily: 'Figtree-SemiBold', fontVariant: ['tabular-nums'] });
  });

  it('el título es el de la barra nativa: la pantalla no lo repite, y las tarjetas van en el orden de E14', async () => {
    await mostrar();
    expect(screen.queryByRole('header', { name: 'Política de tratamiento' })).not.toBeOnTheScreen();
    expect(screen.getAllByRole('header').map(textoDe)).toEqual([
      'Quién responde por tus datos',
      'Para qué usamos tus datos',
      'Necesarias',
      'Opcionales',
      'Tus derechos',
      'Dónde guardamos tus datos',
      'Cómo hacer una consulta o un reclamo',
    ]);
  });

  it('«Quién responde»: la frase propuesta del proyecto primero, después las dos de E14', async () => {
    await mostrar();
    expect(encabezado('Quién responde por tus datos')).toBeOnTheScreen();
    const frases = [
      'Alcanzamos, proyecto de Andrés Jiménez.',
      'Andrés Jiménez, dueño de Alcanzamos.',
      'Correo: privacidad@alcanzamos.co.',
    ];
    for (const frase of frases) expect(screen.getByText(frase)).toBeOnTheScreen();
    const orden = frases.map((f) => textoDe(screen.getByText(f)));
    expect(orden).toEqual(frases);
  });

  it('«Para qué usamos tus datos»: necesarias y opcionales con su texto, y cierra con la frase de D-200', async () => {
    await mostrar();
    for (const nombre of [
      'Cuenta y acceso',
      'Funciones financieras',
      'Cuenta de un menor',
      'Avisos con la app cerrada',
      'Horas de vida',
      'Correo del menor',
    ])
      expect(screen.getByText(nombre)).toBeOnTheScreen();
    for (const texto of [
      'Usamos tu correo, tu contraseña y tu nombre para crear tu cuenta, dejarte entrar y ayudarte a recuperar el acceso.',
      'Usamos lo que registras —movimientos, presupuestos, deudas y metas— para calcular tu plata disponible, avisarte de un faltante y mostrarte tus resúmenes.',
      'Usamos los datos de la cuenta de un niño, niña o adolescente a tu cargo para que pueda usar la app con tu acompañamiento. Tú respondes por esa cuenta porque tienes su tutoría.',
      'Usamos un código de tu teléfono para enviarte avisos aunque la app esté cerrada. El aviso solo dice «Tienes un aviso en Alcanzamos.» y no lleva cifras ni nombres.',
      'Si tienes menos de 18 años y estás por cumplirlos, puedes dar un correo, con permiso de tu tutor. Lo usamos solo para que puedas entrar con él cuando cumplas 18.',
    ])
      expect(screen.getByText(texto)).toBeOnTheScreen();
    expect(screen.getByText(/^Usamos tu ingreso y tus horas de trabajo/)).toBeOnTheScreen();
    // Las necesarias van antes que las opcionales, y la frase cierra la tarjeta.
    const nombres = screen.getAllByText(/^(Cuenta y acceso|Funciones financieras|Cuenta de un menor|Avisos con la app cerrada|Horas de vida|Correo del menor)$/);
    expect(nombres.map(textoDe)).toEqual([
      'Cuenta y acceso',
      'Funciones financieras',
      'Cuenta de un menor',
      'Avisos con la app cerrada',
      'Horas de vida',
      'Correo del menor',
    ]);
    expect(screen.getByText('No vendemos tus datos ni los usamos para mostrarte publicidad de terceros.')).toBeOnTheScreen();
  });

  it('«Para qué usamos tus datos» no lista la transmisión a los encargados (la cubre «Dónde guardamos tus datos»)', async () => {
    await mostrar();
    expect(screen.queryByText('transmision_a_encargados')).not.toBeOnTheScreen();
    expect(screen.queryByText(/Acepto que mis datos se envíen/)).not.toBeOnTheScreen();
  });

  it('«Tus derechos»: «Puedes:» y las seis viñetas de E14', async () => {
    await mostrar();
    expect(screen.getByText('Puedes:')).toBeOnTheScreen();
    const lista = listas()[0]!;
    expect(lista.children).toHaveLength(6);
    for (const texto of [
      'conocer qué datos tuyos tenemos y para qué los usamos;',
      'corregir o actualizar tus datos;',
      'pedir que borremos tus datos;',
      'retirar tu autorización cuando quieras;',
      'pedir la prueba de tu autorización: la versión del texto y la fecha;',
      'presentar una queja ante la Superintendencia de Industria y Comercio.',
    ])
      expect(within(lista).getByText(texto)).toBeOnTheScreen();
  });

  // SC-E21-25 3.8, criterio 7 (RF-059): cada encargado con su país o con la indicación de que no lo informa.
  it('«Dónde guardamos tus datos» nombra a cada encargado con su país y dice que las empresas de avisos no informan el suyo', async () => {
    await mostrar();
    const lista = listas()[1]!;
    expect(lista.children).toHaveLength(5);
    for (const texto of [
      'Tus datos se guardan en Microsoft Azure, en México.',
      'El correo que te enviamos (verificar tu cuenta, recuperar el acceso, avisos a quien tiene una tutoría) sale por Azure Communication Services, que guarda sus datos en Francia.',
      'Lo que escribes a privacidad@alcanzamos.co queda en Zoho Mail, en Estados Unidos.',
      'Estas empresas son encargadas: tratan los datos por cuenta de Alcanzamos, que es el responsable, y solo para lo que les pedimos.',
      'Si activas los avisos con la app cerrada, el código de tu teléfono o de tu navegador y un aviso que solo dice «Tienes un aviso en Alcanzamos.» pasan por el servicio de notificaciones de Google (Firebase Cloud Messaging) en Android, o por el de la empresa que hace tu navegador en la web. Esas empresas no dicen en qué país los procesan.',
    ])
      expect(within(lista).getByText(texto)).toBeOnTheScreen();
    expect(screen.queryByText(/Todavía no confirmamos en qué país guardan ese código/)).not.toBeOnTheScreen();
  });

  it('«Cómo hacer una consulta o un reclamo»: qué traer, el menor, y los plazos de E14', async () => {
    await mostrar();
    expect(screen.getByText('Escribe al correo privacidad@alcanzamos.co. En tu mensaje, cuéntanos:')).toBeOnTheScreen();
    const [, , datos, tiempos] = listas();
    expect(datos?.children).toHaveLength(3);
    for (const texto of ['tu nombre y el correo de tu cuenta;', 'si es una consulta o un reclamo;', 'qué quieres saber o qué quieres corregir.'])
      expect(within(datos!).getByText(texto)).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Si escribes por un menor a tu cargo, dinos su nombre. Si no tienes cuenta y quieres que quitemos tu nombre de una deuda que otra persona registró, escribe al mismo correo.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Cuánto tardamos.')).toBeOnTheScreen();
    expect(tiempos?.children).toHaveLength(3);
    const frases = [
      'Una consulta: máximo 10 días hábiles desde que la recibimos. Si necesitamos más tiempo, te contamos el motivo y la nueva fecha. Serían máximo 5 días hábiles más.',
      'Un reclamo: máximo 15 días hábiles desde el día siguiente a que lo recibimos. Si necesitamos más tiempo, te contamos el motivo y la nueva fecha. Serían máximo 8 días hábiles más.',
      'Si tu reclamo llega incompleto, te lo decimos en los 5 días siguientes para que lo completes. Si pasan 2 meses sin que lo completes, entendemos que ya no lo necesitas.',
    ];
    frases.forEach((frase, i) => expect(textoDe(tiempos!.children[i] as never)).toBe(frase));
  });

  it('las listas son listas para TalkBack: derechos, dónde guardamos, qué traer y cuánto tardamos', async () => {
    await mostrar();
    expect(listas()).toHaveLength(4);
  });

  it('«Escribir al correo» abre el correo del dispositivo con la dirección; no hay formulario ni campos', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await mostrar();
    await fireEvent.press(screen.getByRole('button', { name: 'Escribir al correo' }));
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenCalledWith('mailto:privacidad@alcanzamos.co');
    expect(screen.queryByRole('checkbox')).not.toBeOnTheScreen();
    expect(screen.queryByPlaceholderText(/./)).not.toBeOnTheScreen();
    abrir.mockRestore();
  });

  it('si el dispositivo no tiene con qué abrir el correo, no pasa nada: la dirección sigue escrita en la pantalla', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('sin app de correo'));
    await mostrar();
    await fireEvent.press(screen.getByRole('button', { name: 'Escribir al correo' }));
    expect(screen.getByText('Correo: privacidad@alcanzamos.co.')).toBeOnTheScreen();
    abrir.mockRestore();
  });

  it('no pide nada al API: es texto estático, sin sesión', async () => {
    const { fetchFalso } = instalarFetchFalso();
    await mostrar();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('sin la nota del menor (fila 8): la cuenta de un menor llega con I11 y PN-68 no sabe quién la abre', async () => {
    await mostrar();
    expect(screen.queryByText(/Puedes escribir tú al correo/)).not.toBeOnTheScreen();
  });

  it('no hay estado de carga ni de error: el texto va en la app', async () => {
    await mostrar();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Intentar de nuevo' })).not.toBeOnTheScreen();
  });
});

/** El texto de una vista: lo que dicen sus `Text`, con las cifras en Figtree incluidas. */
function textoDe(vista: { children: unknown[] }): string {
  return vista.children
    .map((hijo) =>
      typeof hijo === 'string' ? hijo : textoDe(hijo as { children: unknown[] }),
    )
    .join('');
}
