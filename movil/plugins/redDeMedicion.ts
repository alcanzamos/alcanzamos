// US-48: excepción de HTTP en claro para medir en un celular contra el API del portátil.
//
// Solo se activa cuando EAS compila el perfil «medicion» (EAS_BUILD_PROFILE). Entonces agrega una configuración de
// seguridad de red de Android que permite HTTP en claro únicamente hacia `localhost` y hacia el host de
// EXPO_PUBLIC_URL_API cuando es una dirección de la red local, y lo prohíbe para todo lo demás. Nunca pone
// `usesCleartextTraffic` en toda la app. En cualquier otro perfil (producción, `expo start`, prebuild local) no
// cambia nada.

// D-129 (sin dominio fijo) vale para el código de la app; esto es configuración de compilación y `localhost` es el dato.
/* eslint-disable no-restricted-syntax */
import { type ConfigPlugin, withAndroidManifest, withDangerousMod } from '@expo/config-plugins';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PERFIL_DE_MEDICION = 'medicion';
const NOMBRE_DEL_ARCHIVO = 'network_security_config';

const octeto = '(25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const ipv4 = new RegExp(`^${octeto}\\.${octeto}\\.${octeto}\\.${octeto}$`);

/** Direcciones de la red local (RFC 1918). */
function esIpv4Privada(host: string): boolean {
  if (!ipv4.test(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Hosts con HTTP en claro permitido para una compilación de medición: `localhost` (con `adb reverse`) y el host de
 * `urlDelApi` si usa `http:`. Si ese host no es de la red local, falla: la excepción no debe llegar a un dominio.
 */
export function hostsEnClaro(urlDelApi: string | undefined): string[] {
  const hosts = ['localhost'];
  const texto = urlDelApi?.trim();
  if (!texto) return hosts;
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new Error(`EXPO_PUBLIC_URL_API no es una URL válida: ${texto}`);
  }
  if (url.protocol !== 'http:') return hosts;
  if (url.hostname !== 'localhost' && !esIpv4Privada(url.hostname)) {
    throw new Error(
      `El perfil «medicion» solo permite HTTP en claro hacia la red local (10.x, 172.16-31.x, 192.168.x) o localhost; EXPO_PUBLIC_URL_API apunta a ${url.hostname}.`,
    );
  }
  return url.hostname === 'localhost' ? hosts : [url.hostname, ...hosts];
}

/** `network_security_config.xml`: todo en HTTPS salvo los hosts dados. */
export function reglasDeRed(hosts: string[]): string {
  const dominios = hosts.map((host) => `    <domain includeSubdomains="false">${host}</domain>`).join('\n');
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<network-security-config>',
    '  <base-config cleartextTrafficPermitted="false" />',
    '  <domain-config cleartextTrafficPermitted="true">',
    dominios,
    '  </domain-config>',
    '</network-security-config>',
    '',
  ].join('\n');
}

const conRedDeMedicion: ConfigPlugin = (config) => {
  if (process.env.EAS_BUILD_PROFILE !== PERFIL_DE_MEDICION) return config;
  const hosts = hostsEnClaro(process.env.EXPO_PUBLIC_URL_API);

  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const carpeta = path.join(modConfig.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      await fs.promises.mkdir(carpeta, { recursive: true });
      await fs.promises.writeFile(path.join(carpeta, `${NOMBRE_DEL_ARCHIVO}.xml`), reglasDeRed(hosts));
      return modConfig;
    },
  ]);

  return withAndroidManifest(config, (modConfig) => {
    const aplicacion = modConfig.modResults.manifest.application?.[0];
    if (!aplicacion) throw new Error('AndroidManifest.xml sin <application>.');
    aplicacion.$['android:networkSecurityConfig'] = `@xml/${NOMBRE_DEL_ARCHIVO}`;
    return modConfig;
  });
};

export default conRedDeMedicion;
