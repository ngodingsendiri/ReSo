/**
 * Audit duplikasi permanen — mendeteksi fungsi yang disalin antar file dan
 * BELUM tercakup pengawasan, lalu GAGAL. "Tercakup" berarti salah satu dari:
 *
 * 1. Di dalam blok marker (NORMALIZE/DONEMSG/PARSERS/PANELTOOLS/FBURLS) —
 *    sudah di-awasi fixture parity (normalization-fixture / ui-consistency).
 * 2. Terdaftar di PARITY_REGISTRY (tests/duplication-registry.mjs) — salinan
 *    wajib identik, di-awasi test PARITY helper plumbing.
 * 3. Terdaftar di PARITY_EXCLUSIONS — duplikat identik yang sengaja tidak
 *    diseragamkan (dengan alasan tertulis).
 *
 * Gagal = temuan baru, mis.: seseorang menyalin `post()` ke file ke-4 tanpa
 * mendaftarkannya, atau menambah helper baru yang diduplikasi tapi tidak
 * masuk registry. Perbaikan: daftarkan di PARITY_REGISTRY (bila salinan
 * wajib identik) atau PARITY_EXCLUSIONS (bila sengaja dibiarkan berbeda).
 * Pure ESM — node --test, zero deps.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PARITY_REGISTRY,
  PARITY_EXCLUSIONS,
  extractFnBalanced,
  findMarkerSpans,
} from "./duplication-registry.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// File yang dipindai — DETEKSI OTOMATIS (glob): setiap `*.js` di root ikut
// diaudit, jadi file sumber baru (mis. content script/platform baru) tidak
// bisa lolos tanpa didaftarkan di registry. Subdirektori (tests/, dist/,
// fonts/, icons/) tidak ikut; diurutkan agar deterministik.
const FILES = fs
  .readdirSync(ROOT)
  .filter((f) => f.endsWith(".js") && fs.statSync(path.join(ROOT, f)).isFile())
  .sort();

const minify = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\s+/g, "");

/** Semua deklarasi fungsi per file: name -> { min, positions[] }. */
function collect(src) {
  const out = new Map();
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const body = extractFnBalanced(src, name);
    if (body == null) continue;
    if (!out.has(name)) out.set(name, { min: minify(body), positions: [] });
    out.get(name).positions.push(m.index);
    // Lompati body agar deklarasi bersarang tidak dihitung ganda.
    re.lastIndex = m.index + body.length;
  }
  return out;
}

test("audit duplikasi: semua fungsi yang disalin antar file tercakup (registry/marker/exclusion)", () => {
  // Sanity glob: file sumber inti harus ikut dipindai — kalau filter berubah
  // sehingga salah satunya lolos, audit kehilangan cakupan dan test ini merah.
  for (const core of ["shared.js", "background.js", "inject-fb.js", "content-ig.js"]) {
    assert.ok(FILES.includes(core), `glob audit tidak menemukan ${core}`);
  }
  const perFile = new Map();
  const spans = new Map();
  for (const f of FILES) {
    const src = read(f);
    perFile.set(f, collect(src));
    spans.set(f, findMarkerSpans(src));
  }

  // Kelompokkan lokasi berdasarkan body identik (whitespace-normalized).
  const buckets = new Map(); // min -> [{ file, name, pos }]
  for (const [f, fns] of perFile) {
    for (const [name, { min, positions }] of fns) {
      for (const pos of positions) {
        if (!buckets.has(min)) buckets.set(min, []);
        buckets.get(min).push({ file: f, name, pos });
      }
    }
  }

  const findings = [];
  for (const [min, locs] of buckets) {
    if (locs.length < 2) continue; // hanya duplikasi lintas lokasi
    const files = new Set(locs.map((l) => l.file));
    const names = new Set(locs.map((l) => l.name));

    // 1. Semua lokasi di dalam blok marker file-nya → sudah di-awasi marker test.
    const allInMarkers = locs.every((l) =>
      spans.get(l.file).some(([s, e]) => l.pos >= s && l.pos < e)
    );
    if (allInMarkers) continue;

    // 2/3. Satu nama & semua file tercakup registry / exclusion.
    if (names.size === 1) {
      const n = [...names][0];
      const reg = PARITY_REGISTRY[n];
      if (reg && [...files].every((f) => reg.includes(f))) continue;
      if (PARITY_EXCLUSIONS.some((x) => x.name === n)) continue;
    }

    findings.push({
      locations: locs.map((l) => `${l.file}:${l.name}`),
      body: min.slice(0, 120),
    });
  }

  assert.deepEqual(
    findings,
    [],
    [
      "Fungsi disalin antar file tapi BELUM tercakup pengawasan.",
      "Daftarkan di tests/duplication-registry.mjs:",
      "- PARITY_REGISTRY bila salinan wajib identik (nama + daftar file),",
      "- PARITY_EXCLUSIONS bila duplikat identik yang sengaja dibiarkan (dengan alasan),",
      "- atau pindahkan ke blok marker bila sudah di-awasi marker parity test.",
    ].join("\n")
  );
});
