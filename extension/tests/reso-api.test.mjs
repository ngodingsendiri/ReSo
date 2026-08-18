/**
 * ReSo API (Opsi C) — kirim langsung ke database via /api/engagement.
 * Test perilaku NYATA shared.js:
 *  - token tersimpan valid → kirim dengan Bearer,
 *  - token kedaluwarsa → mint dari refresh token (tanpa tab),
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
  mintResoIdToken,
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
    if (u.includes("securetoken.googleapis.com")) {
      mintCalls.push(record);
      if (routes.mintError) {
        return new Response(JSON.stringify(routes.mintError.body), {
          status: routes.mintError.status || 400,
        });
      }
      return new Response(JSON.stringify({ id_token: "tok-minted", refresh_token: "rt-new" }), { status: 200 });
    }
    if (u.includes("/api/engagement")) {
      apiCalls.push(record);
      const r = routes.api || { ok: true, date: "2026-08-17", added: 2, existing: 1 };
      return new Response(JSON.stringify(r), { status: r.ok ? 200 : r.status || 400 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
  return () => {
    globalThis.fetch = orig;
  };
}

function mockChrome({ storage = {}, tabs = [] } = {}) {
  const store = { ...storage };
  const orig = globalThis.chrome;
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
    tabs: {
      query: async () => tabs,
      // Tab tanpa `reply` → balasan handoff standar (backward-compat);
      // `throwMsg: true` → sendMessage menolak (mis. tab tanpa content script).
      sendMessage: async (id) => {
        const t = tabs.find((x) => x.id === id);
        if (t?.throwMsg) throw new Error("no receiver");
        return t && "reply" in t
          ? t.reply
          : { idToken: "tok-handoff", refreshToken: "rt-handoff" };
      },
    },
  };
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
    assert.equal(mintCalls.length, 0, "tanpa mint — token masih valid");
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

test("sendNamesToResoApi: token kedaluwarsa → mint dari refresh token, lalu kirim", async () => {
  apiCalls = [];
  mintCalls = [];
  const restoreFetch = mockFetch({ api: { ok: true, date: "2026-08-17", added: 0, existing: 1 } });
  const { store, restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(EXPIRED), refreshToken: "rt-simpan", savedAt: Date.now() } },
  });
  try {
    const out = await sendNamesToResoApi("facebook", ["Andi"], {});
    assert.equal(out.ok, true, "ok");
    assert.equal(mintCalls.length, 1, "refresh token dipakai");
    assert.equal(apiCalls[0].init.headers.Authorization, "Bearer tok-minted", "pakai token hasil mint");
    assert.equal(store.resoAuth.idToken, "tok-minted", "storage diperbarui dengan token baru");
    assert.equal(store.resoAuth.refreshToken, "rt-new", "refresh token baru ikut disimpan");
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

test("ensureResoIdToken: prioritas — fresh → mint → handoff → null", async () => {
  const restoreFetch = mockFetch({});
  try {
    const a = mockChrome({ storage: { resoAuth: { idToken: fakeToken(FAR_FUTURE), refreshToken: "r", savedAt: Date.now() } }, tabs: [] });
    assert.equal(await ensureResoIdToken(), fakeToken(FAR_FUTURE), "fresh dipakai langsung");
    a.restore();

    const b = mockChrome({ storage: { resoAuth: { idToken: fakeToken(EXPIRED), refreshToken: "r", savedAt: Date.now() } }, tabs: [] });
    assert.equal(await ensureResoIdToken(), "tok-minted", "expired → mint");
    b.restore();

    const c = mockChrome({ storage: {}, tabs: [{ id: 3, url: RESO_URL }] });
    assert.equal(await ensureResoIdToken(), "tok-handoff", "tanpa refresh → handoff");
    c.restore();

    const d = mockChrome({ storage: {}, tabs: [] });
    assert.equal(await ensureResoIdToken(), null, "tanpa apa pun → null");
    d.restore();
  } finally {
    restoreFetch();
  }
});

test("ensureResoIdToken: mint gagal definitif (INVALID_REFRESH_TOKEN) → auth dibersihkan, lanjut handoff", async () => {
  mintCalls = [];
  const restoreFetch = mockFetch({
    mintError: {
      status: 400,
      body: { error: { message: "INVALID_REFRESH_TOKEN : Token expired or is invalid" } },
    },
  });
  const { store, restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(EXPIRED), refreshToken: "rt-mati", savedAt: Date.now() } },
    tabs: [{ id: 9, url: RESO_URL, reply: { idToken: "tok-segar", refreshToken: "rt-segar" } }],
  });
  try {
    const tok = await ensureResoIdToken();
    assert.equal(tok, "tok-segar", "mint gagal definitif → handoff dipakai");
    assert.equal(mintCalls.length, 1, "mint dicoba sekali");
    assert.equal(store.resoAuth.idToken, "tok-segar", "auth mati diganti hasil handoff");
    assert.equal(store.resoAuth.refreshToken, "rt-segar");
  } finally {
    restoreFetch();
    restore();
  }
});

test("ensureResoIdToken: mint gagal definitif tanpa tab → null & resoAuth dihapus", async () => {
  mintCalls = [];
  const restoreFetch = mockFetch({
    mintError: {
      status: 400,
      body: { error: { message: "USER_DISABLED : Access for this account has been temporarily disabled." } },
    },
  });
  const { store, restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(EXPIRED), refreshToken: "rt-mati", savedAt: Date.now() } },
    tabs: [],
  });
  try {
    const tok = await ensureResoIdToken();
    assert.equal(tok, null, "tanpa tab → null");
    assert.equal(store.resoAuth, undefined, "refresh token mati dibersihkan dari storage");
  } finally {
    restoreFetch();
    restore();
  }
});

test("ensureResoIdToken: mint gagal non-definitif (API key/transien) → resoAuth dipertahankan", async () => {
  mintCalls = [];
  const restoreFetch = mockFetch({
    mintError: {
      status: 400,
      body: { error: { message: "API key not valid. Please pass a valid API key." } },
    },
  });
  const { store, restore } = mockChrome({
    storage: { resoAuth: { idToken: fakeToken(EXPIRED), refreshToken: "rt-simpan", savedAt: Date.now() } },
    tabs: [],
  });
  try {
    const tok = await ensureResoIdToken();
    assert.equal(tok, null, "tanpa tab → null");
    assert.ok(store.resoAuth, "error transien tidak menghapus auth — bisa dicoba lagi");
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
