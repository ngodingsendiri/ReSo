/**
 * tests/check-yaml.test.mjs — unit test scripts/check-yaml.mjs.
 *
 * Diskriminator: tiap kelas kegagalan yang bisa memutus workflow GitHub
 * (indentasi, block scalar, kutip, ${{ }}, skema job/step) wajib terdeteksi,
 * termasuk persis bug release.yml v1.0.47 (baris lanjutan --notes di kolom 0
 * menjadi key root tak dikenal).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkYamlContent } from "../scripts/check-yaml.mjs";

const WF = (p) => fileURLToPath(new URL(`../.github/workflows/${p}`, import.meta.url));

test("YAML workflow valid: ci.yml (file asli di repo) lolos", () => {
  const r = checkYamlContent(readFileSync(WF("ci.yml"), "utf8"), "ci.yml");
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
});

test("YAML workflow valid: release.yml (file asli di repo) lolos", () => {
  const r = checkYamlContent(readFileSync(WF("release.yml"), "utf8"), "release.yml");
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
});

test("DISKRIMINATOR bug v1.0.47: baris lanjutan --notes di kolom 0 → key root tak dikenal", () => {
  const broken = `name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Buat GitHub Release + upload artifact
        run: |
          gh release create "\$GITHUB_REF_NAME" "\$ZIP" \\
            --notes "Rilis otomatis dari tag \$GITHUB_REF_NAME.

Artifact: **\$ZIP** — siap di-load unpacked.
`;
  const r = checkYamlContent(broken, "release-broken.yml");
  assert.ok(
    r.errors.some((e) => e.includes('key root tidak dikenal: "Artifact"')),
    `harus menangkap key root Artifact, dapat: ${JSON.stringify(r.errors)}`,
  );
});

test("DISKRIMINATOR: TAB di indentasi ditolak", () => {
  const src = "name: CI\non:\n\tpush:\n";
  const r = checkYamlContent(src, "tab.yml");
  assert.ok(r.errors.some((e) => e.includes("TAB")), JSON.stringify(r.errors));
});

test("DISKRIMINATOR: konten block scalar tidak boleh di indentasi key-nya sendiri", () => {
  const src = "jobs:\n  job1:\n    run: |\n    echo hai\n";
  const r = checkYamlContent(src, "block.yml");
  assert.ok(r.errors.length > 0, "harus error — baris `echo hai` keluar dari block scalar");
});

test("DISKRIMINATOR: ekspresi ${{ }} tidak seimbang ditolak", () => {
  const src = "jobs:\n  job1:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ github.ref\n";
  const r = checkYamlContent(src, "expr.yml");
  assert.ok(r.errors.some((e) => e.includes("${{ }} tidak seimbang")), JSON.stringify(r.errors));
});

test("DISKRIMINATOR: key root tidak dikenal ditolak (skema GitHub)", () => {
  const src = "name: X\non: push\nbogus_key: 1\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n";
  const r = checkYamlContent(src, "schema.yml");
  assert.ok(r.errors.some((e) => e.includes('key root tidak dikenal: "bogus_key"')), JSON.stringify(r.errors));
});

test("DISKRIMINATOR: job tanpa runs-on ditolak (skema GitHub)", () => {
  const src = "name: X\non: push\njobs:\n  a:\n    steps:\n      - run: echo\n";
  const r = checkYamlContent(src, "norun.yml");
  assert.ok(r.errors.some((e) => e.includes('job "a": wajib punya runs-on')), JSON.stringify(r.errors));
});

test("DISKRIMINATOR: step tanpa name/uses/run ditolak (skema GitHub)", () => {
  const src = "name: X\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - env:\n          FOO: bar\n";
  const r = checkYamlContent(src, "barestep.yml");
  assert.ok(r.errors.some((e) => e.includes("step tanpa name/uses/run")), JSON.stringify(r.errors));
});
