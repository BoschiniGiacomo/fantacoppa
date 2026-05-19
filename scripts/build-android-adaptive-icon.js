/**
 * Centra assets/app-icon-android.png (es. 500×500) su canvas 1024×1024 per adaptive icon.
 * Poi: npx expo prebuild --platform android --no-install
 */
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'assets', 'app-icon-android.png');
const out = path.join(root, 'assets', 'app-icon-android-adaptive.png');

const ps = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${src.replace(/'/g, "''")}')
$canvas = New-Object System.Drawing.Bitmap 1024, 1024
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::White)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$x = [int]((1024 - $src.Width) / 2)
$y = [int]((1024 - $src.Height) / 2)
$g.DrawImage($src, $x, $y, $src.Width, $src.Height)
$canvas.Save('${out.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $canvas.Dispose(); $src.Dispose()
Write-Host "Written ${out.replace(/'/g, "''")} ($($src.Width)x$($src.Height) on 1024x1024)"
`;

execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'inherit', cwd: root });
