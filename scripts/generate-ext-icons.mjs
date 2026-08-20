/**
 * Generate icon extension (16/48/128) dari public/logo.svg (logo app).
 * Run: node scripts/generate-ext-icons.mjs
 * Logo transparan di-composite di atas bg slate-900 agar terlihat di toolbar.
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'public', 'logo.svg');
const outDir = path.join(root, 'extension', 'icons');

if (!fs.existsSync(svgPath)) {
  console.error('Missing public/logo.svg');
  process.exit(1);
}

const svg = fs.readFileSync(svgPath);
const jobs = [
  { file: 'icon16.png', size: 16 },
  { file: 'icon48.png', size: 48 },
  { file: 'icon128.png', size: 128 },
];

for (const job of jobs) {
  // Render logo (dengan sedikit padding) lalu composite di atas bg slate-900.
  const inner = Math.round(job.size * 0.9);
  const pad = Math.round((job.size - inner) / 2);
  const icon = await sharp(svg, { density: 300 })
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
    .toFile(path.join(outDir, job.file));
  const out = fs.readFileSync(path.join(outDir, job.file));
  console.log('wrote', job.file, out.length, 'bytes');
}

console.log('Extension icons generated.');
