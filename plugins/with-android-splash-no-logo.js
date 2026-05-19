/**
 * Dopo expo prebuild: splash Android = solo sfondo nero, MAI logo/icona app.
 * (Il video di caricamento è AppLoadingShell via API.)
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const STYLES_XML = `<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
    <item name="android:enforceNavigationBarContrast" tools:targetApi="29">true</item>
    <item name="android:editTextBackground">@drawable/rn_edit_text_material</item>
    <item name="colorPrimary">@color/colorPrimary</item>
    <item name="android:statusBarColor">#000000</item>
  </style>
  <style name="Theme.App.SplashScreen" parent="AppTheme">
    <item name="android:windowBackground">@drawable/ic_launcher_background</item>
  </style>
</resources>
`;

const LAUNCHER_BG_XML = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/splashscreen_background"/>
</layer-list>
`;

function withAndroidSplashNoLogo(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const resDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/res',
      );
      fs.writeFileSync(path.join(resDir, 'values/styles.xml'), STYLES_XML, 'utf8');
      fs.writeFileSync(
        path.join(resDir, 'drawable/ic_launcher_background.xml'),
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
      return cfg;
    },
  ]);
}

module.exports = withAndroidSplashNoLogo;
