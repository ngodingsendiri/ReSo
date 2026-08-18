#!/usr/bin/env node
/**
 * scripts/zip.mjs — buat release zip tanpa dependensi eksternal.
 *
 * Memakai zlib bawaan Node (deflate) + CRC32 manual → cukup `npm run zip`,
 * tanpa perlu tool `zip`/PowerShell/Python di sistem. Output:
 *   reso-ekstention-<version>.zip   (version dari package.json)
 *
 * Isi zip = isi folder dist/ (manifest.json di root), nama entry pakai
 * forward slash, flag UTF-8 diset → bisa diekstrak di Windows/macOS/Linux.
 *
 * Verifikasi sebelum menyatakan release sukses:
 *   1. Referensi file di manifest.json (ikon, popup, options, service worker,
 *      content scripts js/css) wajib ADA di dalam zip.
 *   2. Referensi sekunder ikut dicek: aset href/src di popup.html & options.html,
 *      import module (background.js → shared-module.js, shared-module.js →
 *      shared.js), dan nama file executeScript (inject-*.js, content-*.js/css).
 *   3. Setelah ditulis, zip dibaca ulang & tiap entry di-inflate + CRC-nya
 *      dicek ulang — release yang rusak gagal di sini, bukan di Chrome.
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const OUT = join(ROOT, `reso-ekstention-${pkg.version}.zip`);

if (!existsSync(DIST)) {
  console.error("dist/ tidak ada — jalankan `npm run build` dulu (atau `npm run zip`).");
  process.exit(1);
}

// ---- CRC32 (IEEE, polynomial 0xEDB88320) ----
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// ---- kumpulkan file dist/ (urut deterministik) ----
const filePaths = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (st.isFile()) filePaths.push(p);
  }
})(DIST);
filePaths.sort();

// ---- bangun entry (local header + data terkompresi) ----
const entries = [];
const localParts = [];
let offset = 0;

for (const p of filePaths) {
  const name = relative(DIST, p).split(sep).join("/");
  let data;
  try {
    data = readFileSync(p);
  } catch (err) {
    console.error(`✗ Tidak bisa membaca ${p}: ${err.message}`);
    process.exit(1);
  }
  const { time, date } = dosDateTime(statSync(p).mtime);
  const crc = crc32(data);
  const compressed = deflateRawSync(data, { level: 9 });
  const csize = compressed.length;
  const usize = data.length;
  const nameBuf = Buffer.from(name, "utf8");

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // "PK\x03\x04"
  local.writeUInt16LE(20, 4);         // version needed
  local.writeUInt16LE(0x0800, 6);     // general purpose: UTF-8 names
  local.writeUInt16LE(8, 8);          // method: deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(csize, 18);
  local.writeUInt32LE(usize, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);         // extra len

  entries.push({ name, crc, csize, usize, offset, time, date });
  localParts.push(Buffer.concat([local, nameBuf, compressed]));
  offset += 30 + nameBuf.length + csize;
}

// =====================================================================
// Verifikasi referensi — SEMUA file yang dirujuk manifest & kode wajib
// ada di dalam zip, DILAKUKAN SEBELUM zip ditulis.
// =====================================================================
const entryNames = new Set(entries.map((e) => e.name));
const problems = [];
const perSource = [];

function verify(label, refs, origin) {
  const unique = [...new Set(refs)].filter(Boolean);
  perSource.push([label, unique.length]);
  for (const r of unique) {
    if (!entryNames.has(r)) problems.push(`${r}  (dirujuk oleh ${origin})`);
  }
}

// 0) Guard versi — versi manifest di dalam zip WAJIB sama dengan versi
// package.json (nama file zip). Mismatch = build basi / stamp gagal.
{
  const distManifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
  if (distManifest.version !== pkg.version) {
    console.error(
      `zip: versi tidak konsisten! package.json=${pkg.version} vs dist/manifest.json=${distManifest.version}. ` +
        `Jalankan npm run build (stamp-version) sebelum zip.`
    );
    process.exit(1);
  }
}

// 1) Referensi langsung dari manifest.json
const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
{
  const refs = [];
  for (const v of Object.values(manifest.icons || {})) refs.push(v);
  for (const v of Object.values((manifest.action || {}).default_icon || {})) refs.push(v);
  refs.push(manifest.action && manifest.action.default_popup);
  refs.push(manifest.options_ui && manifest.options_ui.page);
  refs.push(manifest.background && manifest.background.service_worker);
  for (const cs of manifest.content_scripts || []) {
    (cs.js || []).forEach((f) => refs.push(f));
    (cs.css || []).forEach((f) => refs.push(f));
  }
  verify("manifest.json", refs, "manifest.json");
}

// 2) Referensi sekunder — aset HTML (link/script/img)
function htmlAssets(file) {
  const html = readFileSync(file, "utf8");
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((v) => !v.startsWith("http") && !v.startsWith("#"));
}
verify("popup.html", htmlAssets(join(DIST, "popup.html")), "popup.html");

// 3) Referensi sekunder — import module (background/shared-module)
function moduleImports(file) {
  const src = readFileSync(file, "utf8");
  return [
    ...[...src.matchAll(/from\s+["']\.\/([^"']+)["']/g)].map((m) => m[1]),
    ...[...src.matchAll(/import\s+["']\.\/([^"']+)["']/g)].map((m) => m[1]),
  ];
}
for (const f of ["background.js", "popup.js", "shared-module.js"]) {
  verify(f, moduleImports(join(DIST, f)), f);
}

// 4) Referensi sekunder — nama file executeScript (inject-*, content-*)
function executeScriptFiles(file) {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/["']((?:inject|content)-[a-z]+\.(?:js|css))["']/g)].map((m) => m[1]);
}
verify("background.js (executeScript)", executeScriptFiles(join(DIST, "background.js")), "background.js");

if (problems.length > 0) {
  console.error("✗ Referensi yang tidak ada di dalam zip:");
  for (const p of problems) console.error(`   - ${p}`);
  console.error(`  ${OUT} TIDAK jadi ditulis.`);
  process.exit(1);
}
console.log(
  `✓ referensi zip OK — ${perSource.map(([l, n]) => `${l} ${n}`).join(", ")}`,
);

// ---- central directory ----
const centralParts = [];
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, "utf8");
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); // "PK\x01\x02"
  c.writeUInt16LE(0x0014, 4);     // version made by (DOS)
  c.writeUInt16LE(20, 6);         // version needed
  c.writeUInt16LE(0x0800, 8);     // UTF-8 names
  c.writeUInt16LE(8, 10);         // deflate
  c.writeUInt16LE(e.time, 12);
  c.writeUInt16LE(e.date, 14);
  c.writeUInt32LE(e.crc, 16);
  c.writeUInt32LE(e.csize, 20);
  c.writeUInt32LE(e.usize, 24);
  c.writeUInt16LE(nameBuf.length, 28);
  c.writeUInt16LE(0, 30);         // extra len
  c.writeUInt16LE(0, 32);         // comment len
  c.writeUInt16LE(0, 34);         // disk number start
  c.writeUInt16LE(0, 36);         // internal attrs
  c.writeUInt32LE(0, 38);         // external attrs
  c.writeUInt32LE(e.offset, 42);
  centralParts.push(Buffer.concat([c, nameBuf]));
}
const centralDir = Buffer.concat(centralParts);
const centralOffset = offset;

// ---- end of central directory ----
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); // "PK\x05\x06"
eocd.writeUInt16LE(0, 4);          // disk number
eocd.writeUInt16LE(0, 6);          // disk with central dir
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(centralDir.length, 12);
eocd.writeUInt32LE(centralOffset, 16);
eocd.writeUInt16LE(0, 20);         // comment len

writeFileSync(OUT, Buffer.concat([...localParts, centralDir, eocd]));

// ---- verifikasi mandiri: inflate ulang + cek CRC tiap entry ----
const zipBytes = readFileSync(OUT);
let failures = 0;
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, "utf8");
  const start = e.offset + 30 + nameBuf.length;
  const raw = zipBytes.subarray(start, start + e.csize);
  let infl;
  try {
    infl = inflateRawSync(raw);
  } catch {
    failures++;
    console.error("  GAGAL inflate:", e.name);
    continue;
  }
  if (infl.length !== e.usize || crc32(infl) !== e.crc) {
    failures++;
    console.error("  GAGAL CRC/size:", e.name);
  }
}

if (failures > 0) {
  console.error(`✗ ${failures} entry rusak — ${OUT} tidak jadi dipakai.`);
  process.exit(1);
}

const total = entries.reduce((s, e) => s + e.usize, 0);
console.log(
  `✓ ${OUT} — ${entries.length} entry, ${(total / 1024).toFixed(1)} KB (deflate level 9, terverifikasi ${entries.length}/${entries.length})`,
);
