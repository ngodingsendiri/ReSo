/**
 * Unit tests untuk logika murni engine Instagram (inject-ig.js):
 * payloadMatchesMedia (anti kontaminasi lintas post), tryParseResponse
 * (anti-bocor balasan saat includeReplies off — parity FB v1.0.42 /
 * TikTok v1.0.43), parsePage (has_more/cursor/replyTargets), looksLikeCommentsApi
 * & buildUrl (template → URL request: rewrite media_id + endpoint balasan).
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
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "inject-ig.js"),
  "utf8"
);

function extract(fnName) {
  const idx = src.indexOf(`function ${fnName}(`);
  assert.ok(idx >= 0, `function ${fnName} not found in inject-ig.js`);
  // Pertahankan modifier `async` (fungsi seperti expandLoadMore memakai
  // `await` — tanpa ini ekstraksi jadi fungsi sinkron yang tak valid).
  const start = idx - (src.slice(Math.max(0, idx - 6), idx) === "async " ? 6 : 0);
  // Lewati daftar parameter: `{` pertama bisa milik destructuring
  // (mis. buildUrl(templateUrl, { nextMaxId, reply, ... })) — brace badan
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
  return src.slice(start, i + 1);
}

// ===================== payloadMatchesMedia (anti kontaminasi lintas post) =====================

function makePayloadMatcher(activeMediaId) {
  const fnSrc = [
    extract("extractMediaIdFromUrl"),
    `let activeMediaId = ${JSON.stringify(activeMediaId ?? null)};`,
    extract("payloadMatchesMedia"),
    "return payloadMatchesMedia;",
  ].join("\n");
  return new Function(fnSrc)();
}

test("payloadMatchesMedia: media id di path URL cocok → true", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm("https://www.instagram.com/api/v1/media/111/comments/?x=1", '{"comments":[]}'),
    true
  );
});

test("payloadMatchesMedia: URL balasan post SAMA (inline_child_comments) → true", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm(
      "https://www.instagram.com/api/v1/media/111/comments/22/inline_child_comments/?x=1",
      '{"comments":[]}'
    ),
    true
  );
});

test("payloadMatchesMedia: media LAIN di path URL ditolak (kontaminasi lintas post)", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm(
      "https://www.instagram.com/api/v1/media/222/comments/?x=1",
      '{"comments":[{"user":{"username":"X"}}],"has_more":1}'
    ),
    false
  );
});

test("payloadMatchesMedia: id 12345 vs 123456789 (celah substring) ditolak", () => {
  // Celah substring lama: `text.includes(activeMediaId)` cocok dengan id post
  // lain yang diawali id target. Id path URL kini dibandingkan persis.
  const pm = makePayloadMatcher("12345");
  assert.equal(
    pm("https://www.instagram.com/api/v1/media/123456789/comments/?x=1", '{"comments":[]}'),
    false
  );
});

test("payloadMatchesMedia: tanpa media id di path, body memuat id target → true", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm("https://www.instagram.com/api/v1/media/111_abc/comments/?x=1", '{"comments":[],"media_id":"111"}'),
    true
  );
});

test("payloadMatchesMedia: tanpa media id di path, fallback shape-only → true (perilaku lama)", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm("https://www.instagram.com/api/v1/media/111_abc/comments/?x=1", '{"comments":[],"has_more":1}'),
    true
  );
});

test("payloadMatchesMedia: tanpa media id di path, non-komentar → false", () => {
  const pm = makePayloadMatcher("111");
  assert.equal(
    pm("https://www.instagram.com/api/v1/media/111_abc/comments/?x=1", '{"status":"ok"}'),
    false
  );
});

test("payloadMatchesMedia: activeMediaId null → selalu true", () => {
  const pm = makePayloadMatcher(null);
  assert.equal(
    pm("https://www.instagram.com/api/v1/media/222/comments/?x=1", '{"comments":[]}'),
    true
  );
});

// ===================== looksLikeCommentsApi =====================

const looksLikeCommentsApi = new Function(
  extract("looksLikeCommentsApi") + "\nreturn looksLikeCommentsApi;"
)();

test("looksLikeCommentsApi: URL komentar API → true", () => {
  assert.equal(
    looksLikeCommentsApi("https://www.instagram.com/api/v1/media/111/comments/?x=1"),
    true
  );
});

test("looksLikeCommentsApi: URL balasan (inline_child_comments) juga true", () => {
  assert.equal(
    looksLikeCommentsApi(
      "https://www.instagram.com/api/v1/media/111/comments/22/inline_child_comments/"
    ),
    true
  );
});

test("looksLikeCommentsApi: non-komentar / URL lain / null → false", () => {
  assert.equal(looksLikeCommentsApi("https://www.instagram.com/api/v1/media/111/"), false);
  assert.equal(looksLikeCommentsApi("https://www.instagram.com/explore/"), false);
  assert.equal(looksLikeCommentsApi(null), false);
  assert.equal(looksLikeCommentsApi(""), false);
});

// ===================== parsePage (has_more / cursor / replyTargets) =====================

/**
 * Harness parsePage: fungsi asli dengan ingest nyata (parseIgComments +
 * addUsername stub) — jadi asersi bisa memeriksa struktur return DAN nama
 * yang benar-benar diingest.
 */
function makePageParser() {
  const fnSrc = [
    extract("parseIgComments"),
    "const ingested = [];",
    "function addUsername(n) { ingested.push(n); }",
    extract("parsePage"),
    "return { parsePage, ingested };",
  ].join("\n");
  return new Function(fnSrc)();
}

test("parsePage: top-level has_more_comments=true + next_max_id → hasMore true, nextMaxId", () => {
  const { parsePage } = makePageParser();
  const r = parsePage({
    comments: [{ comment_id: "1", user: { username: "A" } }],
    has_more_comments: true,
    next_max_id: "AQICBA==",
  });
  assert.equal(r.hasMore, true);
  assert.equal(r.nextMaxId, "AQICBA==");
  assert.equal(r.batchSize, 1);
});

test("parsePage: has_more_comments=1 / has_more=true dikenali; string '1' TIDAK (strict)", () => {
  // Parity lintas platform (FB/TT): hanya `=== true || === 1` — string "1"
  // dari respons aneh tidak membuka halaman "palsu" berikutnya.
  const { parsePage } = makePageParser();
  assert.equal(parsePage({ comments: [], has_more_comments: 1 }).hasMore, true);
  assert.equal(parsePage({ comments: [], has_more: "1" }).hasMore, false);
  assert.equal(parsePage({ comments: [], has_more: true }).hasMore, true);
});

test("parsePage: has_more=0 / absent → false", () => {
  const { parsePage } = makePageParser();
  assert.equal(parsePage({ comments: [], has_more: 0 }).hasMore, false);
  assert.equal(parsePage({ comments: [] }).hasMore, false);
});

test("parsePage: next_max_id numerik → String; null/absent → null", () => {
  const { parsePage } = makePageParser();
  assert.equal(parsePage({ comments: [], next_max_id: 123 }).nextMaxId, "123");
  assert.equal(parsePage({ comments: [], next_max_id: null }).nextMaxId, null);
  assert.equal(parsePage({ comments: [] }).nextMaxId, null);
});

test("parsePage: isReplyPage=true — has_more_tail_child_comments + next_max_child_cursor", () => {
  const { parsePage } = makePageParser();
  const r = parsePage(
    {
      comments: [{ comment_id: "55", user: { username: "Rep" } }],
      has_more_tail_child_comments: true,
      next_max_child_cursor: "CUR2",
    },
    true
  );
  assert.equal(r.hasMore, true);
  assert.equal(r.nextMaxId, "CUR2");
  // Field top-level tidak dipakai saat isReplyPage.
  const r2 = parsePage({ comments: [], has_more_comments: true, next_max_id: "T" }, true);
  assert.equal(r2.hasMore, false);
  assert.equal(r2.nextMaxId, null);
});

test("parsePage: isReplyPage=true — fallback has_more_child_comments + next_max_child_id", () => {
  const { parsePage } = makePageParser();
  const r = parsePage(
    { comments: [], has_more_child_comments: true, next_max_child_id: "CUR3" },
    true
  );
  assert.equal(r.hasMore, true);
  assert.equal(r.nextMaxId, "CUR3");
});

test("parsePage: isReplyPage=true — strict parity: 1/true dikenali, string '1' TIDAK (sama dengan top-level)", () => {
  const { parsePage } = makePageParser();
  assert.equal(
    parsePage({ comments: [], has_more_tail_child_comments: 1 }, true).hasMore,
    true
  );
  assert.equal(
    parsePage({ comments: [], has_more_tail_child_comments: "1" }, true).hasMore,
    false
  );
  assert.equal(
    parsePage({ comments: [], has_more_child_comments: 1 }, true).hasMore,
    true
  );
});

test("parsePage: isReplyPage=true — strict parity: string \"false\" / 0 / 2 TIDAK jadi hasMore", () => {
  // Lama: `!!(x || y)` truthy — string "false"/0 justru membuka halaman
  // "palsu" berikutnya. Kini semantik strict sama dengan top-level.
  const { parsePage } = makePageParser();
  assert.equal(
    parsePage({ comments: [], has_more_tail_child_comments: "false" }, true).hasMore,
    false
  );
  assert.equal(
    parsePage({ comments: [], has_more_tail_child_comments: 0 }, true).hasMore,
    false
  );
  assert.equal(
    parsePage({ comments: [], has_more_child_comments: "false" }, true).hasMore,
    false
  );
  assert.equal(
    parsePage({ comments: [], has_more_tail_child_comments: 2 }, true).hasMore,
    false
  );
  assert.equal(
    parsePage({ comments: [], has_more_tail_child_comments: "1" }, true).hasMore,
    false
  );
  assert.equal(parsePage({ comments: [], has_more_child_comments: false }, true).hasMore, false);
  assert.equal(parsePage({ comments: [] }, true).hasMore, false);
});

test("parsePage: replyTargets dari comment_id/pk/id + child_comment_count > 0", () => {
  const { parsePage } = makePageParser();
  const r = parsePage({
    comments: [
      { comment_id: "1", child_comment_count: 3 },
      { pk: "2", child_comment_count: 0 },
      { id: "3", child_comment_count: "2" },
    ],
  });
  assert.deepEqual(r.replyTargets, [
    { commentId: "1", total: 3 },
    { commentId: "3", total: 2 },
  ]);
});

test("parsePage: nama username diingest dari data.comments (user null/kosong dilewati)", () => {
  const { parsePage, ingested } = makePageParser();
  parsePage({
    comments: [
      { comment_id: "1", user: { username: "alice" } },
      { comment_id: "2", user: { username: "bob" } },
      { comment_id: "3", user: null },
      { comment_id: "4" },
    ],
  });
  assert.deepEqual([...ingested].sort(), ["alice", "bob"]);
});

test("parsePage: tak ada array komentar → batchSize 0, replyTargets kosong", () => {
  const { parsePage } = makePageParser();
  const r = parsePage({ status: "ok" });
  assert.equal(r.batchSize, 0);
  assert.deepEqual(r.replyTargets, []);
});

// ===================== tryParseResponse (anti-bocor balasan + lintas post) =====================

function makeParser(includeRepliesVal, runningVal = true) {
  const fnSrc = [
    extract("parseIgComments"),
    extract("parsePage"),
    extract("looksLikeCommentsApi"),
    extract("extractMediaIdFromUrl"),
    extract("payloadMatchesMedia"),
    extract("tryParseResponse"),
    `let running = ${runningVal};`,
    `let includeReplies = ${includeRepliesVal};`,
    "let activeMediaId = '111';",
    "const ingested = [];",
    "function addUsername(n) { ingested.push(n); }",
    "return { tryParseResponse, ingested };",
  ].join("\n");
  return new Function(fnSrc)();
}

const replyUrl =
  "https://www.instagram.com/api/v1/media/111/comments/1000/inline_child_comments/?x=1";
const childUrl =
  "https://www.instagram.com/api/v1/media/111/comments/1000/child_comments/?x=1";
const replyPayload = JSON.stringify({
  comments: [
    { comment_id: "1001", user: { username: "replyauthor" }, text: "balasan" },
    { comment_id: "1002", user: { username: "replyauthor2" }, text: "balasan 2" },
  ],
  has_more_tail_child_comments: false,
});
const topUrl = "https://www.instagram.com/api/v1/media/111/comments/?x=1";
const topPayload = JSON.stringify({
  comments: [
    { comment_id: "1", user: { username: "topuser" }, text: "komentar" },
    { comment_id: "2", user: { username: "topuser2" }, text: "komentar 2" },
  ],
  has_more_comments: false,
});

test("tryParseResponse: includeReplies=OFF, respons inline_child_comments TIDAK diingest", () => {
  const { tryParseResponse, ingested } = makeParser(false);
  tryParseResponse(replyUrl, replyPayload);
  assert.deepEqual(ingested, []);
});

test("tryParseResponse: includeReplies=OFF, respons child_comments juga TIDAK diingest", () => {
  const { tryParseResponse, ingested } = makeParser(false);
  tryParseResponse(childUrl, replyPayload);
  assert.deepEqual(ingested, []);
});

test("tryParseResponse: includeReplies=OFF, respons komentar biasa tetap diingest", () => {
  const { tryParseResponse, ingested } = makeParser(false);
  tryParseResponse(topUrl, topPayload);
  assert.deepEqual([...ingested].sort(), ["topuser", "topuser2"]);
});

test("tryParseResponse: includeReplies=ON, respons balasan diingest", () => {
  const { tryParseResponse, ingested } = makeParser(true);
  tryParseResponse(replyUrl, replyPayload);
  assert.deepEqual([...ingested].sort(), ["replyauthor", "replyauthor2"]);
});

test("tryParseResponse: URL media LAIN ditolak (kontaminasi lintas post)", () => {
  const { tryParseResponse, ingested } = makeParser(true);
  const otherUrl = "https://www.instagram.com/api/v1/media/222/comments/?x=1";
  tryParseResponse(otherUrl, topPayload);
  assert.deepEqual(ingested, []);
});

test("tryParseResponse: URL balasan media LAIN ditolak meski includeReplies ON", () => {
  const { tryParseResponse, ingested } = makeParser(true);
  const otherReply =
    "https://www.instagram.com/api/v1/media/222/comments/1000/inline_child_comments/?x=1";
  tryParseResponse(otherReply, replyPayload);
  assert.deepEqual(ingested, []);
});

test("tryParseResponse: tidak running → tidak diproses", () => {
  const { tryParseResponse, ingested } = makeParser(false, false);
  tryParseResponse(topUrl, topPayload);
  assert.deepEqual(ingested, []);
});

// ===================== buildUrl (template → URL request) =====================

const VOLATILE = [
  "max_id",
  "min_id",
  "index",
  "a1",
  "__user",
  "__a",
  "__req",
  "__dyn",
  "__csr",
  "__tt",
  "__bfa",
  "__aut",
  "__spin_r",
  "__spin_b",
  "__spin_t",
];

// buildUrl bergantung pada closure activeMediaId — bungkus dengan stub.
function makeUrlBuilder(activeMediaIdVal) {
  const fnSrc = [
    extract("stripVolatileParams"),
    `let activeMediaId = ${JSON.stringify(activeMediaIdVal ?? null)};`,
    extract("buildUrl"),
    "return buildUrl;",
  ].join("\n");
  return new Function(fnSrc)();
}

const TEMPLATE =
  "https://www.instagram.com/api/v1/media/111/comments/?max_id=abc&__a=1&can_support_threading=false";

test("buildUrl: basic — path media dipertahankan, param volatil dibuang, can_support_threading=true", () => {
  const bu = makeUrlBuilder(null);
  const url = new URL(bu(TEMPLATE, {}));
  assert.equal(url.pathname, "/api/v1/media/111/comments/");
  for (const p of VOLATILE) assert.equal(url.searchParams.get(p), null, p);
  assert.equal(url.searchParams.get("can_support_threading"), "true");
});

test("buildUrl: mediaId eksplisit menulis ulang segmen media_id di path", () => {
  const bu = makeUrlBuilder(null);
  const u = bu(TEMPLATE, { mediaId: "222" });
  assert.equal(new URL(u).pathname, "/api/v1/media/222/comments/");
});

test("buildUrl: tanpa mediaId, activeMediaId (closure) dipakai", () => {
  const bu = makeUrlBuilder("333");
  const u = bu(TEMPLATE, {});
  assert.equal(new URL(u).pathname, "/api/v1/media/333/comments/");
});

test("buildUrl: reply + commentId → endpoint inline_child_comments (default)", () => {
  const bu = makeUrlBuilder(null);
  const u = bu(TEMPLATE, { reply: true, commentId: "55" });
  assert.equal(
    new URL(u).pathname,
    "/api/v1/media/111/comments/55/inline_child_comments/"
  );
});

test("buildUrl: replyEndpoint child_comments dipakai bila diminta", () => {
  const bu = makeUrlBuilder(null);
  const u = bu(TEMPLATE, { reply: true, commentId: "55", replyEndpoint: "child_comments" });
  assert.equal(new URL(u).pathname, "/api/v1/media/111/comments/55/child_comments/");
});

test("buildUrl: nextMaxId → param max_id", () => {
  const bu = makeUrlBuilder(null);
  const u = bu(TEMPLATE, { nextMaxId: "CUR9" });
  assert.equal(new URL(u).searchParams.get("max_id"), "CUR9");
});

// ===================== R-IG: bump ukuran halaman [30..50] =====================
test("buildUrl: count dikepang ke [30..50]; template tanpa count dibiarkan", () => {
  const bu = makeUrlBuilder(null);
  const mk = (c) =>
    `https://www.instagram.com/api/v1/media/111/comments/?can_support_threading=false${
      c == null ? "" : `&count=${c}`
    }`;
  assert.equal(new URL(bu(mk(10), {})).searchParams.get("count"), "30"); // naik
  assert.equal(new URL(bu(mk(80), {})).searchParams.get("count"), "50"); // cap
  assert.equal(new URL(bu(mk(33), {})).searchParams.get("count"), "33"); // biarkan
  const without = new URL(bu(mk(undefined), {}));
  assert.equal(without.searchParams.get("count"), null); // jaga bentuk capture
});

// ===================== S3-IG: pre-seed nama run sebelumnya =====================
function makeIgNameStore(store) {
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
  return new Function(
    "localStorage",
    "Date",
    [
      'const NAMES_STORE_KEY = "fnk_ig_names_v1";',
      extract("loadPriorNames"),
      extract("persistNames"),
      "return { loadPriorNames, persistNames };",
    ].join("\n")
  )(ls, Date);
}

test("pre-seed IG: persist → load cocok shortcode; TTL & key salah ditolak", () => {
  const store = {};
  const ns = makeIgNameStore(store);

  ns.persistNames("CxAbCdEf", ["user_one", "user.two"]);
  assert.deepEqual(ns.loadPriorNames("CxAbCdEf"), ["user_one", "user.two"]);
  // Shortcode berbeda → tidak di-seed
  assert.equal(ns.loadPriorNames("ZzOther99"), null);

  // TTL kedaluwarsa (8 hari)
  const stale = JSON.parse(store.fnk_ig_names_v1);
  stale.at = Date.now() - 8 * 86400_000;
  store.fnk_ig_names_v1 = JSON.stringify(stale);
  assert.equal(ns.loadPriorNames("CxAbCdEf"), null);

  // Nama non-string disaring
  const dirty = {};
  const ns2 = makeIgNameStore(dirty);
  dirty.fnk_ig_names_v1 = JSON.stringify({
    key: "CxAbCdEf",
    names: ["ok", 7, null],
    at: Date.now(),
  });
  assert.deepEqual(ns2.loadPriorNames("CxAbCdEf"), ["ok"]);

  // persist tanpa key/nama → no-op (tidak menambah kunci baru)
  ns2.persistNames("", []);
  ns2.persistNames(null, ["a"]);
  assert.deepEqual(Object.keys(dirty), ["fnk_ig_names_v1"]);
});

test("buildUrl: template null / URL tak valid → null", () => {
  const bu = makeUrlBuilder(null);
  assert.equal(bu(null, {}), null);
  assert.equal(bu("not a url", {}), null);
});

// ===================== buildUrl → tryParseResponse penuh (urutan fetch engine) =====================
// Verifikasi lifecycle intercept utuh (pola makeEngineChain TikTok): URL yang
// DIBANGUN buildUrl asli (template → request, rewrite media_id + strip param
// volatil) diteruskan ke tryParseResponse asli (guard anti-bocor balasan +
// anti kontaminasi lintas post) lalu nama diingest — urutan yang sama persis
// dengan loop fetch engine. Dedupe dimodelkan lewat Set (di engine terjadi di
// nameMap, di luar tryParseResponse). Guard balasan IG ada di tingkat
// endpoint (tryParseResponse), bukan parser — jadi tanpa includeReplies,
// payload balasan ditolak sebelum pernah menyentuh parseIgComments.

function makeEngineChain(includeRepliesVal) {
  const fnSrc = [
    extract("parseIgComments"),
    extract("extractMediaIdFromUrl"),
    extract("payloadMatchesMedia"),
    extract("parsePage"),
    extract("looksLikeCommentsApi"),
    extract("tryParseResponse"),
    extract("stripVolatileParams"),
    extract("buildUrl"),
    "let running = true;",
    `let includeReplies = ${includeRepliesVal};`,
    "let activeMediaId = '111';",
    "const nameSet = new Set();",
    "function addUsername(n) { nameSet.add(n); }",
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

test("chain IG: buildUrl top-level → tryParseResponse → nama diingest (ON)", () => {
  const { fetchChain, names } = makeEngineChain(true);
  const url = fetchChain(TEMPLATE, { nextMaxId: "CUR1" }, topPayload);
  assert.ok(url, "URL harus terbentuk");
  const u = new URL(url);
  assert.equal(u.pathname, "/api/v1/media/111/comments/");
  // max_id sengaja DI-SET dari nextMaxId (bukan di-strip seperti param volatil)
  assert.equal(u.searchParams.get("max_id"), "CUR1");
  for (const p of VOLATILE.filter((x) => x !== "max_id")) {
    assert.equal(u.searchParams.get(p), null, p);
  }
  assert.deepEqual(names(), ["topuser", "topuser2"]);
});

test("chain IG: buildUrl reply inline_child_comments → diingest saat ON", () => {
  const { fetchChain, names } = makeEngineChain(true);
  const url = fetchChain(
    TEMPLATE,
    { reply: true, commentId: "1000" },
    replyPayload
  );
  assert.match(new URL(url).pathname, /inline_child_comments\/$/);
  assert.deepEqual(names(), ["replyauthor", "replyauthor2"]);
});

test("chain IG: buildUrl reply child_comments (endpoint fallback) → diingest saat ON", () => {
  const { fetchChain, names } = makeEngineChain(true);
  const url = fetchChain(
    TEMPLATE,
    { reply: true, commentId: "1000", replyEndpoint: "child_comments" },
    replyPayload
  );
  assert.match(new URL(url).pathname, /child_comments\/$/);
  assert.deepEqual(names(), ["replyauthor", "replyauthor2"]);
});

test("chain IG: buildUrl reply → TIDAK diingest saat OFF (kedua endpoint)", () => {
  const { fetchChain, names } = makeEngineChain(false);
  const u = fetchChain(
    TEMPLATE,
    { reply: true, commentId: "1000" },
    replyPayload
  );
  assert.match(new URL(u).pathname, /inline_child_comments\/$/); // URL memang dibangun…
  assert.deepEqual(names(), []); // …tapi guard endpoint menolaknya
  fetchChain(
    TEMPLATE,
    { reply: true, commentId: "1000", replyEndpoint: "child_comments" },
    replyPayload
  );
  assert.deepEqual(names(), []);
});

test("chain IG: buildUrl top-level tetap diingest saat OFF", () => {
  const { fetchChain, names } = makeEngineChain(false);
  fetchChain(TEMPLATE, { nextMaxId: "CUR2" }, topPayload);
  assert.deepEqual(names(), ["topuser", "topuser2"]);
});

test("chain IG: post lain (mediaId 222) ditolak untuk top-level DAN reply (anti kontaminasi)", () => {
  const { fetchChain, names } = makeEngineChain(true);
  // Guard media dijalankan SETELAH guard endpoint — keduanya aktif: top-level
  // post lain ditolak, dan balasan post lain ditolak untuk kedua endpoint.
  fetchChain(TEMPLATE, { mediaId: "222" }, topPayload);
  assert.deepEqual(names(), []);
  fetchChain(
    TEMPLATE,
    { mediaId: "222", reply: true, commentId: "1000" },
    replyPayload
  );
  assert.deepEqual(names(), []);
  fetchChain(
    TEMPLATE,
    { mediaId: "222", reply: true, commentId: "1000", replyEndpoint: "child_comments" },
    replyPayload
  );
  assert.deepEqual(names(), []);
});

test("chain IG: pengulangan URL yang sama di-dedupe (nameMap) tanpa crash", () => {
  const { fetchChain, names } = makeEngineChain(true);
  fetchChain(TEMPLATE, { nextMaxId: "CUR3" }, topPayload);
  fetchChain(TEMPLATE, { nextMaxId: "CUR3" }, topPayload); // halaman sama lagi
  assert.deepEqual(names(), ["topuser", "topuser2"]); // unik, tidak ganda
});

test("chain IG: template tak valid → null tanpa crash", () => {
  const { fetchChain, names } = makeEngineChain(true);
  assert.equal(fetchChain(null, {}, topPayload), null);
  assert.equal(fetchChain("not a url", {}, topPayload), null);
  assert.deepEqual(names(), []);
});

// ===================== scrapeDomUsernames (mode scroll — DOM fallback) =====================
// Fallback mode scroll: username dari link profil yang terlihat di DOM
// di-harvest dari scope `[role=dialog]` + `main` (nav/header dilewati,
// path non-profil ditolak, dedupe lintas scope). Harness memakai fungsi ASLI
// (normalizeInstagramUsername → addUsername → nameMap) dengan fixture DOM
// (tests/dom-fixture.mjs) — yang di-assert adalah username yang BENAR-BENAR
// masuk nameMap.

function makeIgScraper() {
  const fnSrc = [
    extract("normalizeInstagramUsername"),
    "const nameMap = new Map();",
    "let lastNewAt = 0;",
    extract("addUsername"),
    extract("scrapeDomUsernames"),
    "return { scrapeDomUsernames, names: () => [...nameMap.values()] };",
  ].join("\n");
  return new Function(fnSrc)();
}

/** Jalankan scraper asli dengan document fixture, kembalikan { added, names }. */
function runScrape(doc) {
  const realDoc = globalThis.document;
  globalThis.document = makeDocument(doc);
  try {
    const { scrapeDomUsernames, names } = makeIgScraper();
    return { added: scrapeDomUsernames(), names: names() };
  } finally {
    globalThis.document = realDoc;
  }
}

test("scrapeDom IG: main + dialog di-harvest, nav/header dilewati, dedupe lintas scope", () => {
  const doc = el("div", {}, [
    el("nav", {}, [el("a", { href: "/suggested" }, [], "s")]), // nav → dilewati walau path profil
    el("header", {}, [el("a", { href: "/me" }, [], "m")]), // header → dilewati
    el("main", {}, [
      el("a", { href: "/alice" }, [], "alice"),
      el("a", { href: "/bob/" }, [], "bob"), // slash akhir dibuang
      el("a", { href: "/p/123456/" }, [], "post"), // path multi-segmen → bukan profil
      el("a", { href: "https://instagram.com/ext" }, [], "ext"), // absolut → bukan /profil
    ]),
    el("div", { role: "dialog" }, [
      el("a", { href: "/carol" }, [], "carol"),
      el("a", { href: "/alice" }, [], "dupe"), // dedupe lintas scope (seen)
    ]),
  ]);
  const { added, names } = runScrape(doc);
  assert.equal(added, 3); // alice, bob, carol
  assert.deepEqual([...names].sort(), ["alice", "bob", "carol"]);
});

test("scrapeDom IG: batas profilRe — titik/garis-bawah sah, panjang > 30 & segmen ganda ditolak", () => {
  const long31 = "u".repeat(31);
  const doc = el("div", {}, [
    el("main", {}, [
      el("a", { href: "/john.doe_1" }, [], "a"), // titik & garis bawah sah (≤30)
      el("a", { href: `/${long31}` }, [], "b"), // 31 karakter → ditolak
      el("a", { href: "/seg/dua" }, [], "c"), // dua segmen → ditolak
      el("a", { href: "/" }, [], "d"), // kosong setelah slash → ditolak
    ]),
  ]);
  const { added, names } = runScrape(doc);
  assert.equal(added, 1);
  assert.deepEqual([...names].sort(), ["john.doe_1"]);
});

test("scrapeDom IG: tanpa scope dialog/main → 0 ditambahkan", () => {
  const doc = el("div", {}, [el("a", { href: "/alice" }, [], "alice")]);
  const { added, names } = runScrape(doc);
  assert.equal(added, 0);
  assert.deepEqual(names, []);
});

test("scrapeDom IG: href kosong / anchor tanpa href dilewati", () => {
  const doc = el("div", {}, [
    el("main", {}, [
      el("a", { href: "" }, [], "x"),
      el("a", {}, [], "y"),
    ]),
  ]);
  const { added, names } = runScrape(doc);
  assert.equal(added, 0);
  assert.deepEqual(names, []);
});

// ===================== wiring intercept (fetch/XHR hook → tryParseResponse) =====================
// Instagram TIDAK punya buffer respons seperti gqlBuffer Facebook — hook
// fetch/XHR memproses respons SEGERA lewat tryParseResponse (intercept hanya
// komplementer; loop pagination pakai direct fetch). Yang diuji di sini:
// WIRING blok intercept ASLI — apakah hook benar-benar meneruskan URL +
// payload ke tryParseResponse (jalur fetch maupun XHR), termasuk guard
// anti-bocor endpoint balasan saat includeReplies off DI JALUR HOOK.

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
function makeIgNetStubs() {
  const realWin = globalThis.window;
  const realXhr = globalThis.XMLHttpRequest;
  let fetchImpl = () => "";
  class FakeXhr {
    constructor() {
      this.listeners = {};
      this.__ing_url = "";
    }
    addEventListener(type, cb) {
      (this.listeners[type] ||= []).push(cb);
    }
    open() {}
    send() {}
  }
  globalThis.XMLHttpRequest = FakeXhr;
  globalThis.window = {
    __ING_NET__: undefined,
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
    // supaya `this.__ing_url` / `this.responseText` terbaca di dalam hook.
    fireLoad: (x) => (x.listeners.load || []).forEach((cb) => cb.call(x)),
    restore: () => {
      globalThis.window = realWin;
      globalThis.XMLHttpRequest = realXhr;
    },
  };
}

/** Harness wiring: blok hook ASLI dieksekusi, rantai tryParseResponse → parsePage asli. */
function makeIgHook(runningVal = true, includeRepliesVal = true) {
  const hookBlock = extractHook("if (!window.__ING_NET__) {");
  const fnSrc = [
    `let running = ${runningVal};`,
    `let includeReplies = ${includeRepliesVal};`,
    "let activeMediaId = '111';",
    "const ingested = [];",
    extract("parseIgComments"),
    extract("parsePage"),
    extract("looksLikeCommentsApi"),
    extract("extractMediaIdFromUrl"),
    extract("payloadMatchesMedia"),
    extract("tryParseResponse"),
    "function addUsername(n) { ingested.push(n); }",
    hookBlock,
    "return { ingested };",
  ].join("\n");
  return new Function(fnSrc)();
}

const flushMicro = () => new Promise((r) => setImmediate(r));

test("intercept IG: hook fetch → tryParseResponse → payload komentar nyata diingest", async () => {
  const net = makeIgNetStubs();
  const h = makeIgHook();
  const hookedFetch = globalThis.window.fetch; // setelah install
  net.restore();
  net.setFetch(() => topPayload);
  await hookedFetch(topUrl);
  await flushMicro();
  assert.deepEqual(h.ingested, ["topuser", "topuser2"]);
});

test("intercept IG: hook fetch — URL non-komentar / running=false tidak diingest", async () => {
  const net = makeIgNetStubs();
  const h = makeIgHook();
  const hookedFetch = globalThis.window.fetch;
  net.restore();
  net.setFetch(() => topPayload);
  await hookedFetch("https://www.instagram.com/api/v1/media/111/");
  await flushMicro();
  assert.deepEqual(h.ingested, [], "URL non-komentar → hook tidak memanggil tryParseResponse");

  const net2 = makeIgNetStubs();
  const h2 = makeIgHook(false); // running = false
  const hookedFetch2 = globalThis.window.fetch;
  net2.restore();
  net2.setFetch(() => topPayload);
  await hookedFetch2(topUrl);
  await flushMicro();
  assert.deepEqual(h2.ingested, [], "running=false → hook tidak memproses (guard !running)");
});

test("intercept IG: hook fetch — argumen Request object {url} diekstrak dan diingest", async () => {
  const net = makeIgNetStubs();
  const h = makeIgHook();
  const hookedFetch = globalThis.window.fetch;
  net.restore();
  net.setFetch(() => topPayload);
  await hookedFetch({ url: topUrl });
  await flushMicro();
  assert.deepEqual(h.ingested, ["topuser", "topuser2"], "args[0] berupa Request object → url dibaca dari .url");
});

test("intercept IG: hook XHR — open mencatat URL, load → tryParseResponse(responseText)", () => {
  const net = makeIgNetStubs();
  const h = makeIgHook();
  net.restore();
  const x = new net.Xhr();
  x.open("GET", topUrl);
  x.responseText = topPayload;
  x.send();
  net.fireLoad(x);
  assert.deepEqual(h.ingested, ["topuser", "topuser2"]);
});

test("intercept IG: hook XHR — includeReplies OFF, endpoint balasan tidak diingest (anti-bocor)", () => {
  const net = makeIgNetStubs();
  const h = makeIgHook(true, false); // includeReplies = false
  net.restore();
  const x = new net.Xhr();
  x.open("GET", replyUrl);
  x.responseText = replyPayload;
  x.send();
  net.fireLoad(x);
  assert.deepEqual(h.ingested, [], "guard endpoint balasan aktif DI JALUR HOOK (parity FB v1.0.42)");
});

// ===================== findLoadMoreButtons / expandLoadMore (muat komentar lainnya) =====================
// Tombol "Muat komentar lainnya" / "Load more comments" perlu diklik agar IG
// memuat batch berikutnya di dialog (scroll saja tidak cukup di beberapa layout).

function makeIgExpander() {
  const fnSrc = [
    "let stopFlag = false;",
    "let sleepWhile = async () => {};",
    extract("findLoadMoreButtons"),
    extract("expandLoadMore"),
    "return { findLoadMoreButtons, expandLoadMore, setSleep: (fn) => { sleepWhile = fn; }, setStop: (v) => { stopFlag = v; } };",
  ].join("\n");
  return new Function(fnSrc)();
}

function runFindLoadMore(doc) {
  const realDoc = globalThis.document;
  globalThis.document = makeDocument(doc);
  try {
    const { findLoadMoreButtons } = makeIgExpander();
    return findLoadMoreButtons();
  } finally {
    globalThis.document = realDoc;
  }
}

test("findLoadMoreButtons IG: pola load-more terdeteksi", () => {
  const doc = el("div", {}, [
    el("div", { role: "button" }, [], "Muat komentar lainnya"),
    el("span", { dir: "auto" }, [], "Load more comments"),
    el("button", {}, [], "Lihat lebih banyak komentar"),
    el("div", { role: "button" }, [], "Lihat balasan lainnya"),
    el("div", { role: "button" }, [], "Kirim"), // tidak match
    el("span", { dir: "auto" }, [], "View more replies"),
  ]);
  const out = runFindLoadMore(doc);
  assert.equal(out.length, 5, "5 tombol load-more terdeteksi, Kirim dilewati");
  assert.ok(out.every((b) => b.innerText !== "Kirim"));
});

test("findLoadMoreButtons IG: aria-label fallback saat innerText kosong", () => {
  const doc = el("div", {}, [
    el("div", { role: "button", "aria-label": "Muat komentar lainnya" }, [], ""),
    el("div", { role: "button", "aria-label": "Load more comments" }, [], ""),
    el("div", { role: "button", "aria-label": "Suka" }, [], ""), // tidak match
  ]);
  const out = runFindLoadMore(doc);
  assert.equal(out.length, 2, "deteksi lewat aria-label");
});

test("findLoadMoreButtons IG: elemen non-visible / rect kecil dilewati", () => {
  const hidden = el("div", { role: "button" }, [], "Muat komentar lainnya");
  hidden.getBoundingClientRect = () => ({ width: 0, height: 0 });
  const visible = el("div", { role: "button" }, [], "Load more comments");
  const doc = el("div", {}, [hidden, visible]);
  const out = runFindLoadMore(doc);
  assert.equal(out.length, 1, "hanya yang terlihat yang terdeteksi");
  assert.equal(out[0], visible);
});

test("findLoadMoreButtons IG: teks panjang >140 karakter dilewati", () => {
  const long = el("div", { role: "button" }, [], "Muat komentar lainnya ".repeat(10)); // >140
  const normal = el("div", { role: "button" }, [], "Muat komentar lainnya");
  const doc = el("div", {}, [long, normal]);
  const out = runFindLoadMore(doc);
  assert.equal(out.length, 1, "teks panjang dilewati");
  assert.equal(out[0], normal);
});

test("expandLoadMore IG: stopFlag mencegah klik lebih lanjut", async () => {
  const h = makeIgExpander();
  h.setSleep(async () => {}); // instant sleep
  h.setStop(true);
  const doc = el("div", {}, [
    el("div", { role: "button" }, [], "Muat komentar lainnya"),
    el("div", { role: "button" }, [], "Load more comments"),
  ]);
  const realDoc = globalThis.document;
  globalThis.document = makeDocument(doc);
  try {
    const n = await h.expandLoadMore();
    assert.equal(n, 0, "stopFlag aktif → tidak ada yang diklik");
  } finally {
    globalThis.document = realDoc;
  }
});
