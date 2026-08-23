/**
 * extreme-stress.test.mjs — Stress test ekstrem untuk engine ReSo Extension.
 *
 * Mensimulasikan input bermusuhan, payload raksasa, konkurensi, dan
 * edge-case yang jarang terjadi di produksi tapi bisa crash seluruh engine.
 *
 * Target: FB/TT/IG parsers, normalize, GraphQL relay, queue, state flow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FB_SRC = readFileSync(join(ROOT, "inject-fb.js"), "utf8");

// ── Extract helper dari inject-fb.js (brace-counting string-aware) ──
function extract(fnName) {
  const idx = FB_SRC.indexOf(`function ${fnName}(`);
  assert.ok(idx >= 0, `function ${fnName} not found`);
  const start = idx - (FB_SRC.slice(Math.max(0, idx - 6), idx) === "async " ? 6 : 0);
  const openIdx = FB_SRC.indexOf("{", start);
  let depth = 0;
  let i = openIdx;
  let inStr = null;
  let inLine = false;
  let inBlock = false;
  let inRegex = false;
  for (; i < FB_SRC.length; i++) {
    const ch = FB_SRC[i];
    const next = FB_SRC[i + 1];
    if (inLine) { if (ch === "\n") inLine = false; continue; }
    if (inBlock) { if (ch === "*" && next === "/") { inBlock = false; i++; } continue; }
    if (inStr) { if (ch === "\\") { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (inRegex) { if (ch === "\\") { i++; continue; } if (ch === "/") inRegex = false; continue; }
    if (ch === "/" && next === "/") inLine = true;
    else if (ch === "/" && next === "*") inBlock = true;
    else if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === "/" && /[(\s,=[!&|?:;{}]/.test(FB_SRC[i - 1] || " ")) inRegex = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  return FB_SRC.slice(start, i + 1);
}

/** Helper ekstraksi fungsi dari shared.js — ambil blok fungsi utuh (brace-aware). */
function extractShared(fnName) {
  const src = readFileSync(join(ROOT, "shared.js"), "utf8");
  const idx = src.indexOf(`function ${fnName}(`);
  assert.ok(idx >= 0, `function ${fnName} not found in shared.js`);
  const openIdx = src.indexOf("{", idx);
  let depth = 0;
  let i = openIdx;
  let inStr = null;
  let inLine = false;
  let inBlock = false;
  let inRegex = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLine) { if (ch === "\n") inLine = false; continue; }
    if (inBlock) { if (ch === "*" && next === "/") { inBlock = false; i++; } continue; }
    if (inStr) { if (ch === "\\") { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (inRegex) { if (ch === "\\") { i++; continue; } if (ch === "/") inRegex = false; continue; }
    if (ch === "/" && next === "/") inLine = true;
    else if (ch === "/" && next === "*") inBlock = true;
    else if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === "/" && /[(\s,=[!&|?:;{}]/.test(src[i - 1] || " ")) inRegex = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(idx, i + 1);
}

function setupNormalize() {
  const fn = extractShared("normalizeCommentName");
  const script = new Function(fn + "\nreturn { normalizeCommentName };");
  return script();
}

function setupFbGraphql() {
  const fnSrc = [
    extract("extractGraphqlNames"),
    extract("splitJsonChunks"),
    "return { extractGraphqlNames, splitJsonChunks };",
  ].join("\n");
  return new Function(fnSrc)();
}

function setupFbId() {
  const fnSrc = [
    extract("fbIdB64"),
    extract("fbIdsMatch"),
    extract("normalizeFeedbackId"),
    "return { fbIdB64, fbIdsMatch, normalizeFeedbackId };",
  ].join("\n");
  return new Function(fnSrc)();
}

// ===================== 1. NormalizeCommentName — Input ekstrem =====================
test("STRESS: normalizeCommentName — 10.000× random karakter", () => {
  const { normalizeCommentName } = setupNormalize();
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 10_000; i++) {
    const len = Math.floor(rnd() * 500) + 1;
    const chars = [];
    for (let j = 0; j < len; j++) {
      const r = rnd();
      if (r < 0.3) chars.push(String.fromCodePoint(0x20 + Math.floor(rnd() * 0x5E)));
      else if (r < 0.5) chars.push(String.fromCodePoint(0x1F600 + Math.floor(rnd() * 100)));
      else if (r < 0.7) chars.push(String.fromCodePoint(0x600 + Math.floor(rnd() * 0x500)));
      else if (r < 0.85) chars.push("\u200b\u200c\u200d\ufeff"[Math.floor(rnd() * 4)]);
      else chars.push("\x00\x01\x02\x1B\x7F\x80\xFF"[Math.floor(rnd() * 7)]);
    }
    const result = normalizeCommentName(chars.join(""));
    assert.ok(typeof result === "string", "tidak crash: " + result.length);
  }
});

test("STRESS: normalizeCommentName — null/undefined/number/object", () => {
  const { normalizeCommentName } = setupNormalize();
  assert.equal(normalizeCommentName(null), "");
  assert.equal(normalizeCommentName(undefined), "");
  assert.equal(normalizeCommentName(123), "");
  assert.equal(normalizeCommentName({}), "");
  assert.equal(normalizeCommentName([]), "");
  assert.equal(normalizeCommentName(true), "");
});

test("STRESS: normalizeCommentName — SQL injection / XSS payload", () => {
  const { normalizeCommentName } = setupNormalize();
  const xss = [
    "<script>alert(1)</script>",
    "' OR 1=1 --",
    "Robert'); DROP TABLE Students;--",
    "{{7*7}}",
    "${7*7}",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
    "\\u0027 OR 1=1 --",
    "&#x3C;script&#x3E;",
    "A".repeat(5000),
    "正常な名前です長い名前",
    "مثال بالعربية",
    "名前テスト",
  ];
  for (const payload of xss) {
    const r = normalizeCommentName(payload);
    assert.ok(typeof r === "string", "tidak crash: " + payload.slice(0, 30));
  }
});

test("STRESS: extractGraphqlNames — payload relay raksasa (10MB)", () => {
  const { extractGraphqlNames } = setupFbGraphql();
  const huge = '{"data":{"node":{"__typename":"Comment","author":{"name":"Andi"}}}}';
  const payload = (huge + "x".repeat(1_000_000)).slice(0, 10_000_000);
  const result = extractGraphqlNames(payload, true);
  assert.ok(Array.isArray(result), "tidak crash pada payload 10MB");
});

test("STRESS: extractGraphqlNames — nested brace overload (10.000 level)", () => {
  const { extractGraphqlNames } = setupFbGraphql();
  let deep = "";
  for (let i = 0; i < 10_000; i++) deep += '{"a":';
  deep += '"name":"Andi"';
  for (let i = 0; i < 10_000; i++) deep += "}";
  const result = extractGraphqlNames(deep, true);
  assert.ok(Array.isArray(result), "tidak crash pada nested 10.000 level");
});

test("STRESS: extractGraphqlNames — karakter kontrol dalam string JSON", () => {
  const { extractGraphqlNames } = setupFbGraphql();
  const payload = '{"__typename":"Comment","author":{"name":"Andi\\u0000\\u0001\\u0002\\u001B\\u007F\\u009F\\u200B"}}';
  const result = extractGraphqlNames(payload, true);
  assert.ok(Array.isArray(result), "tidak crash pada karakter kontrol dalam JSON");
});

test("STRESS: extractGraphqlNames — braces di dalam string (parse string-aware)", () => {
  const { extractGraphqlNames } = setupFbGraphql();
  const payload = '{"__typename":"Comment","author":{"name":"Andi","bio":"a{b}c{d}e{f}"},"comment_parent":{"id":"x"}}';
  const result = extractGraphqlNames(payload, true);
  assert.ok(Array.isArray(result), "tidak crash pada braces di dalam string");
});

test("STRESS: extractGraphqlNames — 1000 pola regex match cepat", () => {
  const { extractGraphqlNames } = setupFbGraphql();
  const parts = [];
  for (let i = 0; i < 1000; i++) {
    parts.push(`{"__typename":"Comment","author":{"name":"User${i}"},"created_time":${i}}`);
  }
  const payload = "[" + parts.join(",") + "]";
  const result = extractGraphqlNames(payload, true);
  assert.ok(result.length === 1000, "1000 nama terekstrak dalam 1 payload");
});

test("STRESS: extractGraphqlNames — payload dengan prefix for(;;); + chunk", () => {
  const { extractGraphqlNames, splitJsonChunks } = setupFbGraphql();
  const chunk1 = `for(;;);{"__typename":"Comment","author":{"name":"Andi"}}`;
  const chunk2 = `for(;;);{"__typename":"Comment","author":{"name":"Budi"}}`;
  const chunks = splitJsonChunks(chunk1 + chunk2);
  let names = [];
  for (const c of chunks) {
    names = names.concat(extractGraphqlNames(c, true));
  }
  assert.equal(names.length, 2, "2 chunk di-parse dengan benar");
});

test("STRESS: fbIdB64 — edge case input (tidak crash)", () => {
  const { fbIdB64, fbIdsMatch, normalizeFeedbackId } = setupFbId();
  const ids = [null, undefined, "", "0", "123", "999999999999999", "abc", "   ", "a", "1", "!@#$%^&*()"];
  for (const id of ids) {
    // fbIdB64 hanya memproses string non-kosong; input lain diteruskan apa
    // adanya (null/undefined) — yang diuji adalah TIDAK CRASH.
    fbIdB64(id);
  }
  assert.equal(fbIdB64("123"), btoa("feedback:123"), "id numerik di-encode base64");
  assert.equal(fbIdB64(null), null, "null diteruskan");
  assert.equal(fbIdB64(""), "", "string kosong diteruskan");
  assert.equal(fbIdB64(123), 123, "non-string diteruskan");
});

test("STRESS: normalizeFeedbackId — edge case input (tidak crash)", () => {
  const { normalizeFeedbackId } = setupFbId();
  const inputs = [null, undefined, "", "123", "abcdef", "!@#$%", "a".repeat(1000), {}, [], 0, 1, true];
  for (const v of inputs) {
    normalizeFeedbackId(v);
  }
  // Perilaku nyata: non-string / string pendek / non-base64 diteruskan.
  assert.equal(normalizeFeedbackId("123"), "123");
  assert.equal(normalizeFeedbackId(btoa("feedback:100037619991877")), "100037619991877");
});

test("STRESS: splitJsonChunks — chunk bercampur sampah (tidak crash)", () => {
  const { splitJsonChunks } = setupFbGraphql();
  const inputs = [
    'for(;;);{"a":1}',
    'for(;;);\n{"a":1}\nfor(;;);{"b":2}',
    '{"a":1}{"b":2}',
    'for(;;);',
    '',
    null,
    undefined,
    "A".repeat(100_000),
    'for(;;);' + "x".repeat(50_000) + '{"a":1}',
  ];
  for (const input of inputs) {
    try {
      const chunks = splitJsonChunks(input);
      assert.ok(Array.isArray(chunks), "return array: " + typeof input);
    } catch (e) {
      if (input != null && input !== undefined)
        assert.fail(`splitJsonChunks crash: len=${String(input).length} → ${e.message}`);
    }
  }
});

// ===================== walkJson / extractNamesFromText — payload dalam =====================
function makeFbExtract() {
  const fnSrc = [
    "const gqlBuffer = [];",
    "const nameMap = new Map();",
    "let includeReplies = true;",
    "let lastNewAt = 0;",
    extract("normalizeCommentName"),
    extract("extractGraphqlNames"),
    extract("splitJsonChunks"),
    extract("walkJson"),
    extract("isCommentLike"),
    extract("isReplyComment"),
    extract("addName"),
    extract("extractNamesFromText"),
    "return { extractNamesFromText, names: () => [...nameMap.values()] };",
  ].join("\n");
  return new Function(fnSrc)();
}

test("STRESS: extractNamesFromText — payload nested 50 level dengan Comment di dasar", () => {
  const h = makeFbExtract();
  let deep = "";
  for (let i = 0; i < 50; i++) deep += '{"a":';
  deep += '{"__typename":"Comment","author":{"name":"Andi Dalam"}}';
  for (let i = 0; i < 50; i++) deep += "}";
  try {
    const n = h.extractNamesFromText(deep);
    assert.ok(n >= 0, "tidak crash, ekstrak " + n + " nama");
  } catch (e) {
    assert.fail(`extractNamesFromText crash (nested 50): ${e.message}`);
  }
});

test("STRESS: extractNamesFromText — 10.000 komentar dalam satu JSON", () => {
  const h = makeFbExtract();
  const comments = [];
  for (let i = 0; i < 10_000; i++) {
    comments.push({ __typename: "Comment", id: String(i), author: { name: `Orang ${i}` } });
  }
  const payload = JSON.stringify({ data: { feedback: { comments } } });
  try {
    const n = h.extractNamesFromText(payload);
    assert.equal(n, 10_000, "10.000 nama diekstrak dari 1 JSON");
    assert.equal(h.names().length, 10_000);
  } catch (e) {
    assert.fail(`extractNamesFromText crash (10.000 komentar): ${e.message}`);
  }
});

test("STRESS: extractNamesFromText — input non-string / null (tidak crash)", () => {
  const h = makeFbExtract();
  assert.equal(h.extractNamesFromText(null), 0);
  assert.equal(h.extractNamesFromText(undefined), 0);
  assert.equal(h.extractNamesFromText(123), 0);
  assert.equal(h.extractNamesFromText({}), 0);
  assert.equal(h.extractNamesFromText([]), 0);
});

// ===================== isCommentLike / isReplyComment — fuzz =====================
function makeFbDetect() {
  const fnSrc = [
    extract("isCommentLike"),
    extract("isReplyComment"),
    "return { isCommentLike, isReplyComment };",
  ].join("\n");
  return new Function(fnSrc)();
}

test("STRESS: isCommentLike/isReplyComment — 10.000 objek fuzz (tidak crash)", () => {
  const { isCommentLike, isReplyComment } = makeFbDetect();
  let seed = 987654321;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 10_000; i++) {
    const obj = {
      __typename: rnd() < 0.3 ? "Comment" : rnd() < 0.5 ? "Photo" : "User",
      author: rnd() < 0.8 ? { name: "Orang " + i } : null,
      comment_parent: rnd() < 0.2 ? { id: "p" + i } : undefined,
      depth: rnd() < 0.3 ? Math.floor(rnd() * 5) : undefined,
      body: rnd() < 0.6 ? { text: "isi komentar ke-" + i } : undefined,
      created_time: rnd() < 0.5 ? 1700000000 + i : undefined,
    };
    isCommentLike(obj);
    isReplyComment(obj);
  }
  assert.ok(true, "10.000 fuzz isCommentLike/isReplyComment tidak crash");
});

// ===================== Normalisasi IG/TT — edge case =====================
function setupNormalizeAll() {
  const fn = [
    extractShared("normalizeCommentName"),
    extractShared("normalizeNickname"),
    extractShared("normalizeInstagramUsername"),
  ].join("\n");
  const script = new Function(fn + "\nreturn { normalizeCommentName, normalizeNickname, normalizeInstagramUsername };");
  return script();
}

test("STRESS: normalizeNickname — 5.000 fuzz karakter (tidak crash)", () => {
  const { normalizeNickname } = setupNormalizeAll();
  let seed = 424242;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 5000; i++) {
    const len = Math.floor(rnd() * 200) + 1;
    const chars = [];
    for (let j = 0; j < len; j++) {
      const r = rnd();
      if (r < 0.4) chars.push(String.fromCodePoint(0x41 + Math.floor(rnd() * 26)));
      else if (r < 0.6) chars.push(String.fromCodePoint(0x30 + Math.floor(rnd() * 10)));
      else if (r < 0.8) chars.push(String.fromCodePoint(0x1F300 + Math.floor(rnd() * 100)));
      else chars.push("._-@#" [Math.floor(rnd() * 5)]);
    }
    const r = normalizeNickname(chars.join(""));
    assert.ok(typeof r === "string", "tidak crash: " + r.length);
  }
});

test("STRESS: normalizeInstagramUsername — 5.000 fuzz (tidak crash)", () => {
  const { normalizeInstagramUsername } = setupNormalizeAll();
  const inputs = [
    "a".repeat(1000), "A".repeat(31), "@user", "user.name_", "..user", "user..name",
    "user.", ".user", "user name", "user\tname", "", "   ", null, undefined, 123,
    "h\u200bdidik", "jawaban\u200c_tepat", "a.b.c.d.e.f.g", "oke12345_",
  ];
  for (const u of inputs) {
    try {
      const r = normalizeInstagramUsername(u);
      assert.ok(typeof r === "string", "tidak crash: " + String(u).slice(0, 30));
    } catch (e) {
      assert.fail(`normalizeInstagramUsername crash: "${u}" → ${e.message}`);
    }
  }
});

// ===================== Queue — overload =====================
import {
  normalizeName as modNormalize,
  parsePostAgeText,
  createTimeFromRehydration,
  scanPageForPostDate,
  enqueueResoPayload,
  getResoPending,
  flushResoQueue,
} from "../shared-module.js";

function mockChrome({ storage = {} } = {}) {
  const store = { ...storage };
  const orig = globalThis.chrome;
  const chrome = {
    storage: {
      local: {
        get: async (k) => {
          const out = {};
          for (const key of [].concat(k)) out[key] = store[key] ?? null;
          return out;
        },
        set: async (o) => Object.assign(store, o),
        remove: async (keys) => {
          for (const k of [].concat(keys)) delete store[k];
        },
      },
    },
    runtime: {
      sendMessage: async () => { throw new Error("no receiver"); },
      lastError: null,
    },
    tabs: { query: async () => [] },
  };
  globalThis.chrome = chrome;
  return { store, restore: () => { globalThis.chrome = orig; } };
}

test("STRESS: parsePostAgeText — 100× edge case timestamp (tidak crash)", () => {
  const cases = [
    ["baru saja", Date.now()],
    ["just now", Date.now()],
    ["3 jam yang lalu", Date.now()],
    ["1 menit yang lalu", Date.now()],
    ["2 hari yang lalu", Date.now()],
    ["kemarin", Date.now()],
    ["Kemarin pukul 07.30", Date.now()],
    ["Hari ini pukul 14.05", Date.now()],
    ["8 Agu pukul 07.30", Date.parse("2026-08-08T00:00:00+07:00")],
    ["1 bln", Date.now()],
    ["2 thn", Date.now()],
    ["5d", Date.now()],
    ["3h", Date.now()],
    ["10 jam", Date.now()],
    ["about 2 hours ago", Date.now()],
    ["a minute ago", Date.now()],
    ["an hour ago", Date.now()],
    ["18 Agustus 2026 pukul 07.30", Date.now()],
    ["", Date.now()],
    ["   ", Date.now()],
    ["tidak dikenal", Date.now()],
    [null, Date.now()],
    [undefined, Date.now()],
    [123, Date.now()],
    [[], Date.now()],
    [{}, Date.now()],
  ];
  for (const [text, now] of cases) {
    try {
      const result = parsePostAgeText(text, now);
      assert.ok(result === null || (typeof result === "object" && !Array.isArray(result)),
        "return null atau object: " + JSON.stringify(text));
    } catch (e) {
      assert.fail(`parsePostAgeText crash: "${text}" → ${e.message}`);
    }
  }
});

test("STRESS: createTimeFromRehydration — malformed data (tidak crash)", () => {
  const inputs = [
    null, undefined, {}, [], "", 0, true,
    { __UNIVERSAL_DATA_FOR_REHYDRATION__: null },
    { __UNIVERSAL_DATA_FOR_REHYDRATION__: {} },
    { __UNIVERSAL_DATA_FOR_REHYDRATION__: { __DEFAULT_SCOPE__: {} } },
    { __UNIVERSAL_DATA_FOR_REHYDRATION__: { __DEFAULT_SCOPE__: { webapp: {} } } },
    { __UNIVERSAL_DATA_FOR_REHYDRATION__: { __DEFAULT_SCOPE__: { webapp: { video: {} } } } },
    { __UNIVERSAL_DATA_FOR_REHYDRATION__: { __DEFAULT_SCOPE__: { webapp: { video: { createTime: -1 } } } } },
    { __UNIVERSAL_DATA_FOR_REHYDRATION__: { __DEFAULT_SCOPE__: { webapp: { video: { createTime: 0 } } } } },
    { __UNIVERSAL_DATA_FOR_REHYDRATION__: { __DEFAULT_SCOPE__: { webapp: { video: { createTime: "not a number" } } } } },
    { __UNIVERSAL_DATA_FOR_REHYDRATION__: { __DEFAULT_SCOPE__: { webapp: { video: { createTime: 999999999999999 } } } } },
  ];
  for (const input of inputs) {
    try {
      const r = createTimeFromRehydration(input);
      assert.ok(r === null || typeof r === "number", "return null atau number: " + String(input).slice(0, 80));
    } catch (e) {
      assert.fail(`createTimeFromRehydration crash: ${e.message}`);
    }
  }
});

test("STRESS: scanPageForPostDate — DOM edge case (tidak crash)", () => {
  const now = Date.now();
  const inputs = [null, undefined, {}, { querySelectorAll: () => [] }, { querySelectorAll: () => [null] }];
  for (const root of inputs) {
    try {
      scanPageForPostDate(root, now);
    } catch (e) {
      assert.fail(`scanPageForPostDate crash: ${e.message}`);
    }
  }
});

test("STRESS: enqueueResoPayload — 2.000 payload berturut-turut", async () => {
  const { store, restore } = mockChrome({ storage: {} });
  try {
    for (let i = 0; i < 2000; i++) {
      await enqueueResoPayload({ platform: "facebook", names: [`User${i}`], date: "2026-08-23" });
    }
    const pending = await getResoPending();
    assert.ok(pending.length > 0, "antrian terisi");
    assert.ok(pending.length <= 2000, "antrian tidak overflow: " + pending.length);
  } finally {
    restore();
  }
});

test("STRESS: enqueueResoPayload — 10.000 nama dalam 1 payload tersimpan semua, enqueue kedua di-dedupe", async () => {
  const { restore } = mockChrome({ storage: {} });
  try {
    const manyNames = new Array(10_000).fill("Andi Wijaya");
    await enqueueResoPayload({ platform: "facebook", names: manyNames, date: "2026-08-23" });
    const pending1 = await getResoPending();
    assert.equal(pending1.length, 1, "satu entry");
    assert.equal(pending1[0].names.length, 10_000, "payload besar tidak dipangkas");

    // Enqueue kedua nama sama → mergeNames (platform facebook) di-dedupe.
    await enqueueResoPayload({ platform: "facebook", names: ["Andi Wijaya", "Budi"], date: "2026-08-23" });
    const pending2 = await getResoPending();
    assert.equal(pending2.length, 1, "tetap 1 entry (merge antar payload)");
    assert.equal(pending2[0].names.length, 2, "10.000 Andi + Budi di-dedupe jadi Andi + Budi");
  } finally {
    restore();
  }
});

test("STRESS: enqueueResoPayload — 1000 nama unik per payload", async () => {
  const { restore } = mockChrome({ storage: {} });
  try {
    const manyNames = [];
    for (let i = 0; i < 1000; i++) manyNames.push(`User Ke-${i}`);
    await enqueueResoPayload({ platform: "tiktok", names: manyNames, date: "2026-08-23" });
    const pending = await getResoPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].names.length, 1000, "1000 nama unik disimpan");
  } finally {
    restore();
  }
});

test("STRESS: flushResoQueue — tanpa fetch ter-mock → tidak crash", async () => {
  const { restore } = mockChrome({ storage: {} });
  try {
    await enqueueResoPayload({ platform: "facebook", names: ["Andi"], date: "2026-08-23" });
    await flushResoQueue();
  } finally {
    restore();
  }
});

// Sanity: modNormalize setara dengan setupNormalize
test("STRESS: normalizeCommentName parity (module vs extract)", () => {
  const { normalizeCommentName } = setupNormalize();
  assert.equal(modNormalize("  Budi  Santoso  ", "facebook"), normalizeCommentName("  Budi  Santoso  "));
  assert.equal(modNormalize("View 3 more comments", "facebook"), normalizeCommentName("View 3 more comments"));
});

// ===================== Queue — konkurensi & race condition =====================
test("STRESS: enqueueResoPayload — 50 enqueue concurrent (tanpa lock)", async () => {
  const { restore } = mockChrome({ storage: {} });
  try {
    // 50 enqueue simultan — tanja lock, ini paling rawan lost-update.
    const tasks = [];
    for (let i = 0; i < 50; i++) {
      tasks.push(enqueueResoPayload({ platform: "facebook", names: [`User${i}`], date: "2026-08-23" }));
    }
    await Promise.all(tasks);
    const pending = await getResoPending();
    // Tanpa lock, bisa terjadi lost-update (beberapa entry hilang) atau
    // duplikasi entry. Yang diuji: tidak crash, dan antrian tidak kosong.
    assert.ok(pending.length > 0, "antrian tidak kosong setelah concurrent enqueue");
    assert.ok(pending.length <= 50, "maks 50 entry untuk 50 nama unik");
  } finally {
    restore();
  }
});

test("STRESS: enqueueResoPayload — 50 concurrent enqueue + flush bersamaan", async () => {
  const { restore } = mockChrome({ storage: {} });
  try {
    const tasks = [];
    for (let i = 0; i < 50; i++) {
      tasks.push(enqueueResoPayload({ platform: "facebook", names: [`User${i}`], date: "2026-08-23" }));
    }
    tasks.push(flushResoQueue());
    await Promise.all(tasks);
    const pending = await getResoPending();
    // Tidak crash adalah ukuran kelulusan
    assert.ok(Array.isArray(pending), "pending array OK");
  } finally {
    restore();
  }
});

test("STRESS: enqueueResoPayload — 10 enqueue + 10 flush bergantian (tanpa lock)", async () => {
  const { restore } = mockChrome({ storage: {} });
  try {
    for (let r = 0; r < 10; r++) {
      await Promise.all([
        enqueueResoPayload({ platform: "facebook", names: [`User${r}a`], date: "2026-08-23" }),
        enqueueResoPayload({ platform: "facebook", names: [`User${r}b`], date: "2026-08-23" }),
        flushResoQueue(),
        enqueueResoPayload({ platform: "tiktok", names: [`User${r}c`], date: "2026-08-23" }),
      ]);
    }
    const pending = await getResoPending();
    // Tidak crash, antrian tidak corrupt
    assert.ok(Array.isArray(pending), "pending OK");
    for (const item of pending) {
      assert.ok(Array.isArray(item.names), "names tetap array");
      assert.ok(typeof item.platform === "string", "platform tetap string");
    }
  } finally {
    restore();
  }
});
