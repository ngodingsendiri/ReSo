/**
 * tests/changelog-notes.test.mjs — unit test scripts/changelog-notes.mjs.
 *
 * Menguji ekstraksi entri CHANGELOG terhadap file CHANGELOG.md asli repo:
 * batas antar-section (tidak bocor ke [Unreleased] / versi lain), normalisasi
 * prefiks "v", dan kegagalan saat versi tidak punya entri.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractChangelogSection } from "../scripts/changelog-notes.mjs";

const CHANGELOG = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
const MD = readFileSync(CHANGELOG, "utf8");

test("ekstrak 1.0.47: header + isi, TIDAK bocor dari section versi lain", () => {
  const s = extractChangelogSection(MD, "1.0.47");
  assert.ok(s.startsWith("## [1.0.47]"), `harus mulai dari header versi, dapat: ${s.slice(0, 40)}`);
  assert.ok(s.includes("### Release tooling"), "isi 1.0.47 harus ada");
  assert.ok(!s.includes("Validasi sintaks YAML"), "isi [Unreleased] tidak boleh bocor ke 1.0.47");
  assert.ok(!s.includes("Test chip fnk-inline"), "isi [1.0.46] tidak boleh bocor ke 1.0.47");
});

test("ekstrak 1.0.46: batas bawah benar, tidak berisi konten 1.0.47", () => {
  const s = extractChangelogSection(MD, "1.0.46");
  assert.ok(s.startsWith("## [1.0.46]"), "harus mulai dari header 1.0.46");
  assert.ok(s.includes("### Test chip fnk-inline"), "isi 1.0.46 harus ada");
  assert.ok(!s.includes("### Release tooling"), "konten 1.0.47 tidak boleh bocor ke 1.0.46");
});

test("prefiks v dinormalisasi: 'v1.0.47' menghasilkan bagian yang sama", () => {
  assert.equal(extractChangelogSection(MD, "v1.0.47"), extractChangelogSection(MD, "1.0.47"));
});

test("versi tanpa entri CHANGELOG → error dengan pesan jelas", () => {
  assert.throws(() => extractChangelogSection(MD, "99.99.99"), /tidak ditemukan/);
});
