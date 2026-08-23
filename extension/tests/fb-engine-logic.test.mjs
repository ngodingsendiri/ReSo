/**
 * Unit tests untuk logika murni engine Facebook (inject-fb.js):
 * fbIdB64 / fbIdsMatch / normalizeFeedbackId / buildSyntheticPaginationTemplates.
 * Pure ESM — node --test, zero deps. Fungsi diekstrak langsung dari source
 * (brace-counting) dan dieksekusi dengan stub minimal, sehingga perbaikan
 * engine apa pun di masa depan langsung ter-uji di sini.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { el, makeDocument } from "./dom-fixture.mjs";

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "inject-fb.js"),
  "utf8"
);

function extract(fnName) {
  const idx = src.indexOf(`function ${fnName}(`);
  assert.ok(idx >= 0, `function ${fnName} not found in inject-fb.js`);
  // Pertahankan modifier `async` (fungsi seperti paginateGraphql memakai
  // `await` — tanpa ini ekstraksi jadi fungsi sinkron yang tak valid).
  const start = idx - (src.slice(Math.max(0, idx - 6), idx) === "async " ? 6 : 0);
  const openIdx = src.indexOf("{", start);
  // Brace-counting STRING-AWARE: brace di dalam string ("..." / '...'),
  // komentar (// dan /* */), dan regex literal /.../ tidak dihitung —
  // ekstraktor naif rusak oleh regex ber-brace seperti /[\s\S]{0,1500}?/
  // di extractGraphqlNames.
  let depth = 0;
  let i = openIdx;
  let inStr = null; // '"' | "'" | null
  let inLine = false;
  let inBlock = false;
  let inRegex = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLine) {
      if (ch === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (inRegex) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "/") inRegex = false;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "/") {
      // Heuristik regex vs pembagian: '/' setelah identifier/angka/penutup
      // `) ] }` adalah pembagian, setelah operator/awal adalah regex.
      const prev = src[i - 1];
      if (!prev || !/[A-Za-z0-9_$)\]}]/.test(prev)) inRegex = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(depth === 0, `brace tidak seimbang saat ekstraksi ${fnName}`);
  return src.slice(start, i + 1);
}

const b64 = (s) => Buffer.from(s, "binary").toString("base64");
const atob = (s) => Buffer.from(s, "base64").toString("binary");

const helpers = new Function(
  "btoa",
  "atob",
  `${extract("fbIdB64")}
   ${extract("fbIdsMatch")}
   ${extract("normalizeFeedbackId")}
   return { fbIdB64, fbIdsMatch, normalizeFeedbackId };`
)(b64, atob);

const { fbIdB64, fbIdsMatch, normalizeFeedbackId } = helpers;

// Nilai nyata dari laporan user (permalink album kolektif):
// https://www.facebook.com/photo?fbid=1483436860484357&set=pcb.1483436933817683
const REAL_ID = "1483436860484357";
const REAL_B64 = b64(`feedback:${REAL_ID}`);

// ===================== fbIdB64 =====================
test("fbIdB64: id mentah → base64 Relay feedback:<id>", () => {
  assert.equal(fbIdB64(REAL_ID), REAL_B64);
  assert.equal(fbIdB64(REAL_ID), "ZmVlZGJhY2s6MTQ4MzQzNjg2MDQ4NDM1Nw==");
  assert.notEqual(fbIdB64(REAL_ID), REAL_ID); // benar-benar ditransformasi
});

test("fbIdB64: non-string / empty dipertahankan", () => {
  assert.equal(fbIdB64(null), null);
  assert.equal(fbIdB64(""), "");
});

// ===================== fbIdsMatch =====================
test("fbIdsMatch: cocok raw ↔ base64 dua arah", () => {
  assert.equal(fbIdsMatch(REAL_ID, REAL_B64), true);
  assert.equal(fbIdsMatch(REAL_B64, REAL_ID), true);
  assert.equal(fbIdsMatch(REAL_ID, REAL_ID), true);
});

test("fbIdsMatch: id berbeda / kosong → false", () => {
  assert.equal(fbIdsMatch(REAL_ID, b64("feedback:9999999999999999")), false);
  assert.equal(fbIdsMatch("", REAL_B64), false);
  assert.equal(fbIdsMatch(REAL_ID, null), false);
});

// ===================== normalizeFeedbackId =====================
test("normalizeFeedbackId: base64 Relay → id mentah", () => {
  assert.equal(normalizeFeedbackId(REAL_B64), REAL_ID);
});

test("normalizeFeedbackId: id mentah / kecil / non-string tetap apa adanya", () => {
  assert.equal(normalizeFeedbackId(REAL_ID), REAL_ID);
  assert.equal(normalizeFeedbackId("12345"), "12345");
  assert.equal(normalizeFeedbackId(null), null);
});

// ===================== PAGINATION_DOC_IDS =====================
test("PAGINATION_DOC_IDS: 3 kandidat dari scraper publik 2024–2026", () => {
  const m = src.match(/const PAGINATION_DOC_IDS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(m, "PAGINATION_DOC_IDS tidak ditemukan");
  const ids = [...m[1].matchAll(/"(\d{10,})"/g)].map((x) => x[1]);
  assert.ok(ids.includes("25399415259725176"), "doc_id 2026 hilang");
  assert.ok(ids.includes("5676025945801633"), "doc_id 2025 hilang");
  assert.ok(ids.includes("4712008195539492"), "doc_id 2024 hilang");
  assert.equal(ids.length, 3, "harus tepat 3 kandidat");
});

// ===================== Template sintetik =====================
const DOC_IDS = ["25399415259725176", "5676025945801633", "4712008195539492"];

function buildSynth(storedDocId) {
  const fnSrc = [
    "const PAGINATION_DOC_IDS = " + JSON.stringify(DOC_IDS) + ";",
    extract("fbIdB64"),
    `function feedbackIdsFromUrl() { return ["${REAL_ID}"]; }`,
    storedDocId
      ? `function bestStoredPaginationTemplate() { return { doc_id: "${storedDocId}" }; }`
      : `function bestStoredPaginationTemplate() { return null; }`,
    extract("buildSyntheticPaginationTemplates"),
    "return buildSyntheticPaginationTemplates();",
  ].join("\n");
  return new Function("btoa", fnSrc)(b64);
}

test("Synthetic: 3 kandidat + doc_id + feedbackID Relay + Semua Komentar", () => {
  const synth = buildSynth(null);
  assert.equal(synth.length, 3);
  for (const t of synth) {
    assert.match(t.params.doc_id, /^\d{10,}$/);
    assert.equal(t.variables.feedbackID, REAL_B64);
    assert.equal(t.variables.sortKey, "RANKED_UNFILTERED");
    assert.equal(t.variables.topLevelViewOption, "RANKED_UNFILTERED");
    assert.equal(
      t.variables.commentsIntentToken,
      "RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1"
    );
    assert.equal(t.variables.includeNestedComments, true);
    assert.equal(t.variables.isPaginating, true);
    assert.equal(t.url, "https://www.facebook.com/api/graphql/");
    assert.equal(t.friendlyName, "CometUFICommentsProviderPaginationQuery");
  }
});

test("Synthetic: doc_id tersimpan diprioritaskan di kandidat pertama", () => {
  const synth = buildSynth("STORED_DOC_ID_123");
  assert.equal(synth[0].params.doc_id, "STORED_DOC_ID_123");
  // id dari URL tetap dipakai untuk semua kandidat (anti salah post)
  for (const t of synth) assert.equal(t.variables.feedbackID, REAL_B64);
});

// ===================== findPageInfo (top-level vs balasan tertanam) =====================
// DFS lama mengembalikan page_info PERTAMA yang ditemukan; karena `edges`
// disimpan sebelum `page_info` di objek koneksi Relay, koneksi balasan yang
// tertanam di dalam edges selalu ditemukan lebih dulu → pagination memakai
// cursor/has_next_page milik koneksi BALASAN (berhenti prematur di halaman 1
// atau memakai cursor yang salah). Fix: kumpulkan semua kandidat, pilih yang
// milik koneksi TOP-LEVEL (bukan sub-pohon balasan, edges terbanyak).

const findPageInfo = new Function(
  `${extract("findPageInfo")}\nreturn findPageInfo;`
)();

/** Bentuk respons Relay: koneksi top-level dengan edges + page_info. */
function relayPayload({ topHasNext, topCursor, replyHasNext, replyCursor }) {
  return {
    data: {
      feedback: {
        id: "feedback:1",
        topLevelComments: {
          count: 100,
          edges: [
            {
              cursor: "c1",
              node: {
                __typename: "Comment",
                feedback: {
                  id: "feedback:2",
                  replies_connection: {
                    edges: [{ cursor: "r1", node: { __typename: "Comment" } }],
                    page_info: {
                      has_next_page: replyHasNext,
                      end_cursor: replyCursor,
                    },
                  },
                },
              },
            },
          ],
          page_info: { has_next_page: topHasNext, end_cursor: topCursor },
          total_count: 100,
        },
      },
    },
  };
}

test("findPageInfo: balasan tertanam TIDAK menang — top-level dipilih", () => {
  // Kasus audit: balasan tertanam has_next_page:false (sudah tuntas) tapi
  // top-level masih punya halaman berikutnya. DFS lama → {hasNext:false} →
  // run berhenti "complete" di halaman 1. Fix → {hasNext:true, endCursor:TOP3}.
  const r = findPageInfo(
    relayPayload({ topHasNext: true, topCursor: "TOP3", replyHasNext: false, replyCursor: null })
  );
  assert.deepEqual(r, { hasNext: true, endCursor: "TOP3" });
});

test("findPageInfo: balasan tertanam ber-cursor pun tidak menang", () => {
  // Varian lebih bahaya: koneksi balasan has_next_page:true ber-cursor — DFS
  // lama akan mem-paginate query TOP-LEVEL pakai cursor BALASAN. Fix harus
  // tetap memilih page_info top-level.
  const r = findPageInfo(
    relayPayload({ topHasNext: true, topCursor: "TOP5", replyHasNext: true, replyCursor: "R2" })
  );
  assert.deepEqual(r, { hasNext: true, endCursor: "TOP5" });
});

test("findPageInfo: tanpa balasan tertanam tetap bekerja", () => {
  const payload = relayPayload({
    topHasNext: false,
    topCursor: null,
    replyHasNext: false,
    replyCursor: null,
  });
  payload.data.feedback.topLevelComments.edges[0].node.feedback.replies_connection =
    null;
  const r = findPageInfo(payload);
  assert.deepEqual(r, { hasNext: false, endCursor: null });
});

test("findPageInfo: has_next_page === 1 (numerik) tetap dikenali", () => {
  const payload = relayPayload({
    topHasNext: false,
    topCursor: null,
    replyHasNext: false,
    replyCursor: null,
  });
  payload.data.feedback.topLevelComments.page_info = {
    has_next_page: 1,
    end_cursor: "TOP9",
  };
  const r = findPageInfo(payload);
  assert.deepEqual(r, { hasNext: true, endCursor: "TOP9" });
});

test("findPageInfo: koneksi dengan edges terbanyak menang", () => {
  // Dua koneksi top-level-ish: `comments` (edges kecil) vs `topLevelComments`
  // (edges besar = koneksi utama yang di-paginate).
  const payload = {
    data: {
      feedback: {
        comments: {
          edges: [{ cursor: "x", node: { __typename: "Comment" } }],
          page_info: { has_next_page: true, end_cursor: "SMALL" },
        },
        topLevelComments: {
          edges: [
            { cursor: "a", node: { __typename: "Comment" } },
            { cursor: "b", node: { __typename: "Comment" } },
            { cursor: "c", node: { __typename: "Comment" } },
          ],
          page_info: { has_next_page: true, end_cursor: "BIG" },
        },
      },
    },
  };
  const r = findPageInfo(payload);
  assert.deepEqual(r, { hasNext: true, endCursor: "BIG" });
});

test("findPageInfo: bentuk non-koneksi (page_info telanjang) tetap terdeteksi", () => {
  const payload = { data: { some: { page_info: { has_next_page: true, end_cursor: "X1" } } } };
  const r = findPageInfo(payload);
  assert.deepEqual(r, { hasNext: true, endCursor: "X1" });
});

test("findPageInfo: tanpa page_info sama sekali → null", () => {
  assert.equal(findPageInfo({ data: { feedback: { id: "1" } } }), null);
  assert.equal(findPageInfo(null), null);
  assert.equal(findPageInfo("nope"), null);
});

// ===================== feedbackIdFromTemplateVars / isTargetCommentResponse =====================
// activeFeedbackId (kunci anti kontaminasi lintas post) diturunkan dari
// template pagination TOP-LEVEL. Fallback ke `id` untuk bentuk lama — tanpa
// itu, di halaman feed (URL tanpa id) filter menolak SEMUA respons
// ber-feedbackID dan nama dari request FB asli terbuang di jalur always-on
// (replay engine tetap jalan, tapi harvest halaman hilang).

const feedbackIdFromTemplateVars = new Function(
  `${extract("feedbackIdFromTemplateVars")}\nreturn feedbackIdFromTemplateVars;`
)();

function makeTargetChecker(urlIds, activeId) {
  const fnSrc = [
    extract("fbIdB64"),
    extract("fbIdsMatch"),
    `let activeFeedbackId = ${JSON.stringify(activeId ?? null)};`,
    `function feedbackIdsFromUrl() { return ${JSON.stringify(urlIds)}; }`,
    extract("isTargetCommentResponse"),
    "return isTargetCommentResponse;",
  ].join("\n");
  return new Function("btoa", "atob", fnSrc)(b64, atob);
}

test("fbTemplateId: feedbackID menang atas id", () => {
  assert.equal(
    feedbackIdFromTemplateVars({ feedbackID: "FB1", id: "IDX" }),
    "FB1"
  );
});

test("fbTemplateId: feedback_id fallback kedua", () => {
  assert.equal(
    feedbackIdFromTemplateVars({ feedback_id: "FB2", id: "IDX" }),
    "FB2"
  );
});

test("fbTemplateId: fallback ke id (bentuk lama) — mentah & base64 Relay", () => {
  assert.equal(
    feedbackIdFromTemplateVars({ id: REAL_ID }),
    REAL_ID
  );
  assert.equal(feedbackIdFromTemplateVars({ id: REAL_B64 }), REAL_B64);
});

test("fbTemplateId: kosong / non-objek → kosong", () => {
  assert.equal(feedbackIdFromTemplateVars({}), "");
  assert.equal(feedbackIdFromTemplateVars(null), "");
  assert.equal(feedbackIdFromTemplateVars(undefined), "");
  assert.equal(feedbackIdFromTemplateVars("x"), "");
});

test("target-check: URL id cocok (raw ↔ base64), id asing ditolak", () => {
  const check = makeTargetChecker([REAL_ID], null);
  assert.equal(check([REAL_B64]), true); // URL raw ↔ request base64 Relay
  assert.equal(check([b64("feedback:9999999999999999")]), false);
});

test("target-check: feed tanpa URL id — activeFeedbackId dari template.id menerima respons sendiri", () => {
  // Skenario audit: URL feed tanpa id. Dulu activeFeedbackId null (template
  // id-only tak diturunkan) → SEMUA respons ber-feedbackID ditolak. Kini
  // turunan feedbackIdFromTemplateVars + normalizeFeedbackId mengisinya.
  const derived = normalizeFeedbackId(
    feedbackIdFromTemplateVars({ id: REAL_B64 })
  );
  assert.equal(derived, REAL_ID);
  const check = makeTargetChecker([], derived);
  assert.equal(check([REAL_ID]), true); // respons postingan sendiri diterima
  assert.equal(check([b64("feedback:9999999999999999")]), false); // postingan lain ditolak
});

test("target-check: request tanpa feedback id selalu diproses", () => {
  const check = makeTargetChecker([], null);
  assert.equal(check([]), true);
  assert.equal(check(null), true);
  assert.equal(check(undefined), true);
});

// ===================== paginateGraphql end-to-end (findPageInfo fix) =====================
// Dua halaman Relay dengan balasan tertanam: page_info koneksi BALASAN (decoy)
// tidak boleh menang atas page_info top-level — pagination harus lanjut ke
// halaman 2 dengan cursor top-level. findPageInfo ASLI dieksekusi di dalam
// stub graphqlReplayWithBackoff, jadi test ini mengunci interaksi fix secara
// end-to-end, bukan hanya unit findPageInfo.

async function makePaginator(candidates, pages, opts = {}) {
  // opts: { replyIds, replyPages, lastReplyKey, replyTpl } untuk fase balasan.
  const fnSrc = [
    extract("forceAllComments"),
    extract("feedbackIdFromTemplateVars"),
    extract("normalizeFeedbackId"),
    extract("findPageInfo"),
    extract("setCursorOnVariables"),
    "const REQUEST_BUDGET = 350;",
    "let requestBudget = 0;",
    "const nameMap = new Map();",
    "let stopFlag = false;",
    "let running = true;",
    "let includeReplies = true;",
    "let lastReplyKey = OPTS.lastReplyKey;",
    "const gqlTemplates = new Map();",
    "if (OPTS.replyTpl) gqlTemplates.set(OPTS.lastReplyKey, OPTS.replyTpl);",
    "let activeFeedbackId = null;",
    "let engineMode = 'idle';",
    "let lastNewAt = 0;",
    "const posts = [];",
    "const replyCalls = [];",
    "const topCursors = [];",
    "function snapshot() { return [...nameMap.values()]; }",
    "function post(type, payload) { posts.push({ type, ...payload }); }",
    "const sleepWhile = async () => true;",
    // Stub backoff. Halaman top-level bergantung cursor ("TOP1") — kalau
    // findPageInfo keliru memilih decoy balasan, cursor salah dan test gagal.
    // Jalur balasan dirutekan via friendlyName reply, cursor per balasan
    // (null → "RC1" → selesai); tiap panggilan balasan dicatat ke replyCalls.
    "const graphqlReplayWithBackoff = async (tpl, cursor) => {",
    "  const isReply = /reply|replies/i.test(String(tpl && tpl.friendlyName) || '');",
    "  if (isReply) {",
    "    const raw = cursor === 'RC1' ? OPTS.replyPages[1] : OPTS.replyPages[0];",
    "    replyCalls.push({",
    "      fbId: (tpl.variables && (tpl.variables.id ?? tpl.variables.feedbackID)) ?? null,",
    "      cursor,",
    "    });",
    "    const page = findPageInfo(JSON.parse(JSON.stringify(raw)));",
    "    return { ok: true, status: 200, page, replyIds: [], textSlice: '' };",
    "  }",
    "  topCursors.push(cursor);",
    "  const raw = cursor === 'TOP1' ? PAGES[1] : PAGES[0];",
    "  const page = findPageInfo(JSON.parse(JSON.stringify(raw)));",
    "  return { ok: true, status: 200, page, replyIds: OPTS.replyIds || [], textSlice: '' };",
    "};",
    "const orderedCandidates = () => CANDIDATES;",
    extract("paginateGraphql"),
    "return { run: paginateGraphql, posts, getActive: () => activeFeedbackId, replyCalls, topCursors };",
  ].join("\n");
  // paginateGraphql memakai `await` → body harus async (AsyncFunction), dan
  // memanggilnya mengembalikan Promise — await hasilnya di sini.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return await new AsyncFunction(
    "btoa",
    "atob",
    "PAGES",
    "CANDIDATES",
    "OPTS",
    fnSrc
  )(b64, atob, pages, candidates, opts);
}

const PAG_CANDIDATES = [
  {
    url: "https://www.facebook.com/api/graphql/",
    params: { doc_id: "25399415259725176" },
    variables: { feedbackID: REAL_B64, sortKey: "RANKED_THREADED" },
    friendlyName: "CometUFICommentsProviderPaginationQuery",
    capturedAt: 0,
  },
];

test("paginateGraphql: balasan tertanam tidak menghentikan pagination (2 halaman)", async () => {
  // Halaman 1: decoy balasan has_next_page:false (tuntas) — findPageInfo lama
  // akan memakainya → run berhenti "complete" di halaman 1 (~20 nama).
  // Halaman 2: top-level selesai. Fix → lanjut dengan cursor top-level.
  const pages = [
    relayPayload({ topHasNext: true, topCursor: "TOP1", replyHasNext: false, replyCursor: null }),
    relayPayload({ topHasNext: false, topCursor: null, replyHasNext: false, replyCursor: null }),
  ];
  const { run, posts, getActive } = await makePaginator(PAG_CANDIDATES, pages);
  const res = await run(30_000);
  assert.equal(res.mode, "graphql");
  assert.equal(res.reason, "complete");
  assert.equal(res.pages, 2);
  // activeFeedbackId diturunkan & dinormalisasi dari variabel template (base64 → raw)
  assert.equal(getActive(), REAL_ID);
  // Dua halaman benar-benar diambil, bukan berhenti di 1
  const pagePosts = posts.filter((p) => /^GraphQL halaman \d+/.test(p.message || ""));
  assert.equal(pagePosts.length, 2);
  assert.match(pagePosts[0].message, /halaman 1/);
  assert.match(pagePosts[1].message, /halaman 2/);
});

test("paginateGraphql: decoy balasan has_next_page:true tanpa cursor → tetap lanjut", async () => {
  // Varian lebih bahaya: decoy has_next_page:true TANPA end_cursor — findPageInfo
  // lama akan masuk cabang "hasNext && !endCursor" → idle di halaman 1.
  const pages = [
    relayPayload({ topHasNext: true, topCursor: "TOP1", replyHasNext: true, replyCursor: null }),
    relayPayload({ topHasNext: false, topCursor: null, replyHasNext: false, replyCursor: null }),
  ];
  const { run, posts } = await makePaginator(PAG_CANDIDATES, pages);
  const res = await run(30_000);
  assert.equal(res.reason, "complete");
  assert.equal(res.pages, 2);
  const pagePosts = posts.filter((p) => /^GraphQL halaman \d+/.test(p.message || ""));
  assert.equal(pagePosts.length, 2);
});

test("paginateGraphql: decoy balasan has_next_page:true BER-cursor → cursor top-level dipakai", async () => {
  // Varian paling berbahaya: koneksi balasan has_next_page:true DENGAN cursor
  // (DECOY1). findPageInfo lama akan mem-paginate query TOP-LEVEL memakai
  // cursor BALASAN — loop tetap "lanjut" tapi halaman 1 diambil ulang. Stub
  // mencatat cursor tiap panggilan top-level: fix harus memakai
  // [null, "TOP1"], bukan [null, "DECOY1"].
  const pages = [
    relayPayload({ topHasNext: true, topCursor: "TOP1", replyHasNext: true, replyCursor: "DECOY1" }),
    relayPayload({ topHasNext: false, topCursor: null, replyHasNext: false, replyCursor: null }),
  ];
  const { run, posts, topCursors } = await makePaginator(PAG_CANDIDATES, pages);
  const res = await run(30_000);
  assert.equal(res.reason, "complete");
  assert.equal(res.pages, 2);
  // Diskriminator: [probe (null), halaman 1 (null), halaman 2 (TOP1)] — kalau
  // findPageInfo keliru memilih page_info balasan, panggilan halaman 2 memakai
  // DECOY1 (halaman 1 diambil ulang) — test gagal.
  assert.deepEqual(topCursors, [null, null, "TOP1"]);
  const pagePosts = posts.filter((p) => /^GraphQL halaman \d+/.test(p.message || ""));
  assert.equal(pagePosts.length, 2);
  assert.match(pagePosts[1].message, /halaman 2/);
});

test("paginateGraphql: antrean balasan diproses dengan cursor balasan masing-masing", async () => {
  // Fase balasan: replyIds dari halaman top-level masuk replyQueue → di-dedupe
  // → tiap balasan unik di-paginate dengan template reply (cursor null → RC1 →
  // selesai). Template reply memakai `id` (di-inject per balasan) — bentuk
  // query balasan yang sebenarnya.
  const pages = [
    relayPayload({ topHasNext: true, topCursor: "TOP1", replyHasNext: false, replyCursor: null }),
    relayPayload({ topHasNext: false, topCursor: null, replyHasNext: false, replyCursor: null }),
  ];
  const replyPage1 = {
    data: {
      replies: {
        edges: [{ cursor: "r1", node: { __typename: "Comment" } }],
        page_info: { has_next_page: true, end_cursor: "RC1" },
      },
    },
  };
  const replyPage2 = {
    data: {
      replies: {
        edges: [{ cursor: "r2", node: { __typename: "Comment" } }],
        page_info: { has_next_page: false, end_cursor: null },
      },
    },
  };
  const replyTpl = {
    url: "https://www.facebook.com/api/graphql/",
    params: { doc_id: "25399415259725176" },
    variables: { id: "PLACEHOLDER", count: 10 },
    friendlyName: "CometUFIRepliesProviderQuery",
    capturedAt: 0,
  };
  const { run, posts, replyCalls } = await makePaginator(PAG_CANDIDATES, pages, {
    replyIds: ["R1", "R1", "R2"], // duplikat (muncul di 2 halaman top-level)
    replyPages: [replyPage1, replyPage2],
    lastReplyKey: "CometUFIRepliesProviderQuery",
    replyTpl,
  });
  const res = await run(30_000);
  assert.equal(res.reason, "complete");
  assert.equal(res.pages, 2);

  // Fase balasan berjalan: post pembuka antrean + satu post per balasan unik
  const replyPosts = posts.filter((p) => p.postHint === "replies");
  // Pembuka memakai ukuran antrean MENTAH (sebelum dedupe): 2 halaman
  // top-level × 3 replyIds = 6.
  assert.ok(
    replyPosts.some((p) => /^Mengambil balasan… antrean 6/.test(p.message || "")),
    "post pembuka antrean hilang"
  );
  assert.equal(
    replyPosts.filter((p) => /^Balasan…/.test(p.message || "")).length,
    2,
    "harus ada satu post Balasan per balasan unik"
  );

  // Antrean unik 2 (R1,R1,R2 → R1,R2); tiap balasan 2 halaman reply dengan
  // cursor sendiri: null → RC1 → selesai (tidak boleh memakai cursor top-level).
  const fbIds = [...new Set(replyCalls.map((c) => c.fbId))].sort();
  assert.deepEqual(fbIds, ["R1", "R2"]);
  assert.equal(replyCalls.length, 4);
  for (const fbId of ["R1", "R2"]) {
    const cursors = replyCalls
      .filter((c) => c.fbId === fbId)
      .map((c) => c.cursor);
    assert.deepEqual(cursors, [null, "RC1"]);
  }
});

// ===================== isProfileHref — profil anggota grup =====================
// Gap DOM fallback: link penulis komentar di post grup berbentuk
// /groups/<gid>/user/<uid> yang sebelumnya ditolak oleh pengecualian
// `/groups/` — jadi nama penulis di post grup tidak pernah ter-harvest lewat
// DOM. Fix: struktur `/user/<uid numeric>` = profil pengguna → diizinkan;
// halaman grup lain (beranda/posting/foto) tetap ditolak.

const isProfileHref = new Function(
  `${extract("isProfileHref")}\nreturn isProfileHref;`
)();

test("isProfileHref: profil anggota grup /groups/<gid>/user/<uid> diterima", () => {
  assert.equal(
    isProfileHref("https://www.facebook.com/groups/1234567890123456/user/987654321098765/")
      ,
    true
  );
  assert.equal(isProfileHref("/groups/1234567890/user/987654321"), true); // relatif
  assert.equal(
    isProfileHref("https://www.facebook.com/groups/123/user/456/?ref=group_header"),
    true
  );
  assert.equal(
    isProfileHref("https://www.facebook.com/groups/123/user/456/posts/"),
    true // tab postingan milik pengguna itu sendiri
  );
});

test("isProfileHref: halaman grup lain tetap ditolak", () => {
  assert.equal(isProfileHref("https://www.facebook.com/groups/1234567890/"), false);
  assert.equal(isProfileHref("https://www.facebook.com/groups/123/posts/456"), false);
  assert.equal(isProfileHref("https://www.facebook.com/groups/123/permalink/456"), false);
  assert.equal(isProfileHref("/groups/123/events/"), false);
});

test("isProfileHref: uid non-numerik ditolak (bukan struktur profil sah)", () => {
  assert.equal(isProfileHref("https://www.facebook.com/groups/123/user/john.doe"), false);
  assert.equal(isProfileHref("/groups/123/user/"), false); // tanpa uid
});

test("isProfileHref: bentuk profil lain tetap bekerja (regression)", () => {
  assert.equal(isProfileHref("https://www.facebook.com/profile.php?id=12345"), true);
  assert.equal(isProfileHref("https://www.facebook.com/john.doe"), true);
  assert.equal(isProfileHref("https://www.facebook.com/posts/123"), false);
  assert.equal(isProfileHref("https://www.facebook.com/photo.php?fbid=1&comment_id=2"), false);
  assert.equal(isProfileHref("javascript:void(0)"), false);
  assert.equal(isProfileHref("#"), false);
  assert.equal(isProfileHref(""), false);
});

// ===================== scrapeDomNames (mode scroll — DOM fallback) =====================
// Fallback mode scroll Facebook: tiga lintasan — (1) elemen aria-label dengan
// pola "Comment by X"/"X commented", (2) role=article komentar (link profil,
// termasuk profil anggota grup /groups/<gid>/user/<uid>), (3) tombol
// Reply/Balas → walk-up ke baris → link profil. Harness memakai fungsi ASLI
// (normalizeCommentName → addName → nameMap; qsa/isVisible/isProfileHref asli)
// dengan fixture DOM (tests/dom-fixture.mjs) — yang di-assert adalah nama
// yang BENAR-BENAR masuk nameMap.

function makeFbScraper() {
  const fnSrc = [
    extract("normalizeCommentName"),
    extract("isProfileHref"),
    "const nameMap = new Map();",
    "let lastNewAt = 0;",
    "let postRoot = null;",
    extract("addName"),
    extract("qsa"),
    extract("isVisible"),
    extract("scrapeDomNames"),
    "return { scrapeDomNames, names: () => [...nameMap.values()] };",
  ].join("\n");
  return new Function(fnSrc)();
}

/** Jalankan scraper asli dengan document fixture (semua elemen terlihat). */
function runScrape(root, docRoot) {
  const realDoc = globalThis.document;
  const realCss = globalThis.getComputedStyle;
  globalThis.document = makeDocument(docRoot ?? root);
  globalThis.getComputedStyle = () => ({
    visibility: "visible",
    display: "block",
    opacity: "1",
  });
  try {
    const { scrapeDomNames, names } = makeFbScraper();
    return { added: scrapeDomNames(root), names: names() };
  } finally {
    globalThis.document = realDoc;
    globalThis.getComputedStyle = realCss;
  }
}

test("scrapeDom FB: pola aria-label Comment by / X commented / Balasan oleh di-harvest", () => {
  const doc = el("div", {}, [
    el("div", { "aria-label": "Comment by Andi Pratama" }, [], ""),
    el("div", { "aria-label": "Balasan oleh Budi Santoso" }, [], ""),
    el("div", { "aria-label": "Citra commented" }, [], ""),
    el("div", { "aria-label": "Dedi dari Jakarta" }, [], ""), // bukan pola → skip
    el("div", { "aria-label": "x" }, [], ""), // <3 karakter → skip
  ]);
  const { added, names } = runScrape(null, doc);
  assert.equal(added, 3);
  assert.deepEqual([...names].sort(), ["Andi Pratama", "Budi Santoso", "Citra"]);
});

test("scrapeDom FB: label multi-bagian dipotong di separator (2+ spasi / titik-tengah)", () => {
  const doc = el("div", {}, [
    el("div", { "aria-label": "Comment by Andi  Pratama · dijawab" }, [], ""),
    el("div", { "aria-label": "Reply by Budi • 2 hari lalu" }, [], ""),
  ]);
  const { names } = runScrape(null, doc);
  assert.deepEqual([...names].sort(), ["Andi", "Budi"]);
});

test("scrapeDom FB: role=article komentar — link profil + tombol Like/Reply, post itu sendiri dilewati", () => {
  const doc = el("div", {}, [
    // Komentar dengan indikator Like+Reply → link penulis di-harvest
    el("div", { role: "article" }, [
      el("div", { role: "button" }, [], "Like"),
      el("div", { role: "button" }, [], "Reply"),
      el("a", { href: "/dian.putri" }, [], "Dian Putri"),
    ]),
    // Post itu sendiri (bukan komentar) → dilewati walau punya link profil
    el("div", { role: "article", "aria-label": "Post by Admin Grup" }, [
      el("a", { href: "/admin" }, [], "Admin Grup"),
    ]),
    // Artikel tanpa indikator komentar → dilewati
    el("div", { role: "article" }, [el("span", {}, [], "konten biasa")]),
  ]);
  const { added, names } = runScrape(null, doc);
  assert.equal(added, 1);
  assert.deepEqual([...names].sort(), ["Dian Putri"]);
});

test("scrapeDom FB: post GRUP — link /groups/<gid>/user/<uid> di-harvest (fix isProfileHref)", () => {
  const doc = el("div", {}, [
    el("div", { role: "article" }, [
      el("div", { role: "button" }, [], "Like"),
      el("div", { role: "button" }, [], "Balas"),
      el("a", { href: "/groups/123456789/user/987654321" }, [], "Member Grup"),
    ]),
    // Bukan struktur profil anggota grup → tetap ditolak (halaman grup lain)
    el("div", { role: "article" }, [
      el("div", { role: "button" }, [], "Like"),
      el("div", { role: "button" }, [], "Reply"),
      el("a", { href: "/groups/123456789/posts/111" }, [], "Postingan Grup"),
    ]),
  ]);
  const { added, names } = runScrape(null, doc);
  assert.equal(added, 1);
  assert.deepEqual([...names].sort(), ["Member Grup"]);
});

test("scrapeDom FB: tombol Balas di baris aksi — walk-up ke baris → link penulis di-harvest", () => {
  const doc = el("div", {}, [
    el("div", { role: "button" }, [], "Balas"), // tombol reply di baris aksi
    el("a", { href: "/budi" }, [], "Budi Santoso"), // link penulis di baris yang sama
  ]);
  const { added, names } = runScrape(null, doc);
  assert.equal(added, 1);
  assert.deepEqual([...names].sort(), ["Budi Santoso"]);
});

test("scrapeDom FB: dedupe lintas lintasan (label + article) — nama sama masuk sekali", () => {
  const doc = el("div", {}, [
    el("div", { "aria-label": "Comment by Endah" }, [], ""),
    el("div", { role: "article" }, [
      el("div", { role: "button" }, [], "Like"),
      el("div", { role: "button" }, [], "Reply"),
      el("a", { href: "/endah" }, [], "Endah"),
    ]),
  ]);
  const { added, names } = runScrape(null, doc);
  assert.equal(added, 1);
  assert.deepEqual([...names].sort(), ["Endah"]);
});

test("scrapeDom FB: scope postRoot — elemen di luar scope tidak di-harvest", () => {
  const post = el("div", {}, [
    el("div", { "aria-label": "Comment by Fitri" }, [], ""),
  ]);
  const outside = el("div", { "aria-label": "Comment by Galuh" }, [], "");
  const doc = el("div", {}, [post, outside]);
  const { added, names } = runScrape(post, doc);
  assert.equal(added, 1);
  assert.deepEqual([...names].sort(), ["Fitri"]);
});

// ===================== findExpandButtons (ekspansi komentar mode scroll) =====================
// Tombol "Lihat komentar lain"/"Lihat balasan"/"View more comments" dkk yang
// memicu ekspansi komentar saat mode scroll (call site runExtract & tunggu
// template GraphQL). Catatan: findExpandButtons TIDAK melakukan walk-up
// (walk-up ada di scrapeDomNames lintasan 3, diuji di atas) — deteksi persis
// alurnya: qsa('[role="button"], div[tabindex="0"]', root) → isVisible →
// gabungan innerText+aria-label (whitespace dinormalisasi) → regex soft
// case-insensitive → batas panjang 120. Fungsi ASLI dieksekusi dengan fixture
// DOM (tests/dom-fixture.mjs); isVisible memakai getComputedStyle yang
// di-stub global (default terlihat, per-elemen via `el.__style`).

function makeFbExpander() {
  const fnSrc = [
    extract("qsa"),
    extract("isVisible"),
    extract("findExpandButtons"),
    "return { findExpandButtons };",
  ].join("\n");
  return new Function(fnSrc)();
}

/** Jalankan findExpandButtons asli dengan stub document + getComputedStyle. */
function runExpand(root, docRoot) {
  const realDoc = globalThis.document;
  const realCss = globalThis.getComputedStyle;
  globalThis.document = makeDocument(docRoot ?? root);
  globalThis.getComputedStyle = (el) =>
    el.__style || { visibility: "visible", display: "block", opacity: "1" };
  try {
    const { findExpandButtons } = makeFbExpander();
    return findExpandButtons(root);
  } finally {
    globalThis.document = realDoc;
    globalThis.getComputedStyle = realCss;
  }
}

const btnTexts = (btns) => btns.map((b) => b.innerText);

test("findExpandButtons FB: pola soft terdeteksi (urutan dokumen), teks biasa dilewati", () => {
  const doc = el("div", {}, [
    el("div", { role: "button" }, [], "Lihat komentar lain"),
    el("div", { role: "button" }, [], "Lihat balasan"),
    el("div", { role: "button" }, [], "View more comments"),
    el("div", { role: "button" }, [], "lihat selengkapnya"),
    el("div", { role: "button" }, [], "Tampilkan balasan"),
    el("div", { role: "button" }, [], "Kirim"), // tidak match regex soft
    el("div", { role: "button" }, [], "Previous comments"),
    el("div", { role: "button" }, [], "Lihat komentar lainnya"),
  ]);
  const out = runExpand(doc);
  assert.deepEqual(btnTexts(out), [
    "Lihat komentar lain",
    "Lihat balasan",
    "View more comments",
    "lihat selengkapnya",
    "Tampilkan balasan",
    "Previous comments",
    "Lihat komentar lainnya",
  ]);
});

test("findExpandButtons FB: aria-label fallback saat innerText kosong + gabungan keduanya", () => {
  const doc = el("div", {}, [
    el("div", { role: "button", "aria-label": "Lihat balasan" }, [], ""), // innerText kosong → aria-label
    el("div", { role: "button", "aria-label": "Lihat balasan" }, [], "Sembunyikan"), // gabungan cocok
    el("div", { role: "button", "aria-label": "Suka" }, [], "Lihat balasan"), // innerText cocok
  ]);
  const out = runExpand(doc);
  assert.equal(out.length, 3);
});

test("findExpandButtons FB: div[tabindex=0] ikut dipilih; elemen tanpa role/tabindex tidak", () => {
  const doc = el("div", {}, [
    el("div", { tabindex: "0" }, [], "lihat komentar sebelumnya"), // div[tabindex=0] → dipilih
    el("span", {}, [], "Lihat balasan"), // tanpa role, bukan div → tidak
    el("a", {}, [], "Lihat balasan"), // tanpa role, bukan div → tidak
    el("div", {}, [], "Lihat balasan"), // tanpa tabindex/role → tidak
  ]);
  const out = runExpand(doc);
  assert.equal(out.length, 1);
  assert.equal(out[0].innerText, "lihat komentar sebelumnya");
});

test("findExpandButtons FB: isVisible menggating — rect kecil / hidden / none / opacity 0 dilewati", () => {
  const hiddenRect = el("div", { role: "button" }, [], "Lihat balasan");
  hiddenRect.getBoundingClientRect = () => ({ width: 0, height: 0 });
  const hiddenVis = el("div", { role: "button" }, [], "Lihat balasan");
  hiddenVis.__style = { visibility: "hidden", display: "block", opacity: "1" };
  const hiddenDisp = el("div", { role: "button" }, [], "Lihat balasan");
  hiddenDisp.__style = { visibility: "visible", display: "none", opacity: "1" };
  const hiddenOp = el("div", { role: "button" }, [], "Lihat balasan");
  hiddenOp.__style = { visibility: "visible", display: "block", opacity: "0" };
  const visible = el("div", { role: "button" }, [], "Lihat balasan");
  const doc = el("div", {}, [hiddenRect, hiddenVis, hiddenDisp, hiddenOp, visible]);
  const out = runExpand(doc);
  assert.equal(out.length, 1, "hanya tombol terlihat yang terdeteksi");
  assert.equal(out[0], visible);
});

test("findExpandButtons FB: teks ≥120 karakter atau kosong dilewati walau mengandung pola", () => {
  const doc = el("div", {}, [
    el("div", { role: "button" }, [], "Lihat komentar lainnya ".repeat(8)), // 192 char → skip
    el("div", { role: "button" }, [], ""), // kosong → skip
    el("div", { role: "button" }, [], "Lihat balasan"),
  ]);
  const out = runExpand(doc);
  assert.equal(out.length, 1);
  assert.equal(out[0].innerText, "Lihat balasan");
});

test("findExpandButtons FB: scope postRoot — tombol di luar scope tidak terdeteksi", () => {
  const post = el("div", {}, [el("div", { role: "button" }, [], "Lihat balasan")]);
  const outside = el("div", { role: "button" }, [], "Lihat balasan");
  const doc = el("div", {}, [post, outside]);
  const out = runExpand(post, doc);
  assert.equal(out.length, 1);
  assert.equal(out[0].parent, post);
});

test("findExpandButtons FB: whitespace dinormalisasi sebelum regex (\n → spasi)", () => {
  const doc = el("div", {}, [
    el("div", { role: "button" }, [], "Lihat\nbalasan"), // → "Lihat balasan" → match
    el("div", { role: "button" }, [], "lihat   komentar   sebelumnya"), // multi-spasi → match
  ]);
  const out = runExpand(doc);
  assert.equal(out.length, 2);
});

// ===================== tryOpenComments (buka panel komentar, end-to-end) =====================
// Call site ekspansi nyata: sebelum mode scroll/GraphQL, engine membuka panel
// komentar saat post BELUM terbuka — scan elemen berlabel jumlah komentar
// ("12 komentar") atau ajakan lihat komentar ("Lihat semua komentar"), lalu
// scrollIntoView + click + sleep, dan berhenti true bila gqlTemplates terisi.
// Alur asli: scope sudah terbuka (>1 role=article) → true tanpa klik; selain
// itu qsa(selector lebar) → isVisible → regex COMMENT_COUNT/VIEW_COMMENTS
// (batas 120) → scrollIntoView + click → sleepWhile(700) → template? → true.
// Fungsi ASLI dieksekusi; `sleepWhile` di-stub (test bisa menyuntik template
// ke `gqlTemplates` saat sleep via setSleep), click/scrollIntoView dicatat di
// fixture (el._clickCount / el._scrolled).

function makeFbOpener() {
  const fnSrc = [
    extract("qsa"),
    extract("isVisible"),
    "const gqlTemplates = new Map();",
    "let sleepWhile = async () => {};",
    extract("tryOpenComments"),
    "return { tryOpenComments, gqlTemplates, setSleep: (fn) => { sleepWhile = fn; } };",
  ].join("\n");
  return new Function(fnSrc)();
}

/** Jalankan tryOpenComments asli dengan stub document + getComputedStyle. */
async function runOpen(h, root) {
  const realDoc = globalThis.document;
  const realCss = globalThis.getComputedStyle;
  globalThis.document = makeDocument(root);
  globalThis.getComputedStyle = (el) =>
    el.__style || { visibility: "visible", display: "block", opacity: "1" };
  try {
    return await h.tryOpenComments(root);
  } finally {
    globalThis.document = realDoc;
    globalThis.getComputedStyle = realCss;
  }
}

const clicks = (node) => node._clickCount || 0;

test("tryOpenComments FB: scope sudah terbuka (>1 role=article) → true TANPA klik", async () => {
  const post = el("div", {}, [
    el("div", { role: "article" }, [], "post"),
    el("div", { role: "article" }, [], "komentar 1"),
    el("div", { role: "article" }, [], "komentar 2"),
    el("div", { role: "button" }, [], "12 komentar"),
  ]);
  const h = makeFbOpener();
  const ok = await runOpen(h, post);
  assert.equal(ok, true, "panel sudah terbuka — tidak perlu klik apa pun");
  assert.equal(clicks(post.children[3]), 0);
});

test("tryOpenComments FB: jumlah komentar (COMMENT_COUNT) memicu klik, template kosong → false", async () => {
  const b1 = el("div", { role: "button" }, [], "12 komentar");
  const b2 = el("div", { role: "button" }, [], "1,2rb komentar");
  const b3 = el("div", { role: "button" }, [], "123 comments");
  const doc = el("div", {}, [b1, b2, b3]);
  const h = makeFbOpener();
  const ok = await runOpen(h, doc);
  assert.equal(ok, false, "tanpa template yang ter-capture, tetap lanjut dan return false");
  assert.equal(clicks(b1), 1);
  assert.equal(clicks(b2), 1);
  assert.equal(clicks(b3), 1);
  assert.ok(b1._scrolled >= 1 && b2._scrolled >= 1 && b3._scrolled >= 1, "scrollIntoView dipanggil sebelum klik");
});

test("tryOpenComments FB: VIEW_COMMENTS ('Lihat semua komentar'/'View all comments') memicu klik", async () => {
  const b1 = el("div", { role: "button" }, [], "Lihat semua komentar");
  const b2 = el("a", { role: "link" }, [], "View all comments"); // selector a[role=link]
  const b3 = el("span", { dir: "auto" }, [], "Lihat 3 komentar lainnya"); // selector span[dir=auto]
  const doc = el("div", {}, [b1, b2, b3]);
  const h = makeFbOpener();
  const ok = await runOpen(h, doc);
  assert.equal(ok, false);
  assert.equal(clicks(b1), 1);
  assert.equal(clicks(b2), 1);
  assert.equal(clicks(b3), 1);
});

test("tryOpenComments FB: teks non-pola / tersembunyi / ≥120 char tidak diklik", async () => {
  const longText = el("div", { role: "button" }, [], "Lihat semua komentar ".repeat(8)); // 160 char
  const hidden = el("div", { role: "button" }, [], "Lihat semua komentar");
  hidden.__style = { visibility: "hidden", display: "block", opacity: "1" };
  const noMatch = el("div", { role: "button" }, [], "Kirim komentar"); // bukan pola apa pun
  const total = el("div", { role: "button" }, [], "Total 12 komentar"); // COMMENT_COUNT butuh ^\d → tidak match
  const doc = el("div", {}, [longText, hidden, noMatch, total]);
  const h = makeFbOpener();
  const ok = await runOpen(h, doc);
  assert.equal(ok, false);
  assert.equal(clicks(longText), 0);
  assert.equal(clicks(hidden), 0);
  assert.equal(clicks(noMatch), 0);
  assert.equal(clicks(total), 0);
});

test("tryOpenComments FB: template ter-capture saat sleep → return true, elemen berikutnya TIDAK diklik", async () => {
  const b1 = el("div", { role: "button" }, [], "Lihat semua komentar");
  const b2 = el("div", { role: "button" }, [], "12 komentar");
  const doc = el("div", {}, [b1, b2]);
  const h = makeFbOpener();
  h.setSleep(async () => {
    h.gqlTemplates.set("t1", {}); // template muncul saat sleep (request GraphQL ter-capture)
  });
  const ok = await runOpen(h, doc);
  assert.equal(ok, true, "template terisi → berhenti segera");
  assert.equal(clicks(b1), 1);
  assert.equal(clicks(b2), 0, "elemen berikutnya tidak perlu diklik lagi");
});

test("tryOpenComments FB: error klik ditoleransi (try/catch) — elemen berikutnya tetap diproses", async () => {
  const bad = el("div", { role: "button" }, [], "Lihat semua komentar");
  bad.click = () => {
    throw new Error("element tidak bisa diklik");
  };
  const good = el("div", { role: "button" }, [], "12 komentar");
  const doc = el("div", {}, [bad, good]);
  const h = makeFbOpener();
  const ok = await runOpen(h, doc);
  assert.equal(ok, false);
  assert.equal(clicks(good), 1, "error di satu elemen tidak menghentikan loop");
});

test("tryOpenComments FB: tanpa scope → document; aria-label dihitung sebagai label", async () => {
  const doc = el("div", {}, [
    el("div", { role: "button", "aria-label": "Lihat semua komentar" }, [], ""),
    el("span", { "aria-label": "123 komentar" }, [], ""),
  ]);
  const h = makeFbOpener();
  const realDoc = globalThis.document;
  const realCss = globalThis.getComputedStyle;
  globalThis.document = makeDocument(doc);
  globalThis.getComputedStyle = (el) =>
    el.__style || { visibility: "visible", display: "block", opacity: "1" };
  try {
    const ok = await h.tryOpenComments(); // tanpa argumen → document
    assert.equal(ok, false);
    const [b1, b2] = doc.children;
    assert.equal(clicks(b1), 1);
    assert.equal(clicks(b2), 1);
  } finally {
    globalThis.document = realDoc;
    globalThis.getComputedStyle = realCss;
  }
});

// ===================== setAllCommentsSort (paksa dropdown "Semua Komentar") =====================
// Dropdown sortir FB dirender lewat PORTAL ke document.body — menu `[role="menu"]`
// berada DI LUAR postRoot. Harness mengeksekusi fungsi ASLI: qsa + isVisible +
// waitVisibleMenu + setAllCommentsSort; `sleepWhile` di-stub agar test bisa
// menyuntikkan menu saat poll (verifikasi polling, bukan sekadar sleep tetap).

function makeFbSort() {
  const fnSrc = [
    "let postRoot = null;",
    "let sleepWhile = async () => {};",
    extract("qsa"),
    extract("isVisible"),
    extract("waitVisibleMenu"),
    extract("setAllCommentsSort"),
    "return { setAllCommentsSort, setSleep: (fn) => { sleepWhile = fn; } };",
  ].join("\n");
  return new Function(fnSrc)();
}

/** Jalankan setAllCommentsSort asli dengan stub document + getComputedStyle. */
async function runSort(h, scope, portal) {
  const body = el("body", {}, portal);
  const doc = makeDocument(body);
  doc.body = body;
  const realDoc = globalThis.document;
  const realCss = globalThis.getComputedStyle;
  globalThis.document = doc;
  globalThis.getComputedStyle = (e) =>
    e.__style || { visibility: "visible", display: "block", opacity: "1" };
  try {
    await h.setAllCommentsSort(scope);
  } finally {
    globalThis.document = realDoc;
    globalThis.getComputedStyle = realCss;
  }
}

test("setAllCommentsSort FB: menu di PORTAL document.body (bukan postRoot) — opsi Semua Komentar diklik", async () => {
  const sortBtn = el("div", { role: "button" }, [], "Paling relevan");
  const post = el("div", {}, [sortBtn]);
  const menuItem = el("div", { role: "menuitem" }, [], "Semua Komentar");
  const menu = el("div", { role: "menu" }, [menuItem]);
  const h = makeFbSort();
  await runSort(h, post, [menu]);
  assert.equal(sortBtn._clickCount, 1, "tombol sortir diklik");
  assert.equal(menuItem._clickCount, 1, "opsi Semua Komentar diklik (menu di document.body)");
});

test("setAllCommentsSort FB: menu terlambat muncul — polling menemukannya saat sleep", async () => {
  const sortBtn = el("div", { role: "button" }, [], "Paling relevan");
  const post = el("div", {}, [sortBtn]);
  const menuItem = el("div", { role: "menuitem" }, [], "All comments");
  let injected = false;
  const h = makeFbSort();
  h.setSleep(async () => {
    if (!injected) {
      injected = true;
      // Simulasi portal: menu (dengan opsi) baru disuntikkan ke document.body
      // saat polling — verifikasi waitVisibleMenu tidak menyerah pada iterasi
      // pertama yang masih kosong.
      const menu = el("div", { role: "menu" }, [menuItem]);
      globalThis.document.body.children.push(menu);
    }
    return true; // sleepWhile asli resolve true saat tidak di-stop
  });
  await runSort(h, post, []); // portal kosong awalnya — menu muncul belakangan
  assert.equal(sortBtn._clickCount, 1);
  assert.equal(menuItem._clickCount, 1, "menu yang muncul belakangan tetap terdeteksi");
});

test("setAllCommentsSort FB: sudah 'Semua Komentar' (label aktif) → tidak klik apa pun (idempotent)", async () => {
  const sortBtn = el("div", { role: "button" }, [], "Semua Komentar");
  const post = el("div", {}, [sortBtn]);
  const h = makeFbSort();
  await runSort(h, post, []);
  assert.equal(clicks(sortBtn), 0, "label aktif sudah Semua Komentar — tidak membuka menu");
});

test("setAllCommentsSort FB: menu tak punya opsi Semua Komentar → menu ditutup (body.click)", async () => {
  const sortBtn = el("div", { role: "button" }, [], "Paling relevan");
  const post = el("div", {}, [sortBtn]);
  const menuItem = el("div", { role: "menuitem" }, [], "Terbaru");
  const menu = el("div", { role: "menu" }, [menuItem]);
  const body = el("body", {}, [menu]);
  const doc = makeDocument(body);
  doc.body = body;
  const h = makeFbSort();
  const realDoc = globalThis.document;
  const realCss = globalThis.getComputedStyle;
  globalThis.document = doc;
  globalThis.getComputedStyle = (e) =>
    e.__style || { visibility: "visible", display: "block", opacity: "1" };
  try {
    await h.setAllCommentsSort(post);
  } finally {
    globalThis.document = realDoc;
    globalThis.getComputedStyle = realCss;
  }
  assert.equal(clicks(sortBtn), 1);
  assert.equal(clicks(menuItem), 0, "Terbaru TIDAK diklik (bukan Semua Komentar)");
  assert.equal(clicks(body), 1, "menu ditutup lewat body.click()");
});

test("setAllCommentsSort FB: tombol sortir tidak ditemukan → no-op", async () => {
  const post = el("div", {}, [el("div", { role: "button" }, [], "Kirim")]);
  const h = makeFbSort();
  await runSort(h, post, []);
  // tidak ada throw; tidak ada klik (harness tidak crash)
});

// ===================== drainGqlBuffer (buffer respons GraphQL) =====================
// Buffer XHR/fetch GraphQL: `pushGqlBuffer(text)` (guard: panjang ≥ 60 + teks
// memuat `"name":` ATAU author/Comment; cap GQL_BUFFER_MAX=50 FIFO) lalu
// `drainGqlBuffer()` mengosongkan buffer dan memanggil `extractNamesFromText`
// per item — regex extractGraphqlNames (filter balasan saat includeReplies
// off) + walkJson/splitJsonChunks (JSON Relay, prefix `for(;;);`, chunk
// berurutan). Harness memakai fungsi ASLI seluruh rantai; yang di-assert
// adalah nama yang BENAR-BENAR masuk nameMap + semantik buffer (count,
// kosong setelah drain, cap FIFO).

function makeGqlBuffer() {
  const fnSrc = [
    "const gqlBuffer = [];",
    "const GQL_BUFFER_MAX = 50;",
    "const nameMap = new Map();",
    "let lastNewAt = 0;",
    "let includeReplies = true;",
    extract("normalizeCommentName"),
    extract("addName"),
    extract("extractGraphqlNames"),
    extract("isCommentLike"),
    extract("isReplyComment"),
    extract("walkJson"),
    extract("splitJsonChunks"),
    extract("extractNamesFromText"),
    extract("pushGqlBuffer"),
    extract("drainGqlBuffer"),
    "return {",
    "  pushGqlBuffer, drainGqlBuffer,",
    "  names: () => [...nameMap.values()],",
    "  bufferLen: () => gqlBuffer.length,",
    "  setIncludeReplies: (v) => { includeReplies = v; },",
    "};",
  ].join("\n");
  return new Function(fnSrc)();
}

// Payload Relay nyata — komentar top-level dengan author + created_time.
const relayComment = (id, name, extra = {}) => ({
  __typename: "Comment",
  id,
  author: { __typename: "User", name },
  body: { text: "Isi komentar biasa." },
  created_time: 1700000000 + Number(id),
  ...extra,
});

const relayPage = (nodes) =>
  JSON.stringify({
    data: {
      node: {
        feedback: {
          comments: {
            edges: nodes.map((n) => ({ cursor: `c${n.id}`, node: n })),
            page_info: { has_next_page: false, end_cursor: null },
          },
        },
      },
    },
  });

test("drainGqlBuffer FB: payload Relay top-level → nama masuk nameMap, buffer kosong setelah drain", () => {
  const h = makeGqlBuffer();
  const text = relayPage([relayComment(1, "Andi Pratama"), relayComment(2, "Budi Santoso")]);
  h.pushGqlBuffer(text);
  assert.equal(h.bufferLen(), 1);
  const n = h.drainGqlBuffer();
  assert.equal(n, 2, "dua nama baru ditambahkan");
  assert.deepEqual(h.names().sort(), ["Andi Pratama", "Budi Santoso"]);
  assert.equal(h.bufferLen(), 0, "drain mengosongkan buffer (splice)");
  assert.equal(h.drainGqlBuffer(), 0, "drain kedua tidak menambah apa pun");
});

test("drainGqlBuffer FB: balasan (comment_parent/depth) — masuk saat includeReplies ON, DITOLAK saat OFF", () => {
  const reply = relayComment(3, "Citra Dewi", {
    comment_parent: { id: "Q29tbWVudDox" },
  });
  const depthReply = relayComment(4, "Dedi Kurniawan", { depth: 1 });

  const h = makeGqlBuffer();
  h.pushGqlBuffer(relayPage([reply, depthReply]));
  assert.equal(h.drainGqlBuffer(), 2, "includeReplies ON (default) → balasan ikut masuk");

  const h2 = makeGqlBuffer();
  h2.setIncludeReplies(false);
  h2.pushGqlBuffer(relayPage([reply, depthReply]));
  assert.equal(h2.drainGqlBuffer(), 0, "includeReplies OFF → balasan ditolak di jalur buffer (parity anti-bocor)");
  assert.deepEqual(h2.names(), []);
});

test("drainGqlBuffer FB: pushGqlBuffer guard — teks pendek / tanpa penanda nama ditolak", () => {
  const h = makeGqlBuffer();
  h.pushGqlBuffer('{"a":"x"}'); // < 60 char → ditolak
  h.pushGqlBuffer("A".repeat(80)); // ≥ 60 tapi tanpa "name": dan tanpa author/Comment → ditolak
  assert.equal(h.bufferLen(), 0, "guard pushGqlBuffer menolak keduanya");
  h.pushGqlBuffer(relayPage([relayComment(5, "Endah")]));
  assert.equal(h.bufferLen(), 1);
});

test("drainGqlBuffer FB: cap GQL_BUFFER_MAX=50 FIFO — item tertua dibuang, drain menghasilkan 50 nama", () => {
  const h = makeGqlBuffer();
  for (let i = 1; i <= 55; i++) {
    h.pushGqlBuffer(relayPage([relayComment(i, `Orang ${i}`)]));
  }
  assert.equal(h.bufferLen(), 50, "buffer di-cap 50 (shift item tertua)");
  const n = h.drainGqlBuffer();
  assert.equal(n, 50, "5 item tertua (Orang 1–5) dibuang, 50 terbaru diproses");
  const names = h.names();
  assert.ok(!names.includes("Orang 1"), "item pertama yang di-push sudah keluar (FIFO)");
  assert.ok(names.includes("Orang 55"), "item terakhir yang di-push masih ada");
});

test("drainGqlBuffer FB: prefix for(;;); + chunk JSON berurutan dipisah dan diproses", () => {
  const h = makeGqlBuffer();
  const multi = `for (;;);${relayPage([relayComment(6, "Fitri")])}${relayPage([
    relayComment(7, "Galuh"),
  ])}`;
  h.pushGqlBuffer(multi);
  assert.equal(h.drainGqlBuffer(), 2, "prefix dibuang + dua chunk JSON diproses");
  assert.deepEqual(h.names().sort(), ["Fitri", "Galuh"]);
});

test("drainGqlBuffer FB: dedupe lintas item — nama sama di dua payload masuk sekali", () => {
  const h = makeGqlBuffer();
  h.pushGqlBuffer(relayPage([relayComment(8, "Hana")]));
  h.pushGqlBuffer(relayPage([relayComment(9, "Hana"), relayComment(10, "Iwan")]));
  assert.equal(h.drainGqlBuffer(), 2, "Hana dihitung sekali (addName dedupe), Iwan baru");
  assert.deepEqual(h.names().sort(), ["Hana", "Iwan"]);
});

// ===================== intercept fetch GraphQL (capture + anti-kontaminasi) =====================
// Jalur interceptor asli (window.fetch hook inject-fb.js): isGraphqlUrl →
// parseBodyToParams → captureGraphqlRequest (guard friendly-name komentar,
// parse variables, simpan template + persist localStorage, klasifikasi
// top-level vs reply) — dan gate respons feedbackIdsFromReqBody →
// isTargetCommentResponse (anti kontaminasi lintas post). Fungsi ASLI seluruh
// rantai dieksekusi; `location.href` (feedbackIdsFromUrl) dan `localStorage`
// (persistGqlTemplate) di-stub per pemanggilan.

function makeFbIntercept() {
  const fnSrc = [
    "const gqlTemplates = new Map();",
    "let lastReplyKey = null;",
    "let lastTopLevelKey = null;",
    "let activeFeedbackId = \"\";",
    "const COMMENT_FRIENDLY = /comment|ufi|feedback|reply|replies|depth\\d*comments|CommentsList|CometUFI|CommentList/i;",
    "const TPL_STORAGE_KEY = \"fnk_fb_gql_tpl_v1\";",
    extract("isGraphqlUrl"),
    extract("parseBodyToParams"),
    extract("extractFbFeedbackIds"),
    extract("fbIdB64"),
    extract("fbIdsMatch"),
    extract("isPaginationLike"),
    extract("loadStoredTemplates"),
    extract("persistGqlTemplate"),
    extract("captureGraphqlRequest"),
    extract("feedbackIdsFromReqBody"),
    extract("feedbackIdsFromUrl"),
    extract("isTargetCommentResponse"),
    "return {",
    "  isGraphqlUrl, captureGraphqlRequest, feedbackIdsFromReqBody, isTargetCommentResponse,",
    "  templateKeys: () => [...gqlTemplates.keys()],",
    "  templates: () => [...gqlTemplates.values()],",
    "  lastReplyKey: () => lastReplyKey,",
    "  lastTopLevelKey: () => lastTopLevelKey,",
    "  setActiveFeedbackId: (v) => { activeFeedbackId = v; },",
    "};",
  ].join("\n");
  return new Function(fnSrc)();
}

/** Jalankan fn dengan stub localStorage (Map) + location.href; return nilai fn(store). */
function withNetStubs(href, fn) {
  const realLs = globalThis.localStorage;
  const realLoc = globalThis.location;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  globalThis.location = { href };
  try {
    return fn(store);
  } finally {
    globalThis.localStorage = realLs;
    globalThis.location = realLoc;
  }
}

const GQL_URL = "https://www.facebook.com/api/graphql/?dpr=2&locale=id_ID";
const REAL_URL = "https://www.facebook.com/photo?fbid=1483436860484357&set=pcb.1483436933817683";

const formBody = (obj) =>
  JSON.stringify({
    fb_api_req_friendly_name: obj.name,
    ...(obj.doc_id ? { doc_id: obj.doc_id } : {}),
    ...(obj.variables ? { variables: JSON.stringify(obj.variables) } : {}),
  });

test("intercept FB: isGraphqlUrl memilah URL graphql vs biasa (case-insensitive)", () => {
  const h = makeFbIntercept();
  assert.equal(h.isGraphqlUrl(GQL_URL), true, "/api/graphql/ → true");
  assert.equal(h.isGraphqlUrl("https://www.facebook.com/feed?graphql=1"), true, "mengandung 'graphql' → true");
  assert.equal(h.isGraphqlUrl("GraphQL"), true, "case-insensitive");
  assert.equal(h.isGraphqlUrl("https://www.facebook.com/home.php"), false);
  assert.equal(h.isGraphqlUrl(""), false);
  assert.equal(h.isGraphqlUrl(null), false);
});

test("intercept FB: captureGraphqlRequest menyimpan template + klasifikasi top-level vs reply + persist", () => {
  const h = makeFbIntercept();
  withNetStubs(REAL_URL, (store) => {
    h.captureGraphqlRequest(
      GQL_URL,
      formBody({
        name: "CometUFICommentsProviderPaginationQuery",
        doc_id: "25399415259725176",
        variables: { count: 20, cursor: "abc", feedbackID: "1483436860484357" },
      })
    );
    // Template tersimpan dengan key = friendly name, URL tanpa query, variabel ter-parse
    assert.deepEqual(h.templateKeys(), ["CometUFICommentsProviderPaginationQuery"]);
    const t = h.templates()[0];
    assert.equal(t.friendlyName, "CometUFICommentsProviderPaginationQuery");
    assert.deepEqual(t.variables, { count: 20, cursor: "abc", feedbackID: "1483436860484357" });
    assert.equal(t.url, "https://www.facebook.com/api/graphql/");
    assert.equal(h.lastTopLevelKey(), "CometUFICommentsProviderPaginationQuery");
    assert.equal(h.lastReplyKey(), null, "belum ada request balasan");
    // persist — entry ber-doc_id + pagination-like masuk localStorage
    assert.ok(store.has("fnk_fb_gql_tpl_v1"), "persistGqlTemplate menulis localStorage");
    const saved = JSON.parse(store.get("fnk_fb_gql_tpl_v1"));
    assert.equal(saved[0].doc_id, "25399415259725176");

    // Request balasan → lastReplyKey di-set, lastTopLevelKey TIDAK berubah
    h.captureGraphqlRequest(
      GQL_URL,
      formBody({
        name: "CometUFICommentsProviderRepliesFragmentQuery",
        doc_id: "5676025945801633",
        variables: { commentID: "1", feedbackID: "1483436860484357" },
      })
    );
    assert.equal(h.lastReplyKey(), "CometUFICommentsProviderRepliesFragmentQuery");
    assert.equal(h.lastTopLevelKey(), "CometUFICommentsProviderPaginationQuery");
    assert.equal(h.templateKeys().length, 2);
  });
});

test("intercept FB: guard friendly non-komentar — ditolak tanpa doc_id/variables, disimpan bila comment-ish", () => {
  const h = makeFbIntercept();
  withNetStubs(REAL_URL, () => {
    // Friendly name feed (bukan komentar) TANPA doc_id/variables → tidak disimpan
    h.captureGraphqlRequest(GQL_URL, formBody({ name: "CometHomeFeedQuery" }));
    assert.equal(h.templateKeys().length, 0, "guard menolak request non-komentar tanpa penanda");
    // Sama tapi DENGAN doc_id+variables yang comment-ish → disimpan (key = friendly name)
    h.captureGraphqlRequest(
      GQL_URL,
      formBody({
        name: "CometHomeFeedQuery",
        doc_id: "25399415259725176",
        variables: { feedbackID: "123456789012345" },
      })
    );
    assert.deepEqual(h.templateKeys(), ["CometHomeFeedQuery"]);
    // URL non-graphql → tidak pernah di-capture
    h.captureGraphqlRequest("https://www.facebook.com/ajax/feed/", formBody({ name: "CometUFICommentsProviderPaginationQuery" }));
    assert.equal(h.templateKeys().length, 1, "URL non-graphql diabaikan");
  });
});

test("intercept FB: feedbackIdsFromReqBody — hanya feedbackID/feedback_id, BUKAN id", () => {
  const h = makeFbIntercept();
  assert.deepEqual(
    h.feedbackIdsFromReqBody(formBody({ name: "x", variables: { feedbackID: "1483436860484357" } })),
    ["1483436860484357"]
  );
  assert.deepEqual(
    h.feedbackIdsFromReqBody(formBody({ name: "x", variables: { feedback_id: "111" } })),
    ["111"]
  );
  assert.deepEqual(
    h.feedbackIdsFromReqBody(formBody({ name: "x", variables: { id: "222" } })),
    [],
    "variabel `id` sengaja TIDAK dibaca (query balasan menaruh id komentar di situ)"
  );
  // Body form-urlencoded (bukan JSON)
  const enc = encodeURIComponent(JSON.stringify({ feedbackID: "333" }));
  assert.deepEqual(h.feedbackIdsFromReqBody(`variables=${enc}`), ["333"]);
  // Body string JSON langsung (variabel berisi JSON escape \")
  assert.deepEqual(
    h.feedbackIdsFromReqBody('{"variables":"{\\"feedbackID\\":\\"444\\"}"}'),
    ["444"]
  );
  // Body kosong / null
  assert.deepEqual(h.feedbackIdsFromReqBody(null), []);
  assert.deepEqual(h.feedbackIdsFromReqBody(""), []);
});

test("intercept FB: isTargetCommentResponse — anti-kontaminasi lintas post di tingkat gate", () => {
  // Permalink nyata (fbid + set=pcb.<story>) → feedbackIdsFromUrl ASLI dari location.href
  const h = makeFbIntercept();
  withNetStubs(REAL_URL, () => {
    // Request membawa id URL (mentah ATAU base64 Relay) → diizinkan
    assert.equal(h.isTargetCommentResponse(["1483436860484357"]), true);
    assert.equal(h.isTargetCommentResponse([b64("feedback:1483436860484357")]), true);
    assert.equal(h.isTargetCommentResponse(["1483436933817683"]), true, "id story dari set=pcb juga diizinkan");
    // Id postingan LAIN → ditolak (kontaminasi lintas post)
    assert.equal(h.isTargetCommentResponse(["999888777666555"]), false);
    assert.equal(h.isTargetCommentResponse(["999888777666555", "1483436860484357"]), true, "salah satu cocok → izinkan");
    // Tanpa id (balasan / bentuk tak dikenal) → tetap diproses (kontrak lama)
    assert.equal(h.isTargetCommentResponse([]), true);
    assert.equal(h.isTargetCommentResponse(null), true);
  });

  // Feed tanpa id URL — fallback activeFeedbackId (fix v1.0.44)
  const h2 = makeFbIntercept();
  h2.setActiveFeedbackId("1483436860484357");
  withNetStubs("https://www.facebook.com/", () => {
    assert.equal(h2.isTargetCommentResponse(["1483436860484357"]), true, "respons halaman sendiri diterima");
    assert.equal(h2.isTargetCommentResponse(["999888777666555"]), false, "postingan lain ditolak");
  });
});

// ===================== siklus template: capture → persist → reuse lintas sesi =====================
// Rantai penuh template pagination FB: captureGraphqlRequest (sesi 1) →
// persistGqlTemplate (localStorage) → bestStoredPaginationTemplate (sesi 2,
// baca localStorage) → buildSyntheticPaginationTemplates (doc_id tersimpan
// diprioritaskan, dedupe vs PAGINATION_DOC_IDS) → orderedCandidates (urutan
// kandidat probe: URL-matched → pagination-like terbaru → top-level terakhir).
// Fungsi ASLI dieksekusi; localStorage & location.href di-stub via withNetStubs
// — "sesi baru" = harness baru dengan Map gqlTemplates segar, localStorage yang
// SAMA (persist lintas sesi terbukti nyata, bukan stub fungsi).

const PAGINATION_DOC_IDS_LITERAL = (() => {
  const m = src.match(/const PAGINATION_DOC_IDS\s*=\s*(\[[\s\S]*?\];)/);
  assert.ok(m, "PAGINATION_DOC_IDS tidak ditemukan di inject-fb.js");
  return m[1];
})();

function makeFbTemplateCycle() {
  const fnSrc = [
    "const gqlTemplates = new Map();",
    "let lastReplyKey = null;",
    "let lastTopLevelKey = null;",
    "const COMMENT_FRIENDLY = /comment|ufi|feedback|reply|replies|depth\\d*comments|CommentsList|CometUFI|CommentList/i;",
    "const TPL_STORAGE_KEY = \"fnk_fb_gql_tpl_v1\";",
    `const PAGINATION_DOC_IDS = ${PAGINATION_DOC_IDS_LITERAL};`,
    extract("isGraphqlUrl"),
    extract("parseBodyToParams"),
    extract("extractFbFeedbackIds"),
    extract("fbIdB64"),
    extract("fbIdsMatch"),
    extract("isPaginationLike"),
    extract("matchesFeedback"),
    extract("loadStoredTemplates"),
    extract("persistGqlTemplate"),
    extract("bestStoredPaginationTemplate"),
    extract("captureGraphqlRequest"),
    extract("feedbackIdsFromUrl"),
    extract("orderedCandidates"),
    extract("buildSyntheticPaginationTemplates"),
    "return {",
    "  captureGraphqlRequest, persistGqlTemplate, bestStoredPaginationTemplate,",
    "  buildSyntheticPaginationTemplates, orderedCandidates, feedbackIdsFromUrl,",
    "  isPaginationLike, matchesFeedback, fbIdB64,",
    "  templateKeys: () => [...gqlTemplates.keys()],",
    "  templates: () => [...gqlTemplates.values()],",
    "  lastTopLevelKey: () => lastTopLevelKey,",
    "  lastReplyKey: () => lastReplyKey,",
    "};",
  ].join("\n");
  return new Function("btoa", fnSrc)(b64);
}

const STORY_ID = "1483436933817683";
const OTHER_ID = "999888777666555";

test("template cycle FB: sesi 1 capture → persist → sesi 2 reuse doc_id tersimpan", () => {
  withNetStubs(REAL_URL, (store) => {
    // Sesi 1 — user membuka komentar di postingan, request pagination ter-capture
    const h1 = makeFbTemplateCycle();
    h1.captureGraphqlRequest(
      GQL_URL,
      formBody({
        name: "CometUFICommentsProviderPaginationQuery",
        doc_id: "STORE_DOC_77",
        variables: { count: 20, cursor: null, feedbackID: REAL_ID },
      })
    );
    assert.ok(store.has("fnk_fb_gql_tpl_v1"), "sesi 1 menulis localStorage");
    const saved = JSON.parse(store.get("fnk_fb_gql_tpl_v1"));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].doc_id, "STORE_DOC_77");
    assert.equal(saved[0].friendlyName, "CometUFICommentsProviderPaginationQuery");
    assert.deepEqual(saved[0].variables, { count: 20, cursor: null, feedbackID: REAL_ID });

    // Sesi 2 — halaman lain, Map gqlTemplates SEGAR, localStorage sama
    const h2 = makeFbTemplateCycle();
    const best = h2.bestStoredPaginationTemplate();
    assert.ok(best, "bestStoredPaginationTemplate membaca template sesi 1");
    assert.equal(best.doc_id, "STORE_DOC_77");

    const synth = h2.buildSyntheticPaginationTemplates();
    assert.equal(synth.length, 3, "2 id URL + doc_id fallback → 3 kandidat");
    assert.equal(synth[0].params.doc_id, "STORE_DOC_77", "doc_id tersimpan di kandidat pertama");
    // extractFbFeedbackIds(REAL_URL) = [story, fbid] — id URL pertama di-probe duluan
    assert.equal(synth[0].variables.feedbackID, fbIdB64(STORY_ID));
    assert.equal(synth[1].variables.feedbackID, fbIdB64(REAL_ID), "id URL kedua juga di-probe");
    for (const t of synth) {
      assert.equal(t.variables.sortKey, "RANKED_UNFILTERED");
      assert.equal(t.variables.topLevelViewOption, "RANKED_UNFILTERED");
      assert.equal(t.variables.isPaginating, true);
      assert.equal(t.variables.commentsIntentToken, "RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1");
      assert.equal(t.url, "https://www.facebook.com/api/graphql/");
      assert.equal(t.friendlyName, "CometUFICommentsProviderPaginationQuery");
    }
  });
});

test("template cycle FB: bestStoredPaginationTemplate — kosong/rusak/bukan-array/entri invalid dilewati", () => {
  const h = makeFbTemplateCycle();
  withNetStubs(REAL_URL, () => {
    // localStorage kosong
    assert.equal(h.bestStoredPaginationTemplate(), null);
    // JSON rusak
    globalThis.localStorage.setItem("fnk_fb_gql_tpl_v1", "{rusak");
    assert.equal(h.bestStoredPaginationTemplate(), null);
    // bukan array (objek) → loadStoredTemplates mengembalikan []
    globalThis.localStorage.setItem(
      "fnk_fb_gql_tpl_v1",
      JSON.stringify({ doc_id: "1", variables: { feedbackID: REAL_ID } })
    );
    assert.equal(h.bestStoredPaginationTemplate(), null);
    // entri tanpa doc_id → dilewati
    globalThis.localStorage.setItem(
      "fnk_fb_gql_tpl_v1",
      JSON.stringify([{ friendlyName: "x", variables: { feedbackID: REAL_ID } }])
    );
    assert.equal(h.bestStoredPaginationTemplate(), null);
    // entri non-pagination-like (tanpa cursor/page_info/feedbackID/comments) → dilewati
    globalThis.localStorage.setItem(
      "fnk_fb_gql_tpl_v1",
      JSON.stringify([{ friendlyName: "x", doc_id: "1", variables: { count: 20 } }])
    );
    assert.equal(h.bestStoredPaginationTemplate(), null);
    // variabel bentuk STRING (bentuk persist lama) tetap dikenali isPaginationLike
    globalThis.localStorage.setItem(
      "fnk_fb_gql_tpl_v1",
      JSON.stringify([
        {
          friendlyName: "x",
          doc_id: "1",
          variables: JSON.stringify({ feedbackID: REAL_ID, cursor: null }),
          capturedAt: 1,
        },
      ])
    );
    const best = h.bestStoredPaginationTemplate();
    assert.equal(best.doc_id, "1", "entri valid terdeteksi walau variables berbentuk string");
  });
});

test("template cycle FB: persistGqlTemplate — guard, cap 3 FIFO, dedupe nama, tanpa tulis redundant", () => {
  const h = makeFbTemplateCycle();
  withNetStubs(REAL_URL, (store) => {
    let writes = 0;
    const realSet = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = (...a) => {
      writes++;
      return realSet(...a);
    };
    try {
      // Tanpa doc_id → tidak ditulis
      h.persistGqlTemplate({
        friendlyName: "x",
        params: {},
        variables: { feedbackID: REAL_ID },
      });
      assert.equal(writes, 0, "entry tanpa doc_id tidak memicu write");
      // Bukan pagination-like → tidak ditulis
      h.persistGqlTemplate({
        friendlyName: "x",
        params: { doc_id: "1" },
        variables: { count: 20 },
      });
      assert.equal(writes, 0, "entry non-pagination-like tidak memicu write");
      // 4 template berbeda → cap 3, tertua dibuang
      for (let i = 1; i <= 4; i++) {
        h.persistGqlTemplate({
          friendlyName: `Pagination${i}`,
          url: GQL_URL,
          params: { doc_id: `D${i}` },
          variables: { feedbackID: REAL_ID, cursor: null },
          capturedAt: i * 1000,
        });
      }
      assert.equal(writes, 4, "4 template → 4 write");
      let list = JSON.parse(store.get("fnk_fb_gql_tpl_v1"));
      assert.equal(list.length, 3, "cap 3");
      assert.equal(list[0].doc_id, "D4");
      assert.ok(!list.some((t) => t.doc_id === "D1"), "tertua dibuang");
      // Bentuk tersimpan bersih: hanya field yang disengaja, tanpa params mentah
      assert.deepEqual(Object.keys(list[0]).sort(), ["capturedAt", "doc_id", "friendlyName", "url", "variables"]);
      // Dedupe nama: Pagination4 dengan doc_id baru → pindah ke depan, tetap 3
      h.persistGqlTemplate({
        friendlyName: "Pagination4",
        url: GQL_URL,
        params: { doc_id: "D4b" },
        variables: { feedbackID: REAL_ID, cursor: null },
        capturedAt: 5000,
      });
      assert.equal(writes, 5);
      list = JSON.parse(store.get("fnk_fb_gql_tpl_v1"));
      assert.equal(list.length, 3);
      assert.equal(list[0].doc_id, "D4b");
      // Entry identik di depan (nama + doc_id sama) → early return, tanpa write ulang
      h.persistGqlTemplate({
        friendlyName: "Pagination4",
        url: GQL_URL,
        params: { doc_id: "D4b" },
        variables: { feedbackID: REAL_ID, cursor: null },
        capturedAt: 6000,
      });
      assert.equal(writes, 5, "entry identik di depan tidak ditulis ulang");
    } finally {
      globalThis.localStorage.setItem = realSet;
    }
  });
});

test("template cycle FB: orderedCandidates — URL-matched dulu, lalu pagination-like terbaru, top-level terakhir, reply dieksklusi", () => {
  const h = makeFbTemplateCycle();
  withNetStubs(REAL_URL, () => {
    const realNow = Date.now;
    let clock = 0;
    Date.now = () => (clock += 1000);
    try {
      const mk = (name, feedbackID, vars) =>
        formBody({
          name,
          doc_id: "25399415259725176",
          variables: { count: 20, cursor: null, feedbackID, ...vars },
        });
      // tA: pagination-like, id URL → harus #1 walau di-capture paling awal
      h.captureGraphqlRequest(GQL_URL, mk("CometUFICommentsProviderPaginationQuery", REAL_ID));
      // tB: pagination-like, id LAIN → jangan #1 walau lebih baru (anti salah post)
      h.captureGraphqlRequest(GQL_URL, mk("CometUFICommentsProviderPaginationQueryB", OTHER_ID));
      // tC: balasan → dieksklusi total dari kandidat
      h.captureGraphqlRequest(GQL_URL, mk("CometUFICommentsProviderRepliesFragmentQuery", REAL_ID));
      // tD: komentar-ish TANPA penanda pagination → hanya fallback paling akhir
      h.captureGraphqlRequest(
        GQL_URL,
        formBody({
          name: "CometUFICommentsProviderInitialQuery",
          doc_id: "25399415259725176",
          variables: { count: 20, first: 20, scale: 1 },
        })
      );
      const order = h.orderedCandidates().map((t) => t.friendlyName);
      assert.deepEqual(
        order,
        [
          "CometUFICommentsProviderPaginationQuery", // 1) URL-matched
          "CometUFICommentsProviderPaginationQueryB", // 2) pagination-like terbaru (id lain)
          "CometUFICommentsProviderInitialQuery", // 3) top-level terakhir (fallback)
        ],
        "urutan kandidat: URL-matched → pagination-like → top-level terakhir"
      );
      assert.ok(
        !order.includes("CometUFICommentsProviderRepliesFragmentQuery"),
        "template balasan tidak pernah jadi kandidat pagination"
      );
    } finally {
      Date.now = realNow;
    }
  });
});

test("template cycle FB: reuse lintas sesi — seed lama, capture baru menang di sesi berikutnya", () => {
  const seed = [
    {
      friendlyName: "PaginationA",
      url: GQL_URL,
      doc_id: "OLD_SEED_1",
      variables: { feedbackID: REAL_ID, cursor: null },
      capturedAt: 200,
    },
    {
      friendlyName: "PaginationB",
      url: GQL_URL,
      doc_id: "OLD_SEED_2",
      variables: { feedbackID: REAL_ID, cursor: null },
      capturedAt: 100,
    },
  ];
  withNetStubs(REAL_URL, (store) => {
    store.set("fnk_fb_gql_tpl_v1", JSON.stringify(seed));
    const h = makeFbTemplateCycle();
    // Sesi baru tanpa capture: template sesi lama terbaik dipakai
    assert.equal(h.bestStoredPaginationTemplate().doc_id, "OLD_SEED_1", "entri terdepan (terbaru) menang");
    assert.equal(h.buildSyntheticPaginationTemplates()[0].params.doc_id, "OLD_SEED_1");
    // Sesi ini menangkap doc_id BARU → persist pindah ke depan list
    h.captureGraphqlRequest(
      GQL_URL,
      formBody({
        name: "CometUFICommentsProviderPaginationQuery",
        doc_id: "NEW_SEED_9",
        variables: { count: 20, cursor: null, feedbackID: REAL_ID },
      })
    );
    const saved = JSON.parse(store.get("fnk_fb_gql_tpl_v1"));
    assert.equal(saved.length, 3, "2 seed + 1 baru, cap 3");
    assert.equal(saved[0].doc_id, "NEW_SEED_9");
    // Sesi berikutnya (harness segar) → reuse memakai doc_id baru
    const h3 = makeFbTemplateCycle();
    assert.equal(h3.bestStoredPaginationTemplate().doc_id, "NEW_SEED_9");
    assert.equal(h3.buildSyntheticPaginationTemplates()[0].params.doc_id, "NEW_SEED_9");
  });
});

test("template cycle FB: dedupe doc_id tersimpan vs PAGINATION_DOC_IDS fallback", () => {
  const fallback0 = PAGINATION_DOC_IDS_LITERAL.match(/"(\d{10,})"/)[1];
  withNetStubs(REAL_URL, (store) => {
    store.set(
      "fnk_fb_gql_tpl_v1",
      JSON.stringify([
        {
          friendlyName: "PaginationA",
          url: GQL_URL,
          doc_id: fallback0,
          variables: { feedbackID: REAL_ID },
          capturedAt: 1,
        },
      ])
    );
    const h = makeFbTemplateCycle();
    const synth = h.buildSyntheticPaginationTemplates();
    assert.equal(synth.length, 3, "2 id URL + doc_id berikutnya → 3 kandidat");
    // Dua kandidat pertama = id URL berbeda, SAMA doc_id tersimpan (by design)
    assert.equal(synth[0].params.doc_id, fallback0);
    assert.equal(synth[1].params.doc_id, fallback0);
    // Dedupe nyata: fallback0 (stored) TIDAK di-push ulang ke daftar docIds —
    // kandidat ketiga memakai fallback BERIKUTNYA, bukan duplikat stored
    assert.notEqual(synth[2].params.doc_id, fallback0, "fallback tidak diduplikasi");
    const distinct = new Set(synth.map((t) => t.params.doc_id));
    assert.equal(distinct.size, 2, "tepat 2 doc_id berbeda: stored + fallback berikutnya");
  });
});
