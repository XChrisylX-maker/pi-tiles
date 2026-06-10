import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const logoPath = process.argv[2];
const outputPath = path.join(root, "pi-store-assets", "fireside-playpitiles-official.png");
const qrPath = path.join(root, "pi-store-assets", "fireside-playpitiles-qr.png");

const qrGenerator = path.join(root, "scripts", "generate-pi-qr");
execFileSync("clang", [
  "-fobjc-arc",
  "-framework",
  "AppKit",
  "-framework",
  "CoreImage",
  path.join(root, "scripts", "generate-pi-qr.m"),
  "-o",
  qrGenerator,
]);
execFileSync(qrGenerator, [
  "pi://play-pi-tiles.com",
  qrPath,
]);

const width = 1080;
const height = 1080;

const background = Buffer.from(`
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="85%">
      <stop offset="0%" stop-color="#21104d"/>
      <stop offset="52%" stop-color="#080b24"/>
      <stop offset="100%" stop-color="#02040d"/>
    </radialGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#18c9ff"/>
      <stop offset="50%" stop-color="#d52cff"/>
      <stop offset="100%" stop-color="#ff2ba6"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="16" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  <rect x="34" y="34" width="1012" height="1012" rx="42" fill="none"
        stroke="url(#edge)" stroke-width="5" opacity=".88" filter="url(#glow)"/>
  <circle cx="90" cy="210" r="3" fill="#46ddff"/>
  <circle cx="980" cy="285" r="4" fill="#ff42ce"/>
  <circle cx="125" cy="880" r="3" fill="#ff42ce"/>
  <circle cx="948" cy="925" r="3" fill="#46ddff"/>
</svg>`);

const text = Buffer.from(`
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="cyanGlow"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <style>
    .sans { font-family: Arial, Helvetica, sans-serif; text-anchor: middle; }
  </style>
  <text x="540" y="530" class="sans" fill="#ffffff" font-size="57" font-weight="800">APPLICATION OFFICIELLE</text>
  <text x="540" y="590" class="sans" fill="#cbd4ff" font-size="30" font-weight="500">Ouvrez PlayPiTiles directement dans Pi Browser</text>
  <rect x="132" y="650" width="816" height="322" rx="36" fill="#080b18" stroke="#2ddcff" stroke-width="3" opacity=".96"/>
  <text x="380" y="732" class="sans" fill="#ffffff" font-size="35" font-weight="700">SCANNEZ POUR JOUER</text>
  <text x="380" y="786" class="sans" fill="#93eaff" font-size="27" font-weight="600">dans Pi Browser</text>
  <text x="380" y="879" class="sans" fill="#ffffff" font-size="34" font-weight="800" filter="url(#cyanGlow)">play-pi-tiles.com</text>
  <text x="380" y="924" class="sans" fill="#b9bfdb" font-size="21">Le jeu, le classement et le Pass VIP officiels</text>
</svg>`);

const logo = await sharp(logoPath)
  .resize(390, 390, { fit: "contain" })
  .png()
  .toBuffer();

const qr = await sharp(qrPath)
  .resize(246, 246, { kernel: "nearest" })
  .extend({ top: 18, bottom: 18, left: 18, right: 18, background: "#ffffff" })
  .png()
  .toBuffer();

await sharp(background)
  .composite([
    { input: logo, left: 345, top: 88 },
    { input: text, left: 0, top: 0 },
    { input: qr, left: 680, top: 669 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

console.log(outputPath);
