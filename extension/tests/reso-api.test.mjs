/**
 * ReSo API (Opsi C) — kirim langsung ke database via /api/engagement.
 * Test perilaku NYATA shared.js:
 *  - token tersimpan valid → kirim dengan Bearer,
 *  - token kedaluwarsa → handoff dari tab ReSo yang terbuka,
 *  - tanpa token tersimpan → handoff dari tab ReSo yang terbuka,
 *  - tanpa apa pun → needsLogin (tidak fetch),
 *  - jwtExpSeconds decode,
 *  - content-reso.js: branch GET_AUTH_TOKEN (CustomEvent round trip).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sendNamesToResoApi,
  ensureResoIdToken,
  handoffResoAuthFromTab,
  jwtExpSeconds,
  getResoAuth,
  setResoAuth,
  enqueueResoPayload,
  flushResoQueue,
  checkResoConnection,
  getResoPending,
  getResoUrl,
  setResoUrl,
  applyResoConnect,
  RESO_URL,
  RESO_DEV_URL,
  RESO_FIREBASE,
} from "../shared-module.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** JWT palsu dengan exp (detik). */
function fakeToken(expSeconds) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ exp: expSeconds })}.sig`;
}
/** JWT palsu dengan exp + aud (projectId Firebase). */
function fakeTokenAud(expSeconds, aud) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ exp: expSeconds, aud })}.sig`;
}
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 3600;
const EXPIRED = Math.floor(Date.now() / 1000) - 3600;

let apiCalls = [];
let mintCalls = [];

function mockFetch(routes) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    let body = null;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    const record = { url: u, init, body };
    if (u.includes("/api/engagement")) {
      apiCalls.push(record);
      const r = routes.api || { ok: true, date: "2026-08-17", added: 2, existing: 1 };
      return new Response(JSON.stringify(r), { status: r.ok ? 200 : r.status || 400 });
    }
    if (u.includes("/api/health")) {
      return new Response(JSON.stringify({ ok: true }), { status: routes.health === false ? 500 : 200 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
  return () => {
    globalThis.fetch = orig;
  };
}

function mockChrome({ storage = {}, tabs = [], runtime = null, tabsQueryError = null } = {}) {
  const store = { ...storage };
  const orig = globalThis.chrome;
  const chrome = {
    storage: {
      local: {
        get: async (k) => ({ [k]: store[k] ?? null }),
        set: async (o) => Object.assign(store, o),
        remove: async (keys) => {
          for (const k of [].concat(keys)) delete store[k];
        },
      },
    },
    // `runtime` opsional: konteks content script TIDAK punya chrome.tabs tapi
    // PUNYA chrome.runtime.sendMessage (delegasi handoff ke background).
    ...(runtime ? { runtime } : {}),
  };
  // `tabs === null` → simulasikan konteks content script (chrome.tabs TIDAK ada).
  if (tabs !== null) {
    chrome.tabs = {
      query: async () => {
        if (tabsQueryError) throw tabsQueryError;
        return tabs;
      },
      // Tab tanpa `reply` → balasan handoff standar (backward-compat);
      // `throwMsg: true` → sendMessage menolak (mis. tab tanpa content script).
      sendMessage: async (id) => {
        const t = tabs.find((x) => x.id === id);
        if (t?.throwMsg) throw new Error("no receiver");
        return t && "reply" in t
          ? t.reply
          : { idToken: "tok-handoff", refreshToken: "rt-handoff" };
      },
    };
  }
  globalThis.chrome = chrome;
  return { store, restore: () => { globalThis.chrome = orig; } };
}

test("sendNamesToResoApi: token valid tersimpan → POST /api/engagement dengan Bearer + body benar", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({ api: { ok: true, date: "2026-08-17", added: 2, existing: 1 } });
  const { restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() } },
  });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi Wijaya", "budi"], {
      suggestedDate: "2026-08-17",
      label: "Kemarin",
    });
    assert.equal(out.ok, true, "ok");
    assert.equal(out.date, "2026-08-17");
    assert.equal(out.added, 2);
    assert.equal(out.existing, 1);
    assert.equal(apiCalls.length, 1, "satu panggilan API");
    assert.equal(apiCalls[0].init.headers.Authorization, "Bearer " + fakeToken(FAR_FUTURE));
    assert.deepEqual(apiCalls[0].body, { platform: "facebook", names: ["Andi Wijaya", "budi"], date: "2026-08-17" });
    assert.equal(mintCalls.length, 0, "tanpa mint — token masih valid (refreshToken null)");
  } finally {
    restoreFetch();
    restore();
  }
});

test("sendNamesToResoApi: hint.suggestedIso → body memuat postedAt; tanpa/rusak → tidak ada", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({ api: { ok: true, date: "2026-08-09", added: 1, existing: 0 } });
  const { restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() } },
  });
  try {
    await sendNamesToResoApi("facebook", ["Andi Wijaya"], {
      suggestedDate: "2026-08-09",
      suggestedIso: "2026-08-09T07:30",
      label: "9 Agu pukul 07.30",
    });
    assert.equal(apiCalls[0].body.date, "2026-08-09");
    assert.equal(apiCalls[0].body.postedAt, "2026-08-09T07:30", "postedAt dikirim dari suggestedIso");
    // tanpa suggestedIso → key postedAt tidak ada
    apiCalls = [];
    await sendNamesToResoApi("facebook", ["Andi Wijaya"], { suggestedDate: "2026-08-09", label: "Kemarin" });
    assert.ok(!("postedAt" in apiCalls[0].body), "tanpa suggestedIso → postedAt tidak dikirim");
    // suggestedIso rusak → diabaikan
    apiCalls = [];
    await sendNamesToResoApi("facebook", ["Andi Wijaya"], { suggestedDate: "2026-08-09", suggestedIso: "rusak" });
    assert.ok(!("postedAt" in apiCalls[0].body), "suggestedIso rusak → postedAt tidak dikirim");
  } finally {
    restoreFetch();
    restore();
  }
});

test("sendNamesToResoApi: token kedaluwarsa → handoff dari tab, lalu kirim", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({ api: { ok: true, date: "2026-08-17", added: 0, existing: 1 } });
  const { store, restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(EXPIRED), refreshToken: null, savedAt: Date.now() } },
    tabs: [{ id: 9, url: RESO_URL, reply: { idToken: "tok-segar", refreshToken: "", uid: "u1", email: "a@b.c" } }],
  });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi"], {});
    assert.equal(out.ok, true, "ok");
    assert.equal(apiCalls[0].init.headers.Authorization, "Bearer tok-segar", "pakai token hasil handoff");
    assert.equal(store.resoAuth.idToken, "tok-segar", "storage diperbarui dengan token handoff");
  } finally {
    restoreFetch();
    restore();
  }
});

test("sendNamesToResoApi: tanpa token tersimpan → handoff dari tab ReSo terbuka", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({ api: { ok: true, date: "2026-08-16", added: 1, existing: 0 } });
  const { store, restore } = mockChrome({
    storage: {},
    tabs: [{ id: 5, url: RESO_URL }],
  });
  try {
    const out = await sendNamesToResoApi("instagram", ["andiw"], { suggestedDate: "2026-08-16" });
    assert.equal(out.ok, true, "ok");
    assert.equal(apiCalls[0].init.headers.Authorization, "Bearer tok-handoff", "token hasil handoff");
    assert.equal(store.resoAuth.idToken, "tok-handoff", "handoff disimpan ke storage");
    assert.equal(store.resoAuth.refreshToken, "rt-handoff");
  } finally {
    restoreFetch();
    restore();
  }
});

test("sendNamesToResoApi: tidak ada token & tidak ada tab → needsLogin, tanpa fetch API", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({});
  const { restore } = mockChrome({ storage: {}, tabs: [] });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi"], {});
    assert.equal(out.ok, false);
    assert.equal(out.needsLogin, true);
    assert.match(out.message, /Buka ReSo/);
    assert.equal(apiCalls.length, 0, "tidak ada panggilan API");
  } finally {
    restoreFetch();
    restore();
  }
});

test("sendNamesToResoApi: tanpa hint → tanggal hari ini lokal", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({ api: { ok: true, date: "2026-08-17", added: 1, existing: 0 } });
  const { restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() } },
  });
  try {
    const out = await sendNamesToResoApi("tiktok", ["@buditk"], {});
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    assert.equal(apiCalls[0].body.date, iso, "tanggal default = hari ini lokal");
    assert.equal(out.ok, true);
  } finally {
    restoreFetch();
    restore();
  }
});

test("sendNamesToResoApi: unmatched dari respons API → diparse + masuk pesan sukses", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({ api: { ok: true, date: "2026-08-17", added: 1, existing: 0, unmatched: 2 } });
  const { restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() } },
  });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi", "Budi", "Citra"], {});
    assert.equal(out.ok, true, "ok");
    assert.equal(out.unmatched, 2, "unmatched diparse dari respons API");
    assert.match(
      out.message,
      /2 nama belum terpetakan di ReSo/,
      "pesan sukses menyebut jumlah nama belum terpetakan"
    );
    assert.match(
      out.message,
      /buka dashboard untuk memetakan/,
      "pesan memberi arah memetakan di dashboard"
    );
  } finally {
    restoreFetch();
    restore();
  }
});

test("sendNamesToResoApi: tanpa field unmatched di respons → 0 & pesan tanpa sebutan belum terpetakan", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({ api: { ok: true, date: "2026-08-17", added: 1, existing: 0 } });
  const { restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() } },
  });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi"], {});
    assert.equal(out.ok, true, "ok");
    assert.equal(out.unmatched, 0, "tanpa field → 0");
    assert.equal(
      out.message.includes("belum terpetakan"),
      false,
      "tanpa antrian → pesan tidak menyebut belum terpetakan"
    );
    assert.match(out.message, /Terkirim ke rekap/, "pesan sukses normal tetap ada");
  } finally {
    restoreFetch();
    restore();
  }
});

test("jwtExpSeconds: decode exp benar; token rusak → 0", () => {
  const exp = 4102444800;
  assert.equal(jwtExpSeconds(fakeToken(exp)), exp);
  assert.equal(jwtExpSeconds("not.a.jwt"), 0);
  assert.equal(jwtExpSeconds(""), 0);
  assert.equal(jwtExpSeconds(fakeToken(exp).split(".")[0] + ".xx.yy"), 0);
});

test("ensureResoIdToken: prioritas — fresh → handoff → null", async () => {
  const restoreFetch = mockFetch({});
  try {
    const a = mockChrome({ storage: { resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() } }, tabs: [] });
    assert.equal(await ensureResoIdToken(), fakeToken(FAR_FUTURE), "fresh dipakai langsung");
    a.restore();

    const b = mockChrome({ storage: {}, tabs: [{ id: 3, url: RESO_URL }] });
    assert.equal(await ensureResoIdToken(), "tok-handoff", "tanpa token → handoff");
    b.restore();

    const c = mockChrome({ storage: {}, tabs: [] });
    assert.equal(await ensureResoIdToken(), null, "tanpa apa pun → null");
    c.restore();
  } finally {
    restoreFetch();
  }
});

test("ensureResoIdToken: expired + tab terbuka → handoff", async () => {
  const restoreFetch = mockFetch({});
  const { store, restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(EXPIRED), refreshToken: null, savedAt: Date.now() } },
    tabs: [{ id: 9, url: RESO_URL, reply: { idToken: "tok-segar", refreshToken: "", uid: "u1", email: "a@b.c" } }],
  });
  try {
    const tok = await ensureResoIdToken();
    assert.equal(tok, "tok-segar", "expired + tab → handoff");
    assert.equal(store.resoAuth.idToken, "tok-segar", "auth diganti hasil handoff");
  } finally {
    restoreFetch();
    restore();
  }
});

test("ensureResoIdToken: expired tanpa tab → null", async () => {
  const restoreFetch = mockFetch({});
  const { store, restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(EXPIRED), refreshToken: null, savedAt: Date.now() } },
    tabs: [],
  });
  try {
    const tok = await ensureResoIdToken();
    assert.equal(tok, null, "tanpa tab → null");
  } finally {
    restoreFetch();
    restore();
  }
});

test("handoffResoAuthFromTab: prefer produksi di atas dev; tab gagal dilewati", async () => {
  const { store, restore } = mockChrome({
    storage: {},
    tabs: [
      { id: 1, url: RESO_DEV_URL, throwMsg: true },
      { id: 2, url: `${RESO_DEV_URL}/feed`, reply: { idToken: "tok-dev", refreshToken: "rt-dev" } },
      { id: 3, url: `${RESO_URL}/dashboard`, reply: { idToken: "tok-prod", refreshToken: "rt-prod" } },
    ],
  });
  try {
    const auth = await handoffResoAuthFromTab();
    assert.equal(auth.idToken, "tok-prod", "tab produksi dipilih walau muncul belakangan");
    assert.equal(store.resoAuth.idToken, "tok-prod", "hasil handoff disimpan ke storage");
  } finally {
    restore();
  }
});

test("handoffResoAuthFromTab: semua tab gagal → null tanpa menulis storage", async () => {
  const { store, restore } = mockChrome({
    storage: {},
    tabs: [
      { id: 1, url: RESO_URL, throwMsg: true },
      { id: 2, url: `${RESO_URL}/x`, reply: null },
    ],
  });
  try {
    const auth = await handoffResoAuthFromTab();
    assert.equal(auth, null, "tanpa token valid → null");
    assert.equal(store.resoAuth, undefined, "tidak menulis storage saat tidak ada token");
  } finally {
    restore();
  }
});

test("handoffResoAuthFromTab: konteks content script (tanpa chrome.tabs) → delegasi ke background via runtime", async () => {
  const { store, restore } = mockChrome({
    storage: {},
    tabs: null, // tabs tidak relevan: content script tidak punya chrome.tabs
    runtime: {
      sendMessage: async (msg) => {
        assert.equal(msg.type, "RESO_HANDOFF_AUTH", "background diminta handoff");
        return { ok: true, auth: { idToken: "tok-bg", refreshToken: "rt-bg" } };
      },
    },
  });
  try {
    const auth = await handoffResoAuthFromTab();
    assert.equal(auth.idToken, "tok-bg", "auth hasil delegasi dipakai");
    assert.equal(store.resoAuth.idToken, "tok-bg", "hasil handoff disimpan ke storage");
    assert.equal(store.resoAuth.refreshToken, "rt-bg");
  } finally {
    restore();
  }
});

test("handoffResoAuthFromTab: delegasi balas tanpa auth → null tanpa menulis storage", async () => {
  const { store, restore } = mockChrome({
    storage: {},
    tabs: null,
    runtime: {
      sendMessage: async () => ({ ok: true, auth: null }),
    },
  });
  try {
    const auth = await handoffResoAuthFromTab();
    assert.equal(auth, null, "tanpa auth → null");
    assert.equal(store.resoAuth, undefined, "storage tidak ditulis");
  } finally {
    restore();
  }
});

test("handoffResoAuthFromTab: runtime.sendMessage melempar → null (tidak crash)", async () => {
  const { store, restore } = mockChrome({
    storage: {},
    tabs: null,
    runtime: {
      sendMessage: async () => {
        throw new Error("background down");
      },
    },
  });
  try {
    const auth = await handoffResoAuthFromTab();
    assert.equal(auth, null, "gagal → null, bukan TypeError");
    assert.equal(store.resoAuth, undefined, "storage tidak ditulis");
  } finally {
    restore();
  }
});

test("sendNamesToResoApi: content script (tanpa chrome.tabs) → handoff via background, lalu POST", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({ api: { ok: true, date: "2026-08-17", added: 1, existing: 0 } });
  const { store, restore } = mockChrome({
    storage: {},
    tabs: null,
    runtime: {
      sendMessage: async () => ({ ok: true, auth: { idToken: "tok-bg", refreshToken: "rt-bg" } }),
    },
  });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi"], {});
    assert.equal(out.ok, true, "ok");
    assert.equal(apiCalls[0].init.headers.Authorization, "Bearer tok-bg", "pakai token hasil handoff background");
    assert.equal(store.resoAuth.idToken, "tok-bg", "handoff disimpan ke storage");
    assert.equal(store.resoAuth.refreshToken, "rt-bg");
  } finally {
    restoreFetch();
    restore();
  }
});

test("sendNamesToResoApi: error tak terduga saat ensureResoIdToken → needsLogin ramah, bukan throw", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({});
  const { restore } = mockChrome({
    storage: {},
    tabs: [],
    tabsQueryError: new Error("chrome.tabs down"),
  });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi"], {});
    assert.equal(out.ok, false);
    assert.equal(out.needsLogin, true, "diubah jadi pesan needsLogin");
    assert.match(out.message, /Buka ReSo/);
    assert.equal(apiCalls.length, 0, "tidak ada panggilan API");
  } finally {
    restoreFetch();
    restore();
  }
});

test("sendNamesToResoApi: gagal jaringan (transien) → masuk antrian, data tidak hilang", async () => {
  apiCalls = [];
  const prevDelay = globalThis.__RESO_RETRY_DELAY_MS;
  globalThis.__RESO_RETRY_DELAY_MS = 0;
  const restoreFetch = mockFetch({});
  const { store, restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() } },
    tabs: [],
  });
  globalThis.fetch = async () => { throw new Error("network down"); };
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi", "budi"], { suggestedDate: "2026-08-17" });
    assert.equal(out.ok, false);
    assert.equal(out.retryable, true, "gagal jaringan = transien");
    assert.ok(out.queued, "kiriman ditandai masuk antrian");
    assert.match(out.message, /antrian ReSo/, "pesan memberi tahu antrian");
    const pending = await getResoPending();
    assert.equal(pending.length, 1, "satu kiriman antri");
    assert.equal(pending[0].platform, "facebook");
    assert.equal(pending[0].date, "2026-08-17");
    assert.deepEqual(pending[0].names, ["Andi", "budi"]);
    assert.equal(store.resoPending.length, 1, "antrian tersimpan di storage");
  } finally {
    globalThis.__RESO_RETRY_DELAY_MS = prevDelay;
    restoreFetch();
    restore();
  }
});

test("sendNamesToResoApi: error 400 definitif → TIDAK masuk antrian", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({
    api: { ok: false, status: 400, error: "Tanggal tidak valid" },
  });
  const { restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() } },
    tabs: [],
  });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi"], { suggestedDate: "rusak" });
    assert.equal(out.ok, false);
    assert.equal(out.retryable, false, "4xx = definitif, jangan retry");
    assert.equal(out.queued, undefined, "tidak di-antri");
    const pending = await getResoPending();
    assert.equal(pending.length, 0, "antrian tetap kosong");
  } finally {
    restoreFetch();
    restore();
  }
});

test("enqueueResoPayload: gabung nama untuk platform+date+postedAt sama (dedupe)", async () => {
  const { store, restore } = mockChrome({ storage: {}, tabs: [] });
  try {
    await enqueueResoPayload({ platform: "facebook", names: ["Andi", "budi"], date: "2026-08-17", postedAt: null });
    await enqueueResoPayload({ platform: "facebook", names: ["Budi", "Citra"], date: "2026-08-17", postedAt: null });
    await enqueueResoPayload({ platform: "tiktok", names: ["@dito"], date: "2026-08-17", postedAt: null });
    const pending = await getResoPending();
    assert.equal(pending.length, 2, "fb digabung, tt terpisah");
    const fb = pending.find((x) => x.platform === "facebook");
    assert.deepEqual(fb.names, ["Andi", "budi", "Citra"], "nama digabung tanpa duplikat");
  } finally {
    restore();
  }
});

test("flushResoQueue: kirim sukses → antrian kosong; transien dipertahankan; definitif dibuang", async () => {
  apiCalls = [];
  let mode = "ok";
  const prevDelay = globalThis.__RESO_RETRY_DELAY_MS;
  globalThis.__RESO_RETRY_DELAY_MS = 0;
  const restoreFetch = mockFetch({});
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/api/engagement")) {
      const body = JSON.parse(init.body);
      apiCalls.push({ url: u, body });
      if (mode === "ok") {
        return new Response(JSON.stringify({ ok: true, date: body.date, added: body.names.length, existing: 0 }), { status: 200 });
      }
      if (mode === "transient") {
        return new Response(JSON.stringify({ error: "boom" }), { status: 503 });
      }
      return new Response(JSON.stringify({ error: "bad" }), { status: 400 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
  const { restore } = mockChrome({
    storage: {
      resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() },
      resoPending: [
        { platform: "facebook", names: ["Andi"], date: "2026-08-17", postedAt: null, createdAt: 1 },
        { platform: "tiktok", names: ["@dito"], date: "2026-08-17", postedAt: null, createdAt: 2 },
        { platform: "instagram", names: ["andiw"], date: "2026-08-17", postedAt: null, createdAt: 3 },
      ],
    },
    tabs: [],
  });
  try {
    mode = "ok";
    const ok = await flushResoQueue();
    assert.equal(ok.sent, 3, "semua terkirim");
    assert.equal(ok.remaining, 0);
    assert.equal((await getResoPending()).length, 0, "antrian kosong setelah sukses");

    // Mode transien: 2 antri, satu gagal 503 → dipertahankan.
    const { store: store2, restore: restore2 } = mockChrome({
      storage: {
        resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() },
        resoPending: [
          { platform: "facebook", names: ["Andi"], date: "2026-08-17", postedAt: null, createdAt: 1 },
          { platform: "tiktok", names: ["@dito"], date: "2026-08-17", postedAt: null, createdAt: 2 },
        ],
      },
      tabs: [],
    });
    mode = "transient";
    const partial = await flushResoQueue();
    assert.equal(partial.sent, 0);
    assert.equal(partial.remaining, 2, "gagal transien → antrian dipertahankan");
    assert.equal(store2.resoPending.length, 2);
    restore2();

    // Mode definitif: 400 → item dibuang (tidak ada gunanya retry).
    const { store: store3, restore: restore3 } = mockChrome({
      storage: {
        resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() },
        resoPending: [
          { platform: "facebook", names: ["Andi"], date: "2026-08-17", postedAt: null, createdAt: 1 },
        ],
      },
      tabs: [],
    });
    mode = "definitive";
    const drop = await flushResoQueue();
    assert.equal(drop.remaining, 0, "definitif dibuang");
    assert.equal(store3.resoPending.length, 0);
    restore3();
  } finally {
    globalThis.__RESO_RETRY_DELAY_MS = prevDelay;
    restoreFetch();
    restore();
  }
});

test("flushResoQueue: tanpa token valid → antrian dipertahankan, needsLogin", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({});
  const { store, restore } = mockChrome({
    storage: {
      resoPending: [{ platform: "facebook", names: ["Andi"], date: "2026-08-17", postedAt: null, createdAt: 1 }],
    },
    tabs: [],
  });
  try {
    const out = await flushResoQueue();
    assert.equal(out.needsLogin, true);
    assert.equal(out.sent, 0);
    assert.equal(out.remaining, 1, "antrian dipertahankan");
    assert.equal(store.resoPending.length, 1);
    assert.equal(apiCalls.length, 0, "tanpa token tidak menyentuh API");
  } finally {
    restoreFetch();
    restore();
  }
});

test("checkResoConnection: token valid + API sehat → connected; pending dihitung", async () => {
  const prevCache = globalThis.__RESO_HEALTH_CACHE_MS;
  globalThis.__RESO_HEALTH_CACHE_MS = 0; // matikan cache probe di test
  const restoreFetch = mockFetch({ health: true });
  const { restore } = mockChrome({
    storage: {
      resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() },
      resoPending: [
        { platform: "facebook", names: ["Andi"], date: "2026-08-17", postedAt: null, createdAt: 1 },
        { platform: "tiktok", names: ["@dito"], date: "2026-08-17", postedAt: null, createdAt: 2 },
      ],
    },
    tabs: [],
  });
  try {
    const s = await checkResoConnection();
    assert.equal(s.connected, true);
    assert.equal(s.authenticated, true);
    assert.equal(s.reachable, true);
    assert.equal(s.pending, 2, "jumlah antrian dihitung");
  } finally {
    globalThis.__RESO_HEALTH_CACHE_MS = prevCache;
    restoreFetch();
    restore();
  }
});

test("checkResoConnection: tanpa auth tapi punya refresh token → authenticated; API mati → tidak connected", async () => {
  const prevCache = globalThis.__RESO_HEALTH_CACHE_MS;
  globalThis.__RESO_HEALTH_CACHE_MS = 0;
  const restoreFetch = mockFetch({ health: false });
  const { restore } = mockChrome({
    storage: {
      resoAuth: { idToken: fakeToken(EXPIRED), refreshToken: "rt-oke", savedAt: Date.now() },
    },
    tabs: [],
  });
  try {
    const s = await checkResoConnection();
    assert.equal(s.authenticated, true, "refresh token = sesi bisa hidup lagi");
    assert.equal(s.reachable, false, "API down");
    assert.equal(s.connected, false, "API tak terjangkau → tidak connected");
    assert.equal(s.pending, 0);
  } finally {
    globalThis.__RESO_HEALTH_CACHE_MS = prevCache;
    restoreFetch();
    restore();
  }
});

test("checkResoConnection: tanpa auth tersimpan tapi tab ReSo terbuka & login → handoff laku, connected", async () => {
  const prevCache = globalThis.__RESO_HEALTH_CACHE_MS;
  globalThis.__RESO_HEALTH_CACHE_MS = 0;
  const restoreFetch = mockFetch({ health: true });
  const { store, restore } = mockChrome({
    storage: {}, // belum ada resoAuth
    tabs: [{ id: 1, url: `${RESO_URL}/`, reply: { idToken: fakeToken(FAR_FUTURE), refreshToken: "rt-handoff", uid: "u1", email: "a@b.c" } }],
  });
  try {
    const s = await checkResoConnection();
    assert.equal(s.authenticated, true, "token di-handoff dari tab ReSo");
    assert.equal(s.reachable, true);
    assert.equal(s.connected, true, "buka ReSo & login → popup harus 'Terhubung'");
    assert.ok(store.resoAuth && store.resoAuth.idToken, "hasil handoff disimpan");
  } finally {
    globalThis.__RESO_HEALTH_CACHE_MS = prevCache;
    restoreFetch();
    restore();
  }
});

test("checkResoConnection: tanpa auth & tidak ada tab ReSo → tidak authenticated (Belum tersambung)", async () => {
  const prevCache = globalThis.__RESO_HEALTH_CACHE_MS;
  globalThis.__RESO_HEALTH_CACHE_MS = 0;
  const restoreFetch = mockFetch({ health: true });
  const { restore } = mockChrome({ storage: {}, tabs: [] });
  try {
    const s = await checkResoConnection();
    assert.equal(s.authenticated, false, "tidak ada sesi yang bisa di-handoff");
    assert.equal(s.connected, false);
  } finally {
    globalThis.__RESO_HEALTH_CACHE_MS = prevCache;
    restoreFetch();
    restore();
  }
});

test("checkResoConnection: tab ReSo terbuka tapi belum login (no-user) → tidak authenticated", async () => {
  const prevCache = globalThis.__RESO_HEALTH_CACHE_MS;
  globalThis.__RESO_HEALTH_CACHE_MS = 0;
  const restoreFetch = mockFetch({ health: true });
  const { restore } = mockChrome({
    storage: {},
    tabs: [{ id: 1, url: `${RESO_URL}/`, reply: { error: "no-user" } }],
  });
  try {
    const s = await checkResoConnection();
    assert.equal(s.authenticated, false, "handoff gagal (belum login) → tetap butuh login");
    assert.equal(s.connected, false);
  } finally {
    globalThis.__RESO_HEALTH_CACHE_MS = prevCache;
    restoreFetch();
    restore();
  }
});

test("enqueueResoPayload: konteks content script → delegasi RESO_ENQUEUE ke background (single-writer)", async () => {
  let received = null;
  const { store, restore } = mockChrome({
    storage: {},
    tabs: null, // content script: chrome.tabs TIDAK ada
    runtime: {
      sendMessage: async (msg) => { received = msg; return { ok: true }; },
    },
  });
  try {
    await enqueueResoPayload({ platform: "facebook", names: ["Andi", "budi"], date: "2026-08-17", postedAt: null });
    assert.equal(received.type, "RESO_ENQUEUE", "background yang menulis");
    assert.equal(received.payload.platform, "facebook");
    assert.equal(received.payload.date, "2026-08-17");
    assert.equal(store.resoPending, undefined, "content script tidak menulis storage langsung");
  } finally {
    restore();
  }
});

test("getResoUrl: default RESO_URL bila belum diset, lalu domain dipelajari dari app push", async () => {
  const { restore } = mockChrome({ storage: {} });
  try {
    assert.equal(await getResoUrl(), RESO_URL, "default sebelum ada push");
    await applyResoConnect({
      url: "https://rekapsosmed.vercel.app/",
      idToken: fakeTokenAud(FAR_FUTURE, RESO_FIREBASE.projectId),
      refreshToken: "rt",
    });
    assert.equal(await getResoUrl(), "https://rekapsosmed.vercel.app", "pakai domain dari push (strip path)");
  } finally {
    restore();
  }
});

test("applyResoConnect: tolak url bukan https & tanpa idToken; simpan bila valid", async () => {
  const { restore } = mockChrome({ storage: {} });
  try {
    assert.equal(await applyResoConnect({ url: "ftp://x", idToken: "t" }), false, "skema salah → tolak");
    assert.equal(await applyResoConnect({ url: "https://a.vercel.app", idToken: "" }), false, "tanpa idToken → tolak");
    assert.equal(
      await applyResoConnect({
        url: "https://rekapsosmed.vercel.app",
        idToken: fakeTokenAud(FAR_FUTURE, RESO_FIREBASE.projectId),
        refreshToken: "rt",
        uid: "u",
        email: "e@f.g",
      }),
      true,
      "valid → tersimpan"
    );
    const a = await getResoAuth();
    assert.equal(a.idToken, fakeTokenAud(FAR_FUTURE, RESO_FIREBASE.projectId));
    assert.equal(a.refreshToken, "rt");
  } finally {
    restore();
  }
});

test("applyResoConnect: tolak token dari project Firebase lain (aud != RESO_FIREBASE.projectId)", async () => {
  const { restore } = mockChrome({ storage: {} });
  try {
    assert.equal(
      await applyResoConnect({
        url: "https://rekapsosmed.vercel.app",
        idToken: fakeTokenAud(FAR_FUTURE, "wrong-project-id"),
      }),
      false,
      "aud salah → tolak (cegah situs asing suntik token)"
    );
  } finally {
    restore();
  }
});

test("applyResoConnect: pin manual (resoUrl) mengalahkan url app yang berbeda", async () => {
  const { restore } = mockChrome({ storage: { resoUrl: "https://reso.vercel.app" } });
  try {
    assert.equal(
      await applyResoConnect({
        url: "https://rekapsosmed.vercel.app",
        idToken: fakeTokenAud(FAR_FUTURE, RESO_FIREBASE.projectId),
      }),
      false,
      "app push domain lain ditolak bila sudah di-pin"
    );
    assert.equal(await getResoUrl(), "https://reso.vercel.app", "tetap pakai pin");
  } finally {
    restore();
  }
});

test("sendNamesToResoApi: POST ke domain yang dipelajari (bukan hardcoded reso.vercel.app)", async () => {
  apiCalls = [];
  const prevCache = globalThis.__RESO_HEALTH_CACHE_MS;
  globalThis.__RESO_HEALTH_CACHE_MS = 0;
  const restoreFetch = mockFetch({ health: true });
  const { restore } = mockChrome({
    storage: {
      resoUrl: "https://rekapsosmed.vercel.app",
      resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() },
    },
    tabs: [],
  });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi"], {});
    assert.equal(out.ok, true, "kirim sukses ke domain dipelajari");
    assert.ok(apiCalls.length === 1 && apiCalls[0].url.includes("rekapsosmed.vercel.app/api/engagement"), "POST ke domain benar");
  } finally {
    globalThis.__RESO_HEALTH_CACHE_MS = prevCache;
    restoreFetch();
    restore();
  }
});

test("checkResoConnection: health di-probe ke domain dipelajari", async () => {
  const prevCache = globalThis.__RESO_HEALTH_CACHE_MS;
  globalThis.__RESO_HEALTH_CACHE_MS = 0;
  let healthUrl = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/health")) healthUrl = String(url);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const { restore } = mockChrome({
    storage: {
      resoUrl: "https://rekapsosmed.vercel.app",
      resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() },
    },
    tabs: [],
  });
  try {
    const s = await checkResoConnection();
    assert.equal(s.connected, true);
    assert.ok(healthUrl && healthUrl.includes("rekapsosmed.vercel.app/api/health"), "health probe ke domain benar");
  } finally {
    globalThis.__RESO_HEALTH_CACHE_MS = prevCache;
    globalThis.fetch = origFetch;
    restore();
  }
});

test("enqueueResoPayload: delegasi gagal → fallback tulis lokal (data tidak hilang)", async () => {
  const { store, restore } = mockChrome({
    storage: {},
    tabs: null,
    runtime: {
      sendMessage: async () => { throw new Error("background down"); },
    },
  });
  try {
    await enqueueResoPayload({ platform: "tiktok", names: ["@dito"], date: "2026-08-17", postedAt: null });
    assert.equal(store.resoPending.length, 1, "fallback menulis lokal");
    assert.equal(store.resoPending[0].platform, "tiktok");
    assert.deepEqual(store.resoPending[0].names, ["@dito"]);
  } finally {
    restore();
  }
});

test("sendNamesToResoApi: 401 (token basi) → retryable + masuk antrian (tidak hilang)", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({
    api: { ok: false, status: 401, error: "Token ReSo tidak valid atau kedaluwarsa." },
  });
  const { restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() } },
    tabs: [],
  });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi"], {});
    assert.equal(out.ok, false);
    assert.equal(out.retryable, true, "401 = bisa me-mint ulang → retryable");
    assert.equal(out.queued, true, "di-antri supaya di-flush dengan token segar");
    assert.equal((await getResoPending()).length, 1);
  } finally {
    restoreFetch();
    restore();
  }
});

test("flushResoQueue: 401 di tengah flush → item dipertahankan & berhenti (re-auth, data tidak hilang)", async () => {
  apiCalls = [];
  const restoreFetch = mockFetch({});
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/engagement")) {
      return new Response(JSON.stringify({ error: "Token basi" }), { status: 401 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
  const { store, restore } = mockChrome({
    storage: {
      resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: null, savedAt: Date.now() },
      resoPending: [
        { platform: "facebook", names: ["Andi"], date: "2026-08-17", postedAt: null, createdAt: 1 },
        { platform: "tiktok", names: ["@dito"], date: "2026-08-17", postedAt: null, createdAt: 2 },
      ],
    },
    tabs: [],
  });
  try {
    const out = await flushResoQueue();
    assert.equal(out.sent, 0);
    assert.equal(out.needsLogin, true, "token basi → berhenti, minta re-auth");
    assert.equal(out.remaining, 2, "antrian penuh dipertahankan");
    assert.equal(store.resoPending.length, 2, "tidak ada item yang dibuang");
  } finally {
    restoreFetch();
    restore();
  }
});

test("config ReSoEx: RESO_FIREBASE selaras dengan firebase-applet-config.json repo (anti-drift)", () => {
  const cfg = JSON.parse(
    readFileSync(new URL("../../firebase-applet-config.json", import.meta.url), "utf8")
  );
  assert.equal(RESO_FIREBASE.projectId, cfg.projectId, "projectId sinkron dengan repo");
  assert.equal(RESO_FIREBASE.databaseId, cfg.firestoreDatabaseId, "firestoreDatabaseId sinkron");
  assert.equal(RESO_FIREBASE.apiKey, cfg.apiKey, "apiKey sinkron");
});

/** Muat content-reso.js ke window stub. Kembalikan { win, listener }. */
const EXT_ID = "reso-ekstention-test";
function loadBridge(origin = "https://reso.vercel.app") {
  const code = readFileSync(new URL("../content-reso.js", import.meta.url), "utf8");
  let listener = null;
  const win = {
    location: { origin },
    __listeners: {},
    addEventListener(type, cb) { (this.__listeners[type] ||= []).push(cb); },
    removeEventListener(type, cb) {
      this.__listeners[type] = (this.__listeners[type] || []).filter((f) => f !== cb);
    },
    dispatchEvent(ev) {
      for (const cb of this.__listeners[ev.type] || []) cb(ev);
      return true;
    },
  };
  new Function("window", "chrome", code)(win, {
    id: EXT_ID,
    runtime: { id: EXT_ID, onMessage: { addListener(cb) { listener = cb; } } },
  });
  assert.ok(listener, "listener terpasang");
  return { win, listener };
}

const sendReq = (listener, sender = { id: EXT_ID }) =>
  new Promise((resolve) => listener({ type: "GET_AUTH_TOKEN" }, sender, resolve));

test("content-reso.js: GET_AUTH_TOKEN → channel unik + echo origin → sendResponse", async () => {
  const { win, listener } = loadBridge();
  const seen = [];
  // Aplikasi: baca request, balas di channel respondTo (persis token-handoff ReSo).
  win.addEventListener("reso:get-token", (e) => {
    const d = e.detail;
    seen.push(d);
    win.dispatchEvent(new CustomEvent(d.respondTo, {
      detail: { requestId: d.requestId, origin: d.origin, idToken: "tok9", refreshToken: "rt9", uid: "u1", email: "a@b.c" },
    }));
  });
  const resp = sendReq(listener);
  await flush();
  assert.equal(seen.length, 1, "satu permintaan diteruskan");
  assert.ok(seen[0].requestId, "requestId ada");
  assert.equal(seen[0].origin, "https://reso.vercel.app", "origin ikut request");
  assert.ok(
    /^reso:token-response-[a-zA-Z0-9_-]+$/.test(seen[0].respondTo),
    "channel respons unik per permintaan"
  );
  const out = await resp;
  assert.deepEqual(out, { idToken: "tok9", refreshToken: "rt9", uid: "u1", email: "a@b.c", error: null });
});

test("content-reso.js: guard sekali-pakai — respons kedua/duplikat diabaikan", async () => {
  const { win, listener } = loadBridge();
  let req = null;
  win.addEventListener("reso:get-token", (e) => { req = e.detail; });
  const resp = sendReq(listener);
  await flush();
  const d = req;
  win.dispatchEvent(new CustomEvent(d.respondTo, {
    detail: { requestId: d.requestId, origin: d.origin, idToken: "tok-A", refreshToken: "rt-A", uid: "u1", email: "a@b.c" },
  }));
  win.dispatchEvent(new CustomEvent(d.respondTo, {
    detail: { requestId: d.requestId, origin: d.origin, idToken: "tok-B", refreshToken: "rt-B", uid: "u1", email: "a@b.c" },
  }));
  const out = await resp;
  assert.equal(out.idToken, "tok-A");
  assert.equal(out.refreshToken, "rt-A");
});

test("content-reso.js: origin respons tidak cocok → diabaikan (menunggu respons sah)", async () => {
  const { win, listener } = loadBridge();
  let req = null;
  win.addEventListener("reso:get-token", (e) => { req = e.detail; });
  const resp = sendReq(listener);
  await flush();
  const d = req;
  // Respons spoof origin jahat: diabaikan, permintaan belum settle.
  win.dispatchEvent(new CustomEvent(d.respondTo, {
    detail: { requestId: d.requestId, origin: "https://evil.example", idToken: "tok-E", refreshToken: "rt-E" },
  }));
  win.dispatchEvent(new CustomEvent(d.respondTo, {
    detail: { requestId: d.requestId, origin: d.origin, idToken: "tok-G", refreshToken: "rt-G", uid: "u1", email: "a@b.c" },
  }));
  const out = await resp;
  assert.equal(out.idToken, "tok-G");
});

test("content-reso.js: respons bentuk salah (tanpa idToken & tanpa error) → diabaikan", async () => {
  const { win, listener } = loadBridge();
  let req = null;
  win.addEventListener("reso:get-token", (e) => { req = e.detail; });
  const resp = sendReq(listener);
  await flush();
  const d = req;
  win.dispatchEvent(new CustomEvent(d.respondTo, {
    detail: { requestId: d.requestId, origin: d.origin, refreshToken: "rt-x" },
  }));
  win.dispatchEvent(new CustomEvent(d.respondTo, {
    detail: { requestId: d.requestId, origin: d.origin, idToken: "tok-ok", refreshToken: "rt-ok", uid: "u1", email: "a@b.c" },
  }));
  const out = await resp;
  assert.equal(out.idToken, "tok-ok");
});

test("content-reso.js: refreshToken kosong (mode idToken-only) diterima", async () => {
  const { win, listener } = loadBridge();
  let req = null;
  win.addEventListener("reso:get-token", (e) => { req = e.detail; });
  const resp = sendReq(listener);
  await flush();
  const d = req;
  win.dispatchEvent(new CustomEvent(d.respondTo, {
    detail: { requestId: d.requestId, origin: d.origin, idToken: "tok-1h", refreshToken: "", uid: "u1", email: "a@b.c" },
  }));
  const out = await resp;
  assert.deepEqual(out, { idToken: "tok-1h", refreshToken: "", uid: "u1", email: "a@b.c", error: null });
});

test("content-reso.js: respons error diteruskan", async () => {
  const { win, listener } = loadBridge();
  let req = null;
  win.addEventListener("reso:get-token", (e) => { req = e.detail; });
  const resp = sendReq(listener);
  await flush();
  const d = req;
  win.dispatchEvent(new CustomEvent(d.respondTo, {
    detail: { requestId: d.requestId, origin: d.origin, error: "no-user" },
  }));
  const out = await resp;
  assert.deepEqual(out, { error: "no-user" });
});

test("content-reso.js: GET_AUTH_TOKEN tanpa balasan → timeout (error, tidak gantung)", async () => {
  const { listener } = loadBridge();
  const out = await sendReq(listener);
  assert.equal(out.error, "timeout");
});

test("content-reso.js: pesan dari sender non-ekstensi diabaikan (defense-in-depth)", async () => {
  const { win, listener } = loadBridge();
  let dispatched = false;
  let responded = false;
  win.addEventListener("reso:get-token", () => {
    dispatched = true;
  });
  listener({ type: "GET_AUTH_TOKEN" }, { id: "evil-extension-id" }, () => {
    responded = true;
  });
  await flush();
  assert.equal(dispatched, false, "permintaan tidak diteruskan ke halaman");
  assert.equal(responded, false, "tidak membalas pesan asing");
});

test("content-reso.js: sender tanpa id (pesan legacy) diabaikan", async () => {
  const { win, listener } = loadBridge();
  let dispatched = false;
  win.addEventListener("reso:get-token", () => {
    dispatched = true;
  });
  listener({ type: "GET_AUTH_TOKEN" }, {}, () => {});
  await flush();
  assert.equal(dispatched, false, "sender tanpa id tidak diteruskan");
});
