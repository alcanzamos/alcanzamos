// US-48: excepción de HTTP en claro para medir en un celular contra el API del portátil.
//
// El día de la medición el celular se conecta al portátil con `adb reverse tcp:18090 tcp:18090`: el puerto 18090 del
// celular (su `localhost`) llega al API del portátil. La app usa `EXPO_PUBLIC_URL_API=http://localhost:18090`, así que
// no depende de la IP del portátil ni abre su cortafuegos.
//
// Solo se activa cuando EAS compila el perfil «medicion» (EAS_BUILD_PROFILE). Entonces agrega una configuración de
// seguridad de red de Android que permite HTTP en claro únicamente hacia `localhost`, y lo prohíbe para todo lo demás.
// El nombre `localhost` es lo único que hace falta: Android compara el nombre de host de la URL con `<domain>`, no la
// dirección a la que resuelve, y la app nunca usa `127.0.0.1` ni otro nombre. Por eso, si `EXPO_PUBLIC_URL_API` usa
// `http:` hacia cualquier otro host (una IP de la red local, `127.0.0.1` o un dominio), la compilación falla en vez de
// ampliar la excepción. Una URL `https:` no necesita excepción y se acepta. Nunca pone `usesCleartextTraffic` en toda
// la app. En cualquier otro perfil (`uat`, `expo start`, prebuild local) no cambia nada.

// D-129 (sin dominio fijo) vale para el código de la app; esto es configuración de compilación y `localhost` es el dato.
/* eslint-disable no-restricted-syntax */
import { type ConfigPlugin, withAndroidManifest, withDangerousMod } from '@expo/config-plugins';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PERFIL_DE_MEDICION = 'medicion';
const NOMBRE_DEL_ARCHIVO = 'network_security_config';

const HOST_EN_CLARO = 'localhost';

/**
 * Hosts con HTTP en claro permitido para una compilación de medición: solo `localhost`. Falla si `urlDelApi` usa `http:`
 * hacia otro host, o no es una URL: la excepción no debe llegar a la red local ni a un dominio.
 */
export function hostsEnClaro(urlDelApi: string | undefined): string[] {
  const texto = urlDelApi?.trim();
  if (texto) {
    let url: URL;
    try {
      url = new URL(texto);
    } catch {
      throw new Error(`EXPO_PUBLIC_URL_API no es una URL válida: ${texto}`);
    }
    if (url.protocol === 'http:' && url.hostname !== HOST_EN_CLARO) {
      throw new Error(
        `El perfil «medicion» solo permite HTTP en claro hacia ${HOST_EN_CLARO} (con adb reverse tcp:18090 tcp:18090 y EXPO_PUBLIC_URL_API=http://${HOST_EN_CLARO}:18090); EXPO_PUBLIC_URL_API apunta a ${url.hostname}.`,
      );
    }
  }
  return [HOST_EN_CLARO];
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
