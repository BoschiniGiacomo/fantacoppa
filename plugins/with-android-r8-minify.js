/**
 * Abilita R8 minify + resource shrink sui release Android (Google Play App optimization).
 * Sopravvive a `expo prebuild` aggiornando gradle.properties.
 */
const { withGradleProperties } = require('expo/config-plugins');

const PROPS = [
  { key: 'android.enableMinifyInReleaseBuilds', value: 'true' },
  { key: 'android.enableShrinkResourcesInReleaseBuilds', value: 'true' },
];

function upsertGradleProperty(gradleProperties, key, value) {
  const list = Array.isArray(gradleProperties) ? [...gradleProperties] : [];
  const idx = list.findIndex((item) => item && item.type === 'property' && item.key === key);
  if (idx >= 0) {
    list[idx] = { type: 'property', key, value };
  } else {
    list.push({ type: 'property', key, value });
  }
  return list;
}

function withAndroidR8Minify(config) {
  return withGradleProperties(config, (cfg) => {
    let props = cfg.modResults;
    for (const { key, value } of PROPS) {
      props = upsertGradleProperty(props, key, value);
    }
    cfg.modResults = props;
    return cfg;
  });
}

module.exports = withAndroidR8Minify;
