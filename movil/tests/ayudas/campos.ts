import { screen } from '@testing-library/react-native';

// ACC-004 (bugs 226 y 227): el campo de texto no lleva `accessibilityLabel`; TalkBack lo nombra con su texto de ejemplo
// transparente, que es la etiqueta («Monto») o la etiqueta y el error («Monto, Falta el monto.»). Las pruebas lo buscan
// por la etiqueta: el texto de ejemplo empieza con ella y, si hay error, sigue con «, ».
const delCampo = (etiqueta: string) => new RegExp(`^${etiqueta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(, .+)?$`);

/** El campo de texto con esa etiqueta. */
export const campo = (etiqueta: string) => screen.getByPlaceholderText(delCampo(etiqueta));

/** El campo de texto con esa etiqueta, o `null` si no está. */
export const quizasCampo = (etiqueta: string) => screen.queryByPlaceholderText(delCampo(etiqueta));

/** Espera al campo de texto con esa etiqueta. */
export const buscarCampo = (etiqueta: string) => screen.findByPlaceholderText(delCampo(etiqueta));
