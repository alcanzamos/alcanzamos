// Las fuentes viven en ../diseno/fuentes (compartidas con web/); Metro debe poder leerlas.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../diseno')];
// Con React Native 0.88 el módulo de cada recurso importa `react-native/asset-registry` desde la
// carpeta del recurso; fuera de movil/ no hay node_modules, así que se le indica dónde buscar.
config.resolver.nodeModulesPaths = [...(config.resolver.nodeModulesPaths ?? []), path.resolve(__dirname, 'node_modules')];

module.exports = config;
