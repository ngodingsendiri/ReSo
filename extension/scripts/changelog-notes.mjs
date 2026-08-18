#!/usr/bin/env node
/**
 * scripts/changelog-notes.mjs — ekstrak entri CHANGELOG untuk versi yang
 * dirilis, dipakai sebagai isi GitHub Release notes (--notes-file).
 *
 * Zero-dependensi (Node bawaan), pola yang sama dengan zip.mjs / check-yaml.mjs.
 *
 * Pemakaian:
 *   node scripts/changelog-notes.mjs <versi> [file-output]
 *
 * <versi> menerima "1.0.47" maupun "v1.0.47". Entri dicari sebagai header
 * level-2 "## [<versi>]" (Keep a Changelog); isi = semua baris sampai header
 * "## " berikutnya. Jika file-output diberikan → isi ditulis ke sana dan
 * ringkasan ke stderr; jika tidak → isi dicetak ke stdout.
 *
 * Entri tidak ditemukan → exit 1 + pesan jelas: release TIDAK boleh dibuat
 * tanpa entri CHANGELOG versi itu.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const CHANGELOG = join(ROOT, "CHANGELOG.md");

/**
 * Ekstrak bagian "## [<versi>]" dari teks CHANGELOG.
 * @param {string} md konten CHANGELOG.md
 * @param {string|number} version "1.0.47" atau "v1.0.47"
 * @returns {string} header + isi bagian, tanpa baris kosong berlebih, diakhiri newline
 * @throws {Error} jika header versi tidak ditemukan
 */
export function extractChangelogSection(md, version) {
  const v = String(version).replace(/^v/, "");
  const lines = md.split(/\r?\n/);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## \[([^\]]+)\]/);
    if (m && m[1].replace(/^v/, "") === v) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    throw new Error(`entri CHANGELOG "## [${v}]" tidak ditemukan`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }

  const section = lines.slice(start, end).join("\n").trim();
  return section + "\n";
}

// =====================================================================
// CLI
// =====================================================================
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  if (args.length < 1 || args[0] === "-h" || args[0] === "--help") {
    console.error("Pemakaian: node scripts/changelog-notes.mjs <versi> [file-output]");
    process.exit(args.length < 1 ? 2 : 0);
  }
  const version = args[0];
  const outFile = args[1];
  let md;
  try {
    md = readFileSync(CHANGELOG, "utf8");
  } catch (err) {
    console.error(`✗ tidak bisa membaca ${CHANGELOG}: ${err.message}`);
    process.exit(1);
  }
  try {
    const section = extractChangelogSection(md, version);
    if (outFile) {
      writeFileSync(outFile, section);
      console.error(`✓ entri CHANGELOG [${version}] (${section.length} char) ditulis ke ${outFile}`);
    } else {
      process.stdout.write(section);
    }
  } catch (err) {
    console.error(`✗ ${err.message} — tambahkan entri CHANGELOG dulu sebelum rilis.`);
    process.exit(1);
  }
}
