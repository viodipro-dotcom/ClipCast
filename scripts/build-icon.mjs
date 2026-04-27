import fs from 'fs';
import path from 'path';
import url from 'url';
import sharp from 'sharp';
import ico from 'sharp-ico';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const LOGO_PNG = path.join(ROOT, 'assets', 'logo option 1.png');
const OUT_ICO = path.join(ROOT, 'build', 'icon.ico');

async function main() {
  if (!fs.existsSync(LOGO_PNG)) {
    console.error('[build-icon] Missing:', LOGO_PNG);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT_ICO), { recursive: true });

  const image = sharp(LOGO_PNG);
  await ico.sharpsToIco([image], OUT_ICO, {
    sizes: [256, 128, 64, 48, 32, 16],
  });
  console.log('[build-icon] Written:', OUT_ICO);
}

main().catch((err) => {
  console.error('[build-icon]', err);
  process.exit(1);
});
