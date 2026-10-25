export type Hoja = { texto: string | { one: string; other: string }; e14: string };
export function marcadoresDe(texto: string): string[];
export function hojasDe(seccion: object, prefijo?: string[]): [string[], Hoja][];
export function hojasDeLaPlataforma(json: object, plataforma: "web" | "android"): [string[], Hoja][];
export function generar(json: object, plataforma: "web" | "android", ayudas: string): string;
export function generarDesdeArchivos(plataforma: "web" | "android"): string;
