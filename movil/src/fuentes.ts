import { tokens } from './tokens/tokens.generated';

// Solo los pesos que usa la pantalla de prueba; los TTF estáticos vienen de ../diseno/fuentes.
export const archivosDeFuentes = {
  'Figtree-SemiBold': require('../../diseno/fuentes/figtree/Figtree-SemiBold.ttf'),
  'Figtree-Bold': require('../../diseno/fuentes/figtree/Figtree-Bold.ttf'),
  'AtkinsonHyperlegibleNext-Regular': require('../../diseno/fuentes/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext-Regular.ttf'),
  'AtkinsonHyperlegibleNext-SemiBold': require('../../diseno/fuentes/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext-SemiBold.ttf'),
  'AtkinsonHyperlegibleNext-Bold': require('../../diseno/fuentes/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext-Bold.ttf'),
};

type NombreCargado = keyof typeof archivosDeFuentes;

const sufijoDePeso: Record<string, string> = { '400': 'Regular', '600': 'SemiBold', '700': 'Bold' };

// En Android cada peso es un archivo distinto: se elige por nombre y no con fontWeight, para que no se sintetice negrita.
export function familiaCargada(familia: string, peso: string): NombreCargado {
  const base = familia.replace(/ /g, '');
  const nombre = `${base}-${sufijoDePeso[peso]}`;
  if (!(nombre in archivosDeFuentes)) throw new Error(`Fuente no cargada: ${nombre}`);
  return nombre as NombreCargado;
}

// Estilo de texto de React Native a partir de un token de tipografía.
export function estiloDeTipografia(nombre: keyof typeof tokens.tipografia) {
  const t = tokens.tipografia[nombre];
  return {
    fontFamily: familiaCargada(t.fontFamily, t.fontWeight),
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
  };
}
