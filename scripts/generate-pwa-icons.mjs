/**
 * Generate PNG icons from public/pwa-icon.svg (source of truth).
 * Run: node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const svgPath = path.join(publicDir, 'pwa-icon.svg');

if (!fs.existsSync(svgPath)) {
  console.error('Missing public/pwa-icon.svg');
  process.exit(1);
}

const svg = fs.readFileSync(svgPath);

const jobs = [
  { file: 'icon-192x192.png', size: 192 },
  { file: 'icon-512x512.png', size: 512 },
  { file: 'maskable-icon-512x512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'apple-touch-icon-180.png', size: 180 },
];

for (const job of jobs) {
  // Maskable: slight padding so safe zone is ok
  const density = 300;
  let pipeline = sharp(svg, { density });
  if (job.file.includes('maskable')) {
    // Render smaller glyph centered on full canvas with solid bg matching theme
    const inner = Math.round(job.size * 0.8);
    const pad = Math.round((job.size - inner) / 2);
    const icon = await sharp(svg, { density })
      .resize(inner, inner)
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: job.size,
        height: job.size,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 1 }, // slate-900
      },
    })
      .composite([{ input: icon, top: pad, left: pad }])
      .png()
      .toFile(path.join(publicDir, job.file));
  } else {
    await pipeline.resize(job.size, job.size).png().toFile(path.join(publicDir, job.file));
  }
  const out = fs.readFileSync(path.join(publicDir, job.file));
  console.log('wrote', job.file, out.length, 'bytes', out.subarray(0, 4).toString('hex'));
}

console.log('PWA icons generated.');
