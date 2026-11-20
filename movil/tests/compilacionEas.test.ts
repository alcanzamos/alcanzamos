// US-48: la compilación con EAS Build. La configuración de Expo (paquete, dueño, proyecto), los dos perfiles de
// `eas.json` y la excepción de HTTP en claro, que solo existe en el perfil «medicion» y solo hacia la red local.
import { compileModsAsync } from '@expo/config-plugins';
import { getConfig } from 'expo/config';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import conRedDeMedicion from '../plugins/redDeMedicion';
import { NPM_SHA512, NPM_VERSION, urlDelTarball } from '../scripts/npm-de-eas-logica.mjs';

const ejecutar = promisify(execFile);

const raiz = path.resolve(__dirname, '..');
const leerJson = (archivo: string) => JSON.parse(fs.readFileSync(path.join(raiz, archivo), 'utf8'));

describe('configuración de Expo (app.json)', () => {
  const { exp } = getConfig(raiz, { skipSDKVersionRequirement: true, isPublicConfig: true });

  it('declara el paquete de Android, el nombre y la versión de la app', () => {
    expect(exp.android?.package).toBe('co.alcanzamos.movil');
    expect(exp.name).toBe('Alcanzamos');
    expect(exp.version).toBe('0.1.0');
  });

  it('está enlazada al proyecto de EAS del dueño', () => {
    expect(exp.owner).toBe('alcanzamos');
    expect(exp.extra?.eas?.projectId).toBe('f153dd46-75b9-41f2-bc2c-d86a7e005396');
  });

  it('no fija el versionCode (lo lleva EAS) ni permite HTTP en claro en toda la app', () => {
    const android = leerJson('app.json').expo.android;
    expect(android.versionCode).toBeUndefined();
    expect(JSON.stringify(leerJson('app.json'))).not.toMatch(/usesCleartextTraffic/i);
  });

  it('conserva los plugins y registra el de la red de medición', () => {
    const plugins: unknown[] = leerJson('app.json').expo.plugins;
    expect(plugins).toEqual(
      expect.arrayContaining(['expo-font', 'expo-secure-store', '@react-native-community/datetimepicker', 'expo-status-bar']),
    );
    expect(plugins).toContain('./plugins/redDeMedicion');
  });
});

describe('eas.json', () => {
  let eas: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON de eas.json, sin tipo propio
  beforeAll(() => {
    eas = leerJson('eas.json');
  });

  it('fija la versión de eas-cli y deja que EAS lleve el versionCode', () => {
    expect(eas.cli.version).toBe('27.9.0');
    expect(eas.cli.appVersionSource).toBe('remote');
  });

  it('«medicion» es un APK instalable que habla con el API del portátil', () => {
    const perfil = eas.build.medicion;
    expect(perfil.distribution).toBe('internal');
    expect(perfil.android.buildType).toBe('apk');
    expect(perfil.developmentClient).toBeUndefined();
    expect(perfil.env.EXPO_PUBLIC_URL_API).toBe('http://192.168.1.36:18090');
  });

  it('«produccion» es un AAB contra el API por HTTPS, sin excepción de HTTP en claro', () => {
    const perfil = eas.build.produccion;
    expect(perfil.android.buildType).toBe('app-bundle');
    expect(perfil.autoIncrement).toBe(true);
    expect(perfil.env.EXPO_PUBLIC_URL_API).toBe('https://api-uat.alcanzamos.co');
    expect(JSON.stringify(perfil)).not.toMatch(/cleartext|http:\/\//i);
  });

  it('usa el Node fijado de engines en los dos perfiles', () => {
    const engines: string = leerJson('package.json').engines.node;
    const nodeFijado = engines.replace(/^>=/, '');
    expect(eas.build.medicion.node).toBe(nodeFijado);
    expect(eas.build.produccion.node).toBe(nodeFijado);
  });

  it('no debilita las protecciones de npm: ningún perfil toca la configuración de npm', () => {
    for (const perfil of [eas.build.medicion, eas.build.produccion]) {
      expect(Object.keys(perfil.env).filter((nombre) => /^npm_config_/i.test(nombre))).toEqual([]);
    }
    expect(JSON.stringify(eas)).not.toMatch(/engine.?strict/i);
  });
});

describe('excepción de HTTP en claro (plugins/redDeMedicion)', () => {
  const variables = ['EAS_BUILD_PROFILE', 'EXPO_PUBLIC_URL_API'] as const;
  const original = Object.fromEntries(variables.map((v) => [v, process.env[v]]));
  const proyectos: string[] = [];

  afterEach(() => {
    for (const v of variables) {
      if (original[v] === undefined) delete process.env[v];
      else process.env[v] = original[v];
    }
    for (const proyecto of proyectos.splice(0)) fs.rmSync(proyecto, { recursive: true, force: true });
  });

  // Aplica el plugin y ejecuta sus mods sobre un proyecto Android mínimo, en un directorio temporal.
  async function prebuild(entorno: { perfil?: string; url?: string }) {
    for (const v of variables) delete process.env[v];
    if (entorno.perfil !== undefined) process.env.EAS_BUILD_PROFILE = entorno.perfil;
    if (entorno.url !== undefined) process.env.EXPO_PUBLIC_URL_API = entorno.url;

    const proyecto = fs.mkdtempSync(path.join(os.tmpdir(), 'alc-eas-'));
    proyectos.push(proyecto);
    const carpetaManifiesto = path.join(proyecto, 'android/app/src/main');
    fs.mkdirSync(carpetaManifiesto, { recursive: true });
    fs.writeFileSync(
      path.join(carpetaManifiesto, 'AndroidManifest.xml'),
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:name=".MainApplication"/></manifest>',
    );

    const configuracion = conRedDeMedicion({ name: 'Alcanzamos', slug: 'alcanzamos-movil' });
    await compileModsAsync(configuracion, { projectRoot: proyecto, platforms: ['android'], assertMissingModProviders: false });

    const archivoRed = path.join(carpetaManifiesto, 'res/xml/network_security_config.xml');
    return {
      manifiesto: fs.readFileSync(path.join(carpetaManifiesto, 'AndroidManifest.xml'), 'utf8'),
      reglas: fs.existsSync(archivoRed) ? fs.readFileSync(archivoRed, 'utf8') : null,
    };
  }

  it('en «medicion» permite HTTP en claro solo hacia el portátil y localhost', async () => {
    const { manifiesto, reglas } = await prebuild({ perfil: 'medicion', url: 'http://192.168.1.36:18090' });

    expect(manifiesto).toContain('android:networkSecurityConfig="@xml/network_security_config"');
    expect(manifiesto).not.toMatch(/usesCleartextTraffic/);
    expect(reglas).toContain('<base-config cleartextTrafficPermitted="false"');
    const permitidos = [...(reglas ?? '').matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g)].map((m) => m[1]);
    expect(permitidos).toEqual(['192.168.1.36', 'localhost']);
    expect(reglas).toMatch(/<domain-config cleartextTrafficPermitted="true">[\s\S]*<\/domain-config>/);
    expect((reglas ?? '').match(/cleartextTrafficPermitted="true"/g)).toHaveLength(1);
  });

  it('en «medicion» sin dirección, o con una dirección HTTPS, solo permite localhost', async () => {
    for (const url of [undefined, 'https://api-uat.alcanzamos.co']) {
      const { reglas } = await prebuild({ perfil: 'medicion', url });
      const permitidos = [...(reglas ?? '').matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g)].map((m) => m[1]);
      expect(permitidos).toEqual(['localhost']);
    }
  });

  it('en «medicion» rechaza HTTP en claro hacia un host que no es de la red local', async () => {
    await expect(prebuild({ perfil: 'medicion', url: 'http://api-uat.alcanzamos.co' })).rejects.toThrow(/red local/);
    await expect(prebuild({ perfil: 'medicion', url: 'http://8.8.8.8:18090' })).rejects.toThrow(/red local/);
    await expect(prebuild({ perfil: 'medicion', url: 'http://172.32.0.1' })).rejects.toThrow(/red local/);
  });

  it('en «produccion» y fuera de EAS no cambia nada: sin reglas de red ni permiso de HTTP en claro', async () => {
    for (const perfil of ['produccion', undefined]) {
      const { manifiesto, reglas } = await prebuild({ perfil, url: 'http://192.168.1.36:18090' });
      expect(reglas).toBeNull();
      expect(manifiesto).not.toMatch(/networkSecurityConfig|usesCleartextTraffic/);
    }
  });
});

// EAS trae el npm que acompaña a su Node, no el 12.2.1 de `engines` (que `.npmrc` exige con engine-strict). Un paso
// previo lo instala desde el tarball del registro con su SHA-512 verificado, como `plantillas/pasos/node.yml` del control.
describe('npm 12.2.1 en EAS (eas-build-pre-install)', () => {
  const nodeYml = fs.readFileSync(path.resolve(raiz, '../.azure-pipelines/plantillas/pasos/node.yml'), 'utf8');
  const valorPorDefecto = (nombre: string) =>
    new RegExp(`- name: ${nombre}\\n(?:.*\\n)*?\\s+default: (\\S+)`).exec(nodeYml)?.[1];
  const script = path.join(raiz, 'scripts/npm-de-eas.mjs');

  it('el control y el script fijan la misma versión, el mismo tarball y la misma suma SHA-512', () => {
    expect(valorPorDefecto('npmVersion')).toBe('12.2.1');
    expect(valorPorDefecto('npmSha512')).toMatch(/^[0-9a-f]{128}$/);
    expect(NPM_VERSION).toBe(valorPorDefecto('npmVersion'));
    expect(NPM_SHA512).toBe(valorPorDefecto('npmSha512'));
    expect(urlDelTarball()).toBe('https://registry.npmjs.org/npm/-/npm-12.2.1.tgz');
    expect(nodeYml).toContain('https://registry.npmjs.org/npm/-/npm-${{ parameters.npmVersion }}.tgz');
    expect(leerJson('package.json').engines.npm).toBe(NPM_VERSION);
  });

  it('package.json lo llama desde eas-build-pre-install, y solo desde ahí', () => {
    const { scripts } = leerJson('package.json');
    expect(scripts['eas-build-pre-install']).toBe('node scripts/npm-de-eas.mjs');
    expect(fs.existsSync(script)).toBe(true);
    for (const nombre of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepack']) {
      expect(scripts[nombre]).toBeUndefined();
    }
  });

  it('el script verifica la suma antes de instalar y falla si no coincide', () => {
    const texto = fs.readFileSync(script, 'utf8');
    expect(texto).toMatch(/process\.exit\(1\)|process\.exitCode = 1/);
    expect(texto.indexOf('sumaSha512(contenido)')).toBeGreaterThan(0);
    expect(texto.indexOf('sumaSha512(contenido)')).toBeLessThan(texto.search(/["']install["']/));
  });

  async function correr(entorno: Record<string, string>, cuerpo?: Buffer) {
    const servidor = http.createServer((_pedido, respuesta) => respuesta.end(cuerpo ?? Buffer.alloc(0)));
    await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
    const { port } = servidor.address() as AddressInfo;
    const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'alc-npm-eas-'));
    try {
      const env = Object.assign({} as NodeJS.ProcessEnv, { PATH: process.env.PATH, TMPDIR: temporal, NPM_DE_EAS_URL: `http://127.0.0.1:${port}/npm.tgz` }, entorno);
      const { stdout, stderr } = await ejecutar(process.execPath, [script], { env });
      return { codigo: 0, stdout, stderr, sobras: fs.readdirSync(temporal) };
    } catch (e) {
      const error = e as { code: number; stdout: string; stderr: string };
      return { codigo: error.code, stdout: error.stdout, stderr: error.stderr, sobras: fs.readdirSync(temporal) };
    } finally {
      servidor.close();
      fs.rmSync(temporal, { recursive: true, force: true });
    }
  }

  it('fuera de EAS no hace nada: sale con 0 sin descargar ni instalar', async () => {
    const resultado = await correr({ NPM_DE_EAS_URL: 'http://127.0.0.1:1/no-debe-pedirse' });
    expect(resultado.codigo).toBe(0);
    expect(resultado.stdout).toContain('fuera de EAS');
    expect(resultado.sobras).toEqual([]);
  });

  it('en una compilación local de EAS tampoco instala nada', async () => {
    const resultado = await correr({ EAS_BUILD: 'true', EAS_BUILD_RUNNER: 'local-build-plugin' });
    expect(resultado.codigo).toBe(0);
    expect(resultado.stdout).toContain('compilación local');
  });

  it('en EAS, con un tarball cuya suma no coincide, sale con error y no instala nada', async () => {
    const falso = Buffer.from('no es el tarball de npm');
    expect(createHash('sha512').update(falso).digest('hex')).not.toBe(NPM_SHA512);
    const resultado = await correr({ EAS_BUILD: 'true', EAS_BUILD_RUNNER: 'eas-build' }, falso);
    expect(resultado.codigo).not.toBe(0);
    expect(resultado.stderr).toMatch(/SHA-512/);
    expect(resultado.stdout).not.toMatch(/added|changed/);
    expect(resultado.sobras).toEqual([]);
  });
});
