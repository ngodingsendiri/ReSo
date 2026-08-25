/**
 * UI consistency checks — audit otomatis permanen (node --test, zero deps).
 *
 * Dulu audit UI/UX hanya bisa dijalankan manual (baca file + cek mata).
 * File ini memvalidasi tiga hal yang paling sering regresi:
 *
 * 1. HANDLER TOMBOL PANEL — setiap tombol aksi di template panel FB/TT/IG
 *    punya cabang di click delegation, tidak ada cabang yatim; checkbox
 *    "Balasan" & input cari punya listener; Esc menutup panel; tombol
 *    ikon-only wajib punya title + aria-label.
 * 2. IKON TERISI — setiap ikon di panel, popup.html, dan options.html adalah
 *    ref sprite sheet SVG (<use href="#rs-i-…">) yang terisi & valid;
 *    map setStatusIcon popup lengkap; tiap status non-idle punya aturan
 *    warna .stat-ic & .dot di popup.css; badge toolbar memakai warna tabel
 *    CONSISTENCY.md 1.4; SEMUA permukaan bebas font (sprite SVG satu sumber).
 * 3. FIXTURE PARITY — peta aksi→ikon & set ikon identik di 3 panel; blok
 *    marker bersama (NORMALIZE/DONEMSG/PARSERS/PANELTOOLS/FBURLS) tetap
 *    byte-identik antar salinan; prefix hint seragam "Target:".
 * 4. STRUKTUR RENDER() — render mengisi semua elemen display data-x
 *    (status/hint/count/badge/list/replies), tombol stop tersembunyi saat
 *    tidak running, ikon process swap saat running, dan FAB data-count
 *    mengikuti state (count/kosong) + kelas running/done + title dinamis.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PARITY_REGISTRY, PARITY_NAMES, extractFnBalanced } from "./duplication-registry.mjs";
import path from "node:path";
// Side-effect: shared.js classic-compatible — mengisi globalThis.RS_SHARED
// (dipakai harness render yang menjalankan render() asli content script).
import "../shared.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");
const exists = (f) => existsSync(path.join(root, f));

const PLATFORMS = {
  facebook: { file: "content-fb.js", attr: "fnk" },
  tiktok: { file: "content-tiktok.js", attr: "tnk" },
  instagram: { file: "content-ig.js", attr: "ing" },
};

// Aksi inti desain (CONSISTENCY.md 1.1) — subset WAJIB ADA. Menambah tombol
// aksi baru tidak memecah test (parity template↔handler + kesetaraan lintas
// platform tetap dijaga); menghapus aksi inti langsung ketahuan.
const CORE_ACTIONS = [
  "fab",
  "min",
  "process-send",
  "reset",
  "stop",
];

// Status inti (tabel CONSISTENCY.md 1.4) — wajib ADA di map setStatusIcon.
// Menambah status baru TIDAK memecah test asalkan aturan warna CSS-nya ikut
// ada (test "WARNA STATUS" menurunkan daftar status dari map).
const REQUIRED_STATUSES = ["idle", "running", "done", "partial", "stopped", "error"];

// ---- Ekstraksi dari source (tanpa parse DOM/JS) ---------------------------

/** Template panel: isi string `root.innerHTML = \`...\`;`. */
function extractPanelTemplate(src) {
  const m = src.match(/root\.innerHTML\s*=\s*`([\s\S]*?)`;/);
  assert.ok(m, "template root.innerHTML tidak ditemukan");
  return m[1];
}

/** Blok handler click delegation (brace-balanced) mulai dari addEventListener. */
function extractClickHandler(src) {
  const start = src.indexOf('root.addEventListener("click", (e) => {');
  assert.ok(start >= 0, "click delegation tidak ditemukan");
  const open = src.indexOf("{", start);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

/** Nama aksi tombol di template: data-fnk/tnk/ing pada <button ...>. */
function buttonActions(tpl) {
  const out = [];
  for (const m of tpl.matchAll(/<button\b[^>]*>/g)) {
    const attr = m[0].match(/data-(?:fnk|tnk|ing)="([^"]+)"/);
    if (attr) out.push(attr[1]);
  }
  return out;
}

/** Cabang aksi di handler: `act === "x"`. */
function handlerActs(handler) {
  return [...handler.matchAll(/act\s*===\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** Normalisasi representasi ikon panel FB — token `${svgIcon("x"[, cls][, viewBox])}`
 *  (template) dan `<svg class="rs-ic..." data-ic="x">…</svg>` (badge inline)
 *  → span ligature, supaya pembanding ikon lintas platform tetap berfungsi
 *  (FB kini SVG inline; TT/IG tetap glyph font). */
function canonIcons(s) {
  const tokenRe =
    /\$\{svgIcon\("([a-z0-9_]+)"(?:,\s*"([^"]*)")?(?:,\s*"[^"]*")?\)\}/g;
  const svgRe =
    /<svg class="rs-ic([^"]*)"[^>]*data-ic="([a-z0-9_]+)"[^>]*>[\s\S]*?<\/svg>/g;
  return s
    .replace(tokenRe, (_m, name, cls) =>
      `<span aria-hidden="true" class="rs-ic${cls ? ` ${cls}` : ""}">${name}</span>`
    )
    .replace(svgRe, (_m, cls, name) => `<span class="rs-ic${cls}">${name}</span>`);
}

/** Teks ligature semua <span class="rs-ic ..."> (kelas bisa tambahan).
 *  Tolan atribut lain sebelum class (FB canon: aria-hidden mendahului).
 *  Span ber-id (mis. statIcon popup) diisi JS saat runtime — bukan glyph
 *  statis, jadi dikecualikan dari cek keterisian. */
function iconTexts(str) {
  return [
    ...canonIcons(str).matchAll(/<span[^>]*class="rs-ic[^"]*"[^>]*>([^<]*)<\/span>/g),
  ]
    .filter((m) => !/<span[^>]*\bid=/.test(m[0]))
    .map((m) => m[1]);
}

/** Teks ikon template PANEL kecuali elemen logo (kelas mengandung "logo").
 *  Glyph logo boleh berubah per platform (FB/TT/IG punya brand sendiri) —
 *  yang dikecualikan adalah ELEMENNYA, bukan glyph spesifiknya. */
function nonLogoIcons(tpl) {
  return [
    ...canonIcons(tpl).matchAll(/<span[^>]*class="rs-ic([^"]*)"[^>]*>([^<]*)<\/span>/g),
  ]
    .filter((m) => !m[1].includes("logo"))
    .map((m) => m[2]);
}

const ICON_RE = /^[a-z0-9_]+$/;
function assertIconsFilled(label, texts) {
  assert.ok(texts.length > 0, `${label}: tidak ada ikon yang ditemukan`);
  for (const t of texts) {
    assert.ok(
      ICON_RE.test(t),
      `${label}: ikon kosong/tidak valid: ${JSON.stringify(t)}`
    );
  }
}

/** id pada <button>/<input> (kontrol yang wajib di-wire ke JS). */
function controlIds(html) {
  return [...html.matchAll(/<(?:button|input)\b[^>]*\bid="([^"]+)"/g)].map(
    (m) => m[1]
  );
}

/** id yang direferensikan JS: $("x") atau getElementById("x"). */
function jsIdRefs(src) {
  return [
    ...src.matchAll(/\$\("([^"]+)"\)|getElementById\("([^"]+)"\)/g),
  ].map((m) => m[1] || m[2]);
}

// ===================== 1. Handler tombol panel =====================

for (const [platform, { file, attr }] of Object.entries(PLATFORMS)) {
  const src = read(file);
  const tpl = extractPanelTemplate(src);
  const handler = extractClickHandler(src);

  test(`PANEL ${platform}: tombol template ↔ cabang handler identik (tanpa cabang yatim)`, () => {
    const acts = buttonActions(tpl).sort();
    const handled = handlerActs(handler).sort();
    assert.deepEqual(handled, acts, "aksi tombol vs cabang handler tidak sinkron");
    const missing = CORE_ACTIONS.filter((a) => !acts.includes(a));
    assert.deepEqual(
      missing,
      [],
      `aksi inti hilang dari ${platform}: ${missing.join(", ")}`
    );
  });

  test(`PANEL ${platform}: checkbox Balasan & cari punya listener; Esc menutup; aksesibilitas`, () => {
    assert.match(tpl, new RegExp(`data-${attr}="replies"`), "checkbox Balasan hilang");
    assert.ok(src.includes('addEventListener("change"'), "listener change hilang");
    assert.match(src, /e\.key\s*!==\s*"Escape"/, "handler Esc hilang");
    // Semua tombol ikon-only wajib punya tooltip + label (a11y)
    for (const m of tpl.matchAll(/<button\b[^>]*>/g)) {
      const tag = m[0];
      assert.match(tag, /title="[^"]+"/, `tombol tanpa title: ${tag}`);
      assert.match(tag, /aria-label="[^"]+"/, `tombol tanpa aria-label: ${tag}`);
    }
  });
}

// ===================== 2. Ikon terisi =====================

test("IKON: terisi & valid di 3 template panel (popup minimal tanpa ikon sprite)", () => {
  for (const { file } of Object.values(PLATFORMS)) {
    assertIconsFilled(file, iconTexts(extractPanelTemplate(read(file))));
  }
  // Popup kini minimal (toggle mode) — memakai logo img, bukan ikon sprite.
  assert.ok(
    !/<span\b[^>]*class="[^"]*\brs-ic\b/.test(read("popup.html")),
    "popup.html masih memakai glyph rs-ic (harus logo img)"
  );
});

test("BADGE toolbar: warna tabel CONSISTENCY.md 1.4 + glyph ■ saat stopped", () => {
  const bg = read("background.js");
  assert.ok(bg.includes("#42b72a"), "badge done hijau (#42b72a) hilang");
  assert.ok(bg.includes("#f7b928"), "badge partial amber (#f7b928) hilang");
  assert.ok(bg.includes("#6366f1"), "badge accent stopped (#6366f1) hilang");
  // Cocokkan ASSIGNMENT-nya, bukan sekadar kemunculan string — komentar
  // di atasnya juga memuat "■" dan bisa menyamarkan regresi.
  assert.match(bg, /text\s*=\s*"■"/, "glyph ■ (ikon stop teks) saat stopped hilang");
});

test("FONT: SEMUA permukaan bebas font — ikon = sprite SVG satu sumber", () => {
  // Bundle font dihapus total — tidak ada permukaan yang memakai glyph lagi
  // (panel sejak konversi SVG; popup/options kini ikut sprite yang sama).
  assert.ok(
    !exists("fonts/material-symbols-rounded.woff2"),
    "font woff2 masih ada (tak terpakai lagi)"
  );
  assert.ok(
    !read("manifest.json").includes("fonts/"),
    "manifest masih mengekspos font (web_accessible_resources)"
  );
  // CSS semua permukaan (popup, options, panel): dilarang @font-face /
  // nama font / URL bundle — referensi font = elemen yang bakal tampil
  // sebagai teks (bug ikon rusak), terutama di halaman dengan CSP ketat.
  for (const css of [
    "popup.css",
    ...Object.values(PLATFORMS).map(({ file }) => file.replace(/\.js$/, ".css")),
  ]) {
    const s = read(css);
    assert.ok(!/@font-face\s*{/.test(s), `${css} masih memuat @font-face`);
    assert.ok(!s.includes("Material Symbols Rounded"), `${css} masih memuat nama font`);
    assert.ok(!s.includes("fonts/"), `${css} masih merujuk bundle font`);
  }
  // JS popup/options/panel juga bebas referensi font.
  for (const js of ["popup.js", ...Object.values(PLATFORMS).map(({ file }) => file)]) {
    const s = read(js);
    assert.ok(!s.includes("Material Symbols Rounded"), `${js} masih memuat nama font`);
    assert.ok(!s.includes("ensureIconFont"), `${js} masih memuat ensureIconFont`);
  }
  // popup.html/options.html: nol span glyph rs-ic — semua ikon sprite svg.
  for (const html of ["popup.html"]) {
    assert.ok(
      !/<span\b[^>]*class="[^"]*\brs-ic\b/.test(read(html)),
      `${html} masih ada span glyph rs-ic (ikon tampil sebagai teks)`
    );
  }
});

// ===================== 3. Fixture parity =====================

test("PANEL PARITY: peta aksi→ikon identik; set ikon identik tanpa elemen logo", () => {
  const maps = [];
  const sets = [];
  for (const { file, attr } of Object.values(PLATFORMS)) {
    const tpl = extractPanelTemplate(read(file));
    const map = {};
    for (const m of tpl.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const a = m[1].match(new RegExp(`data-${attr}="([^"]+)"`))[1];
      const ic = canonIcons(m[2]).match(
        /class="rs-ic[^"]*"[^>]*>([^<]*)</
      )[1];
      map[a] = ic;
    }
    maps.push(map);
    sets.push(nonLogoIcons(tpl).sort());
  }
  assert.deepEqual(maps[1], maps[0], "panel TikTok menyimpang dari FB");
  assert.deepEqual(maps[2], maps[0], "panel Instagram menyimpang dari FB");
  assert.deepEqual(sets[1], sets[0], "set ikon TikTok menyimpang");
  assert.deepEqual(sets[2], sets[0], "set ikon Instagram menyimpang");
});

test("WIRING popup: setiap kontrol ber-id punya referensi di JS", () => {
  for (const [html, js] of [
    ["popup.html", "popup.js"],
  ]) {
    const ids = controlIds(read(html));
    const refs = new Set(jsIdRefs(read(js)));
    assert.ok(ids.length > 0, `${html}: tidak ada kontrol ber-id`);
    for (const id of ids) {
      assert.ok(refs.has(id), `${js} tidak mereferensikan #${id}`);
    }
  }
});

// ---- Blok marker bersama (ringkas; detail perilaku di
//      normalization-fixture.test.mjs) --------------------------------------

function extractBlocks(kind, src) {
  const BEGIN = `// BEGIN-RESO-${kind}`;
  const END = `// END-RESO-${kind}`;
  const out = [];
  let i = 0;
  for (;;) {
    const b = src.indexOf(BEGIN, i);
    if (b === -1) break;
    const e = src.indexOf(END, b);
    assert.ok(e > b, `END marker missing after BEGIN ${kind}`);
    out.push(src.slice(b + BEGIN.length, e).trim());
    i = e + END.length;
  }
  return out;
}

/** Bandingkan token: buang whitespace + komentar //. */
const minify = (src) => src.replace(/\/\/[^\n]*/g, "").replace(/\s+/g, "");

/** Ekstrak deklarasi `function name(`..`}` pertama (brace-balanced). */
function extractFn(src, name) {
  const idx = src.indexOf(`function ${name}(`);
  assert.ok(idx >= 0, `function ${name} tidak ditemukan`);
  const open = src.indexOf("{", idx);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(idx, i + 1);
}

test("PARITY blok marker: salinan member identik dengan shared (5 kind)", () => {
  const PLAN = {
    NORMALIZE: {
      shared: 3,
      members: [
        ["inject-fb.js", 0],
        ["content-fb.js", 0],
        ["inject-tiktok.js", 1],
        ["content-tiktok.js", 1],
        ["inject-ig.js", 2],
        ["content-ig.js", 2],
      ],
    },
    DONEMSG: {
      shared: 1,
      members: [
        ["content-fb.js", 0],
        ["content-tiktok.js", 0],
        ["content-ig.js", 0],
      ],
    },
    PARSERS: {
      shared: 1,
      members: [
        ["inject-fb.js", 0],
        ["inject-tiktok.js", 0],
        ["inject-ig.js", 0],
      ],
    },
    PANELTOOLS: {
      shared: 1,
      members: [
        ["content-fb.js", 0],
        ["content-tiktok.js", 0],
        ["content-ig.js", 0],
      ],
    },
    FBURLS: {
      shared: 1,
      members: [
        ["inject-fb.js", 0],
        ["content-fb.js", 0],
      ],
    },
  };
  const shared = read("shared.js");
  for (const [kind, plan] of Object.entries(PLAN)) {
    const refs = extractBlocks(kind, shared).map(minify);
    assert.equal(refs.length, plan.shared, `shared harus punya ${plan.shared} blok ${kind}`);
    for (const [file, idx] of plan.members) {
      const copies = extractBlocks(kind, read(file)).map(minify);
      assert.equal(copies.length, 1, `${file} harus punya 1 blok ${kind}`);
      assert.equal(copies[0], refs[idx], `${file} blok ${kind} drift dari shared`);
    }
  }
});

test("SHARED classic: shared.js satu sumber (tanpa salinan inline di content script)", () => {
  // shared.js kini DUAL-MODE: classic (content scripts via manifest) + module
  // (di-import side-effect oleh shared-module.js, di-re-export bernama untuk
  // popup/options/background). Kunci: TANPA statement import/export di
  // shared.js agar valid di kedua loader — duplikasi helper ke content
  // script tidak boleh ada lagi (menambah helper cukup di shared.js + daftar
  // di RS_SHARED + shared-module.js).
  const sharedSrc = read("shared.js");
  assert.ok(
    !/\b(?:import|export)\b/.test(sharedSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")),
    "shared.js memuat import/export — harus bebas agar valid sebagai classic script"
  );
  // Empat helper panel ada di shared.js & terdaftar di RS_SHARED.
  for (const fn of [
    "svgIcon",
    "iconSprite",
    "injectIconSprite",
    "fbTargetLabel",
    "igTargetLabel",
    "resolveTheme",
  ]) {
    assert.match(sharedSrc, new RegExp(`function ${fn}\\(`), `${fn} hilang dari shared.js`);
    assert.match(
      sharedSrc,
      new RegExp(`\\b${fn}\\b`),
      `${fn} tidak ada di registry RS_SHARED`
    );
    // shared-module.js re-export bernama untuk konsumen module.
    assert.match(
      read("shared-module.js"),
      new RegExp(`\\b${fn}\\b`),
      `${fn} tidak di-re-export shared-module.js`
    );
  }
  // Content script: TIDAK boleh mendefinisikan helper lagi (salinan inline
  // dihapus) — cukup destructure dari globalThis.RS_SHARED.
  const manifest = read("manifest.json");
  for (const [platform, { file }] of Object.entries(PLATFORMS)) {
    const src = read(file);
    assert.ok(
      !src.includes(`function svgIcon(`),
      `${file} masih mendefinisikan svgIcon (harus dari RS_SHARED)`
    );
    assert.match(
      src,
      /const \{ [^}]*\} =\s*globalThis\.RS_SHARED;/,
      `${file} tanpa destructure RS_SHARED`
    );
    const entry = manifest.match(
      new RegExp(
        `\\"js\\"\\s*:\\s*\\[\\s*\\"shared\\.js\\"\\s*,\\s*\\"${file}\"\\s*\\]`
      )
    );
    assert.ok(entry, `manifest tidak memuat shared.js sebelum ${file}`);
  }
});

test("resolveTheme: light/dark eksplisit menang, system mengikuti prefers-color-scheme", () => {
  // Kompilasi salinan shared (tanpa `export`) dan jalankan dengan stub
  // window.matchMedia — kunci SEMANTIK resolusi, bukan hanya parity teks.
  const fnSrc = extractFn(read("shared.js"), "resolveTheme");
  const resolveTheme = new Function(`return (${fnSrc});`)();
  const realWindow = globalThis.window;
  try {
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    assert.equal(resolveTheme("light"), "light");
    assert.equal(resolveTheme("dark"), "dark");
    assert.equal(resolveTheme("system"), "dark");
    assert.equal(resolveTheme(undefined), "dark");
    assert.equal(resolveTheme(""), "dark");
    assert.equal(resolveTheme(null), "dark");
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    assert.equal(resolveTheme("system"), "light");
  } finally {
    globalThis.window = realWindow;
  }
});

test("PARITY helper plumbing: salinan identik lintas platform (registry)", () => {
  // Helper yang diduplikasi antar file TANPA blok marker (pola resolveTheme /
  // fbTargetLabel). Registry tinggal di tests/duplication-registry.mjs (juga
  // dipakai duplication-audit.test.mjs). Pair 2-file = alur platform memang
  // berbeda (FB: template sintetik / tanpa NEED_TEMPLATE / render renderUi).
  for (const [fn, files] of Object.entries(PARITY_REGISTRY)) {
    const refSrc = extractFnBalanced(read(files[0]), fn);
    assert.ok(refSrc, `function ${fn} tidak ditemukan di ${files[0]}`);
    const ref = minify(refSrc);
    for (const f of files.slice(1)) {
      const copySrc = extractFnBalanced(read(f), fn);
      assert.ok(copySrc, `function ${fn} tidak ditemukan di ${f}`);
      assert.equal(
        minify(copySrc),
        ref,
        `${fn} di ${f} drift dari ${files[0]} (salinan harus identik)`
      );
    }
  }
});

test("PARITY naming: nama + tanda tangan sama lintas platform (body per-platform bebas)", () => {
  // mapDone: body sengaja beda (stop reason per platform — FB complete/idle,
  // IG blocked/checkpoint, TT no_video), jadi bukan PARITY_REGISTRY (harus
  // identik). Yang dikunci adalah penamaan + tanda tangan: rename di satu
  // file membuat `function mapDone(` tidak ditemukan → test merah.
  for (const [fn, files] of Object.entries(PARITY_NAMES)) {
    const sigs = files.map((f) => {
      const src = extractFnBalanced(read(f), fn);
      assert.ok(src, `function ${fn} tidak ditemukan di ${f}`);
      return minify(src.slice(src.indexOf("("), src.indexOf(") {") + 1));
    });
    assert.equal(
      new Set(sigs).size,
      1,
      `${fn}: tanda tangan harus sama di ${files.join(", ")}`
    );
  }
});

// ===================== 4. Struktur render() panel (deep) =====================

/** Nama fungsi render tiap panel (mengisi elemen display + state FAB). */
const RENDER_FN = {
  facebook: "renderUi",
  tiktok: "render",
  instagram: "render",
};

/** Ekstrak satu fungsi (brace-balanced) dari source. */
function extractFunction(src, fnName) {
  const start = src.indexOf(`function ${fnName}(`);
  assert.ok(start >= 0, `function ${fnName} tidak ditemukan`);
  const open = src.indexOf("{", start);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

// Elemen display yang wajib di-populate render. reset/min/search ditangani
// oleh listener (click/input), bukan render — sengaja tidak ada di sini.
const RENDER_KEYS = [
  "status",
  "count",
  "replies",
  "process-send",
  "stop",
  "fab",
];

for (const [platform, { file, attr }] of Object.entries(PLATFORMS)) {
  const src = read(file);
  const tpl = extractPanelTemplate(src);
  const render = extractFunction(src, RENDER_FN[platform]);

  test(`RENDER ${platform}: mengisi semua elemen data-${attr} (status/count/replies/actions)`, () => {
    for (const key of RENDER_KEYS) {
      assert.ok(
        tpl.includes(`data-${attr}="${key}"`),
        `template tanpa data-${attr}="${key}"`
      );
      assert.match(
        render,
        new RegExp(`\\[data-${attr}="${key}"\\]`),
        `render tidak query data-${attr}="${key}"`
      );
    }
    // Root status + penulisan aktual ke tiap elemen display
    assert.match(
      render,
      /ui\.setAttribute\("data-status",\s*status\s*\|\|\s*"idle"\)/,
      "data-status root tidak di-set"
    );
    assert.match(
      render,
      /statusEl\.textContent\s*=\s*message/,
      "status tidak diisi message"
    );
    assert.match(render, /countEl\.textContent/, "count tidak diisi");
    assert.match(
      render,
      /replies\.checked\s*=\s*includeReplies/,
      "checkbox Balasan tidak sinkron"
    );
    assert.match(
      render,
      /sendBtn\.disabled\s*=\s*running/,
      "sendBtn disabled tidak mengikuti running"
    );
  });

  test(`RENDER ${platform}: tombol stop tersembunyi saat tidak running; sendBtn swap label`, () => {
    // Toleran terhadap ejaan `status !== "running"` (refactor sah setara).
    assert.match(
      render,
      /stopBtn\.hidden\s*=\s*(?:!running|status\s*!==\s*"running")/,
      "stop harus hidden saat tidak running"
    );
    assert.match(
      render,
      /sendBtn\.disabled\s*=\s*(?:running|status\s*===\s*"running")/,
      "sendBtn disabled tidak mengikuti running"
    );
    assert.match(
      render,
      /sendBtn\.setAttribute\("aria-label",\s*label\)/,
      "sendBtn aria-label tidak dinamis"
    );
    assert.match(
      render,
      /sendBtn\.title\s*=\s*label/,
      "sendBtn title tidak dinamis"
    );
  });

  test(`RENDER ${platform}: FAB data-count mengikuti state + kelas running/done + title dinamis`, () => {
    assert.ok(tpl.includes('data-count=""'), "FAB template tanpa data-count");
    // setAttribute("data-count", ...) atau fab.dataset.count = ... (setara)
    assert.match(
      render,
      /fab\.(?:setAttribute\("data-count"|dataset\.count)\s*(?:,|=)\s*n\s*>\s*0\s*\?\s*String\(n\)\s*:\s*""/,
      "FAB data-count tidak mengikuti jumlah nama (kosong saat 0)"
    );
    assert.match(
      render,
      new RegExp(`fab\\.classList\\.toggle\\(\\s*"${attr}-running"`),
      "FAB kelas running hilang"
    );
    assert.match(
      render,
      new RegExp(`fab\\.classList\\.toggle\\(\\s*"${attr}-done"`),
      "FAB kelas done hilang"
    );
    assert.ok(render.includes("fab.title = fabTitle"), "FAB title tidak dinamis");
    assert.ok(
      render.includes('fab.setAttribute("aria-label", fabTitle)'),
      "FAB aria-label tidak dinamis"
    );
  });
}

// ===================== 4b. PARITY struktur render() lintas platform =====================

/**
 * Urutan elemen data-<attr> di template panel (createUi root.innerHTML) —
 * struktur DOM panel. Bukan urutan querySelector di render (yang boleh beda
 * per platform tanpa mengubah DOM).
 */
function templateDataOrder(src, attr) {
  const tpl = extractPanelTemplate(src);
  const out = [];
  for (const m of tpl.matchAll(new RegExp(`data-${attr}="([^"]+)"`, "g"))) {
    out.push(m[1]);
  }
  return out;
}

/** Statement mulai dari idx sampai `;` pada depth 0 (lewati string/template). */
function extractStatement(src, idx) {
  let depth = 0;
  for (let i = idx; i < src.length; i++) {
    const c = src[i];
    if (c === "`") {
      for (let j = i + 1; j < src.length; j++) {
        if (src[j] === "\\") {
          j++;
          continue;
        }
        if (src[j] === "`") {
          i = j;
          break;
        }
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      for (let j = i + 1; j < src.length; j++) {
        if (src[j] === "\\") {
          j++;
          continue;
        }
        if (src[j] === q) {
          i = j;
          break;
        }
      }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ";" && depth === 0) return src.slice(idx, i + 1);
  }
  return src.slice(idx);
}

test("PARITY struktur template: urutan elemen data-x identik 3 platform", () => {
  const orders = {};
  for (const [platform, { file, attr }] of Object.entries(PLATFORMS)) {
    orders[platform] = templateDataOrder(read(file), attr);
    assert.ok(
      orders[platform].length >= RENDER_KEYS.length,
      `template ${platform} hanya ${orders[platform].length} elemen data-${attr}`
    );
  }
  assert.deepEqual(
    orders.tiktok,
    orders.facebook,
    "urutan elemen data-tnk template drift dari data-fnk"
  );
  assert.deepEqual(
    orders.instagram,
    orders.facebook,
    "urutan elemen data-ing template drift dari data-fnk"
  );
});

/** Pecah atribut satu tag — hormati nilai ber-quote yang mengandung spasi
 *  (mis. title="Buka panel Nama Komentar"). */
function splitAttrs(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let j = i;
    let q = null;
    for (; j < s.length; j++) {
      const c = s[j];
      if (q) {
        if (c === q) q = null;
      } else if (c === '"' || c === "'") {
        q = c;
      } else if (/\s/.test(c)) {
        break;
      }
    }
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

/**
 * Fingerprint struktur panel UTUH (header + tools + actions + FAB): urutan
 * elemen, class per elemen, ikon rs-ic, atribut title/aria-label. Perbedaan
 * yang SAH per platform dinormalisasi dulu — prefix class/data-* (fnk/tnk/
 * ing), glyph logo (facebook/music_note/instagram), kata nama/username, dan
 * nama platform di label — lalu urutan atribut dalam satu tag diurutkan
 * (tidak signifikan di HTML). Sisanya wajib identik; lebih kuat dari test
 * data-x order di atas (subsumed).
 */
function panelFingerprint(tpl) {
  // FB kini ikon SVG inline (`${svgIcon(...)}` token di template) — kanonikkan
  // ke bentuk span yang sama dengan TT/IG (glyph font) sebelum dibandingkan.
  const norm = (s) =>
    s
      .replace(/\b(?:fnk|tnk|ing)-/g, "X-")
      .replace(/data-(?:fnk|tnk|ing)="/g, 'data-X="')
      .replace(/>(?:facebook|music_note|instagram)</g, ">LOGO<")
      .replace(/\b(?:nama|username)\b/gi, "NAMA")
      .replace(/\b(?:Facebook|TikTok|Instagram|FB|TT|IG)\b/g, "PLATFORM");
  const sortTag = (tag) => {
    const m = tag.match(/^<(\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(\/?)>$/);
    if (!m || !m[3].trim()) return tag;
    return `<${m[1]}${m[2]} ${splitAttrs(m[3]).sort().join(" ")}${m[4] ? " /" : ""}>`;
  };
  return norm(canonIcons(tpl).replace(/<[^>]+>/g, sortTag)).replace(/\s+/g, " ").trim();
}

test("PARITY struktur template FULL: class/ikon/title/urutan identik 3 platform (header+tools+actions+FAB)", () => {
  const fps = {};
  for (const [platform, { file }] of Object.entries(PLATFORMS)) {
    fps[platform] = panelFingerprint(extractPanelTemplate(read(file)));
  }
  // Mencakup seluruh bagian panel — bukan hanya elemen display: urutan tag,
  // urutan class per elemen, glyph ikon, title & aria-label, hidden/disabled/
  // aria-pressed, placeholder. Yang boleh beda hanya yang dinormalisasi di
  // panelFingerprint (prefix, logo, kata nama/username, nama platform).
  assert.equal(
    fps.tiktok,
    fps.facebook,
    "struktur panel TikTok drift dari FB (header/tools/actions/FAB)"
  );
  assert.equal(
    fps.instagram,
    fps.facebook,
    "struktur panel Instagram drift dari FB (header/tools/actions/FAB)"
  );
});

test("PARITY guard count: struktur assignment count identik 3 platform (hanya 'nama'/'username' yang boleh beda)", () => {
  const stmts = {};
  for (const [platform, { file }] of Object.entries(PLATFORMS)) {
    const src = read(file);
    const idx = src.indexOf("countEl.textContent =");
    assert.ok(idx >= 0, `countEl.textContent tidak ditemukan di ${platform}`);
    stmts[platform] = extractStatement(src, idx);
  }
  // Kata nama/username (kanal per platform) → token sama; sisanya — ternary
  // "X dari N", "0 …", nama var — wajib identik. Norm SEBELUM minify agar
  // word boundary masih berlaku (setelah minify spasi hilang).
  const norm = (s) => s.replace(/\b(?:nama|username)\b/gi, "NAMA");
  assert.equal(
    minify(norm(stmts.tiktok)),
    minify(norm(stmts.facebook)),
    "guard count TT drift dari FB (hanya kata nama/username yang boleh beda)"
  );
  assert.equal(
    minify(norm(stmts.instagram)),
    minify(norm(stmts.facebook)),
    "guard count IG drift dari FB (hanya kata nama/username yang boleh beda)"
  );
});

// ===================== 5. Eksekusi render() panel (deep, 3 platform) =====================

/**
 * Harness eksekusi render() ASLI content-*.js dengan stub DOM: fungsi murni
 * yang dipanggil render (filterNames/sortNamesAz/visible + helper target per
 * platform) diekstrak dari source, state closure di-stub per test, dan elemen
 * display diganti stub record — jadi asersi memeriksa nilai AKTUAL
 * (textContent, hidden, disabled, class, data-count), bukan sekadar kehadiran
 * pola di source (test RENDER seksi 4). Pola lama makeIgRenderer (Instagram
 * saja) diperluas ke ketiga platform.
 */
const RENDER_HARNESS = {
  facebook: { file: "content-fb.js", attr: "fnk" },
  tiktok: { file: "content-tiktok.js", attr: "tnk" },
  instagram: { file: "content-ig.js", attr: "ing" },
};

function makePanelRenderer(platform, opts = {}) {
  const { file, attr } = RENDER_HARNESS[platform];
  const renderFn = RENDER_FN[platform];
  const src = read(file);
  const body = [
    // svgIcon kini satu sumber di shared.js — disuntikkan dari
    // globalThis.RS_SHARED, bukan diekstrak.
    `const { svgIcon } = globalThis.RS_SHARED;`,
    [renderFn].map((fn) => extractFunction(src, fn)).join("\n"),
    `let status = ${JSON.stringify(opts.status ?? "idle")};`,
    `let names = ${JSON.stringify(opts.names ?? [])};`,
    `let message = "";`,
    `let includeReplies = ${JSON.stringify(!!opts.includeReplies)};`,
    // State panel v1.0.58: kunci tombol saat cooldown + link "Buka rekap".
    `let cooldownActive = false;`,
    `let openResoUrl = "";`,
    `
  function makeEl() {
    const cls = new Set();
    const el = {
      textContent: "",
      innerHTML: "",
      hidden: false,
      checked: false,
      disabled: false,
      title: "",
      _attrs: {},
      classList: {
        toggle(c, on) { if (on) cls.add(c); else cls.delete(c); },
        _has(c) { return cls.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      querySelector() { return el._ic || null; },
    };
    return el;
  }
  const KEYS = ["status","count","process","process-send","stop","copy","reset","fab","replies"];
  const els = {};
  for (const k of KEYS) els[k] = makeEl();
  els.process._ic = makeEl();
  const ui = {
    setAttribute(k, v) { this["_" + k] = String(v); },
    querySelector(sel) {
      const m = sel.match(/data-${attr}="([a-z-]+)"/);
      return m && els[m[1]] ? els[m[1]] : null;
    },
  };
  const setState = (patch) => {
    if ("status" in patch) status = patch.status;
    if ("names" in patch) names = patch.names;
  };
  return { render: ${renderFn}, els, setState };
`,
  ].join("\n");
  return new Function(body)();
}

function assertChipIconSprite(chip, label) {
  assert.ok(
    chip.innerHTML.includes('<use href="#rs-i-forum"/>'),
    `${label}: chip tanpa <use href="#rs-i-forum"/> (ikon bukan ref sprite)`
  );
  assert.ok(
    !chip.innerHTML.includes("<path"),
    `${label}: chip masih memuat <path> hardcoded (harus ref sprite)`
  );
  assert.ok(
    !/<span\b[^>]*class="[^"]*rs-ic/.test(chip.innerHTML),
    `${label}: chip masih span glyph rs-ic (ikon tampil sebagai teks)`
  );
  assert.ok(
    chip.innerHTML.includes('class="fnk-action-svg"') &&
      chip.innerHTML.includes('aria-hidden="true"'),
    `${label}: svg chip hilang / tidak dekoratif`
  );
}

test("RENDER instagram (exec): FAB data-count + kelas running/done + title/aria dinamis", () => {
  // idle tanpa nama → data-count kosong, title default, bukan done.
  const r1 = makePanelRenderer("instagram", { status: "idle", names: [] });
  r1.render();
  assert.equal(r1.els.fab._attrs["data-count"], "");
  assert.equal(r1.els.fab.title, "Username Komentar");
  assert.equal(r1.els.fab.classList._has("ing-done"), false);

  // running dengan nama → data-count terisi, kelas running, title proses.
  const r2 = makePanelRenderer("instagram", { status: "running", names: ["alice", "bob", "carol"] });
  r2.render();
  assert.equal(r2.els.fab._attrs["data-count"], "3");
  assert.equal(r2.els.fab.classList._has("ing-running"), true);
  assert.equal(r2.els.fab.title, "Proses berjalan — buka panel untuk Stop");
  assert.equal(
    r2.els.fab._attrs["aria-label"],
    "Proses berjalan — buka panel untuk Stop"
  );

  // done dengan nama → kelas done, title hasil.
  const r3 = makePanelRenderer("instagram", { status: "done", names: ["alice"] });
  r3.render();
  assert.equal(r3.els.fab.classList._has("ing-done"), true);
  assert.equal(r3.els.fab.title, "Buka panel — 1 username terkumpul (username unik, bukan hitungan komentar)");

  // done TANPA nama → bukan done (kelas butuh names.length > 0), data-count kosong.
  const r4 = makePanelRenderer("instagram", { status: "done", names: [] });
  r4.render();
  assert.equal(r4.els.fab.classList._has("ing-done"), false);
  assert.equal(r4.els.fab._attrs["data-count"], "");
});

test("RENDER instagram (exec): tombol stop tersembunyi saat tidak running + sendBtn label dinamis", () => {
  // idle → stop hidden, sendBtn aktif dengan label default.
  const r1 = makePanelRenderer("instagram", { status: "idle" });
  r1.render();
  assert.equal(r1.els.stop.hidden, true);
  assert.equal(r1.els["process-send"].disabled, false);
  assert.equal(r1.els["process-send"]._attrs["aria-label"], "Rekap + Kirim ke ReSo");
  assert.equal(r1.els["process-send"].title, "Rekap + Kirim ke ReSo");

  // running → stop tampil, sendBtn disabled, label proses.
  const r2 = makePanelRenderer("instagram", { status: "running" });
  r2.render();
  assert.equal(r2.els.stop.hidden, false);
  assert.equal(r2.els["process-send"].disabled, true);
  assert.equal(r2.els["process-send"]._attrs["aria-label"], "Memproses…");
  assert.equal(r2.els["process-send"].title, "Memproses…");
});

test("RENDER (exec) parity count: jumlah nama identik 3 platform (kata nama/username boleh beda)", () => {
  // Skenario sama dijalankan ke render() ASLI ketiga platform (stub DOM):
  // teks count (jumlah nama terkumpul) wajib identik — hanya kata
  // nama/username yang boleh beda. Kebenaran nilai aktual ikut di-assert
  // (count mengikuti names.length, bukan filter — filter dihapus di panel
  // minimal).
  const scenarios = [
    { name: "tanpa nama", names: [], count: "0 NAMA" },
    { name: "beberapa nama", names: ["alice", "bob"], count: "2 NAMA" },
    {
      name: "banyak nama (tanpa truncation)",
      names: Array.from({ length: 50 }, (_, i) => `u${String(i).padStart(2, "0")}`),
      count: "50 NAMA",
    },
  ];
  for (const s of scenarios) {
    const counts = {};
    for (const platform of ["facebook", "tiktok", "instagram"]) {
      const r = makePanelRenderer(platform, { status: "idle", names: s.names });
      r.render();
      counts[platform] = r.els.count.textContent.replace(
        /\b(?:nama|username)\b/gi,
        "NAMA"
      );
    }
    assert.equal(counts.tiktok, counts.facebook, `count parity TT vs FB: ${s.name}`);
    assert.equal(counts.instagram, counts.facebook, `count parity IG vs FB: ${s.name}`);
    assert.equal(counts.facebook, s.count, `count aktual: ${s.name}`);
  }
});

// ============ 6b. Snapshot VISUAL ikon SVG (bukan glyph teks) ============

/** Interpolasi token `${svgIcon(...)}` template dengan svgIcon ASLI
 *  (globalThis.RS_SHARED) → HTML persis seperti yang dirender createUi di
 *  browser. Ini satu-satunya test yang melihat OUTPUT ikon yang sebenarnya
 *  (ref sprite <use>/aria) — test lain menormalkan token jadi span abstrak. */
function renderPanelHtml(platform) {
  const tpl = extractPanelTemplate(read(PLATFORMS[platform].file));
  const svgIcon = globalThis.RS_SHARED.svgIcon;
  return tpl.replace(
    /\$\{svgIcon\("([a-z0-9_]+)"(?:,\s*"([^"]*)")?(?:,\s*"[^"]*")?\)\}/g,
    (_m, name, cls) => svgIcon(name, cls)
  );
}

/** Blok <svg …>…</svg> → { attrs, use } (href `<use>` pertama). Path kini
 *  hidup di sprite sheet (iconSprite shared.js), bukan per elemen. */
function svgBlocks(html) {
  return [...html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)].map((m) => {
    const attrs = {};
    for (const [, k, v] of m[1].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[k] = v;
    return { attrs, use: (m[2].match(/<use\b[^>]*href="([^"]*)"/) || [])[1] || "" };
  });
}

/** Logo brand per platform — viewBox 24 (Simple Icons); selain itu 960. */
const PLATFORM_LOGO = { facebook: "facebook", tiktok: "music_note", instagram: "instagram" };

/** Set ikon panel/FAB per platform (logo + 6 ikon non-logo). */
const PLATFORM_ICON_SET = {
  facebook: ["facebook", "close", "forum", "send", "stop", "restart_alt", "forum"],
  tiktok: ["music_note", "close", "forum", "send", "stop", "restart_alt", "forum"],
  instagram: ["instagram", "close", "forum", "send", "stop", "restart_alt", "forum"],
};

/** Asersi satu string ikon SVG (badge/swap): data-ic benar, path terisi,
 *  aria-hidden, dan BUKAN glyph teks (span rs-ic / ligature mentah). */
function assertSvgIconString(label, str, expectIc) {
  assert.ok(
    !/<span\b[^>]*class="[^"]*\brs-ic\b/.test(str),
    `${label}: masih ada span glyph rs-ic (ikon tampil sebagai teks)`
  );
  assert.ok(str.includes("<svg"), `${label}: bukan SVG: ${JSON.stringify(str.slice(0, 60))}`);
  assert.ok(
    str.includes(`data-ic="${expectIc}"`),
    `${label}: tidak ada data-ic="${expectIc}" di ${JSON.stringify(str.slice(0, 80))}`
  );
  assert.ok(str.includes('aria-hidden="true"'), `${label}: ikon ${expectIc} tidak aria-hidden`);
  assert.ok(
    str.includes(`<use href="#rs-i-${expectIc}"/>`),
    `${label}: tidak ada ref sprite #rs-i-${expectIc} di ${JSON.stringify(str.slice(0, 100))}`
  );
}

test("SNAPSHOT visual ikon SVG: panel & FAB 3 platform — svg lengkap, nol glyph teks", () => {
  for (const [platform, { file }] of Object.entries(PLATFORMS)) {
    const html = renderPanelHtml(platform);
    // 1. Nol glyph span — bug lama (ligature font diblokir CSP) menampilkan
    //    ikon sebagai TEKS; SVG inline tidak punya fallback teks.
    assert.ok(
      !/<span\b[^>]*class="[^"]*\brs-ic\b/.test(html),
      `${file}: masih ada span glyph rs-ic di panel (ikon tampil sebagai teks)`
    );
    // 2. Semua posisi ikon adalah <svg> lengkap: data-ic, aria-hidden,
    //    ukuran, dan ref <use> ke sprite sheet (path di iconSprite).
    const svgs = svgBlocks(html);
    assert.equal(svgs.length, 7, `${file}: jumlah svg ${svgs.length} !== 7`);
    for (const { attrs, use } of svgs) {
      assert.ok(attrs["data-ic"], `${file}: svg tanpa data-ic`);
      assert.equal(
        attrs["aria-hidden"],
        "true",
        `${file}: ikon ${attrs["data-ic"]} tidak aria-hidden (harus dekoratif)`
      );
      assert.ok(attrs.width && attrs.height, `${file}: ikon ${attrs["data-ic"]} tanpa ukuran`);
      assert.equal(
        use,
        `#rs-i-${attrs["data-ic"]}`,
        `${file}: ikon ${attrs["data-ic"]} tanpa ref sprite yang benar`
      );
    }
    // 3. Set ikon tepat (logo + 6 non-logo; forum 2× — label & FAB).
    const ics = svgs.map((s) => s.attrs["data-ic"]).sort();
    assert.deepEqual(
      ics,
      [...PLATFORM_ICON_SET[platform]].sort(),
      `${file}: set ikon menyimpang`
    );
    // 4. Aksesibilitas: tiap tombol ikon punya title + aria-label (nama
    //    aksesibel dari teks, bukan dari ikon), dan ikonnya dekoratif.
    for (const btn of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      assert.match(
        btn[1],
        /title="[^"]+"/,
        `${file}: tombol tanpa title: ${btn[1].slice(0, 80)}`
      );
      assert.match(
        btn[1],
        /aria-label="[^"]+"/,
        `${file}: tombol tanpa aria-label: ${btn[1].slice(0, 80)}`
      );
      assert.match(
        btn[2],
        /<svg\b[^>]*aria-hidden="true"/,
        `${file}: tombol tanpa ikon svg aria-hidden: ${btn[1].slice(0, 80)}`
      );
      assert.ok(
        !btn[1].includes("tabindex") && !btn[1].includes('role="'),
        `${file}: tombol tak perlu tabindex/role manual`
      );
    }
  }
  // Parity: set ikon NON-logo identik di ketiga platform.
  const nonLogo = Object.fromEntries(
    Object.entries(PLATFORMS).map(([p, { file }]) => [
      p,
      svgBlocks(renderPanelHtml(p))
        .map((s) => s.attrs["data-ic"])
        .filter((n) => n !== PLATFORM_LOGO[p])
        .sort(),
    ])
  );
  assert.deepEqual(nonLogo.tiktok, nonLogo.facebook, "set ikon non-logo TT drift dari FB");
  assert.deepEqual(nonLogo.instagram, nonLogo.facebook, "set ikon non-logo IG drift dari FB");
});

/** Representasi LAMA (pra-sprite): ikon SVG dengan path di-INLINE per elemen
 *  (bentuk `svgIcon` sebelum refactor sprite — baseline ukuran DOM). */
function oldInlineIcon(name, vb, d, cls = "") {
  return (
    '<svg class="rs-ic' +
    (cls ? ` ${cls}` : "") +
    `" data-ic="${name}" aria-hidden="true" viewBox="${vb}" width="20" height="20">` +
    `<path fill="currentColor" d="${d}"/></svg>`
  );
}

/** { namaIkon → { vb, d } } diurai dari sprite sheet (satu sumber ICON_PATHS). */
function spriteIconInfo() {
  const sprite = globalThis.RS_SHARED.iconSprite();
  const info = {};
  for (const m of sprite.matchAll(
    /<symbol id="(rs-i-[a-z0-9_]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g
  )) {
    const name = m[1].slice("rs-i-".length);
    info[name] = { vb: m[2], d: (m[3].match(/d="([^"]+)"/) || [])[1] || "" };
  }
  return info;
}

test("UKURAN DOM sprite vs baseline path inline: ref <use> lebih kecil per ikon & per panel; sprite lunas ≤ 10 render", () => {
  const info = spriteIconInfo();
  const svgIcon = globalThis.RS_SHARED.svgIcon;
  const spriteBytes = globalThis.RS_SHARED.iconSprite().length;
  assert.ok(Object.keys(info).length >= 8, "sprite kurang dari 8 ikon (ukuran tak terukur)");

  // 1. PER IKON: representasi baru (ref <use>) SELALU lebih kecil dari yang
  //    lama (path inline) — tidak ada ikon yang bobot per-elemennya membesar.
  for (const [name, { vb, d }] of Object.entries(info)) {
    const ref = svgIcon(name).length;
    const inline = oldInlineIcon(name, vb, d).length;
    assert.ok(
      ref < inline,
      `ikon ${name}: ref ${ref}B >= path inline ${inline}B (representasi baru membesar)`
    );
  }

  // 2. SET PENUH: sprite (path sekali + ref mungil) lebih kecil dari baseline
  //    lama untuk pemakaian SETARA (tiap ikon di-inline sekali) — menyimpan
  //    path sekali tidak pernah lebih besar dari menempelkannya per elemen.
  const setInline = Object.entries(info).reduce(
    (acc, [n, { vb, d }]) => acc + oldInlineIcon(n, vb, d).length,
    0
  );
  assert.ok(
    spriteBytes < setInline,
    `sprite ${spriteBytes}B >= set-inline ${setInline}B (harus lebih kecil)`
  );

  // 3. PER PANEL: payload ikon yang DI-RENDER createUi (12 ref) jauh lebih
  //    kecil dari representasi lama (12 svg path inline) — dan sprite
  //    (biaya satu kali per dokumen) LUNAS setelah R render panel, R kecil.
  for (const [platform, { file }] of Object.entries(PLATFORMS)) {
    const html = renderPanelHtml(platform);
    const refsBytes = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].reduce(
      (a, m) => a + m[0].length,
      0
    );
    // Baseline lama: tiap token ${svgIcon("x"[, "cls"])} → svg path inline
    // dengan kelas yang sama (fair — kelas ikut dihitung di kedua bentuk).
    const tpl = extractPanelTemplate(read(file));
    let oldBytes = 0;
    for (const m of tpl.matchAll(
      /\$\{svgIcon\("([a-z0-9_]+)"(?:,\s*"([^"]*)")?(?:,\s*"[^"]*")?\)\}/g
    )) {
      const { vb, d } = info[m[1]];
      oldBytes += oldInlineIcon(m[1], vb, d, m[2]).length;
    }
    assert.ok(
      refsBytes < oldBytes,
      `${platform}: panel refs ${refsBytes}B >= baseline inline ${oldBytes}B`
    );
    const R = Math.ceil(spriteBytes / (oldBytes - refsBytes));
    assert.ok(
      R >= 1 && R <= 10,
      `${platform}: sprite lunas setelah ${R} render — harus 1..10 (sprite ${spriteBytes}B vs hemat ${oldBytes - refsBytes}B/render)`
    );
  }

  // 4. CHURN RE-RENDER: string ikon yang dihasilkan render() tetap kecil.
  //    (swap ikon Proses sudah dihapus — tombol process tidak ada.)
  //    Minimum: panel refs (svgIcon) harus lebih kecil dari inline.
  //    (diverifikasi di butir 3 per platform)
});

test("SNAPSHOT visual ikon SVG: sprite sheet — 8 symbol, path terisi, viewBox benar, semua dipakai ada", () => {
  const sprite = globalThis.RS_SHARED.iconSprite();
  // 1. Satu <svg id="rs-icon-sprite"> berisi 8 <symbol> (dari ICON_PATHS —
  //    hanya ikon yang benar-benar dipakai: logo, kontrol panel, kirim.
  assert.ok(
    sprite.startsWith('<svg id="rs-icon-sprite"'),
    "sprite bukan <svg id=rs-icon-sprite>"
  );
  const syms = [
    ...sprite.matchAll(
      /<symbol id="(rs-i-[a-z0-9_]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g
    ),
  ];
  assert.equal(syms.length, 8, `sprite symbol ${syms.length} !== 8`);
  const byId = {};
  for (const [, id, vb, body] of syms) byId[id] = { vb, body };
  // 2. viewBox: brand 24 (Simple Icons: facebook/instagram), sisanya 960
  //    (Material — termasuk music_note, bukan brand 24).
  for (const [id, { vb }] of Object.entries(byId)) {
    const name = id.slice("rs-i-".length);
    const expect =
      name === "facebook" || name === "instagram" || name === "send"
        ? "0 0 24 24"
        : "0 -960 960 960";
    assert.equal(vb, expect, `symbol ${id}: viewBox ${vb} salah (harus ${expect})`);
  }
  // 3. Path tiap symbol terisi (ikon tidak pernah tampil sebagai teks).
  for (const [id, { body }] of Object.entries(byId)) {
    const d = (body.match(/d="([^"]+)"/) || [])[1] || "";
    assert.ok(d.length > 0, `symbol ${id}: path kosong`);
  }
  // 4. svgIcon merujuk sprite via <use> — bukan salinan path per elemen.
  assert.ok(
    globalThis.RS_SHARED.svgIcon("close").includes('<use href="#rs-i-close"/>'),
    "svgIcon tidak merujuk sprite via <use>"
  );
  // 5. Semua ikon yang dipakai panel/badge/swap/chip/popup/options ada di
  //    sprite — termasuk yang di-swap JS (badge, statIcon, platformIcon).
  const htmlIcons = (f) =>
    [...read(f).matchAll(/data-ic="([a-z0-9_]+)"/g)].map((m) => m[1]);
  const needed = new Set([
    ...Object.values(PLATFORM_ICON_SET).flat(),
    ...htmlIcons("popup.html"),
  ]);
  for (const n of needed) {
    assert.ok(byId[`rs-i-${n}`], `sprite kurang symbol rs-i-${n} (dipakai UI)`);
  }
  // 6. Setiap content CSS menyembunyikan sprite (id menang atas svg{} halaman).
  for (const { file } of Object.values(PLATFORMS)) {
    const css = read(file.replace(/\.js$/, ".css"));
    assert.match(
      css,
      /#rs-icon-sprite\s*{[^}]*display:\s*none/,
      `${file} CSS tanpa #rs-icon-sprite{display:none} (sprite jadi kotak 300×150)`
    );
  }
});

