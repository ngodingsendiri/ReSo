/**
 * Audit aliran state: GET_STATE / NAMES_PROGRESS / NAMES_DONE / NAMES_ERROR /
 * SET_STATE / START_* / RESET / tab-ditutup — background vs popup.
 *
 * Invariant yang dikunci (perluasan audit konsistensi lintas platform):
 *   popup hanya membaca field yang dijamin DEFINED di state yang dikembalikan
 *   SEMUA jalur pengirim. Karena setiap jalur melewati getState/setState
 *   (applyStatePatch me-merge defaultStateFor platform), jaminannya struktural:
 *   1. Setiap field yang dibaca popup ada di default state platform tempat
 *      field itu dibaca (sesuai cabang render popup) — tidak ada read yang
 *      bisa menghasilkan undefined.
 *   2. Tidak ada jalur yang mengembalikan state sebagai raw object literal
 *      (yang melewati merge defaults) — semua `state:` return hanya null /
 *      prev / hasil getState / setState / restoreSavedIfIdle.
 *   3. Setiap key yang ditulis patch (literal setState, patchObj/patch/
 *      resetPatch, assignment dinamis) ada di defaults — tanpa field hantu.
 *   4. Eksekusi: applyStatePatch asli dari shared.js dengan tiap patch dummy
 *      mempertahankan semua field popup platform itu tetap defined.
 *
 * Perubahan pola ini langsung membuat test merah: field baru di render popup,
 * jalur baru yang mengembalikan state mentah, atau key patch di luar defaults.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DEFAULT_STATE_FB,
  DEFAULT_STATE_TT,
  DEFAULT_STATE_IG,
  defaultStateFor,
  applyStatePatch,
} from "../shared-module.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");
const bg = read("background.js");
const popup = read("popup.js");

const PLATFORMS = ["facebook", "tiktok", "instagram"];
const DEFAULTS = {
  facebook: DEFAULT_STATE_FB,
  tiktok: DEFAULT_STATE_TT,
  instagram: DEFAULT_STATE_IG,
};

// ===================== Helpers (string-aware) =====================

/** Lompati string kutip tunggal/ganda mulai dari i (karakter pembuka). */
function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === q) return j;
  }
  return src.length - 1;
}

/** Lompati template literal mulai dari i (backtick), ${...} di-skip utuh. */
function skipTemplate(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "`") return j;
    if (c === "$" && src[j + 1] === "{") {
      const end = matchClose(src, j + 1);
      if (end >= 0) j = end;
    }
  }
  return src.length - 1;
}

/** Indeks penutup seimbang ({ } ( ) [ ]), lewati string/template/komentar. */
function matchClose(src, openIdx) {
  const open = src[openIdx];
  const close =
    open === "{" ? "}" : open === "(" ? ")" : open === "[" ? "]" : null;
  if (!close) return -1;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipString(src, i);
      continue;
    }
    if (c === "`") {
      i = skipTemplate(src, i);
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Nilai properti mulai dari start, sampai koma/penutup pada depth 0. */
function extractValue(src, start) {
  let depth = 0;
  let paren = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipString(src, i);
      continue;
    }
    if (c === "`") {
      i = skipTemplate(src, i);
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1;
      continue;
    }
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 0) return src.slice(start, i);
      depth--;
    } else if (c === "," && depth === 0 && paren === 0) {
      return src.slice(start, i);
    }
  }
  return src.slice(start);
}

/** Key top-level object literal (patch kami tidak punya objek bersarang). */
function literalKeys(lit) {
  const keys = new Set();
  for (const m of lit.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) keys.add(m[1]);
  return keys;
}

function lineOf(src, idx) {
  return src.slice(0, idx).split("\n").length;
}

/** Definisi `const X =` / `let X =` di bg (string-aware sampai `;` depth 0). */
function identifierDef(src, ident) {
  const m = new RegExp(`\\b(?:const|let)\\s+${ident}\\s*=`).exec(src);
  if (!m) return null;
  let depth = 0;
  let paren = 0;
  for (let i = m.index + m[0].length; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipString(src, i);
      continue;
    }
    if (c === "`") {
      i = skipTemplate(src, i);
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1;
      continue;
    }
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 0 && paren === 0) return src.slice(m.index, i);
      depth--;
    } else if (c === ";" && depth === 0 && paren === 0) {
      return src.slice(m.index, i);
    }
  }
  return src.slice(m.index);
}

/** Assignment dinamis `patchObj.X = ...` / `patch.X = ...` di bg. */
function dynamicKeys(src, ident) {
  const keys = new Set();
  const re = new RegExp(`\\b${ident}\\.([A-Za-z_$][\\w$]*)\\s*=(?!=)`, "g");
  for (const m of src.matchAll(re)) keys.add(m[1]);
  return keys;
}

// ===================== Kumpulkan semua posisi patch =====================

/** Whitelist SET_STATE (background.js) — source utama key patch dinamis. */
const allowM = bg.match(/const allow = \[([\s\S]*?)\];/);
const ALLOW_KEYS = new Set();
if (allowM) {
  for (const s of allowM[1].matchAll(/"([^"]+)"/g)) ALLOW_KEYS.add(s[1]);
}

/** Semua situs setState: { site, firstArg, keys, line }. */
const patches = [];
for (const m of bg.matchAll(/\bsetState\s*\(/g)) {
  // Lewati deklarasi `async function setState(...)` itu sendiri.
  if (/function\s+setState\s*\($/.test(bg.slice(Math.max(0, m.index - 20), m.index))) {
    continue;
  }
  const after = m.index + m[0].length;
  const comma = bg.indexOf(",", after);
  if (comma < 0) continue;
  const firstArg = bg.slice(after, comma).trim();
  let pIdx = comma + 1;
  while (pIdx < bg.length && /\s/.test(bg[pIdx])) pIdx++;

  const keys = new Set();
  if (bg[pIdx] === "{") {
    const close = matchClose(bg, pIdx);
    if (close < 0) continue;
    for (const k of literalKeys(bg.slice(pIdx, close + 1))) keys.add(k);
  } else {
    const ident = bg.slice(pIdx).match(/^[A-Za-z_$][\w$]*/)?.[0];
    if (ident) {
      const def = identifierDef(bg, ident);
      if (def) {
        for (const lm of def.matchAll(/\{/g)) {
          const cl = matchClose(def, lm.index);
          if (cl < 0) continue;
          for (const k of literalKeys(def.slice(lm.index, cl + 1))) keys.add(k);
        }
      }
      for (const k of dynamicKeys(bg, ident)) keys.add(k);
      if (ident === "patch") {
        // SET_STATE: key datang dari whitelist `allow` (patch dimulai kosong).
        for (const k of ALLOW_KEYS) keys.add(k);
      }
    }
  }
  patches.push({ site: `setState(${firstArg}, …)`, firstArg, keys, line: lineOf(bg, m.index) });
}

/** Cakupan platform sebuah situs patch: literal "x" atau dinamis (p/platform). */
function scopeOf(site) {
  return site.firstArg.startsWith('"')
    ? [site.firstArg.slice(1, -1)]
    : PLATFORMS;
}

// ===================== 1. Popup reads vs defaults =====================

/**
 * Field state yang dibaca popup, per cabang render (popup.js render()):
 * - UNIVERSAL dibaca tanpa cabang (status/message/names/count/includeReplies)
 * - videoHint hanya cabang TikTok; postHint hanya FB/IG; hasTemplate TT/IG.
 * Field baru yang dibaca popup WAJIB diklasifikasikan di sini — test merah
 * kalau tidak.
 */
const FIELD_PLATFORMS = {
  status: PLATFORMS,
  message: PLATFORMS,
  names: PLATFORMS,
  count: PLATFORMS,
  includeReplies: PLATFORMS,
  videoHint: ["tiktok"],
  postHint: ["facebook", "instagram"],
  hasTemplate: ["tiktok", "instagram"],
};

test("popup hanya membaca field yang ada di default state platform tempat field dibaca", () => {
  const reads = new Set();
  for (const m of popup.matchAll(/\bstate\.([A-Za-z_$][\w$]*)/g)) reads.add(m[1]);
  for (const m of popup.matchAll(/\bstate\?\.([A-Za-z_$][\w$]*)/g)) reads.add(m[1]);

  const classified = new Set(Object.keys(FIELD_PLATFORMS));
  const unclassified = [...reads].filter((f) => !classified.has(f));
  assert.deepEqual(
    unclassified,
    [],
    `field state yang dibaca popup belum diklasifikasi di FIELD_PLATFORMS: ${unclassified.join(", ")}`
  );

  for (const [field, platforms] of Object.entries(FIELD_PLATFORMS)) {
    for (const p of platforms) {
      assert.ok(
        field in DEFAULTS[p],
        `popup membaca state.${field} tapi default ${p} tidak punya field itu — jalur pengirim bisa mengembalikan undefined`
      );
    }
  }
});

// ===================== 2. Semua state return lewat defaults =====================

test("tidak ada jalur yang mengembalikan state sebagai raw literal (semua lewat getState/setState)", () => {
  const violations = [];
  for (const m of bg.matchAll(/\bstate:\s*/g)) {
    const value = extractValue(bg, m.index + m[0].length).trim();
    const ok =
      value === "null" ||
      value === "prev" ||
      value.startsWith("await setState(") ||
      value.startsWith("await getState(") ||
      value.startsWith("await restoreSavedIfIdle(");
    if (!ok) {
      violations.push(`baris ${lineOf(bg, m.index)}: state: ${value.slice(0, 50)}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    "state return harus null/prev/hasil getState|setState|restoreSavedIfIdle (hanya itu yang me-merge defaults)"
  );
});

// ===================== 3. Patch tanpa field hantu =====================

test("patch hanya menulis key yang ada di defaults platform-nya (tanpa field hantu)", () => {
  assert.ok(patches.length >= 10, `situs setState hanya ${patches.length} — ekstraktor kehilangan jalur`);
  const violations = [];
  for (const site of patches) {
    const allowed = new Set(scopeOf(site).flatMap((p) => Object.keys(DEFAULTS[p])));
    for (const k of site.keys) {
      if (!allowed.has(k)) {
        violations.push(`${site.site} (baris ${site.line}): key "${k}"`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    "patch menulis key di luar default state platform — field hantu atau salah platform"
  );
});

// ===================== 4. Eksekusi: applyStatePatch asli =====================

const FIELDS_PER_PLATFORM = PLATFORMS.reduce((acc, p) => {
  acc[p] = Object.entries(FIELD_PLATFORMS)
    .filter(([, platforms]) => platforms.includes(p))
    .map(([f]) => f);
  return acc;
}, {});

test("eksekusi: applyStatePatch asli mempertahankan semua field popup defined (tiap patch dummy)", () => {
  const DUMMY = {
    status: "idle",
    names: [],
    count: 0,
    message: "x",
    tabId: 1,
    stopReason: null,
    postHint: "x",
    videoHint: "x",
    includeReplies: false,
    hasTemplate: false,
    runId: "r",
  };
  const dummyPatch = (keys) =>
    Object.fromEntries([...keys].map((k) => [k, k in DUMMY ? DUMMY[k] : "x"]));

  for (const site of patches) {
    for (const p of scopeOf(site)) {
      const st = applyStatePatch(defaultStateFor(p), dummyPatch(site.keys), p);
      const missing = FIELDS_PER_PLATFORM[p].filter((f) => st[f] === undefined);
      assert.deepEqual(
        missing,
        [],
        `patch ${site.site} (baris ${site.line}) membuat field popup undefined untuk ${p}: ${missing.join(", ")}`
      );
    }
  }
});
