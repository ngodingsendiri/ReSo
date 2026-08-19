/**
 * E2E alur `rekapSend` (Rekap + Kirim ke ReSo) — 3 platform.
 *
 * Beda dari test unit scanner/parser (reso-bridge) dan test API (reso-api):
 * file ini menjalankan fungsi `rekapSend` ASLI dari content-fb/tiktok/ig.js
 * (diekstrak & dieksekusi dengan engine di-stub di seam `startExtract`),
 * dengan `document` palsu, tapi scanner/parser & `sendNamesToResoApi` ASLI
 * dari shared.js (fetch + chrome di-stub). Rantai yang diverifikasi:
 *
 *   rekapSend asli → scanPageForPostDate / createTimeFromRehydration asli
 *     → hint {suggestedDate, suggestedTime, suggestedIso, label}
 *     → sendNamesToResoApi asli → POST /api/engagement → body.postedAt
 *
 * Dengan begitu hint postedAt/suggestedIso terbukti diteruskan BENAR dari
 * deteksi DOM sampai payload API — bukan sekadar stub-to-stub.
 *
 * Sejak perluasan kedua, harness `makeFullHarness` juga menjalankan
 * `startExtract` ASLI (sebelumnya di-stub): cooldown antar-run, pre-check
 * login, waitEngineReady, dan ENGINE_CMD START diverifikasi — engine
 * benar-benar dijalankan SEBELUM kirim API, dan nama yang dikirim adalah
 * hasil DONE engine, bukan stub.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFnBalanced } from "./duplication-registry.mjs";
// Side-effect: shared.js classic-compatible → mengisi globalThis.RS_SHARED
// dengan scanner/parser/sendNamesToResoApi ASLI yang dipakai rekapSend.
import "../shared.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");

// ===================== Ekstraksi rekapSend asli =====================

/** Ekstrak `async function name(`..`}` pertama (brace-balanced) — versi
 *  extractFnBalanced yang MEMPERTAHANKAN prefix `async` (rekapSend memakai
 *  `await`, jadi tidak boleh jadi fungsi biasa). */
function extractAsyncFn(src, name) {
  const idx = src.indexOf(`async function ${name}(`);
  assert.ok(idx >= 0, `async function ${name} tidak ditemukan`);
  let paramsEnd = src.indexOf(") {", idx);
  if (paramsEnd < 0) paramsEnd = src.indexOf("){", idx);
  assert.ok(paramsEnd >= 0, `penutup parameter ${name} tidak ditemukan`);
  const open = src.indexOf("{", paramsEnd);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.equal(depth, 0, `kurung ${name} tidak seimbang`);
  return src.slice(idx, i + 1);
}

// ===================== Harness rekapSend =====================

const HARNESS = {
  facebook: { file: "content-fb.js", setter: "setLocalState" },
  tiktok: { file: "content-tiktok.js", setter: "setLocal" },
  instagram: { file: "content-ig.js", setter: "setLocal" },
};

/** Bangun fungsi yang menjalankan `rekapSend` asli platform dengan closure
 *  state di-stub: `startExtract` (engine) selesai seketika → status done;
 *  `setLocalState`/`setLocal` mencatat pesan; `status`/`names` dari opsi. */
function makeRekapHarness(platform, { names = [] } = {}) {
  const { file, setter } = HARNESS[platform];
  const body = [
    extractAsyncFn(read(file), "rekapSend"),
    `let status = "idle";`,
    `let names = ${JSON.stringify(names)};`,
    `let messages = [];`,
    `const startExtract = async () => { status = "done"; };`,
    `const ${setter} = (patch) => { if (patch && typeof patch.message === "string") messages.push(patch.message); };`,
    `return { run: rekapSend, messages };`,
  ].join("\n");
  return new Function(body)();
}

// ===================== DOM palsu untuk deteksi tanggal =====================

function makeEl(attrs = {}, text = "") {
  return {
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    textContent: text,
  };
}

/** `document` palsu yang dipahami scanPageForPostDate (querySelectorAll
 *  untuk 3 selektor) dan rekapSend TikTok (getElementById rehydration). */
function makeDoc({ utime, utimeText, timeAttr, timeText, texts = [], rehydrate } = {}) {
  return {
    querySelectorAll(sel) {
      if (sel === "[data-utime]") {
        return utime != null ? [makeEl({ "data-utime": String(utime) }, utimeText)] : [];
      }
      if (sel === "time[datetime]") {
        return timeAttr != null ? [makeEl({ datetime: timeAttr }, timeText)] : [];
      }
      if (sel === "time, a, span, strong, h1, h2, h3") {
        return texts.map((t) => makeEl({}, t));
      }
      return [];
    },
    getElementById(id) {
      if (id === "__UNIVERSAL_DATA_FOR_REHYDRATION__" && rehydrate !== undefined) {
        return {
          textContent: typeof rehydrate === "string" ? rehydrate : JSON.stringify(rehydrate),
        };
      }
      return null;
    },
  };
}

// ===================== Mocks rantai API (chrome + fetch) =====================

const pad2 = (n) => String(n).padStart(2, "0");
/** Konversi waktu UTC → {date, time} lokal — sama dengan konversi
 *  parsePostAgeText (ISO Z → getHours lokal), supaya ekspektasi test
 *  kebal zona waktu mesin. */
const localOf = (utcMs) => {
  const d = new Date(utcMs);
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
};

const fakeToken = (expSeconds) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ exp: expSeconds })}.sig`;
};
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 3600;

/**
 * Stub sendNamesToResoApi menjadi SPY yang meneruskan ke fungsi ASLI, dan
 * stub fetch (POST /api/engagement) + chrome (storage dengan token fresh)
 * supaya rantai asli berjalan. Kembalikan { sent, apiCalls } ke callback:
 *  - sent:      argumen (platform, names, hint) yang diterima sendNamesToResoApi,
 *  - apiCalls:  body JSON yang benar-benar dikirim ke /api/engagement.
 * Selalu mengembalikan semua global di finally.
 *
 * Mode kegagalan (opsi):
 *  - opts.apiStatus/apiBody: fetch balas status non-OK → sendNamesToResoApi
 *    asli mengembalikan {ok:false, message} (jalur A di rekapSend),
 *  - opts.fetchError: fetch MELEMPAR (network) → error ditangkap
 *    sendNamesToResoApi → {ok:false, message: "Gagal kirim ke ReSo: …"},
 *  - opts.sendThrows: SPY melempar sebelum meneruskan → catch luar rekapSend
 *    (jalur B, pesan tanpa prefix label),
 *  - opts.onPost(body): dipanggil saat POST /api/engagement (untuk menyusun
 *    timeline urutan engine→kirim di test startExtract asli).
 */
async function withReSoMocks(fn, opts = {}) {
  const sent = [];
  const apiCalls = [];
  const store = {
    resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() },
  };
  const realSend = globalThis.RS_SHARED.sendNamesToResoApi;
  const realFetch = globalThis.fetch;
  const realChrome = globalThis.chrome;
  const realDoc = globalThis.document;
  const realDelay = globalThis.__RESO_RETRY_DELAY_MS;
  globalThis.__RESO_RETRY_DELAY_MS = 0; // jangan lambatkan test dengan sleep retry
  globalThis.RS_SHARED.sendNamesToResoApi = async (platform, names, hint) => {
    sent.push({ platform, names, hint });
    if (opts.sendThrows) throw opts.sendThrows;
    return realSend(platform, names, hint);
  };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/api/engagement")) {
      apiCalls.push({ url: u, init, body: JSON.parse(init.body) });
      if (opts.onPost) opts.onPost(apiCalls[apiCalls.length - 1].body);
      if (opts.fetchError) throw opts.fetchError;
      if (opts.apiStatus) {
        return new Response(JSON.stringify(opts.apiBody ?? {}), { status: opts.apiStatus });
      }
      return new Response(
        JSON.stringify({ ok: true, date: "2026-08-09", added: 2, existing: 0 }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => ({ [k]: store[k] ?? null }),
        set: async (o) => Object.assign(store, o),
        remove: async (keys) => {
          for (const k of [].concat(keys)) delete store[k];
        },
      },
    },
    tabs: { query: async () => [], sendMessage: async () => null },
  };
  try {
    return await fn({ sent, apiCalls });
  } finally {
    globalThis.RS_SHARED.sendNamesToResoApi = realSend;
    globalThis.fetch = realFetch;
    globalThis.chrome = realChrome;
    globalThis.document = realDoc;
    globalThis.__RESO_RETRY_DELAY_MS = realDelay;
  }
}

// ===================== Harness startExtract ASLI =====================
// Seam yang di-stub HANYA: background (chrome.runtime.sendMessage), engine
// (DONE sinkron saat START), document, location, dan setTimeout (bila
// stubTimers). Semua fungsi content script — sendBg, engineCmd,
// waitEngineReady, acceptFromInject, isCurrentRun, mapDone, doneMessage,
// mergeNames, normalize, startExtract, rekapSend, plus listener pesan engine
// — diekstrak & dieksekusi ASLI dari source.

/** Ekstrak fungsi: coba `async function name(` dulu, lalu `function name(`. */
function extractAny(src, name) {
  if (src.includes(`async function ${name}(`)) return extractAsyncFn(src, name);
  const fn = extractFnBalanced(src, name);
  assert.ok(fn, `function ${name} tidak ditemukan`);
  return fn;
}

function extractInjectSource(src) {
  const m = src.match(/const INJECT_SOURCE = "([^"]+)";/);
  assert.ok(m, "INJECT_SOURCE tidak ditemukan");
  return m[1];
}

/** Seluruh statement `window.addEventListener("message", (event) => {...});`
 *  (brace-balanced) — listener asli yang memproses READY/PROGRESS/DONE/ERROR
 *  dari engine. Dipasang ke fake window harness. */
function extractMessageListener(src) {
  const marker = 'window.addEventListener("message", (event) => {';
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, "message listener tidak ditemukan");
  const open = src.indexOf("{", idx);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.equal(depth, 0, "message listener tidak seimbang");
  const close = src.indexOf(");", i);
  assert.ok(close > i && close - i < 10, "penutup listener tidak ditemukan");
  return src.slice(idx, close + 2);
}

const NORMALIZE_FN = {
  facebook: "normalizeCommentName",
  tiktok: "normalizeNickname",
  instagram: "normalizeInstagramUsername",
};

const SETTER_FN = {
  facebook: "setLocalState",
  tiktok: "setLocal",
  instagram: "setLocal",
};

const DEFAULT_HREF = {
  facebook: "https://www.facebook.com/someuser/posts/123456789",
  tiktok: "https://www.tiktok.com/@user/video/1234567890123456789",
  instagram: "https://www.instagram.com/p/ABC123/",
};

/**
 * Harness penuh: rekapSend + startExtract ASLI. Fake background menangani
 * ENGINE_CMD (PING ok, START → engine selesai SEKETIKA dengan DONE sinkron
 * sehingga status done terpasang sebelum START mengembalikan), CHECK_*_LOGIN
 * (loggedIn), GET_TEMPLATE (null). `bgLog` = timeline kronologis pesan
 * chrome (string) — test bisa menambahkan penanda sendiri (mis. "api:POST")
 * untuk memverifikasi URUTAN engine → kirim.
 *
 * opsi: engineNames (hasil DONE engine), lastRunEndAt/lastRateLimitAt
 * (cooldown), stubTimers (catat setTimeout alih-alih menjadwalkan — untuk
 * test cooldown tanpa menunggu 15/60 dtk), href (location.href), includeReplies.
 */
function makeFullHarness(platform, opts = {}) {
  const src = read(HARNESS[platform].file);
  const setter = SETTER_FN[platform];
  const extract = (name) => extractAny(src, name);
  const body = [];
  if (opts.stubTimers) {
    body.push(
      `const scheduledTimers = [];`,
      `const setTimeout = (cb, ms) => { scheduledTimers.push({ cb, ms }); return scheduledTimers.length; };`,
      `const clearTimeout = () => {};`,
      `const clearInterval = () => {};`
    );
  }
  body.push(
    // Fake window + location + render (render tidak relevan untuk alur ini).
    `const window = { _ls: [], addEventListener(t, cb) { if (t === "message") this._ls.push(cb); }, __dispatch(d) { for (const cb of this._ls.slice()) cb({ source: this, data: d }); } };`,
    `const location = { href: ${JSON.stringify(opts.href || DEFAULT_HREF[platform])} };`,
    `const render = () => {};`,
    `const renderUi = () => {};`,
    // Closure state — cermin deklarasi atas content script asli.
    `let status = "idle";`,
    `let names = ${JSON.stringify(opts.initialNames || [])};`,
    `let message = "";`,
    `let postHint = "";`,
    `let videoHint = "";`,
    `let hasTemplate = false;`,
    `let includeReplies = ${JSON.stringify(opts.includeReplies ?? platform === "facebook")};`,
    `let engineReady = false;`,
    `let currentRunId = null;`,
    `let stopFinalizeTimer = null;`,
    `const COOLDOWN_MS = 15_000;`,
    `const COOLDOWN_RATE_LIMIT_MS = 60_000;`,
    `let lastRunEndAt = ${JSON.stringify(opts.lastRunEndAt || 0)};`,
    `let lastRateLimitAt = ${JSON.stringify(opts.lastRateLimitAt || 0)};`,
    `let startGen = 0;`,
    `const INJECT_SOURCE = ${JSON.stringify(extractInjectSource(src))};`,
    `const messages = [];`,
    `let engineRunId = null;`,
    // Fungsi ASLI dari content script.
    extract("sendBg"),
    extract("engineCmd"),
    extract("waitEngineReady"),
    extract("acceptFromInject"),
    extract("isCurrentRun"),
    extract("makeRunId"),
    extract("mapDone"),
    extract("doneMessage"),
    extract("mergeNames"),
    extract(NORMALIZE_FN[platform]),
    extract("startExtract"),
    extract("rekapSend"),
    ...(platform === "facebook" ? [extract("markBestPostRoot")] : []),
    ...(platform === "tiktok"
      ? [extract("extractAwemeFromLocation"), extract("refreshTemplateFlag")]
      : []),
    ...(platform === "instagram" ? [extract("extractShortcode"), extract("refreshTemplateFlag")] : []),
    // Setter state (stub — mencatat pesan; render tidak relevan).
    `const ${setter} = (patch) => {`,
    `  if (patch && typeof patch.status === "string") status = patch.status;`,
    `  if (patch && Array.isArray(patch.names)) names = mergeNames(patch.names);`,
    `  if (patch && typeof patch.message === "string") messages.push(patch.message);`,
    `  if (patch && typeof patch.postHint === "string") postHint = patch.postHint;`,
    `  if (patch && typeof patch.videoHint === "string") videoHint = patch.videoHint;`,
    `  if (patch && typeof patch.hasTemplate === "boolean") hasTemplate = patch.hasTemplate;`,
    `  if (patch && typeof patch.includeReplies === "boolean") includeReplies = patch.includeReplies;`,
    `};`,
    // Fake background + engine (scope sama dengan fungsi asli).
    `const bgLog = [];`,
    `const chrome = { runtime: { sendMessage: async (msg) => {`,
    `  bgLog.push(msg.type + (msg.cmd ? ":" + msg.cmd : ""));`,
    `  const t = msg.type;`,
    `  if (t === "ENGINE_CMD") {`,
    `    if (msg.cmd === "PING") return { ok: true };`,
    `    if (msg.cmd === "START") {`,
    `      engineRunId = msg.options.runId || null;`,
    // Engine selesai SEKETIKA: DONE sinkron — status done + nama engine
    // terpasang sebelum START mengembalikan (rekapSend tak perlu menunggu
    // poll 800ms; tidak ada timer menggantung).
    `      window.__dispatch({ source: INJECT_SOURCE, type: "DONE", names: ${JSON.stringify(opts.engineNames || ["Nama Engine"])}, runId: msg.options.runId, stopReason: "complete" });`,
    `      return { ok: true };`,
    `    }`,
    `    if (msg.cmd === "SET_TEMPLATE") return { ok: true };`,
    `    if (msg.cmd === "STOP") return { ok: true };`,
    `    return { ok: true };`,
    `  }`,
    `  if (t === "CHECK_FB_LOGIN" || t === "CHECK_TT_LOGIN" || t === "CHECK_IG_LOGIN") return { loggedIn: true };`,
    `  if (t === "GET_TEMPLATE") return { ok: true, url: null };`,
    `  if (t === "GET_STATE") return { ok: true, state: {} };`,
    `  return { ok: true };`,
    `} } };`,
    // Listener pesan engine ASLI — didaftarkan ke fake window.
    extractMessageListener(src),
    `return { run: rekapSend, start: startExtract, messages, bgLog, getStatus: () => status, getNames: () => names, getEngineRunId: () => engineRunId${opts.stubTimers ? ", scheduledTimers" : ""} };`
  );
  // join("\n") WAJIB — new Function(array) meng-join dengan koma → SyntaxError.
  return new Function(body.join("\n"))();
}

// ===================== Test =====================

test("rekapSend facebook: data-utime → hint lengkap diteruskan + postedAt di body API (E2E)", async () => {
  const local = new Date(2026, 7, 9, 7, 30, 0);
  const utime = Math.floor(local.getTime() / 1000);
  await withReSoMocks(async ({ sent, apiCalls }) => {
    globalThis.document = makeDoc({ utime, utimeText: "9 Agu pukul 07.30" });
    const h = makeRekapHarness("facebook", { names: ["Andi Wijaya", "Budi Santoso"] });
    await h.run();

    // 1) Hint yang diterima sendNamesToResoApi — dari scanner ASLI.
    assert.equal(sent.length, 1, "sendNamesToResoApi dipanggil sekali");
    assert.equal(sent[0].platform, "facebook");
    assert.deepEqual(sent[0].names, ["Andi Wijaya", "Budi Santoso"]);
    assert.deepEqual(sent[0].hint, {
      suggestedDate: "2026-08-09",
      suggestedTime: "07:30",
      suggestedIso: "2026-08-09T07:30",
      label: "9 Agu pukul 07.30",
    });

    // 2) Rantai penuh: hint → body API (sendNamesToResoApi asli + fetch asli).
    assert.equal(apiCalls.length, 1, "satu POST /api/engagement");
    assert.equal(apiCalls[0].body.platform, "facebook");
    assert.deepEqual(apiCalls[0].body.names, ["Andi Wijaya", "Budi Santoso"]);
    assert.equal(apiCalls[0].body.date, "2026-08-09");
    assert.equal(apiCalls[0].body.postedAt, "2026-08-09T07:30", "postedAt = suggestedIso");

    // 3) Pesan panel memuat label deteksi.
    assert.ok(h.messages.at(-1).startsWith("Post ~9 Agu pukul 07.30 — "), "pesan memuat label post");
    assert.ok(h.messages.at(-1).includes("Terkirim ke rekap"), "pesan sukses API");
  });
});

test("rekapSend instagram: time[datetime] Z → dikonversi lokal → hint + postedAt (E2E)", async () => {
  const exp = localOf(Date.UTC(2026, 7, 9, 7, 30, 0)); // zona-waktu netral
  await withReSoMocks(async ({ sent, apiCalls }) => {
    globalThis.document = makeDoc({
      timeAttr: "2026-08-09T07:30:00.000Z",
      timeText: "9 Agu",
    });
    const h = makeRekapHarness("instagram", { names: ["andiw", "budi_s"] });
    await h.run();

    assert.equal(sent[0].platform, "instagram");
    assert.deepEqual(sent[0].hint, {
      suggestedDate: exp.date,
      suggestedTime: exp.time,
      suggestedIso: `${exp.date}T${exp.time}`,
      label: "9 Agu",
    });
    assert.equal(apiCalls[0].body.postedAt, `${exp.date}T${exp.time}`, "postedAt = ISO lokal hasil konversi");
    assert.equal(apiCalls[0].body.platform, "instagram");
    assert.ok(h.messages.at(-1).startsWith("Post ~9 Agu — "));
  });
});

test("rekapSend tiktok: createTime rehydration MENANG atas scan DOM → postedAt (E2E)", async () => {
  const local = new Date(2026, 7, 9, 7, 30, 0);
  const ct = Math.floor(local.getTime() / 1000);
  const other = new Date(2026, 7, 10, 9, 0, 0); // tanggal BERBEDA di DOM (data-utime)
  await withReSoMocks(async ({ sent, apiCalls }) => {
    globalThis.document = makeDoc({
      utime: Math.floor(other.getTime() / 1000),
      utimeText: "10 Agu pukul 09.00",
      rehydrate: {
        __DEFAULT_SCOPE__: {
          "webapp.video-detail": {
            itemInfo: { itemStruct: { createTime: ct } },
          },
        },
      },
    });
    const h = makeRekapHarness("tiktok", { names: ["@buditk", "citra"] });
    await h.run();

    assert.equal(sent[0].platform, "tiktok");
    assert.deepEqual(sent[0].hint, {
      suggestedDate: "2026-08-09",
      suggestedTime: "07:30",
      suggestedIso: "2026-08-09T07:30",
      label: "2026-08-09 07:30",
    });
    assert.equal(
      apiCalls[0].body.postedAt,
      "2026-08-09T07:30",
      "rehydration mengalahkan data-utime DOM (jalur prioritas TikTok)"
    );
    assert.ok(h.messages.at(-1).startsWith("Post ~2026-08-09 07:30 — "));
  });
});

test("rekapSend (3 platform): DOM tanpa tanggal → hint {} tanpa postedAt (API default hari ini)", async () => {
  for (const p of ["facebook", "tiktok", "instagram"]) {
    await withReSoMocks(async ({ sent, apiCalls }) => {
      globalThis.document = makeDoc({});
      const h = makeRekapHarness(p, { names: ["Nama Satu"] });
      await h.run();

      assert.deepEqual(sent[0].hint, {}, `${p}: hint kosong diteruskan (fallback hari ini)`);
      assert.ok(!("postedAt" in apiCalls[0].body), `${p}: tanpa postedAt di body`);
      assert.equal(apiCalls[0].body.names.length, 1, `${p}: nama tetap terkirim`);
    });
  }
});

test("rekapSend (3 platform): tanpa nama → tidak kirim, pesan jelas", async () => {
  for (const p of ["facebook", "tiktok", "instagram"]) {
    await withReSoMocks(async ({ sent, apiCalls }) => {
      globalThis.document = makeDoc({});
      const h = makeRekapHarness(p, { names: [] });
      await h.run();

      assert.equal(sent.length, 0, `${p}: sendNamesToResoApi tidak dipanggil`);
      assert.equal(apiCalls.length, 0, `${p}: tanpa POST API`);
      assert.equal(h.messages[0], "Tidak ada nama untuk dikirim ke ReSo.", `${p}: pesan tanpa nama`);
    });
  }
});

// ===================== Jalur kegagalan (pesan error di panel) =====================

/** DOM data-utime 2026-08-09 pukul 07:30 (lokal) — deteksi tanggal yang sama
 *  untuk ketiga platform (jalur scan; tanpa rehydration TikTok). */
function docWithDate() {
  const local = new Date(2026, 7, 9, 7, 30, 0);
  return makeDoc({ utime: Math.floor(local.getTime() / 1000), utimeText: "9 Agu pukul 07.30" });
}

test("rekapSend (3 platform): API balas error → pesan error di panel, postedAt tetap dikirim", async () => {
  for (const p of ["facebook", "tiktok", "instagram"]) {
    await withReSoMocks(
      async ({ sent, apiCalls }) => {
        globalThis.document = docWithDate();
        const h = makeRekapHarness(p, { names: ["Nama Satu"] });
        await h.run();

        assert.equal(sent.length, 1, `${p}: sendNamesToResoApi tetap dipanggil`);
        assert.deepEqual(sent[0].hint.suggestedIso, "2026-08-09T07:30", `${p}: hint diteruskan walau API error`);
        assert.equal(apiCalls[0].body.postedAt, "2026-08-09T07:30", `${p}: postedAt tetap dikirim`);
        // Jalur A: sendNamesToResoApi mengembalikan {ok:false, message} →
        // panel menampilkan pesan API dengan prefix label post.
        assert.ok(h.messages.at(-1).startsWith("Post ~9 Agu pukul 07.30 — "), `${p}: prefix label dipertahankan`);
        assert.ok(h.messages.at(-1).endsWith("Tanggal tidak valid"), `${p}: pesan error API tampil di panel`);
      },
      { apiStatus: 400, apiBody: { error: "Tanggal tidak valid" } }
    );
  }
});

test("rekapSend (3 platform): fetch gagal (network) → pesan kegagalan jaringan di panel", async () => {
  for (const p of ["facebook", "tiktok", "instagram"]) {
    await withReSoMocks(
      async ({ sent, apiCalls }) => {
        globalThis.document = docWithDate();
        const h = makeRekapHarness(p, { names: ["Nama Satu"] });
        await h.run();

        assert.equal(sent.length, 1, `${p}: sendNamesToResoApi tetap dipanggil`);
        assert.equal(apiCalls[0].body.postedAt, "2026-08-09T07:30", `${p}: body dibangun lengkap sebelum fetch gagal`);
        // sendNamesToResoApi menangkap TypeError → {ok:false, message} —
        // pesan panel menyebut kegagalan + detail error jaringan.
        assert.ok(h.messages.at(-1).includes("Gagal kirim ke ReSo"), `${p}: pesan kegagalan kirim`);
        assert.ok(h.messages.at(-1).includes("network down"), `${p}: detail error jaringan muncul`);
      },
      { fetchError: new TypeError("network down") }
    );
  }
});

test("rekapSend (3 platform): sendNamesToResoApi melempar → catch panel 'Gagal kirim ke ReSo: …'", async () => {
  for (const p of ["facebook", "tiktok", "instagram"]) {
    await withReSoMocks(
      async ({ sent }) => {
        globalThis.document = docWithDate();
        const h = makeRekapHarness(p, { names: ["Nama Satu"] });
        await h.run();

        assert.equal(sent.length, 1, `${p}: hint tetap dibangun & diteruskan sebelum throw`);
        assert.equal(sent[0].hint.suggestedIso, "2026-08-09T07:30", `${p}: hint utuh saat throw`);
        // Jalur B: catch luar rekapSend — pesan TANPA prefix label
        // (perilaku saat ini; test mengunci bentuk pesannya).
        assert.equal(h.messages.at(-1), "Gagal kirim ke ReSo: boom", `${p}: catch rekapSend menampilkan error`);
      },
      { sendThrows: new Error("boom") }
    );
  }
});

// ===================== startExtract ASLI: cooldown & urutan engine→kirim =====================

test("rekapSend + startExtract ASLI: engine dijalankan SEBELUM kirim, nama engine yang terkirim (3 platform)", async () => {
  // engineNames = nama mentah dari DONE engine; expected = hasil normalisasi
  // content script (mergeNames → normalize platform, mis. TT buang "@").
  const CASES = {
    facebook: { engineNames: ["Andi Wijaya"], expected: ["Andi Wijaya"] },
    tiktok: { engineNames: ["@buditk"], expected: ["buditk"] },
    instagram: { engineNames: ["andiw"], expected: ["andiw"] },
  };
  for (const p of ["facebook", "tiktok", "instagram"]) {
    const h = makeFullHarness(p, { engineNames: CASES[p].engineNames });
    const log = h.bgLog;
    await withReSoMocks(
      async ({ sent, apiCalls }) => {
        globalThis.document = docWithDate();
        await h.run();

        // startExtract asli menjalankan engine sungguhan (bukan stub).
        assert.equal(h.getStatus(), "done", `${p}: status done dari DONE engine`);
        assert.deepEqual(h.getNames(), CASES[p].expected, `${p}: nama hasil engine terpasang (ternormalisasi)`);
        assert.ok(log.includes("ENGINE_CMD:START"), `${p}: ENGINE_CMD START dikirim`);
        assert.ok(log.includes("ENGINE_CMD:PING"), `${p}: waitEngineReady men-ping engine`);
        assert.ok(log.includes("CHECK_FB_LOGIN") || log.includes("CHECK_TT_LOGIN") || log.includes("CHECK_IG_LOGIN"), `${p}: pre-check login dijalankan`);
        assert.ok(h.messages.some((m) => m.includes("Selesai — 1 nama") || m.includes("Selesai — 1 username")), `${p}: pesan done engine muncul di panel`);

        // URUTAN: state running → engine START → kirim API (satu timeline).
        assert.ok(
          log.indexOf("SET_STATE") < log.indexOf("ENGINE_CMD:START"),
          `${p}: state running di-set sebelum engine dijalankan`
        );
        assert.ok(
          log.indexOf("ENGINE_CMD:START") < log.indexOf("api:POST"),
          `${p}: engine selesai & run selesai SEBELUM POST /api/engagement`
        );

        // Yang dikirim = hasil engine, bukan stub/state lama.
        assert.deepEqual(sent[0].names, CASES[p].expected, `${p}: API menerima nama hasil engine (ternormalisasi)`);
        assert.equal(sent[0].hint.suggestedIso, "2026-08-09T07:30", `${p}: hint tanggal tetap diteruskan`);
        assert.equal(apiCalls[0].body.postedAt, "2026-08-09T07:30", `${p}: postedAt di body API`);
        assert.ok(h.messages.at(-1).startsWith("Post ~"), `${p}: pesan akhir ber-prefix label`);
      },
      { onPost: () => log.push("api:POST") }
    );
  }
});

test("startExtract ASLI: cooldown antar-run memblokir engine — pesan tunggu + timer dicatat (3 platform)", async () => {
  for (const p of ["facebook", "tiktok", "instagram"]) {
    const h = makeFullHarness(p, { lastRunEndAt: Date.now(), stubTimers: true });
    await h.start();

    assert.equal(h.getStatus(), "idle", `${p}: status tetap idle saat cooldown`);
    assert.ok(
      h.messages.some((m) => /Tunggu \d+ dtk sebelum Proses lagi \(cooldown anti rate-limit\)/.test(m)),
      `${p}: pesan cooldown muncul`
    );
    assert.equal(h.getEngineRunId(), null, `${p}: tidak ada run id`);
    assert.ok(!h.bgLog.includes("ENGINE_CMD:START"), `${p}: engine TIDAK dijalankan saat cooldown`);
    // coolMs = 15_000 − ms yang sudah berlalu sejak run berakhir (toleran).
    assert.ok(
      h.scheduledTimers[0].ms > 14_000 && h.scheduledTimers[0].ms <= 15_000,
      `${p}: jeda cooldown normal ≈ 15 dtk (dapat ${h.scheduledTimers[0].ms})`
    );

    // Simulasi cooldown selesai → pesan siap mulai lagi.
    h.scheduledTimers[0].cb();
    assert.ok(h.messages.some((m) => m.includes("Cooldown selesai")), `${p}: pesan setelah cooldown selesai`);
  }
});

test("startExtract ASLI: cooldown rate-limit lebih lama (60 dtk) — engine tetap diblokir (3 platform)", async () => {
  for (const p of ["facebook", "tiktok", "instagram"]) {
    const h = makeFullHarness(p, { lastRateLimitAt: Date.now(), stubTimers: true });
    await h.start();

    // coolMs = 60_000 − ms berlalu sejak rate limit (toleran).
    assert.ok(
      h.scheduledTimers[0].ms > 59_000 && h.scheduledTimers[0].ms <= 60_000,
      `${p}: cooldown rate-limit ≈ 60 dtk (dapat ${h.scheduledTimers[0].ms})`
    );
    assert.ok(h.messages.some((m) => /Tunggu 60 dtk/.test(m)), `${p}: pesan menunggu 60 dtk`);
    assert.ok(!h.bgLog.includes("ENGINE_CMD:START"), `${p}: engine tidak dijalankan`);
    assert.equal(h.getEngineRunId(), null, `${p}: tidak ada run id`);
  }
});
