/**
 * Parity & perilaku grace period idle — ketiga loop pagination (GraphQL FB,
 * list TT, list IG) wajib memakai baris `lastNewAt` yang sama.
 *
 * A. PARITY STATIS — baris grace (`Date.now() - lastNewAt < 2500` →
 *    `idle = Math.max(0, idle - 1)`) dan threshold (`idle >= 6`) harus identik
 *    (whitespace-normalized) di ketiga file dan tepat 1× per file — HANYA di
 *    loop pagination (loop DOM/scroll sengaja tanpa grace di ketiga platform,
 *    meski blok increment-nya sama). Baris grace harus tepat mengikuti blok
 *    increment (hanya komentar/baris kosong di antaranya) — blok increment
 *    yang dimaksud adalah yang mendahului baris grace (lastIndexOf).
 *
 * B. PERILAKU — blok increment + baris grace DIEKSTRAK dari file nyata lalu
 *    dieksekusi dalam simulasi loop pagination (clock terkontrol). Skenario
 *    membuktikan grace benar-benar mengubah perilaku: nama berhenti dengan
 *    lastNewAt baru → idle ditahan (berhenti lebih lambat daripada tanpa
 *    grace); lastNewAt basi → idle menumpuk 1/halaman dan berhenti setelah
 *    6 halaman kosong; nama mengalir lagi → idle di-reset.
 *
 * Catatan v1.0.58: threshold 4 → 6 — window hasil FB kadang tumpang-tindih
 * (re-ranking "Semua Komentar") sehingga halaman bisa berisi nama lama
 * padahal thread belum tuntas; toleransi idle lebih longgar mencegah rekap
 * parsial pada thread besar (keluhan: 9–12 terekap dari 40–50+ pengulas).
 *
 * Pure ESM — node --test, zero deps.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const INJECTS = ["inject-fb.js", "inject-tiktok.js", "inject-ig.js"];

// Baris nyata yang wajib ada (nilai persis, termasuk konstanta 2500/6).
const GRACE_RE = /if \(Date\.now\(\) - lastNewAt < 2500\) idle = Math\.max\(0, idle - 1\);/g;
const INC_RE = /if \(nameMap\.size === before\) idle\+\+;\s*else idle = 0;/g;
const THRESHOLD_RE = /idle >= 6/g;

/** Strip komentar + whitespace (konvensi normalisasi ui-consistency). */
const norm = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\s+/g, "");

const SRC = Object.fromEntries(INJECTS.map((f) => [f, read(f)]));

// ---- A. Parity statis -----------------------------------------------------

test("parity idle: baris grace + threshold identik 3 platform, 1× per file, tepat setelah blok increment", () => {
  const graces = {};
  const incs = {};

  for (const f of INJECTS) {
    const src = SRC[f];

    const grace = src.match(GRACE_RE) || [];
    const thr = src.match(THRESHOLD_RE) || [];

    assert.equal(
      grace.length,
      1,
      `${f}: baris grace harus tepat 1× (hanya di loop pagination — loop DOM/scroll tanpa grace)`
    );
    assert.equal(
      thr.length,
      1,
      `${f}: threshold 'idle >= 6' harus tepat 1× (hanya di loop pagination; loop DOM/scroll memakai 10/18 by design)`
    );

    const graceIdx = src.indexOf(grace[0]);
    // Blok increment muncul 2× per file (pagination + DOM/scroll) — ambil yang
    // MENDULUI baris grace (lastIndexOf) untuk cek posisi & parity.
    const incBefore = src.slice(0, graceIdx);
    const incMatch = incBefore.match(INC_RE);
    assert.ok(incMatch, `${f}: harus ada blok increment sebelum baris grace`);
    const incIdx = incBefore.lastIndexOf(incMatch[incMatch.length - 1]);

    const between = src.slice(incIdx + incMatch[incMatch.length - 1].length, graceIdx);
    assert.ok(
      /^(\s|\/\/[^\n]*\n)*$/.test(between),
      `${f}: antara blok increment dan baris grace hanya boleh komentar/baris kosong`
    );

    graces[f] = norm(grace[0]);
    incs[f] = norm(incMatch[incMatch.length - 1]);
  }

  const g = Object.values(graces);
  const i = Object.values(incs);
  assert.equal(new Set(g).size, 1, `baris grace harus identik 3 platform: ${JSON.stringify(g)}`);
  assert.equal(
    new Set(i).size,
    1,
    `blok increment (yang mendahului grace) harus identik 3 platform: ${JSON.stringify(i)}`
  );
});

// ---- B. Perilaku — blok nyata dieksekusi dalam simulasi loop ---------------

// Ekstrak baris NYATA dari inject-fb.js (identik di ketiga file — dijamin test A).
const SRC_FB = SRC["inject-fb.js"];
const GRACE_RAW = SRC_FB.match(GRACE_RE)[0];
const INC_RAW = (() => {
  const gIdx = SRC_FB.indexOf(GRACE_RAW);
  const m = SRC_FB.slice(0, gIdx).match(INC_RE);
  return m[m.length - 1];
})();
assert.ok(GRACE_RAW.includes("2500"), "sanity: baris grace nyata memuat konstanta 2500");
assert.ok(INC_RAW.includes("idle++"), "sanity: blok increment nyata memuat idle++");

function makeStep(block) {
  // eslint-disable-next-line no-new-func
  return new Function(
    "Date",
    "before",
    "nameMap",
    "lastNewAt",
    "idle",
    `${block}\nreturn idle;`
  );
}

/**
 * Simulasi loop pagination dengan clock terkontrol.
 * `namesFn(page)` → jumlah nama baru di halaman itu; nama baru meng-update
 * `lastNewAt` ke clock saat itu (persis `addName` engine). Berhenti saat
 * `idle >= 6` (persis guard loop). Return halaman berhenti (1-based) atau null.
 */
function simulate({ pages, gapMs, namesFn, withGrace }) {
  const block = withGrace ? `${INC_RAW}\n${GRACE_RAW}` : INC_RAW;
  const step = makeStep(block);
  let idle = 0;
  let size = 0;
  let lastNewAt = -Infinity;
  let clock = 0;
  const fakeDate = { now: () => clock };
  for (let p = 1; p <= pages; p++) {
    clock += gapMs;
    const before = size;
    const added = namesFn(p);
    size += added;
    if (added > 0) lastNewAt = clock;
    idle = step(fakeDate, before, { size }, lastNewAt, idle);
    if (idle >= 6) return { stoppedByIdle: true, atPage: p };
  }
  return { stoppedByIdle: false, atPage: null };
}

test("perilaku idle: nama mengalir terus → tidak pernah berhenti oleh idle", () => {
  const r = simulate({ pages: 10, gapMs: 3000, namesFn: () => 1, withGrace: true });
  assert.equal(r.stoppedByIdle, false, "idle tidak boleh menumpuk saat tiap halaman membawa nama baru");
});

test("perilaku idle: grace menahan idle saat nama baru ≤2,5 dtk (berhenti lebih lambat daripada tanpa grace)", () => {
  // Nama mengalir 3 halaman (gap 1 dtk → lastNewAt segar), lalu berhenti.
  // Grace menahan idle 2 halaman pertama (now - lastNewAt < 2500) → berhenti
  // di halaman 11; tanpa grace idle menumpuk dari halaman 4 → berhenti di 9.
  const namesFn = (p) => (p <= 3 ? 1 : 0);
  const withGrace = simulate({ pages: 14, gapMs: 1000, namesFn, withGrace: true });
  const noGrace = simulate({ pages: 14, gapMs: 1000, namesFn, withGrace: false });
  assert.equal(withGrace.atPage, 11, "grace menahan 2 halaman kosong pertama (lastNewAt segar)");
  assert.equal(noGrace.atPage, 9, "tanpa grace idle menumpuk langsung dari halaman kosong pertama");
  assert.ok(
    withGrace.atPage > noGrace.atPage,
    `grace HARUS menunda berhenti: ${withGrace.atPage} > ${noGrace.atPage}`
  );
});

test("perilaku idle: lastNewAt basi → idle menumpuk 1/halaman, berhenti setelah 6 halaman kosong", () => {
  // Nama hanya di halaman 1, gap 3 dtk → saat halaman 2, now - lastNewAt ≥ 2500.
  const r = simulate({ pages: 12, gapMs: 3000, namesFn: (p) => (p === 1 ? 1 : 0), withGrace: true });
  assert.equal(r.stoppedByIdle, true);
  assert.equal(r.atPage, 7, "6 halaman kosong berurutan (halaman 2–7) → idle 6 → berhenti");
});

test("perilaku idle: nama mengalir lagi setelah jeda → idle di-reset", () => {
  // Halaman 1–2 nama, 3–4 kosong (idle menumpuk), halaman 5 nama lagi → reset,
  // lalu 6–11 kosong → idle 1,2,3,4,5,6 → berhenti di 11 (bukan 7).
  const r = simulate({
    pages: 14,
    gapMs: 3000,
    namesFn: (p) => (p === 1 || p === 2 || p === 5 ? 1 : 0),
    withGrace: true,
  });
  assert.equal(r.stoppedByIdle, true);
  assert.equal(r.atPage, 11, "idle harus 0 kembali setelah nama mengalir di halaman 5");
});

test("perilaku idle: tanpa nama sama sekali → grace tidak pernah aktif (lastNewAt -Infinity)", () => {
  const r = simulate({ pages: 10, gapMs: 3000, namesFn: () => 0, withGrace: true });
  assert.equal(r.stoppedByIdle, true);
  assert.equal(r.atPage, 6, "halaman kosong 1–6 → idle 1..6 → berhenti di 6");
});
