/**
 * OTA: ON_LOAD in produzione (manifest Android = ALWAYS).
 * Solo con EXPO_NO_OTA=1 nel .env locale (expo start / Expo Go) → NEVER.
 */
const appJson = require('./app.json');

module.exports = () => {
  const expo = appJson.expo;
  const disableOtaInDev = process.env.EXPO_NO_OTA === '1';
  const otaCheck = disableOtaInDev
    ? 'NEVER'
    : (expo.updates?.checkAutomatically || 'ON_LOAD');

  return {
    expo: {
      ...expo,
      plugins: [
        ...(expo.plugins || []),
        './plugins/with-android-splash-no-logo',
      ],
      updates: {
        ...expo.updates,
        checkAutomatically: otaCheck,
      },
    },
  };
};
