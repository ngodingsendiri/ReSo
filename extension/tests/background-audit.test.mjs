/**
 * Audit background/shared — kontrak sumber & perilaku murni untuk temuan
 * audit full-extension (F1/F2/F3). Zero deps, node --test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BG = read("background.js");
const SHARED = read("shared.js");

// ===================== F1: fallback platform lengkap =====================
test("kontrak F1: fallback msg.platform menerima ketiga platform", () => {
  // Dulu: hanya tiktok|facebook → instagram tak dikenali di jalur fallback.
  const m = BG.match(
    /\[["']tiktok["'],\s*["']facebook["'],\s*["']instagram["']\]\.includes\(msg\.platform\)/
  );
  assert.ok(m, "fallback platform wajib mencantumkan instagram");
});

// ===================== F3: statusFromReason konservatif =====================
function extractFn(src, name) {
  const idx = src.indexOf(`function ${name}(`);
  assert.ok(idx >= 0, `function ${name} not found`);
  const open = src.indexOf("{", idx);
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") {
      depth--;
      if (depth === 0) return src.slice(idx, k + 1);
    }
  }
  throw new Error("unbalanced " + name);
}

const statusFromReason = new Function(
  `${extractFn(BG, "statusFromReason")}\nreturn statusFromReason;`
)();

test("F3: reason tak dikenal tidak pernah 'done' — partial/error saja", () => {
  assert.equal(statusFromReason("unknown_xyz", 10), "partial");
  assert.equal(statusFromReason("unknown_xyz", 0), "error");
});

test("statusFromReason: peta resmi tetap utuh (regresi)", () => {
  assert.equal(statusFromReason("complete", 5), "done");
  assert.equal(statusFromReason("idle", 0), "error");
  assert.equal(statusFromReason("incomplete", 7), "partial");
  assert.equal(statusFromReason("live", 0), "error");
  assert.equal(statusFromReason("timeout", 3), "partial");
  assert.equal(statusFromReason("stopped", 2), "stopped");
  assert.equal(statusFromReason("rate_limit", 1), "partial");
});

// ===================== F2: timeout fetch ke ReSo =====================
test("kontrak F2: postResoEngagement memakai AbortController 15 dtk", () => {
  const i = SHARED.indexOf("async function postResoEngagement(");
  assert.ok(i >= 0);
  const body = SHARED.slice(i, i + 3000);
  assert.ok(body.includes("AbortController"), "wajib AbortController");
  assert.ok(body.includes("15_000") || body.includes("15000"), "timeout 15 dtk");
  assert.ok(body.includes("signal: ctl.signal"), "signal terpasang di fetch");
});
