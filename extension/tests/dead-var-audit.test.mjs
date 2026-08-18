/**
 * Audit variabel mati permanen — mendeteksi dua pola, lalu GAGAL:
 *
 * A. `let X = null|0|false|""|''|undefined;` yang TIDAK PERNAH di-assign
 *    ulang (pola `readyWaiter`: deklarasi sentinel, hanya dibaca lewat cek
 *    truthiness yang selalu false → dead code).
 * B. `let X ...;` yang DI-ASSIGN tapi TIDAK PERNAH DIBACA (write-only).
 *
 * Analisis statis heuristik pada source mentah (tanpa strip string — regex
 * literal berisi apostrof membuat strip string memakan chunk kode dan
 * menghasilkan false positive; baseline terverifikasi bersih tanpa strip).
 * Kalau temuan ternyata false positive yang sah, daftarkan di
 * DEAD_VAR_EXCLUSIONS dengan alasan (mis. variabel state engine yang dibaca
 * via pola yang tidak dikenali analisis ini).
 *
 * Catatan: analisis per-file — variabel dengan nama sama di scope berbeda
 * (shadowing) bisa lolos (false negative), bukan false positive.
 * Pure ESM — node --test, zero deps.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// File sumber di root — glob otomatis (sama seperti duplication-audit), jadi
// file baru ikut dipindai.
const FILES = fs
  .readdirSync(ROOT)
  .filter((f) => f.endsWith(".js") && fs.statSync(path.join(ROOT, f)).isFile())
  .sort();

/**
 * Pengecualian terdokumentasi — tambah hanya bila temuan benar-benar bukan
 * dead code (variabel state yang dibaca lewat pola di luar analisis ini).
 */
const DEAD_VAR_EXCLUSIONS = [
  // { file: "inject-x.js", name: "variabel", why: "alasan" },
];

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Hitung assignment bare (bukan properti `obj.X =`, bukan perbandingan). */
function countWrites(src, n) {
  const w = new RegExp("(?<![\\w$.])" + esc(n) + "\\s*(?:\\+=|-=|\\*=|/=|\\?\\?=|\\|\\|=|&&=|--|\\+\\+)", "g");
  const a = new RegExp("(?<![\\w$.])" + esc(n) + "\\s*=(?!=)", "g");
  return (src.match(w) || []).length + (src.match(a) || []).length;
}

test("audit variabel mati: tidak ada let yang tak pernah di-assign ulang atau tak pernah dibaca", () => {
  for (const core of ["shared.js", "inject-fb.js", "content-ig.js"]) {
    assert.ok(FILES.includes(core), `glob audit tidak menemukan ${core}`);
  }

  const excluded = new Set(
    DEAD_VAR_EXCLUSIONS.map((x) => `${x.file}:${x.name}`)
  );
  const findings = [];

  for (const f of FILES) {
    const src = read(f);

    // A. `let X = <falsy default>;` tidak pernah di-assign ulang.
    const declA = /\blet\s+([A-Za-z_$][\w$]*)\s*=\s*(null|0|false|""|''|undefined)\s*;/g;
    let m;
    while ((m = declA.exec(src))) {
      const n = m[1];
      if (excluded.has(`${f}:${n}`)) continue;
      const writes = countWrites(src, n);
      const hasDecl = new RegExp("\\blet\\s+" + esc(n) + "\\s*=").test(src);
      if (writes - (hasDecl ? 1 : 0) === 0) {
        findings.push(
          `${f}: ${n} — deklarasi 'let ${n} = ${m[2]};' tidak pernah di-assign ulang ` +
            `(nilai selalu ${m[2]}; pola readyWaiter → dead code atau harus const)`
        );
      }
    }

    // B. `let X ...;` (init apa pun) di-assign tapi tidak pernah dibaca.
    const declB = /\blet\s+([A-Za-z_$][\w$]*)\b/g;
    while ((m = declB.exec(src))) {
      const n = m[1];
      if (excluded.has(`${f}:${n}`)) continue;
      const refs = (src.match(new RegExp("(?<![\\w$.])" + esc(n) + "\\b", "g")) || []).length;
      const writes = countWrites(src, n);
      // `=` pada baris deklarasi terhitung sebagai write oleh countWrites —
      // eksklusikan agar hitungan pembacaan tidak undercount 1.
      const hasDecl = new RegExp("\\blet\\s+" + esc(n) + "\\s*=").test(src);
      const writesExclDecl = writes - (hasDecl ? 1 : 0);
      const reads = refs - 1 - writesExclDecl;
      if (reads <= 0 && writesExclDecl > 0) {
        findings.push(
          `${f}: ${n} — ${writesExclDecl} assignment (non-deklarasi) tapi 0 pembacaan (write-only → dead code)`
        );
      }
    }
  }

  assert.deepEqual(
    findings,
    [],
    [
      "Variabel mati terdeteksi (never-assigned ATAU never-read).",
      "Perbaiki sesuai kasus: hapus kalau benar dead code, tambahkan pembacaan",
      "kalau itu fitur yang hilang (kasus lastNewAt FB), atau daftarkan di",
      "DEAD_VAR_EXCLUSIONS kalau analisis ini false positive yang sah.",
    ].join("\n")
  );
});
