// Stamp versi package.json ke dist/manifest.json — dipanggil oleh `npm run build`.
// Mencegah mismatch seperti zip v1.0.50 berisi manifest 1.0.49:
// versi di dalam artifact SELALU sama dengan nama file zip.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const manifestPath = join(ROOT, "dist", "manifest.json");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  console.error("stamp-version: dist/manifest.json tidak ada — jalankan build dulu.");
  process.exit(1);
}

manifest.version = pkg.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`stamp-version: dist/manifest.json -> ${pkg.version}`);
