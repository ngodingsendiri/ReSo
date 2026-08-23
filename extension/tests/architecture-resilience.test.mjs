/**
 * architecture-resilience.test.mjs — Ketahanan terhadap perubahan arsitektur
 * di Facebook, Instagram, dan TikTok.
 *
 * Mensimulasikan ketika platform mengubah DOM selector, API field, atau
 * struktur response — engine harus tetap tidak crash (graceful fallback).
 * Tidak ada asumsi "selector pasti match" — semua hasil dianggap best-effort.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { el, makeDocument } from "./dom-fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FB_SRC = readFileSync(join(ROOT, "inject-fb.js"), "utf8");
const IG_SRC = readFileSync(join(ROOT, "inject-ig.js"), "utf8");
const TT_SRC = readFileSync(join(ROOT, "inject-tiktok.js"), "utf8");

/** Extract fungsi dari sumber dengan brace-counting string-aware. */
function extractFrom(src, fnName) {
  const idx = src.indexOf(`function ${fnName}(`);
  assert.ok(idx >= 0, `function ${fnName} not found`);
  const start = idx - (src.slice(Math.max(0, idx - 6), idx) === "async " ? 6 : 0);
  const paramsEnd = src.indexOf(") {", idx);
  assert.ok(paramsEnd >= 0, `body brace not found for ${fnName}`);
  const openIdx = src.indexOf("{", paramsEnd);
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
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      // Template literal backtick: interpolasi ${...} tetap boleh punya
      // brace — harus dilewati supaya tidak mengacau hitungan depth.
      continue;
    }
    if (inRegex) { if (ch === "\\") { i++; continue; } if (ch === "/") inRegex = false; continue; }
    if (ch === "/" && next === "/") inLine = true;
    else if (ch === "/" && next === "*") inBlock = true;
    else if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
    else if (ch === "/" && /[(\s,=[!&|?:;{}]/.test(src[i - 1] || " ")) inRegex = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
const extractFb = (n) => extractFrom(FB_SRC, n);
const extractIg = (n) => extractFrom(IG_SRC, n);
const extractTt = (n) => extractFrom(TT_SRC, n);

const visibleStyle = () => ({ visibility: "visible", display: "block", opacity: "1" });

function withDoc(root, fn) {
  const realDoc = globalThis.document;
  const realCss = globalThis.getComputedStyle;
  const realWindow = globalThis.window;
  const doc = makeDocument(root);
  // findPostRoot fallback ke document.body / document.documentElement
  const bodyEl = el("body", {}, []);
  doc.body = bodyEl;
  doc.documentElement = el("html", {}, []);
  globalThis.document = doc;
  globalThis.getComputedStyle = () => visibleStyle();
  globalThis.window = {
    innerHeight: 800,
    scrollBy: () => {},
    scrollTo: () => {},
    scrollY: 0,
  };
  try {
    return fn();
  } finally {
    globalThis.document = realDoc;
    globalThis.getComputedStyle = realCss;
    globalThis.window = realWindow;
  }
}

// ===================== FB: perubahan DOM selector =====================

test("ARCH FB: findPostRoot — semua selector FB berubah (tidak ada match) → fallback body/dokumen", () => {
  const fn = new Function(extractFb("qsa") + extractFb("findPostRoot") + "return findPostRoot;")();
  const root = withDoc(el("div", {}, [el("body")]), () => fn());
  assert.ok(root, "findPostRoot return elemen (fallback body/document)");
});

test("ARCH FB: findExpandButtons — selector role=button berubah (tidak ada) → array kosong", () => {
  const fn = new Function(extractFb("qsa") + extractFb("isVisible") + extractFb("findExpandButtons") + "return findExpandButtons;")();
  const btns = withDoc(el("div", {}, []), () => fn());
  assert.ok(Array.isArray(btns), "return array");
  assert.equal(btns.length, 0, "kosong bila tidak ada match");
});

test("ARCH FB: scrapeDomNames — struktur DOM baru (tidak cocok pola) → 0, tidak crash", () => {
  const fn = new Function([
    "const nameMap = new Map();",
    "let lastNewAt = 0;",
    "let postRoot = null;",
    "let includeReplies = true;",
    extractFb("normalizeCommentName"),
    extractFb("addName"),
    extractFb("qsa"),
    extractFb("isVisible"),
    extractFb("isProfileHref"),
    extractFb("scrapeDomNames"),
    "return scrapeDomNames;",
  ].join("\n"))();
  const n = withDoc(
    el("div", {}, [el("div", { "aria-label": "Commented by NewFormat2026" }, [])]),
    () => fn()
  );
  assert.equal(typeof n, "number", "return number");
  assert.ok(n >= 0, "tidak negatif");
});

test("ARCH FB: tryOpenComments — DOM baru tanpa tombol → false, tidak crash", async () => {
  const fn = new Function([
    "const gqlTemplates = new Map();",
    "let sleepWhile = async () => true;",
    extractFb("qsa"),
    extractFb("isVisible"),
    extractFb("tryOpenComments"),
    "return tryOpenComments;",
  ].join("\n"))();
  const ok = await withDoc(el("div", {}, []), () => fn(el("div", {}, [])));
  assert.equal(ok, false, "tanpa tombol → false (tidak crash)");
});

test("ARCH FB: setAllCommentsSort — DOM tanpa menu sortir → no-op, tidak crash", async () => {
  const fn = new Function([
    "let postRoot = null;",
    "let sleepWhile = async () => true;",
    extractFb("qsa"),
    extractFb("isVisible"),
    extractFb("waitVisibleMenu"),
    extractFb("setAllCommentsSort"),
    "return setAllCommentsSort;",
  ].join("\n"))();
  // Tidak ada tombol sortir → no-op
  const result = await withDoc(el("div", {}, []), () => fn(el("div", {}, [])));
  assert.equal(result, undefined, "no-op, tidak throw");
});

// ===================== IG: perubahan struktur API response =====================

test("ARCH IG: parsePage — field has_more_comments berubah nama → false, tidak crash", () => {
  const fn = new Function([
    extractIg("parseIgComments"),
    "const ingested = [];",
    "function addUsername(n) { ingested.push(n); }",
    extractIg("parsePage"),
    "return parsePage;",
  ].join("\n"))();
  const r = fn({ comments: [{ comment_id: "1", user: { username: "test" } }], can_load_more: true, next_max_id: "abc" });
  assert.ok(r !== null, "return objek");
  assert.equal(r.hasMore, false, "field baru tidak dikenal → false");
  assert.equal(r.batchSize, 1, "komentar tetap diparse");
});

test("ARCH IG: parsePage — response null/tak terdefinisi → batchSize 0, tidak crash", () => {
  const fn = new Function([
    extractIg("parseIgComments"),
    "const ingested = [];",
    "function addUsername(n) { ingested.push(n); }",
    extractIg("parsePage"),
    "return parsePage;",
  ].join("\n"))();
  assert.equal(fn(null).batchSize, 0, "null → batchSize 0");
  assert.equal(fn(undefined).batchSize, 0, "undefined → batchSize 0");
  assert.equal(fn({}).batchSize, 0, "{} → batchSize 0");
  assert.equal(fn("not json").batchSize, 0, "string → batchSize 0");
});

test("ARCH IG: payloadMatchesMedia — struktur URL baru → tidak crash (fallback aman)", () => {
  const matcher = new Function([
    extractIg("extractMediaIdFromUrl"),
    "let activeMediaId = '123';",
    extractIg("payloadMatchesMedia"),
    "return payloadMatchesMedia;",
  ].join("\n"))();
  // URL format baru tanpa id media → fallback shape
  const r = matcher("https://www.instagram.com/api/v1/feed/comments/new-endpoint/", '{"comments":[]}');
  assert.equal(typeof r, "boolean", "return boolean");
});

// ===================== IG: perubahan DOM selector =====================

test("ARCH IG: findLoadMoreButtons — selector baru tidak match → array kosong", () => {
  const fn = new Function(extractIg("findLoadMoreButtons") + "return findLoadMoreButtons;")();
  const btns = withDoc(el("div", {}, []), () => fn());
  assert.ok(Array.isArray(btns), "return array");
  assert.equal(btns.length, 0, "kosong bila tidak ada match");
});

test("ARCH IG: scrapeDomUsernames — selector dialog/main berubah → 0, tidak crash", () => {
  const fn = new Function([
    "const nameMap = new Map();",
    "let lastNewAt = 0;",
    extractIg("normalizeInstagramUsername"),
    extractIg("addUsername"),
    extractIg("scrapeDomUsernames"),
    "return scrapeDomUsernames;",
  ].join("\n"))();
  const n = withDoc(el("div", {}, [
    el("section", { "data-testid": "new-comments" }, [el("a", { href: "/newuser" }, [], "newuser")]),
  ]), () => fn());
  assert.equal(typeof n, "number", "return number");
  assert.ok(n >= 0, "tidak negatif");
});

// ===================== TT: perubahan struktur API response =====================

test("ARCH TT: parsePage — field cursor berubah nama → cursor null, tidak crash", () => {
  const fn = new Function([
    extractTt("parseTikTokComments"),
    "const nameMap = new Map();",
    "let includeReplies = true;",
    "let lastNewAt = 0;",
    extractTt("normalizeNickname"),
    extractTt("addName"),
    extractTt("ingestCommentArrays"),
    extractTt("parsePage"),
    "return parsePage;",
  ].join("\n"))();
  const r = fn({ comments: [{ user: { nickname: "test" } }], next_cursor: "abc123" });
  assert.ok(r !== null, "return objek");
  assert.equal(r.cursor, null, "field baru tidak dikenal → cursor null");
  assert.equal(r.batchSize, 1, "komentar tetap diparse");
});

test("ARCH TT: parsePage — response null/tak terdefinisi → batchSize 0, tidak crash", () => {
  const fn = new Function([
    extractTt("parseTikTokComments"),
    "const nameMap = new Map();",
    "let includeReplies = true;",
    "let lastNewAt = 0;",
    extractTt("normalizeNickname"),
    extractTt("addName"),
    extractTt("ingestCommentArrays"),
    extractTt("parsePage"),
    "return parsePage;",
  ].join("\n"))();
  assert.equal(fn(null).batchSize, 0, "null → batchSize 0");
  assert.equal(fn(undefined).batchSize, 0, "undefined → batchSize 0");
  assert.equal(fn({}).batchSize, 0, "{} → batchSize 0");
  assert.equal(fn("xxx").batchSize, 0, "garbage → batchSize 0");
});

test("ARCH TT: parseTikTokComments — struktur data baru → array, tidak crash", () => {
  const fn = new Function(extractTt("parseTikTokComments") + "return parseTikTokComments;")();
  const inputs = [
    null, undefined, {}, [], "", 0, true,
    { data: null },
    { data: {} },
    { data: { comments: null } },
    { data: { comments: "not array" } },
    { comments: [{ user: { nickname: "test" } }] },
    { comments: { list: [{ user: { nickname: "test" } }] } },
  ];
  for (const input of inputs) {
    const result = fn(input, true);
    assert.ok(Array.isArray(result), "return array: " + typeof input);
  }
});

// ===================== TT: perubahan DOM selector =====================

test("ARCH TT: scrapeDomNicknames — data-e2e selector berubah → 0, tidak crash", () => {
  const fn = new Function([
    "const nameMap = new Map();",
    "let lastNewAt = 0;",
    "let postRoot = null;",
    "let includeReplies = true;",
    extractTt("normalizeNickname"),
    extractTt("addName"),
    extractTt("scrapeDomNicknames"),
    "return scrapeDomNicknames;",
  ].join("\n"))();
  const n = withDoc(
    el("div", {}, [el("div", { "data-e2e": "new-comment-format-2026" }, [], "testuser")]),
    () => fn()
  );
  assert.equal(typeof n, "number", "return number");
  assert.ok(n >= 0, "tidak negatif");
});

test("ARCH TT: commentPanelOpen — selector data-e2e berubah → false, tidak crash", () => {
  const fn = new Function(extractTt("commentPanelOpen") + "return commentPanelOpen;")();
  const open = withDoc(el("div", {}, [el("div", { "data-e2e": "new-panel" }, [])]), () => fn());
  assert.equal(open, false, "panel tidak terdeteksi");
});

// ===================== Ketahanan rehydration data TT =====================

test("ARCH TT: createTimeFromRehydration — path data berubah, tidak crash", async () => {
  const { createTimeFromRehydration } = await import("../shared-module.js");
  const inputs = [
    { __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: { createTime: 1700000000 } } } } },
    { __DEFAULT_SCOPE__: { "webapp.video-detail": { itemStruct: { createTime: 1700000000 } } } },
    { __DEFAULT_SCOPE__: { "webapp.video-detail": { createTime: 1700000000 } } },
    { __DEFAULT_SCOPE__: { video: { createTime: 1700000000 } } },
    { DefaultScope: { "video-detail": { createTime: 1700000000 } } },
    { __DEFAULT_SCOPE__: { "webapp.other-feature": { data: "x" } } },
    {},
    [],
  ];
  for (const input of inputs) {
    try {
      const r = createTimeFromRehydration(input);
      assert.ok(r === null || typeof r === "object", "return null atau object: " + input.constructor.name);
    } catch (e) {
      assert.fail(`createTimeFromRehydration crash: ${e.message}`);
    }
  }
});

// ===================== Ketahanan CSRF token IG =====================

test("ARCH IG: csrfToken — tanpa cookie csrftoken → empty string, tidak crash", () => {
  const fn = new Function(extractIg("csrfToken") + "return csrfToken;")();
  const realDoc = globalThis.document;
  globalThis.document = { cookie: "sessionid=abc; mid=xyz; ig_did=123" };
  try {
    const token = fn();
    assert.equal(token, "", "tanpa csrftoken → empty string");
  } finally {
    globalThis.document = realDoc;
  }
});

// ===================== Ketahanan fetchJson IG — error 403 =====================

test("ARCH IG: fetchJson — response 403 → blocked error (tidak crash)", async () => {
  const { fetchJson } = new Function([
    "let requestBudget = 0;",
    "let running = true;",
    "let stopFlag = false;",
    "const BUDGET = 500;",
    "const IG_APP_ID = '936619743392459';",
    "const sleepWhile = async () => true;",
    extractIg("csrfToken"),
    extractIg("parseRetryAfter"),
    extractIg("fetchJson"),
    "return { fetchJson };",
  ].join("\n"))();
  const realDoc = globalThis.document;
  const realFetch = globalThis.fetch;
  const realLocation = globalThis.location;
  globalThis.document = { cookie: "csrftoken=abc; sessionid=xyz" };
  globalThis.location = { origin: "https://www.instagram.com" };
  globalThis.fetch = async () => new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } });
  try {
    await assert.rejects(
      () => fetchJson("https://www.instagram.com/api/v1/media/123/comments/"),
      (err) => err && err.blocked === true,
      "403 → blocked error"
    );
  } finally {
    globalThis.document = realDoc;
    globalThis.fetch = realFetch;
    globalThis.location = realLocation;
  }
});