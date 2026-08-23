import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const svgPath = 'public/logo.svg';
const outPath = 'public/favicon.ico';
const sizes = [16, 32, 48, 64, 128, 256];

const images = [];
for (const size of sizes) {
  const buf = await sharp(svgPath).resize(size, size).png().toBuffer();
  images.push({ size, buf });
  writeFileSync(`public/favicon-${size}.png`, buf);
}

const headerSize = 6;
const entrySize = 16;
const count = images.length;
const dataStart = headerSize + entrySize * count;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(count, 4);

let offset = dataStart;
const entries = [];
for (const { size, buf } of images) {
  const entry = Buffer.alloc(entrySize);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(buf.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += buf.length;
}

const out = Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]);
writeFileSync(outPath, out);
console.log(`OK: ${outPath} (${out.length} bytes, ${count} sizes)`);
