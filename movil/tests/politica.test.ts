import { readFileSync } from 'fs';
import * as path from 'path';
import { VERSION_DE_LA_POLITICA } from '../src/politica';

// La política (PN-68) es texto de Android y su versión es un dato del API (`autorizacion.VersionActual`, RF-063): el API,
// la web y Android se fusionan juntos (L3 de la US-67). Esta prueba lee el archivo de Go del mismo árbol y falla si se
// separan, como la de la web.
const servicio = path.resolve(__dirname, '../../api/src/autorizacion/servicio.go');

describe('la versión de la política de Android', () => {
  it('es la versión vigente del API (autorizacion.VersionActual)', () => {
    const fuente = readFileSync(servicio, 'utf8');
    const coincidencia = /VersionActual\s*=\s*Version\{Numero:\s*"([^"]+)",\s*Fecha:\s*"([^"]+)"\}/.exec(fuente);
    expect(coincidencia).not.toBeNull();
    expect(VERSION_DE_LA_POLITICA).toEqual({ numero: coincidencia?.[1], fecha: coincidencia?.[2] });
  });
});
