/**
 * Validator skema manifest Chrome MV3 (scripts/check-manifest-schema.mjs).
 * Test perilaku NYATA validator:
 *  - manifest.json sumber & dist/manifest.json valid (tanpa error),
 *  - kasus negatif ditolak: version buruk, MV2, permission tak dikenal,
 *    match pattern rusak, run_at salah, ukuran ikon aneh, background.type,
 *    suggested_key tidak valid.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateManifest } from "../scripts/check-manifest-schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("manifest.json sumber valid (0 error)", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const { errors } = validateManifest(manifest, ROOT, "manifest.json");
  assert.deepEqual(errors, [], `kesalahan: ${errors.join("; ")}`);
});

test("dist/manifest.json valid (0 error) — build output yang di-load-unpacked", () => {
  const distPath = join(ROOT, "dist", "manifest.json");
  const manifest = JSON.parse(readFileSync(distPath, "utf8"));
  const { errors } = validateManifest(manifest, join(ROOT, "dist"), "dist/manifest.json");
  assert.deepEqual(errors, [], `kesalahan: ${errors.join("; ")}`);
});

test("versi manifest.json sumber = package.json (anti-drift stamp-version)", () => {
  // stamp-version.mjs hanya menulis dist/ saat build — tanpa guard ini,
  // manifest sumber bisa tertinggal (kasus nyata: source 1.0.52 vs pkg 1.0.57)
  // dan load-unpacked dari folder sumber menampilkan versi salah.
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  assert.equal(
    manifest.version,
    pkg.version,
    `manifest.json (${manifest.version}) ≠ package.json (${pkg.version}) — naikkan keduanya bersamaan`
  );
});

test("version salah format ditolak (5 bagian, non-numerik)", () => {
  for (const version of ["1.0.0.0.1", "1.0.50-alpha", "1.0.0."]) {
    const { errors } = validateManifest(
      { manifest_version: 3, name: "x", version },
      null,
      "test"
    );
    assert.ok(errors.some((e) => e.includes("version tidak valid")), `harus tolak ${version}`);
  }
});

test("manifest_version selain 3 ditolak", () => {
  const { errors } = validateManifest(
    { manifest_version: 2, name: "x", version: "1.0.0" },
    null,
    "test"
  );
  assert.ok(errors.some((e) => e.includes("manifest_version harus 3")));
});

test("permission tidak dikenal ditolak (Chrome tolak load)", () => {
  const { errors } = validateManifest(
    { manifest_version: 3, name: "x", version: "1.0.0", permissions: ["storage", "foo"] },
    null,
    "test"
  );
  assert.ok(errors.some((e) => e.includes('permission tidak dikenal') && e.includes('"foo"')));
});

test("match pattern rusak / wildcard host tengah ditolak", () => {
  for (const pat of ["https://", "https://fb.*.com/*", "https://a b.com/*"]) {
    const { errors } = validateManifest(
      { manifest_version: 3, name: "x", version: "1.0.0", host_permissions: [pat] },
      null,
      "test"
    );
    assert.ok(errors.length > 0, `harus tolak ${pat} (pesan: ${errors.join("; ")})`);
  }
});

test("run_at di luar enum ditolak", () => {
  const { errors } = validateManifest(
    {
      manifest_version: 3,
      name: "x",
      version: "1.0.0",
      content_scripts: [{ matches: ["https://a.com/*"], js: ["a.js"], run_at: "document_weird" }],
    },
    null,
    "test"
  );
  assert.ok(errors.some((e) => e.includes("run_at")));
});

test("ukuran ikon tidak dikenal ditolak", () => {
  const { errors } = validateManifest(
    { manifest_version: 3, name: "x", version: "1.0.0", icons: { 20: "i.png" } },
    null,
    "test"
  );
  assert.ok(errors.some((e) => e.includes("ukuran ikon")));
});

test("background.type selain module ditolak", () => {
  const { errors } = validateManifest(
    { manifest_version: 3, name: "x", version: "1.0.0", background: { service_worker: "b.js", type: "classic" } },
    null,
    "test"
  );
  assert.ok(errors.some((e) => e.includes('hanya boleh "module"')));
});

test("suggested_key: lebih dari satu tombol / F-key / tanpa modifier ditolak", () => {
  for (const key of ["Ctrl+E+X", "Ctrl+F5", "E", "Ctrl+Shift+Shift+E"]) {
    const { errors } = validateManifest(
      { manifest_version: 3, name: "x", version: "1.0.0", commands: { run: { suggested_key: { default: key }, description: "d" } } },
      null,
      "test"
    );
    assert.ok(errors.some((e) => e.includes("suggested_key")), `harus tolak ${key}`);
  }
});

test("manifest valid minimal & kombinasi modifier ganda diterima", () => {
  const { errors } = validateManifest(
    {
      manifest_version: 3,
      name: "x",
      version: "1.0.50",
      permissions: ["storage"],
      host_permissions: ["https://a.com/*"],
      content_scripts: [{ matches: ["https://a.com/*"], js: ["a.js"], run_at: "document_idle" }],
      background: { service_worker: "b.js", type: "module" },
      action: { default_popup: "p.html" },
      commands: {
        run: { suggested_key: { default: "Ctrl+Shift+E", mac: "MacCtrl+Shift+P" }, description: "d" },
        copy: { suggested_key: { default: "Alt+Shift+9" }, description: "d" },
      },
    },
    null,
    "test"
  );
  assert.deepEqual(errors, []);
});
