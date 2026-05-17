/**
 * In sviluppo (expo start / Expo Go) non scaricare OTA production:
 * altrimenti splash e asset restano quelli del vecchio update (logo nero/bianco).
 * Su EAS Build / EAS Update (EAS_BUILD=true) gli OTA restano attivi.
 */
const appJson = require('./app.json');
const { REVISION, LABEL, EXPECTED_PX } = require('./appIconRevision');

module.exports = () => {
  const expo = appJson.expo;
  const isEasPipeline = process.env.EAS_BUILD === 'true';
  const otaCheck = isEasPipeline ? (expo.updates?.checkAutomatically || 'ON_LOAD') : 'NEVER';

  console.log(
    `[APP_ICON] app.config: revision=${REVISION} icon=${expo.icon} splash=${expo.splash?.image} otaCheck=${otaCheck}`
  );

  return {
    expo: {
      ...expo,
      extra: {
        ...expo.extra,
        appIconRevision: REVISION,
        appIconLabel: LABEL,
        appIconExpectedPx: EXPECTED_PX,
      },
      updates: {
        ...expo.updates,
        checkAutomatically: otaCheck,
      },
    },
  };
};
