/**
 * In sviluppo (expo start / Expo Go) non scaricare OTA production:
 * altrimenti splash e asset restano quelli del vecchio update.
 * Su EAS Build / EAS Update (EAS_BUILD=true) gli OTA restano attivi.
 */
const appJson = require('./app.json');

module.exports = () => {
  const expo = appJson.expo;
  const isEasPipeline = process.env.EAS_BUILD === 'true';
  const otaCheck = isEasPipeline ? (expo.updates?.checkAutomatically || 'ON_LOAD') : 'NEVER';

  return {
    expo: {
      ...expo,
      updates: {
        ...expo.updates,
        checkAutomatically: otaCheck,
      },
    },
  };
};
