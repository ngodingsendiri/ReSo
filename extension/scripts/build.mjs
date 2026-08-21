#!/usr/bin/env node
/**
 * scripts/build.mjs — build ekstensi lintas platform (Windows/macOS/Linux).
 *
 * Menggantikan rantai `rm -rf && mkdir && cp ...` yang hanya jalan di shell
 * Unix. Menyalin file sumber + icons ke dist/, lalu memanggil stamp-version.
 */
import { mkdirSync, rmSync, copyFileSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const FILES = [
  "manifest.json",
  "background.js",
  "content-fb.js",
  "content-fb.css",
  "content-tiktok.js",
  "content-tiktok.css",
  "content-ig.js",
  "content-ig.css",
  "content-reso.js",
  "inject-fb.js",
  "inject-tiktok.js",
  "inject-ig.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js",
  "shared.js",
  "shared-module.js",
  "logo.svg",
];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const f of FILES) {
  const src = join(ROOT, f);
  if (!existsSync(src)) {
    console.error(`build: file sumber tidak ada — ${f}`);
    process.exit(1);
  }
  copyFileSync(src, join(DIST, f));
}

const icons = join(ROOT, "icons");
if (existsSync(icons)) {
  cpSync(icons, join(DIST, "icons"), { recursive: true });
} else {
  console.error("build: folder icons/ tidak ada");
  process.exit(1);
}

console.log(`build: dist/ siap (${FILES.length} file + icons)`);
