/**
 * Dopo expo prebuild: splash Android = solo sfondo nero, senza logo/icona app.
 * (Il video di caricamento è AppLoadingShell via API.)
 * Compatibile con Android 12+ SplashScreen API usata da expo-splash-screen (SDK 57+).
 */
const {
  withDangerousMod,
  AndroidConfig,
  withAndroidStyles,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** Icona splash 1x1 trasparente: Android 12 richiede un'icona, ma non deve vedersi. */
const TRANSPARENT_SPLASH_LOGO_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <size android:width="1dp" android:height="1dp" />
  <solid android:color="#00000000" />
</shape>
`;

const LAUNCHER_BG_XML = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/splashscreen_background"/>
</layer-list>
`;

function ensureTransparentSplashLogo(resDir) {
  const drawableDir = path.join(resDir, 'drawable');
  fs.mkdirSync(drawableDir, { recursive: true });
  for (const name of fs.readdirSync(drawableDir)) {
    if (/^splashscreen_logo\.(png|webp)$/i.test(name)) {
      fs.unlinkSync(path.join(drawableDir, name));
    }
  }
  fs.writeFileSync(
    path.join(drawableDir, 'splashscreen_logo.xml'),
    TRANSPARENT_SPLASH_LOGO_XML,
    'utf8',
  );
  fs.writeFileSync(
    path.join(drawableDir, 'ic_launcher_background.xml'),
    LAUNCHER_BG_XML,
    'utf8',
  );
  const colorsPath = path.join(resDir, 'values/colors.xml');
  if (fs.existsSync(colorsPath)) {
    let colors = fs.readFileSync(colorsPath, 'utf8');
    colors = colors.replace(
      /<color name="splashscreen_background">[^<]*<\/color>/,
      '<color name="splashscreen_background">#000000</color>',
    );
    fs.writeFileSync(colorsPath, colors, 'utf8');
  }
}

function withAndroidSplashNoLogo(config) {
  config = withAndroidStyles(config, (cfg) => {
    cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
      add: true,
      parent: {
        name: 'Theme.App.SplashScreen',
        parent: 'Theme.SplashScreen',
      },
      name: 'windowSplashScreenBackground',
      value: '@color/splashscreen_background',
    });
    cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
      add: true,
      parent: {
        name: 'Theme.App.SplashScreen',
        parent: 'Theme.SplashScreen',
      },
      name: 'windowSplashScreenAnimatedIcon',
      value: '@drawable/splashscreen_logo',
    });
    return cfg;
  });

  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const resDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/res',
      );
      ensureTransparentSplashLogo(resDir);
      return cfg;
    },
  ]);
}

module.exports = withAndroidSplashNoLogo;
