/**
 * Unit tests untuk logika murni engine TikTok (inject-tiktok.js):
 * parsePage (has_more/cursor/replyTargets — termasuk fix {data:{has_more:true}}),
 * buildUrl (template → URL request, mode reply), payloadMatchesVideo
 * (anti kontaminasi lintas video) & tryParseResponse (anti-bocor balasan
 * saat includeReplies off — parity FB v1.0.42).
 * Pure ESM — node --test, zero deps. Fungsi diekstrak langsung dari source
 * (brace-counting) dan dieksekusi dengan stub minimal.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { el, makeDocument } from "./dom-fixture.mjs";

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "inject-tiktok.js"),
  "utf8"
);

function extract(fnName) {
  const idx = src.indexOf(`function ${fnName}(`);
  assert.ok(idx >= 0, `function ${fnName} not found in inject-tiktok.js`);
  // Lewati daftar parameter: `{` pertama bisa milik destructuring
  // (mis. buildUrl(templateUrl, { cursor, awemeId, ... })) — brace badan
  // fungsi selalu muncul setelah `) {` penutup parameter.
  const paramsEnd = src.indexOf(") {", idx);
  assert.ok(paramsEnd >= 0, `body brace not found for ${fnName}`);
  const openIdx = src.indexOf("{", paramsEnd);
  let depth = 0;
  let i = openIdx;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(idx, i + 1);
}

// ===================== payloadMatchesVideo =====================

function makePayloadMatcher(activeAwemeId) {
  const fnSrc = [
    `let activeAwemeId = ${JSON.stringify(activeAwemeId ?? null)};`,
    extract("payloadMatchesVideo"),
    "return payloadMatchesVideo;",
  ].join("\n");
  return new Function(fnSrc)();
}

test("payloadMatchesVideo: aweme_id param cocok → true", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm("https://www.tiktok.com/api/comment/list/?aweme_id=111&cursor=0", '{"comments":[]}'),
    true
  );
});

test("payloadMatchesVideo: item_id param cocok (URL balasan) → true", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm("https://www.tiktok.com/api/comment/list/reply/?item_id=111&comment_id=1", '{"comments":[]}'),
    true
  );
});

test("payloadMatchesVideo: aweme_id video LAIN ditolak (kontaminasi lintas video)", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm(
      "https://www.tiktok.com/api/comment/list/?aweme_id=222&cursor=0",
      '{"comments":[{"user":{"nickname":"X"}}],"has_more":1}'
    ),
    false
  );
});

test("payloadMatchesVideo: item_id video lain ditolak", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm("https://www.tiktok.com/api/comment/list/reply/?item_id=222&comment_id=1", '{"comments":[]}'),
    false
  );
});

test("payloadMatchesVideo: substring bukan param — id 12345 vs 123456789 ditolak", () => {
  // Celah substring lama: `url.includes(activeAwemeId)` cocok dengan id video
  // lain yang diawali id target. Param URL kini dibandingkan persis.
  const pm = makePayloadMatcher("12345");
  assert.equal(
    pm("https://www.tiktok.com/api/comment/list/?aweme_id=123456789&cursor=0", '{"comments":[]}'),
    false
  );
});

test("payloadMatchesVideo: tanpa param, body memuat id target → true", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm("https://www.tiktok.com/api/comment/list/?cursor=0", '{"comments":[],"aweme_id":"111"}'),
    true
  );
});

test("payloadMatchesVideo: tanpa param, fallback shape-only → true (perilaku lama)", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm("https://www.tiktok.com/api/comment/list/?cursor=0", '{"comments":[],"has_more":1}'),
    true
  );
});

test("payloadMatchesVideo: tanpa param, non-komentar → false", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm("https://www.tiktok.com/api/comment/list/?cursor=0", '{"status":"ok"}'),
    false
  );
});

test("payloadMatchesVideo: activeAwemeId null → selalu true", () => {
  const pm = makePayloadMatcher(null);
  assert.equal(
    pm("https://www.tiktok.com/api/comment/list/?aweme_id=222", '{"comments":[]}'),
    true
  );
});

// ===================== parsePage (has_more / cursor / replyTargets) =====================

/**
 * Harness parsePage: fungsi asli dengan ingest nyata (parseTikTokComments +
 * addName stub) — jadi asersi bisa memeriksa struktur return DAN nama yang
 * benar-benar diingest. includeReplies dikontrol per-test.
 */
function makePageParser(includeRepliesVal) {
  const fnSrc = [
    extract("parseTikTokComments"),
    "const ingested = [];",
    "function addName(n) { ingested.push(n); }",
    "function ingestCommentArrays(data) { for (const nick of parseTikTokComments(data, includeReplies)) addName(nick); }",
    extract("parsePage"),
    `let includeReplies = ${includeRepliesVal};`,
    "return { parsePage, ingested };",
  ].join("\n");
  return new Function(fnSrc)();
}

test("parsePage: has_more=1 + cursor numerik → hasMore true, cursor 20, batchSize 1", () => {
  const { parsePage } = makePageParser(false);
  const r = parsePage({
    comments: [{ cid: "1", user: { nickname: "A" } }],
    has_more: 1,
    cursor: 20,
  });
  assert.equal(r.hasMore, true);
  assert.equal(r.cursor, 20);
  assert.equal(r.batchSize, 1);
});

test("parsePage: has_more=true (boolean) dikenali", () => {
  const { parsePage } = makePageParser(false);
  const r = parsePage({ comments: [], has_more: true, cursor: 0 });
  assert.equal(r.hasMore, true);
});

test("parsePage: {data:{has_more:true}} dikenali (fix v1.0.42)", () => {
  const { parsePage } = makePageParser(false);
  const r = parsePage({
    data: { comments: [{ user: { nickname: "A" } }], has_more: true, cursor: 40 },
  });
  assert.equal(r.hasMore, true);
  assert.equal(r.cursor, 40);
  assert.equal(r.batchSize, 1);
});

test("parsePage: has_more=0 / absent → false", () => {
  const { parsePage } = makePageParser(false);
  assert.equal(parsePage({ comments: [], has_more: 0 }).hasMore, false);
  assert.equal(parsePage({ comments: [] }).hasMore, false);
});

test("parsePage: has_more string '1' → false (hanya === 1 atau true, by design)", () => {
  const { parsePage } = makePageParser(false);
  assert.equal(parsePage({ comments: [], has_more: "1" }).hasMore, false);
});

test("parsePage: cursor string '30' → Number 30; null → null", () => {
  const { parsePage } = makePageParser(false);
  assert.equal(parsePage({ comments: [], cursor: "30" }).cursor, 30);
  assert.equal(parsePage({ comments: [], cursor: null }).cursor, null);
  assert.equal(parsePage({ comments: [] }).cursor, null);
});

test("parsePage: replyTargets dari reply_comment_total / reply_count, total 0 tidak masuk", () => {
  const { parsePage } = makePageParser(false);
  const r = parsePage({
    comments: [
      { cid: "1", reply_comment_total: 3 },
      { comment_id: "2", reply_count: 0 },
      { id: "3" },
      { cid: "4", reply_comment_total: "2" },
    ],
  });
  assert.deepEqual(r.replyTargets, [
    { commentId: "1", total: 3 },
    { commentId: "4", total: 2 },
  ]);
});

test("parsePage: data.comments=[] vs data.data.comments berisi → pakai array non-kosong (fix P3 #3)", () => {
  // P3 #3 lama: `data?.comments || data?.data?.comments` — [] truthy, jadi
  // batchSize/replyTargets dihitung dari array kosong walau nested berisi
  // (halaman "palsu kosong" + balasan hilang). Kini array non-kosong dipilih.
  const { parsePage, ingested } = makePageParser(false);
  const r = parsePage({
    comments: [],
    data: {
      comments: [{ cid: "N1", user: { nickname: "NestedA" }, reply_comment_total: 2 }],
      has_more: 1,
      cursor: 5,
    },
  });
  assert.equal(r.hasMore, true);
  assert.equal(r.cursor, 5);
  assert.equal(r.batchSize, 1);
  assert.deepEqual(r.replyTargets, [{ commentId: "N1", total: 2 }]);
  assert.deepEqual(ingested, ["NestedA"]);
});

test("parsePage: keduanya berisi → top menang (perilaku lama dipertahankan)", () => {
  const { parsePage } = makePageParser(false);
  const r = parsePage({
    comments: [{ cid: "T1", user: { nickname: "TopA" }, reply_comment_total: 1 }],
    data: { comments: [{ cid: "N1", user: { nickname: "NestedA" } }], has_more: 1 },
  });
  assert.equal(r.batchSize, 1);
  assert.deepEqual(r.replyTargets, [{ commentId: "T1", total: 1 }]);
});

test("parsePage: top non-array (objek), nested array → nested dipakai", () => {
  const { parsePage } = makePageParser(false);
  const r = parsePage({
    comments: { weird: true },
    data: { comments: [{ cid: "N1", user: { nickname: "NestedA" }, reply_comment_total: 3 }] },
  });
  assert.equal(r.batchSize, 1);
  assert.deepEqual(r.replyTargets, [{ commentId: "N1", total: 3 }]);
});

test("parsePage: tak ada array komentar → batchSize 0, replyTargets kosong", () => {
  const { parsePage } = makePageParser(false);
  const r = parsePage({ data: {} });
  assert.equal(r.batchSize, 0);
  assert.deepEqual(r.replyTargets, []);
});

test("parsePage: includeReplies OFF tidak mengambil reply_comment tertanam", () => {
  const { parsePage, ingested } = makePageParser(false);
  parsePage({
    comments: [
      {
        cid: "1",
        user: { nickname: "Top" },
        reply_comment: [{ user: { nickname: "Rep" } }],
      },
    ],
  });
  assert.deepEqual(ingested, ["Top"]);
});

test("parsePage: includeReplies ON mengambil reply_comment tertanam", () => {
  const { parsePage, ingested } = makePageParser(true);
  parsePage({
    comments: [
      {
        cid: "1",
        user: { nickname: "Top" },
        reply_comment: [{ user: { nickname: "Rep" } }],
      },
    ],
  });
  assert.deepEqual([...ingested].sort(), ["Rep", "Top"]);
});

// ===================== tryParseResponse (anti-bocor balasan) =====================

function makeParser(includeRepliesVal, runningVal = true) {
  const fnSrc = [
    extract("parseTikTokComments"),
    extract("parsePage"),
    extract("looksLikeCommentApi"),
    extract("payloadMatchesVideo"),
    extract("tryParseResponse"),
    `let running = ${runningVal};`,
    `let includeReplies = ${includeRepliesVal};`,
    "let activeAwemeId = '111';",
    "const ingested = [];",
    "function ingestCommentArrays(data) { for (const n of parseTikTokComments(data, includeReplies)) ingested.push(n); }",
    "return { tryParseResponse, ingested };",
  ].join("\n");
  return new Function(fnSrc)();
}

const replyUrl =
  "https://www.tiktok.com/api/comment/list/reply/?aweme_id=111&comment_id=1000&cursor=0";
const replyPayload = JSON.stringify({
  comments: [
    { cid: "1001", user: { nickname: "ReplyA" }, text: "balasan" },
    { cid: "1002", user: { nickname: "ReplyB" }, text: "balasan 2" },
  ],
  cursor: 20,
  has_more: 0,
});
const topUrl = "https://www.tiktok.com/api/comment/list/?aweme_id=111&cursor=0";
const topPayload = JSON.stringify({
  comments: [
    { cid: "1", user: { nickname: "TopA" }, text: "komentar" },
    { cid: "2", user: { nickname: "TopB" }, text: "komentar 2" },
  ],
  cursor: 20,
  has_more: 0,
});

test("tryParseResponse: includeReplies=OFF, respons /list/reply TIDAK diingest", () => {
  const { tryParseResponse, ingested } = makeParser(false);
  tryParseResponse(replyUrl, replyPayload);
  assert.deepEqual(ingested, []);
});

test("tryParseResponse: includeReplies=OFF, respons list biasa tetap diingest", () => {
  const { tryParseResponse, ingested } = makeParser(false);
  tryParseResponse(topUrl, topPayload);
  assert.deepEqual([...ingested].sort(), ["TopA", "TopB"]);
});

test("tryParseResponse: includeReplies=ON, respons /list/reply diingest", () => {
  const { tryParseResponse, ingested } = makeParser(true);
  tryParseResponse(replyUrl, replyPayload);
  assert.deepEqual([...ingested].sort(), ["ReplyA", "ReplyB"]);
});

test("tryParseResponse: respons video lain ditolak (lintas video)", () => {
  const { tryParseResponse, ingested } = makeParser(true);
  const otherUrl = "https://www.tiktok.com/api/comment/list/?aweme_id=222&cursor=0";
  tryParseResponse(otherUrl, topPayload);
  assert.deepEqual(ingested, []);
});

test("tryParseResponse: tidak running → tidak diproses", () => {
  const { tryParseResponse, ingested } = makeParser(true, false);
  tryParseResponse(topUrl, topPayload);
  assert.deepEqual(ingested, []);
});

// ===================== buildUrl (template → URL request) =====================

const SIG_PARAMS = ["msToken", "X-Bogus", "X-Gnarly", "X-Dynosaur", "_signature", "signature"];
const LIST_TEMPLATE =
  "https://www.tiktok.com/api/comment/list/?aweme_id=111&msToken=abc&X-Bogus=def&_signature=xyz&cursor=5";
const REPLY_TEMPLATE = "https://www.tiktok.com/api/comment/list/reply/?item_id=111&comment_id=7";

// buildUrl murni (tanpa state closure) — cukup diekstrak & dipanggil langsung.
const buildUrl = new Function(extract("buildUrl") + "\nreturn buildUrl;")();

test("buildUrl: basic — cursor di-set ulang, aweme_id dipertahankan, param signature dibuang", () => {
  const u = buildUrl(LIST_TEMPLATE, { cursor: 10, awemeId: "111" });
  const url = new URL(u);
  assert.equal(url.pathname, "/api/comment/list/");
  assert.equal(url.searchParams.get("cursor"), "10");
  assert.equal(url.searchParams.get("aweme_id"), "111");
  for (const p of SIG_PARAMS) assert.equal(url.searchParams.get(p), null, p);
});

test("buildUrl: reply=true — path /reply/, item_id menggantikan aweme_id, comment_id; count absen dibiarkan (fidelitas)", () => {
  const u = buildUrl(LIST_TEMPLATE, { cursor: 0, awemeId: "222", reply: true, commentId: "999" });
  const url = new URL(u);
  assert.equal(url.pathname, "/api/comment/list/reply/");
  assert.equal(url.searchParams.get("item_id"), "222");
  assert.equal(url.searchParams.get("aweme_id"), null);
  assert.equal(url.searchParams.get("comment_id"), "999");
  // v1.0.58-TT: buildUrl tidak lagi MENGARANG count default — server default
  // yang berlaku; clamp [30..50] hanya utk template yang memang membawa count.
  assert.equal(url.searchParams.get("count"), null);
});

test("buildUrl: template sudah /reply/ tidak di-swap ganda", () => {
  const u = buildUrl(REPLY_TEMPLATE, { cursor: 1, awemeId: "111", reply: true, commentId: "7" });
  const url = new URL(u);
  assert.equal(url.pathname, "/api/comment/list/reply/");
  assert.equal(url.searchParams.get("item_id"), "111");
  assert.equal(url.searchParams.get("comment_id"), "7");
});

test("buildUrl: non-reply pada template /reply/ dikembalikan ke /list/", () => {
  const u = buildUrl(REPLY_TEMPLATE, { cursor: 2, awemeId: "111" });
  const url = new URL(u);
  assert.equal(url.pathname, "/api/comment/list/");
  assert.equal(url.searchParams.get("aweme_id"), "111");
  // Catatan: item_id lama tidak dihapus pada non-reply (buildUrl hanya
  // men-set/delete param milik mode aktif) — tak relevan untuk /list/.
  assert.equal(url.searchParams.get("item_id"), "111");
});

test("buildUrl: cursor 0 / tanpa cursor → '0' (menimpa nilai template)", () => {
  const u = buildUrl(LIST_TEMPLATE, { awemeId: "111" });
  assert.equal(new URL(u).searchParams.get("cursor"), "0");
});

test("buildUrl: reply tanpa commentId → count tidak ditambahkan; count template dipertahankan", () => {
  const u = buildUrl(LIST_TEMPLATE, { reply: true, awemeId: "111" });
  assert.equal(new URL(u).searchParams.get("count"), null);
  const withCount = buildUrl("https://www.tiktok.com/api/comment/list/?count=50", {
    reply: true,
    awemeId: "111",
    commentId: "9",
  });
  assert.equal(new URL(withCount).searchParams.get("count"), "50");
});

test("buildUrl: template null / URL tak valid → null", () => {
  assert.equal(buildUrl(null, { awemeId: "1" }), null);
  assert.equal(buildUrl("not a url", { awemeId: "1" }), null);
});

// ===================== buildUrl → tryParseResponse penuh (urutan fetch engine) =====================
// Verifikasi lifecycle intercept utuh: URL yang DIBANGUN buildUrl asli
// (template → request) diteruskan ke tryParseResponse asli (guard anti-bocor
// balasan + anti kontaminasi lintas video) lalu nama diingest — urutan yang
// sama persis dengan loop fetch engine. Dedupe dimodelkan lewat Set (di engine
// terjadi di nameMap, di luar tryParseResponse).

function makeEngineChain(includeRepliesVal) {
  const fnSrc = [
    extract("parseTikTokComments"),
    extract("parsePage"),
    extract("looksLikeCommentApi"),
    extract("payloadMatchesVideo"),
    extract("tryParseResponse"),
    extract("buildUrl"),
    "let running = true;",
    `let includeReplies = ${includeRepliesVal};`,
    "let activeAwemeId = '111';",
    "const nameSet = new Set();",
    "function ingestCommentArrays(data) { for (const n of parseTikTokComments(data, includeReplies)) nameSet.add(n); }",
    // Urutan fetch engine: buildUrl(template, opts) → tryParseResponse(url, text)
    "function fetchChain(templateUrl, opts, payload) {",
    "  const url = buildUrl(templateUrl, opts);",
    "  if (!url) return null;",
    "  tryParseResponse(url, payload);",
    "  return url;",
    "}",
    "return { fetchChain, names: () => [...nameSet].sort() };",
  ].join("\n");
  return new Function(fnSrc)();
}

test("chain: buildUrl top-level → tryParseResponse → nama diingest (ON)", () => {
  const { fetchChain, names } = makeEngineChain(true);
  const url = fetchChain(LIST_TEMPLATE, { cursor: 10, awemeId: "111" }, topPayload);
  assert.ok(url, "URL harus terbentuk");
  const u = new URL(url);
  assert.equal(u.searchParams.get("aweme_id"), "111");
  assert.equal(u.searchParams.get("cursor"), "10");
  for (const p of SIG_PARAMS) assert.equal(u.searchParams.get(p), null, p);
  assert.deepEqual(names(), ["TopA", "TopB"]);
});

test("chain: buildUrl reply → /list/reply/ item_id=111 → diingest saat ON", () => {
  const { fetchChain, names } = makeEngineChain(true);
  const url = fetchChain(
    LIST_TEMPLATE,
    { cursor: 0, awemeId: "111", reply: true, commentId: "1000" },
    replyPayload
  );
  const u = new URL(url);
  assert.equal(u.pathname, "/api/comment/list/reply/");
  assert.equal(u.searchParams.get("item_id"), "111");
  assert.equal(u.searchParams.get("aweme_id"), null);
  assert.equal(u.searchParams.get("comment_id"), "1000");
  assert.deepEqual(names(), ["ReplyA", "ReplyB"]);
});

test("chain: buildUrl reply → TIDAK diingest saat OFF (anti-bocor balasan)", () => {
  const { fetchChain, names } = makeEngineChain(false);
  const url = fetchChain(
    LIST_TEMPLATE,
    { cursor: 0, awemeId: "111", reply: true, commentId: "1000" },
    replyPayload
  );
  assert.match(new URL(url).pathname, /\/reply\/$/); // URL memang dibangun…
  assert.deepEqual(names(), []); // …tapi guard /list/reply menolaknya
});

test("chain: buildUrl top-level tetap diingest saat OFF", () => {
  const { fetchChain, names } = makeEngineChain(false);
  fetchChain(LIST_TEMPLATE, { cursor: 0, awemeId: "111" }, topPayload);
  assert.deepEqual(names(), ["TopA", "TopB"]);
});

test("chain: video lain ditolak untuk top-level DAN reply (anti kontaminasi lintas video)", () => {
  const { fetchChain, names } = makeEngineChain(true);
  // awemeId 222 di-override di buildUrl → payloadMatchesVideo menolak URL-nya
  fetchChain(LIST_TEMPLATE, { cursor: 0, awemeId: "222" }, topPayload);
  assert.deepEqual(names(), []);
  fetchChain(
    LIST_TEMPLATE,
    { cursor: 0, awemeId: "222", reply: true, commentId: "1000" },
    replyPayload
  );
  assert.deepEqual(names(), []);
});

test("chain: pengulangan URL yang sama di-dedupe (nameMap) tanpa crash", () => {
  const { fetchChain, names } = makeEngineChain(true);
  fetchChain(LIST_TEMPLATE, { cursor: 0, awemeId: "111" }, topPayload);
  fetchChain(LIST_TEMPLATE, { cursor: 0, awemeId: "111" }, topPayload); // halaman sama lagi
  assert.deepEqual(names(), ["TopA", "TopB"]); // unik, tidak ganda
});

test("chain: template tak valid → null tanpa crash", () => {
  const { fetchChain, names } = makeEngineChain(true);
  assert.equal(fetchChain(null, { awemeId: "111" }, topPayload), null);
  assert.equal(fetchChain("not a url", { awemeId: "111" }, topPayload), null);
  assert.deepEqual(names(), []);
});

// ===================== scrapeDomNicknames (mode scroll — DOM fallback) =====================
// Fallback mode scroll: nama penulis komentar yang terlihat di DOM di-harvest
// via 4 selector TikTok. Harness memakai fungsi ASLI (normalizeNickname →
// addName → nameMap) dengan fixture DOM (tests/dom-fixture.mjs) — yang di-assert
// adalah nama yang BENAR-BENAR masuk nameMap, bukan salinan logika.

function makeTtScraper() {
  const fnSrc = [
    extract("normalizeNickname"),
    "const nameMap = new Map();",
    "let lastNewAt = 0;",
    extract("addName"),
    extract("scrapeDomNicknames"),
    "return { scrapeDomNicknames, names: () => [...nameMap.values()] };",
  ].join("\n");
  return new Function(fnSrc)();
}

/** Jalankan scraper asli dengan document fixture, kembalikan { added, names }. */
function runScrape(doc) {
  const realDoc = globalThis.document;
  globalThis.document = makeDocument(doc);
  try {
    const { scrapeDomNicknames, names } = makeTtScraper();
    return { added: scrapeDomNicknames(), names: names() };
  } finally {
    globalThis.document = realDoc;
  }
}

test("scrapeDom TT: username-1/-2 di-harvest, aria-label diutamakan, teks kosong dilewati", () => {
  const doc = el("div", {}, [
    el("div", { "data-e2e": "comment-username-1" }, [], "alice"),
    el("div", { "data-e2e": "comment-username-2", "aria-label": "@bob" }, [], "bob"),
    el("div", { "data-e2e": "comment-username-1" }, [], "@charlie"),
    el("div", { "data-e2e": "comment-username-1" }, [], ""), // kosong → normalize → skip
    el("div", { "data-e2e": "comment-username-1" }, [], "Lihat semua komentar"), // non-nama → skip
  ]);
  const { added, names } = runScrape(doc);
  assert.equal(added, 3);
  assert.deepEqual([...names].sort(), ["alice", "bob", "charlie"]);
});

test("scrapeDom TT: anchor [data-e2e=comment-item] a[href*=/@] di-harvest", () => {
  const doc = el("div", {}, [
    el("div", { "data-e2e": "comment-item" }, [
      el("a", { href: "/@dave" }, [], "dave"),
    ]),
    // Bukan di dalam comment-item → selector pertama tidak kena
    el("a", { href: "/@skipme" }, [], "skipme"),
  ]);
  const { added, names } = runScrape(doc);
  assert.deepEqual([...names].sort(), ["dave"]);
  assert.equal(added, 1);
});

test("scrapeDom TT: div[class*=Comment] a[href*=/@] di-harvest", () => {
  const doc = el("div", {}, [
    el("div", { class: "CommentContent" }, [
      el("a", { href: "/@eve" }, [], "eve"),
    ]),
    el("div", { class: "ReplySection" }, [
      el("a", { href: "/@no" }, [], "no"), // class tanpa substring Comment → tidak kena
    ]),
  ]);
  const { added, names } = runScrape(doc);
  assert.deepEqual([...names].sort(), ["eve"]);
  assert.equal(added, 1);
});

test("scrapeDom TT: dedupe — nama sama dari selector berbeda masuk sekali", () => {
  const doc = el("div", {}, [
    el("div", { "data-e2e": "comment-username-1" }, [], "alice"),
    el("div", { "data-e2e": "comment-item" }, [
      el("a", { href: "/@alice" }, [], "alice"),
    ]),
    el("div", { class: "CommentBox" }, [
      el("a", { href: "/@alice" }, [], "alice"),
    ]),
  ]);
  const { added, names } = runScrape(doc);
  assert.equal(added, 1); // hanya sekali (dedupe nameMap case-insensitive)
  assert.deepEqual([...names].sort(), ["alice"]);
});

test("scrapeDom TT: tanpa elemen cocok → 0 ditambahkan", () => {
  const doc = el("div", {}, [el("div", {}, [], "bukan komentar")]);
  const { added, names } = runScrape(doc);
  assert.equal(added, 0);
  assert.deepEqual(names, []);
});

// ===================== looksLikeCommentApi + wiring intercept =====================
// TikTok TIDAK punya buffer respons seperti gqlBuffer Facebook — hook fetch/XHR
// memproses respons SEGERA lewat tryParseResponse (intercept hanya komplementer;
// loop pagination pakai direct fetch). Yang perlu diuji: (1) matcher URL
// looksLikeCommentApi (parity test langsung seperti IG), (2) WIRING hook —
// apakah blok intercept asli benar-benar meneruskan URL + payload ke
// tryParseResponse (jalur fetch maupun XHR), dengan payload nyata.

const looksLikeCommentApi = new Function(
  extract("looksLikeCommentApi") + "\nreturn looksLikeCommentApi;"
)();

test("looksLikeCommentApi: URL komentar API (list & reply) → true, case-insensitive", () => {
  assert.equal(
    looksLikeCommentApi("https://www.tiktok.com/api/comment/list/?aweme_id=111&cursor=0"),
    true
  );
  assert.equal(
    looksLikeCommentApi(
      "https://www.tiktok.com/api/comment/list/reply/?aweme_id=111&comment_id=1000"
    ),
    true
  );
  assert.equal(looksLikeCommentApi("TIKTOK.COM/API/COMMENT/LIST/"), true, "case-insensitive");
});

test("looksLikeCommentApi: non-komentar / domain lain / null → false", () => {
  assert.equal(looksLikeCommentApi("https://www.tiktok.com/api/feed/"), false);
  assert.equal(looksLikeCommentApi("https://www.example.com/api/comment/list/"), false);
  assert.equal(looksLikeCommentApi(""), false);
  assert.equal(looksLikeCommentApi(null), false);
});

/** Ekstrak blok `if (!window.__X_NET__) { ... }` verbatim (brace-matched). */
function extractHook(marker) {
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, `hook marker tidak ditemukan: ${marker}`);
  let depth = 0;
  let i = idx;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(depth === 0, `brace tidak seimbang untuk ${marker}`);
  return src.slice(idx, i + 1);
}

/** Stub global window.fetch + XMLHttpRequest; kembalikan driver hook. */
function makeNetStubs() {
  const realWin = globalThis.window;
  const realXhr = globalThis.XMLHttpRequest;
  let fetchImpl = () => "";
  class FakeXhr {
    constructor() {
      this.listeners = {};
      this.__tnk_url = "";
    }
    addEventListener(type, cb) {
      (this.listeners[type] ||= []).push(cb);
    }
    open() {}
    send() {}
  }
  globalThis.XMLHttpRequest = FakeXhr;
  globalThis.window = {
    __TNK_NET__: undefined,
    fetch: async (...args) => {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      return { clone: () => ({ text: async () => fetchImpl(url) }) };
    },
  };
  return {
    Xhr: FakeXhr,
    setFetch: (fn) => {
      fetchImpl = fn;
    },
    // Browser mem-bind `this` listener ke elemen — stub harus meniru (cb.call)
    // supaya `this.__tnk_url` / `this.responseText` terbaca di dalam hook.
    fireLoad: (x) => (x.listeners.load || []).forEach((cb) => cb.call(x)),
    restore: () => {
      globalThis.window = realWin;
      globalThis.XMLHttpRequest = realXhr;
    },
  };
}

/** Harness wiring: blok hook ASLI dieksekusi, rantai tryParseResponse → parsePage asli. */
function makeTtHook(runningVal = true, includeRepliesVal = true) {
  const hookBlock = extractHook("if (!window.__TNK_NET__) {");
  const fnSrc = [
    `let running = ${runningVal};`,
    `let includeReplies = ${includeRepliesVal};`,
    "let activeAwemeId = '111';",
    "const ingested = [];",
    extract("parseTikTokComments"),
    extract("parsePage"),
    extract("looksLikeCommentApi"),
    extract("payloadMatchesVideo"),
    extract("tryParseResponse"),
    "function ingestCommentArrays(data) { for (const n of parseTikTokComments(data, includeReplies)) ingested.push(n); }",
    hookBlock,
    "return { ingested };",
  ].join("\n");
  return new Function(fnSrc)();
}

const flushMicro = () => new Promise((r) => setImmediate(r));

test("intercept TT: hook fetch → tryParseResponse → payload komentar nyata diingest", async () => {
  const net = makeNetStubs();
  const h = makeTtHook();
  const hookedFetch = globalThis.window.fetch; // setelah install
  net.restore();
  net.setFetch(() => topPayload);
  await hookedFetch(topUrl);
  await flushMicro();
  assert.deepEqual(h.ingested, ["TopA", "TopB"]);
});

test("intercept TT: hook fetch — URL non-komentar / running=false tidak diingest", async () => {
  const net = makeNetStubs();
  const h = makeTtHook();
  const hookedFetch = globalThis.window.fetch;
  net.restore();
  net.setFetch(() => topPayload);
  await hookedFetch("https://www.tiktok.com/api/feed/");
  await flushMicro();
  assert.deepEqual(h.ingested, [], "URL non-komentar → hook tidak memanggil tryParseResponse");

  const net2 = makeNetStubs();
  const h2 = makeTtHook(false); // running = false
  const hookedFetch2 = globalThis.window.fetch;
  net2.restore();
  net2.setFetch(() => topPayload);
  await hookedFetch2(topUrl);
  await flushMicro();
  assert.deepEqual(h2.ingested, [], "running=false → hook tidak memproses (guard !running)");
});

test("intercept TT: hook fetch — argumen Request object {url} diekstrak dan diingest", async () => {
  const net = makeNetStubs();
  const h = makeTtHook();
  const hookedFetch = globalThis.window.fetch;
  net.restore();
  net.setFetch(() => topPayload);
  await hookedFetch({ url: topUrl });
  await flushMicro();
  assert.deepEqual(h.ingested, ["TopA", "TopB"], "args[0] berupa Request object → url dibaca dari .url");
});

test("intercept TT: hook XHR — open mencatat URL, load → tryParseResponse(responseText)", () => {
  const net = makeNetStubs();
  const h = makeTtHook();
  net.restore();
  const x = new net.Xhr();
  x.open("GET", topUrl);
  x.responseText = topPayload;
  x.send();
  net.fireLoad(x);
  assert.deepEqual(h.ingested, ["TopA", "TopB"]);
});

test("intercept TT: hook XHR — includeReplies OFF, URL /list/reply tidak diingest (anti-bocor)", () => {
  const net = makeNetStubs();
  const h = makeTtHook(true, false); // includeReplies = false
  net.restore();
  const x = new net.Xhr();
  x.open("GET", replyUrl);
  x.responseText = replyPayload;
  x.send();
  net.fireLoad(x);
  assert.deepEqual(h.ingested, [], "guard /list/reply aktif DI JALUR HOOK (parity FB v1.0.42)");
});

// ===================== L1-TT: synthetic-from-page =====================
const buildSyntheticListUrl = new Function(
  `${extract("buildSyntheticListUrl")}\nreturn buildSyntheticListUrl;`
)();

test("buildSyntheticListUrl: endpoint publik + clamp [30..50] + cursor non-negatif", () => {
  const u = new URL(buildSyntheticListUrl("6912345678901234567"));
  assert.equal(u.origin + u.pathname, "https://www.tiktok.com/api/comment/list/");
  assert.equal(u.searchParams.get("aweme_id"), "6912345678901234567");
  assert.equal(u.searchParams.get("count"), "30");
  assert.equal(u.searchParams.get("cursor"), "0");

  const u2 = new URL(buildSyntheticListUrl("6912345678901234567", { cursor: 120, count: 99 }));
  assert.equal(u2.searchParams.get("count"), "50");
  assert.equal(u2.searchParams.get("cursor"), "120");

  const u3 = new URL(buildSyntheticListUrl("6912345678901234567", { cursor: -4, count: 10 }));
  assert.equal(u3.searchParams.get("cursor"), "0");
  assert.equal(u3.searchParams.get("count"), "30");
});

test("buildSyntheticListUrl: aweme invalid → null", () => {
  for (const bad of [null, "", "abc123", "1234", "x".repeat(26)]) {
    assert.equal(buildSyntheticListUrl(bad), null, `invalid: ${bad}`);
  }
});

// ===================== S3-TT: pre-seed per aweme_id =====================
function makeTtNameStore(store) {
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
  };
  return new Function(
    "localStorage",
    "Date",
    [
      'const NAMES_STORE_KEY = "fnk_tt_names_v1";',
      extract("loadPriorNames"),
      extract("persistNames"),
      "return { loadPriorNames, persistNames };",
    ].join("\n")
  )(ls, Date);
}

test("pre-seed TT: persist → load cocok aweme; TTL & key salah ditolak; cap baca 2000", () => {
  const store = {};
  const ns = makeTtNameStore(store);

  ns.persistNames("6912345678901234567", ["Budi", "Sari"]);
  assert.deepEqual(ns.loadPriorNames("6912345678901234567"), ["Budi", "Sari"]);
  assert.equal(ns.loadPriorNames("6912345678909999999"), null);

  const stale = JSON.parse(store.fnk_tt_names_v1);
  stale.at = Date.now() - 8 * 86400_000;
  store.fnk_tt_names_v1 = JSON.stringify(stale);
  assert.equal(ns.loadPriorNames("6912345678901234567"), null);

  const s2 = {};
  s2.fnk_tt_names_v1 = JSON.stringify({
    key: "6912345678901234567",
    names: Array.from({ length: 2500 }, (_, i) => "u" + i),
    at: Date.now(),
  });
  assert.equal(makeTtNameStore(s2).loadPriorNames("6912345678901234567").length, 2000);
});
