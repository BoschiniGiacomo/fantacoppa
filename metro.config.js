const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Filtra i moduli built-in problematici per Windows (node:sea contiene : che non è valido nei nomi di cartella)
const existingBlockList = Array.isArray(config.resolver?.blockList)
  ? config.resolver.blockList
  : [];

const resolveRequest = config.resolver.resolveRequest;

config.resolver = {
  ...config.resolver,
  blockList: [...existingBlockList, /node:sea/],
  resolveRequest(context, moduleName, platform) {
    if (resolveRequest) {
      return resolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
