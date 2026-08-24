/**
 * Extreme/stress audit khusus mesin Instagram (inject-ig.js) — permukaan baru
 * v1.0.58: pickMediaIdNearShortcode (sadar-korsel), commentCountNear,
 * detectPostKind, buildSyntheticCommentsUrl, clamp count di buildUrl, pre-seed
 * store, template cadangan. Fuzz/adversarial deterministik + batas memori.
 *
 * Pure ESM — node --test, zero deps. Fungsi diekstrak dari source dengan
 * brace-counting STRING-AWARE (regex/`{n,m}`/template literal tidak mengacau).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "inject-ig.js"),
  "utf8"
);

function extract(fnName) {
  const idx = src.indexOf(`function ${fnName}(`);
  assert.ok(idx >= 0, `function ${fnName} not found in inject-ig.js`);
  const start = idx - (src.slice(Math.max(0, idx - 6), idx) === "async " ? 6 : 0);
  // Lewati daftar parameter: `{` pertama bisa milik destructuring
  // (buildUrl(templateUrl, { nextMaxId, ... })) — badan selalu setelah `) {`.
  const paramsEnd = src.indexOf(") {", idx);
  assert.ok(paramsEnd >= 0, `param close not found for ${fnName}`);
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
      if (next === "/") inRegex = false;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (ch === "/" && depth > 0) {
      // Heuristic sama dgn fb-engine-logic: '/' setelah '(' ',' ':' '=' '&'
      // atau sebelumnya operator = awal regex literal.
      const prev = src[i - 1] || "";
      if ("(,=:[!&|?{};".includes(prev)) {
        inRegex = true;
        continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced extraction: " + fnName);
}

// ===================== pickMediaIdNearShortcode =====================
const pickMediaIdNearShortcode = new Function(
  `${extract("pickMediaIdNearShortcode")}\nreturn pickMediaIdNearShortcode;`
)();

test("extreme IG pickMediaId: korsel 200 slide — kontainer menang, runtime terbatas", () => {
  const children = Array.from({ length: 200 }, (_, i) =>
    `{"id":"9${String(i).padStart(17, "0")}"}`
  ).join(",");
  const text =
    `{"media":{"id":"111222333444555666","shortcode":"CxA1",` +
    `"carousel_media":[${children}]}}`;
  assert.equal(pickMediaIdNearShortcode(text, "CxA1"), "111222333444555666");
});

test("extreme IG pickMediaId: objek decoy sebelum induk ditolak (bracket tak seimbang)", () => {
  const text =
    '{"decoy":{"id":"1000111222333444"},"media":{' +
    '"id":"111222333444555666","shortcode":"CxA1"}}';
  assert.equal(pickMediaIdNearShortcode(text, "CxA1"), "111222333444555666");
});

test("extreme IG pickMediaId: hanya id anak tanpa kontainer → null", () => {
  const text =
    '{"shortcode":"CxA1","carousel_media":[{"id":"999888777666555444"}]}';
  // id anak dipisah bracket dari shortcode → ditolak; tak ada kandidat lain
  assert.equal(pickMediaIdNearShortcode(text, "CxA1"), null);
});

test("extreme IG pickMediaId: bentuk escaped URL-encoded tetap dikenali", () => {
  const text =
    "%7B%22shortcode%22%3A%22CxA1%22%2C%22id%22%3A%22999888777666555444%22%7D";
  assert.equal(pickMediaIdNearShortcode(text, "CxA1"), "999888777666555444");
});

test("extreme IG pickMediaId: input sampai / unicode aman", () => {
  assert.equal(pickMediaIdNearShortcode("", "x"), null);
  assert.equal(pickMediaIdNearShortcode(null, "x"), null);
  assert.equal(pickMediaIdNearShortcode('{"id":"123456789012345"}', ""), null);
  const uni = '{"media":{"id":"111222333444555666","shortcode":"CxA1","note":"🎉🔥✨"}}';
  assert.equal(pickMediaIdNearShortcode(uni, "CxA1"), "111222333444555666");
});

// ===================== commentCountNear =====================
const commentCountNear = new Function(
  `${extract("commentCountNear")}\nreturn commentCountNear;`
)();

test("extreme IG countNear: multi-kemunculan media → maksimum antar jendela", () => {
  const text =
    `{"a":{"id":"111222333444555666","comment_count":120},` +
    `"b":{"id":"111222333444555666","comment_count":450}}`;
  assert.equal(commentCountNear(text, "111222333444555666"), 450);
});

test("extreme IG countNear: angka >=100 ribu diabaikan (cap sanity)", () => {
  const text = '{"id":"111222333444555666","comment_count":999999}';
  assert.equal(commentCountNear(text, "111222333444555666"), 0);
});

test("extreme IG countNear: count berbentuk string kutip diabaikan", () => {
  const text = '{"id":"111222333444555666","comment_count":"42"}';
  assert.equal(commentCountNear(text, "111222333444555666"), 0);
});

// ===================== detectPostKind =====================
const detectPostKind = new Function(
  `${extract("detectPostKind")}\nreturn detectPostKind;`
)();

test("extreme IG detectPostKind: bentuk case/query/hash/share/tv", () => {
  assert.equal(detectPostKind("https://www.instagram.com/REELS/Cx1/?x=1"), "reel");
  assert.equal(detectPostKind("https://www.instagram.com/p/Cx1#frag"), "post");
  assert.equal(detectPostKind("https://www.instagram.com/share/tv/Cx1/"), "tv");
  assert.equal(detectPostKind("instagram.com/p/Cx1"), "post");
  assert.equal(detectPostKind("https://fakegram.com/p/Cx1/"), null);
  assert.equal(detectPostKind(null), null);
});

// ===================== buildSyntheticCommentsUrl =====================
const buildSyntheticCommentsUrl = new Function(
  `${extract("buildSyntheticCommentsUrl")}\nreturn buildSyntheticCommentsUrl;`
)();

test("extreme IG synthUrl: panjang id dibatasi <=25 digit", () => {
  const ok19 = "1234567890123456789"; // 19 digit
  const long26 = "1".repeat(26);
  assert.ok(buildSyntheticCommentsUrl(ok19).includes(ok19));
  assert.equal(buildSyntheticCommentsUrl(long26), null);
});

test("extreme IG synthUrl: leading-zero dipertahankan verbatim & count float diround", () => {
  const id = "003847474747474747";
  const u = new URL(buildSyntheticCommentsUrl(id, 31.9));
  assert.ok(u.pathname.includes("/media/" + id + "/comments/"));
  assert.equal(u.searchParams.get("count"), "32");
  assert.equal(new URL(buildSyntheticCommentsUrl(id, -7)).searchParams.get("count"), "30");
});

// ===================== buildUrl clamp count (hardening) =====================
function makeUrlBuilderHardened(activeMediaIdVal) {
  const fnSrc = [
    extract("stripVolatileParams"),
    `let activeMediaId = ${JSON.stringify(activeMediaIdVal ?? null)};`,
    extract("buildUrl"),
    "return buildUrl;",
  ].join("\n");
  return new Function(fnSrc)();
}

const TPL_COUNT =
  "https://www.instagram.com/api/v1/media/111/comments/?can_support_threading=false";

test("extreme IG buildUrl: count negatif / non-numerik dibuang, bukan dikirim mentah", () => {
  const bu = makeUrlBuilderHardened(null);
  for (const bad of ["-5", "abc", "0", "0.4"]) {
    const u = new URL(bu(TPL_COUNT + "&count=" + bad, {}));
    assert.equal(u.searchParams.get("count"), null, `count=${bad} harus dibuang`);
  }
  // 20 → dinaikkan ke floor 30
  assert.equal(new URL(bu(TPL_COUNT + "&count=20", {})).searchParams.get("count"), "30");
});

test("extreme IG buildUrl: reply endpoint — tanpa count di template tetap tanpa count (fidelitas)", () => {
  const bu = makeUrlBuilderHardened(null);
  const u = bu(TPL_COUNT, { reply: true, commentId: "77" });
  assert.equal(new URL(u).pathname, "/api/v1/media/111/comments/77/inline_child_comments/");
  // buildUrl tidak pernah MENGARANG count (hanya menormalkan yang ada);
  // default 30 adalah ranah synthetic-from-page builder.
  assert.equal(new URL(u).searchParams.get("count"), null);
});

// ===================== name store: korupsi & cap =====================
function makeIgNameStore(store) {
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
      'const NAMES_STORE_KEY = "fnk_ig_names_v1";',
      extract("loadPriorNames"),
      extract("persistNames"),
      "return { loadPriorNames, persistNames };",
    ].join("\n")
  )(ls, Date);
}

test("extreme IG store: JSON korup / array / angka / key proto → null tanpa crash", () => {
  const ns = makeIgNameStore({});
  const bads = [
    "{oops",
    "[1,2,3]",
    "42",
    '"str"',
    '{"key":{"__proto__":{}},"names":["a"],"at":' + Date.now() + "}",
    '{"key":"CxAbCdEf","names":"bukan-array","at":' + Date.now() + "}",
  ];
  for (const raw of bads) {
    const s = {};
    s.fnk_ig_names_v1 = raw;
    const h = makeIgNameStore(s);
    assert.equal(h.loadPriorNames("CxAbCdEf"), null, JSON.stringify(raw).slice(0, 40));
  }
});

test("extreme IG store: baca dibatasi 2000 nama (simetris dgn persist)", () => {
  const s = {};
  s.fnk_ig_names_v1 = JSON.stringify({
    key: "CxAbCdEf",
    names: Array.from({ length: 2500 }, (_, i) => "u" + i),
    at: Date.now(),
  });
  const h = makeIgNameStore(s);
  const got = h.loadPriorNames("CxAbCdEf");
  assert.equal(got.length, 2000);
});

// ===================== template cadangan: korupsi/TTL boundary =====================
function makeTplGood(store) {
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
      'const TPL_GOOD_KEY = "fnk_ig_tpl_good_v1";',
      extract("rememberGoodTemplate"),
      extract("getAltTemplate"),
      extract("shouldSwitchAltTemplate"),
      "return { rememberGoodTemplate, getAltTemplate, shouldSwitchAltTemplate };",
    ].join("\n")
  )(ls, Date);
}

test("extreme IG tplGood: korup/kosong/url non-string/TTL boundary", () => {
  const A = "https://www.instagram.com/api/v1/media/1/comments/?q=A";
  const B = "https://www.instagram.com/api/v1/media/1/comments/?q=B";

  for (const raw of ["{rusak", "null", '"x"', "5"]) {
    const s = {};
    s.fnk_ig_tpl_good_v1 = raw;
    assert.equal(makeTplGood(s).getAltTemplate(B), null, raw);
  }

  const s2 = {};
  s2.fnk_ig_tpl_good_v1 = JSON.stringify({ url: 12345, at: Date.now() });
  assert.equal(makeTplGood(s2).getAltTemplate(B), null);

  // TTL boundary: tepat 7 hari masih valid; lewat 1 ms → invalid
  const s3 = {};
  const tg3 = makeTplGood(s3);
  tg3.rememberGoodTemplate(A);
  const e = JSON.parse(s3.fnk_ig_tpl_good_v1);
  e.at = Date.now() - 7 * 86400_000 + 50;
  s3.fnk_ig_tpl_good_v1 = JSON.stringify(e);
  assert.equal(tg3.getAltTemplate(B), A, "masih dalam TTL");
  e.at = Date.now() - 7 * 86400_000 - 50;
  s3.fnk_ig_tpl_good_v1 = JSON.stringify(e);
  assert.equal(tg3.getAltTemplate(B), null, "kedaluwarsa");
});
