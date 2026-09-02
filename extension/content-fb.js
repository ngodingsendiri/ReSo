/**
 * Content script — UI + bridge (FB Nama Komentar)
 */
(function () {
  if (window.__FNK_CONTENT__) return;
  window.__FNK_CONTENT__ = true;

  const INJECT_SOURCE = "fb-nama-komentar-inject";
  const ROOT_ID = "fnk-root";

  let ui = null;
  let status = "idle";
  let names = [];
  let message = "Buka 1 postingan Facebook, lalu klik Proses.";
  let postHint = "";
  let includeReplies = true;
  let engineReady = false;
  let currentRunId = null;
  let stopFinalizeTimer = null;

  // Cooldown antar-run — jeda minimum setelah run apa pun, lebih lama lagi
  // setelah rate limit (pola IG, konsisten lintas platform).
  const COOLDOWN_MS = 15_000;
  const COOLDOWN_RATE_LIMIT_MS = 60_000;
  let lastRunEndAt = 0;
  let lastRateLimitAt = 0;
  
  function sendBg(type, payload = {}) {
    try {
      return chrome.runtime.sendMessage({ type, ...payload }).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  async function engineCmd(cmd, options = {}) {
    return sendBg("ENGINE_CMD", { cmd, options });
  }

  function acceptFromInject(data) {
    if (!data || data.source !== INJECT_SOURCE) return false;
    // Data plane only — control is ENGINE_CMD (no shared secrets in postMessage)
    const t = data.type;
    return (
      t === "READY" ||
      t === "PROGRESS" ||
      t === "DONE" ||
      t === "ERROR"
    );
  }

  async function waitEngineReady(timeoutMs = 5000) {
    if (engineReady) return true;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sendBg("INJECT_MAIN");
      const res = await engineCmd("PING");
      if (res?.ok) {
        engineReady = true;
        return true;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return engineReady;
  }

  // BEGIN-RESO-NORMALIZE
  function normalizeCommentName(raw) {
    if (typeof raw !== "string") return "";
    let name = raw
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
      .replace(/\s+/g, " ")
      .trim();
    name = name.replace(/\s+[·•|].*$/, "").trim();
    name = name.replace(
      /\s+(sekitar\s+)?(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|beberapa)\s+(jam|menit|detik|hari|minggu|tahun|bulan)\s+(yang\s+lalu|lalu).*$/i,
      ""
    );
    name = name.replace(
      /\s+(sehari|semenit|sejam|setahun|seminggu|sebulan)\s+(yang\s+lalu|lalu).*$/i,
      ""
    );
    name = name.replace(
      /\s+\d+\s+(jam|menit|detik|hari|minggu|tahun|bulan)\s+(yang\s+lalu|lalu).*$/i,
      ""
    );
    name = name.replace(
      /\s+(about\s+)?(a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago.*$/i,
      ""
    );
    name = name.replace(/\s+just\s+now.*$/i, "");
    name = name.replace(
      /\s+\d+\s*(d|h|m|w|y|jam|menit|hari|minggu|tahun|bulan|hr|min|detik|sec|second|minute|hour|day|week|month|year)s?\b.*$/i,
      ""
    );
    name = name.replace(/\s+Edited$/i, "").trim();
    if (/\bis with\b/i.test(name)) name = name.split(/\bis with\b/i)[0].trim();
    if (!name) return "";
    if (name.length < 2 || name.length > 100) return "";
    if (name.startsWith("@")) return "";
    if (/^\d+$/.test(name)) return "";
    if (/https?:\/\//i.test(name) || /@\w+\.\w+/.test(name)) return "";
    if (/^(wa\.me|bit\.ly|t\.co|goo\.gl|tinyurl\.com|s\.id|link\.)\b/i.test(name)) return "";
    if (/\b(wa\.me|bit\.ly|t\.co)\b/i.test(name)) return "";
    if (/^[a-z0-9][-a-z0-9]*\.[a-z]{2,6}\//i.test(name)) return "";
    const blocked = [
      /^view\b/i, /^see\b/i, /^like\b/i, /^likes$/i, /^reply\b/i, /^share\b/i,
      /^comment\b/i, /^write\b/i, /^log\s*in/i, /^sign\s*up/i, /^facebook$/i,
      /^meta$/i, /^suka$/i, /^balas$/i, /^bagikan$/i, /^komentar$/i, /^tulis/i,
      /^lihat/i, /^tampilkan/i, /^semua$/i, /^most relevant$/i, /^all comments$/i,
      /^newest$/i, /^terbaru$/i, /^paling relevan$/i, /^edited$/i, /^sponsor/i,
      /^follow$/i, /^following$/i, /^followers$/i, /^ikuti$/i, /^send\b/i,
      /^kirim$/i, /^hide\b/i, /^open\b/i, /^photo$/i, /^video$/i, /^reels?$/i,
      /^add a comment/i, /^tulis komentar/i, /^write a comment/i,
      /^see more$/i, /^lihat selengkapnya$/i,
      /^tiktok$/i,
    ];
    if (blocked.some((re) => re.test(name))) return "";
    try {
      if (!/[\p{L}\p{N}]/u.test(name)) return "";
    } catch {
      if (!/[a-zA-Z0-9\u00C0-\u024F]/.test(name)) return "";
    }
    return name;
  }
  // END-RESO-NORMALIZE

  // BEGIN-RESO-DONEMSG
  /**
   * SINGLE SOURCE OF TRUTH untuk pesan akhir run (DONE). Dipakai oleh
   * background/popup (via reasonToMessage) dan ketiga panel (content-*.js)
   * lewat salinan byte-identik di dalam marker yang sama — dijamin oleh
   * fixture test DONEMSG agar tidak pernah drift.
   * @param {string} reason stopReason dari engine (complete/idle/stopped/...)
   * @param {number} count jumlah hasil terkumpul
   * @param {"facebook"|"tiktok"|"instagram"} platform
   * @param {{extra?: string, tip?: string}} [options] extra = diagnosis tambahan
   *   (mis. 429 saat timeout), tip = panduan saat tidak ada hasil
   * @returns {string}
   */
  function doneMessage(reason, count, platform, options) {
    const word = platform === "instagram" ? "username" : "nama";
    const extra =
      options && typeof options.extra === "string" && options.extra
        ? ` ${options.extra}`
        : "";
    const tip =
      options && typeof options.tip === "string" && options.tip
        ? ` ${options.tip}`
        : "";
    const c = Number.isFinite(count) ? count : 0;

    if (reason === "stopped") {
      return c
        ? `Dihentikan — ${c} ${word}.${extra} Klik Rekap + Kirim untuk mengirim.`
        : `Dihentikan — belum ada ${word}.${extra}`;
    }
    if (reason === "timeout") {
      return c
        ? `Waktu habis — ${c} ${word} (mungkin belum semua).${extra} Klik Rekap + Kirim untuk mengirim.`
        : `Waktu habis — belum ada ${word}.${extra}`;
    }
    if (reason === "incomplete") {
      // Pagination berhenti sebelum FB menyatakan has_next_page:false —
      // jangan beri kesan "selesai"; operator perlu tahu hasil bisa kurang.
      return c
        ? `Belum tuntas — ${c} ${word} terkumpul, thread belum terlihat habis. Proses lagi untuk melengkapi.`
        : `Belum ada ${word} — pagination belum tuntas.${extra}`;
    }
    if (reason === "idle" || reason === "complete") {
      if (c) return `Selesai — ${c} ${word}.${extra} Klik Rekap + Kirim untuk mengirim.`;
      if (tip) return `Tidak ada ${word}.${tip}`;
      if (platform === "facebook")
        return "Tidak ada nama. Buka permalink post, buka list komentar sampai terlihat, tunggu 2–3 dtk, lalu Proses lagi.";
      if (platform === "tiktok")
        return "Tidak ada nama. Pastikan komentar terbuka di video, lalu Proses lagi.";
      return "Tidak ada username. Pastikan komentar terbuka & sudah login, lalu Proses lagi.";
    }
    if (reason === "error") {
      return extra.trim() || "Terjadi error saat ekstrak.";
    }
    if (reason === "rate_limit") {
      const who =
        platform === "facebook"
          ? "Facebook"
          : platform === "tiktok"
            ? "TikTok"
            : "Instagram";
      return c
        ? `Rate limit ${who} (429) — ${c} ${word} terkumpul. Tunggu beberapa saat, lalu Proses lagi.`
        : `Rate limit ${who} (429) — tunggu beberapa saat, lalu coba lagi.`;
    }
    if (reason === "blocked") {
      return c
        ? `Instagram memblokir permintaan (403) — kemungkinan anti-bot. ${c} username terkumpul. Tunggu beberapa saat, lalu Proses lagi.`
        : "Instagram memblokir permintaan (403) — kemungkinan anti-bot atau App-ID ditolak. Berhenti agar akun aman; coba lagi beberapa saat kemudian.";
    }
    if (reason === "checkpoint") {
      return c
        ? `Instagram minta verifikasi (checkpoint). ${c} username terkumpul — buka instagram.com, selesaikan verifikasi, lalu Proses lagi.`
        : "Instagram minta verifikasi (checkpoint). Buka instagram.com, selesaikan verifikasi, lalu Proses lagi.";
    }
    if (reason === "no_template") {
      if (platform === "instagram") {
        return "Belum ada template API komentar. Buka post/reel, klik ikon komentar dulu, tunggu list muncul, lalu Proses lagi (wajib login).";
      }
      if (platform === "facebook") {
        return "Belum ada template GraphQL komentar. Buka permalink post, buka list komentar sampai terlihat, tunggu 2–3 detik, lalu Proses lagi.";
      }
      return "Belum ada template API komentar. Buka video, klik ikon komentar dulu, tunggu komentar muncul, lalu Proses lagi.";
    }
    if (reason === "no_video") {
      return "Buka halaman video TikTok dulu (URL berisi /video/...), bukan For You feed saja.";
    }
    if (reason === "no_login") {
      if (platform === "facebook")
        return "Sesi Facebook tidak aktif — login di facebook.com lalu Proses lagi.";
      if (platform === "tiktok")
        return "Sesi TikTok tidak aktif — login di tiktok.com lalu Proses lagi.";
      return "Butuh login Instagram. Buka instagram.com, login, lalu buka post & Proses lagi.";
    }
    if (reason === "no_media") {
      return "Buka halaman post/reel Instagram dulu (URL /p/... atau /reel/...).";
    }
    if (reason === "live") {
      // S1-AUDIT-TT: siaran live tidak punya kolom komentar permalink.
      return "Siaran LIVE TikTok tidak memiliki kolom komentar permanen — buka salah satu video/foto, lalu Proses lagi.";
    }
    if (reason === "synthetic_failed") {
      // L1-TT: synthetic tanpa capture gagal tanpa hasil (jaringan/signature) —
      // bukan error mentah; fallback ke scroll yang benar, jangan hijau palsu.
      return c
        ? `Belum tuntas — ${c} ${word} terkumpul, endpoint synthetic gagal. Proses lagi untuk melengkapi.`
        : "Endpoint komentar gagal dibuat — buka panel komentar sampai terlihat, tunggu 2–3 dtk, lalu Proses lagi.";
    }
    return c ? `${c} ${word}` : "Siap.";
  }
  // END-RESO-DONEMSG

  // BEGIN-RESO-PANELTOOLS
  /**
   * SINGLE SOURCE OF TRUTH untuk perkakas UI daftar nama — dipakai popup
   * (via export) dan ketiga panel (content-*.js) lewat salinan byte-identik
   * di dalam marker yang sama — dijamin fixture test PANELTOOLS.
   */

  /** Saring nama (case-insensitive substring). */
  function filterNames(names, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return names || [];
    return (names || []).filter((n) => String(n).toLowerCase().includes(q));
  }

  /** Urutkan A–Z (locale id); false = urutan asli. */
  function sortNamesAz(names) {
    return [...(names || [])].sort((a, b) =>
      String(a).localeCompare(String(b), "id")
    );
  }

  /**
   * Gabung nama dari beberapa platform — tiap nama dinormalisasi dengan
   * aturan platform-nya SENDIRI (FB/TT/IG berbeda), lalu di-dedupe
   * case-insensitive. Menghindari data loss saat normalisasi lintas platform
   * (mis. @handle & emoji TikTok, atau nama FB yang mengandung spasi yang
   * ditolak aturan username Instagram).
   * @param {{platform: "facebook"|"tiktok"|"instagram", names: string[]}[]} groups
   * @returns {string[]}
   */
  function mergeAcrossPlatforms(groups) {
    const map = new Map();
    for (const g of groups || []) {
      const platform =
        g?.platform === "tiktok" || g?.platform === "instagram"
          ? g.platform
          : "facebook";
      for (const n of g?.names || []) {
        const k = normalizeName(n, platform);
        if (k && !map.has(k.toLowerCase())) map.set(k.toLowerCase(), k);
      }
    }
    return [...map.values()];
  }
  // END-RESO-PANELTOOLS

  function mergeNames(list) {
    const map = new Map();
    for (const n of list || []) {
      const k = normalizeCommentName(n);
      if (k && !map.has(k.toLowerCase())) map.set(k.toLowerCase(), k);
    }
    return [...map.values()];
  }

  /** Daftar nama yang terlihat — hormati filter pencarian & urutan A–Z. */

  function visible() {
    return names;
  }

  function setLocalState(patch) {
    if (patch.status) status = patch.status;
    if (patch.names) names = mergeNames(patch.names);
    if (patch.message != null) message = patch.message;
    if (patch.postHint != null) postHint = patch.postHint;
    if (patch.openResoUrl != null) openResoUrl = patch.openResoUrl;
    if (typeof patch.includeReplies === "boolean") includeReplies = patch.includeReplies;
    renderUi();
  }

  function makeRunId() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /** Bumps on every start/stop so superseded async starts abort cleanly */
  let startGen = 0;

  // Cooldown aktif → tombol Kirim disabled + ticker sisa detik di status.
  let cooldownActive = false;
  // URL rekap untuk link "Buka rekap" — terisi setelah kirim sukses.
  let openResoUrl = "";

  /** Rekap + Kirim ke ReSo: ekstrak lalu otomatis kirim nama ke database. */
  async function rekapSend() {
    if (status === "running") return;
    await startExtract();
    let myRun = null; try { myRun = typeof currentRunId !== "undefined" ? currentRunId : null; } catch { myRun = null; }
    const start = Date.now();
    while (Date.now() - start < 300000) {
      try { if (typeof currentRunId !== "undefined" && currentRunId !== myRun) return; } catch {}
      if (["done", "partial", "stopped", "error"].includes(status)) break;
      await new Promise((r) => setTimeout(r, 800));
    }
    try { if (typeof currentRunId !== "undefined" && currentRunId !== myRun) return; } catch {}
    const list = (names || []).slice();
    if (!list.length) {
      setLocalState({ message: "Tidak ada nama untuk dikirim ke ReSo." });
      return;
    }
    const sh = globalThis.RS_SHARED || {};
    let hint = null;
    try {
      // M1: prefer postRoot agar tanggal tidak salah ambil post lain di feed
      let rootScan;
      try { rootScan = document.querySelector?.("[data-fnk-post-root]") || undefined; } catch { rootScan = undefined; }
      const r = typeof sh.scanPageForPostDate === "function" ? sh.scanPageForPostDate(rootScan) : null;
      if (r && r.suggestedDate)
        hint = {
          suggestedDate: r.suggestedDate,
          suggestedTime: r.suggestedTime,
          suggestedIso: r.suggestedIso,
          label: r.label,
        };
    } catch { /* tanpa saran — pakai hari ini */ }
    setLocalState({ message: "Mengirim ke ReSo…" });
    try {
      const out = await sh.sendNamesToResoApi("facebook", list, hint || {});
      const patch = {
        message:
          (hint && hint.label ? `Post ~${hint.label} — ` : "") +
          (out?.message || (out?.ok ? "Terkirim ke ReSo." : "Gagal kirim.")),
      };
      // Kirim sukses → sediakan pintasan "Buka rekap" (domain terpelajari).
      if (out?.ok && typeof sh.getResoUrl === "function") {
        try {
          const url = await sh.getResoUrl();
          if (url) patch.openResoUrl = url;
        } catch { /* tanpa link — bukan fatal */ }
      }
      setLocalState(patch);
    } catch (e) {
      setLocalState({ message: `Gagal kirim ke ReSo: ${e?.message || e}` });
    }
  }

  /** Mode ekstensi (toggle popup): false → FAB & panel disembunyikan. */
  async function applyMode() {
    try {
      const KEY = (globalThis.RS_SHARED && globalThis.RS_SHARED.RSX_ENABLED_KEY) || "rsx_enabled";
      const d = await chrome.storage.local.get(KEY);
      const enabled = d[KEY] !== false;
      const root = document.getElementById(ROOT_ID);
      if (root) root.hidden = !enabled;
      return enabled;
    } catch {
      return true;
    }
  }

  async function startExtract(opts = {}) {
    const gen = ++startGen;
    if (stopFinalizeTimer) {
      clearTimeout(stopFinalizeTimer);
      stopFinalizeTimer = null;
    }
    if (status === "running") {
      await engineCmd("STOP");
      await new Promise((r) => setTimeout(r, 100));
    }
    // A newer start/stop superseded this one
    if (gen !== startGen) return;

    // Cooldown antar-run — run beruntun adalah pemicu rate-limit (pola IG
    // v1.0.15, konsisten lintas platform): jeda minimum setelah run apa pun,
    // lebih lama lagi setelah rate limit.
    const nowC = Date.now();
    const sinceEnd = lastRunEndAt ? nowC - lastRunEndAt : Infinity;
    const sinceRl = lastRateLimitAt ? nowC - lastRateLimitAt : Infinity;
    const coolMs =
      sinceRl < COOLDOWN_RATE_LIMIT_MS
        ? COOLDOWN_RATE_LIMIT_MS - sinceRl
        : Math.max(0, COOLDOWN_MS - sinceEnd);
    if (coolMs > 0) {
      const endAt = nowC + coolMs;
      const waitSec = Math.ceil(coolMs / 1000);
      cooldownActive = true;
      setLocalState({
        status: "idle",
        message: `Tunggu ${waitSec} dtk sebelum Proses lagi (cooldown anti rate-limit).`,
      });
      // Timer utama dijadwalkan DULU (indeks-0 pada stub timer test): akhir
      // cooldown → pesan siap + lepas kunci tombol Kirim.
      setTimeout(() => {
        if (!cooldownActive) return;
        cooldownActive = false;
        if (status !== "running") {
          setLocalState({
            message: "Cooldown selesai — klik Proses untuk mulai.",
          });
        }
      }, coolMs);
      // Ticker tampilan: sisa detik berjalan tiap 1 dtk (kosmetik — logika
      // tetap pada timer utama). Berhenti sendiri saat selesai / run mulai.
      const tickCd = () => {
        if (!cooldownActive || status === "running") return;
        const left = Math.ceil((endAt - Date.now()) / 1000);
        if (left <= 0) return;
        setLocalState({
          message: `Tunggu ${left} dtk sebelum Proses lagi (cooldown anti rate-limit).`,
        });
        setTimeout(tickCd, 1000);
      };
      setTimeout(tickCd, 1000);
      return;
    }

    // Pre-check login (pola IG/TT): replay GraphQL butuh sesi Facebook.
    // Gagal cepat dengan pesan jelas alih-alih run yang sia-sia saat logout.
    const login = await sendBg("CHECK_FB_LOGIN");
    if (gen !== startGen) return;
    if (login && login.loggedIn === false) {
      const noLoginMsg =
        "Sesi Facebook tidak aktif — login di facebook.com lalu Proses lagi.";
      setLocalState({
        status: "error",
        names: [],
        message: noLoginMsg,
        postHint: "",
      });
      await sendBg("SET_STATE", {
        patch: {
          status: "error",
          names: [],
          count: 0,
          message: noLoginMsg,
          stopReason: "no_login",
          postHint: "",
          runId: null,
        },
      });
      return;
    }

    currentRunId = opts.runId || makeRunId();
    cooldownActive = false;
    setLocalState({
      status: "running",
      names: [],
      message: "Menyiapkan engine…",
      openResoUrl: "",
    });
    // tabId stamped by background from sender.tab
    const stRes = await sendBg("SET_STATE", {
      patch: {
        status: "running",
        names: [],
        count: 0,
        message: "Menyiapkan engine…",
        stopReason: null,
        includeReplies,
        runId: currentRunId,
      },
    });
    if (gen !== startGen) return;
    if (stRes && stRes.ok === false) {
      setLocalState({
        status: "error",
        message:
          stRes.error === "Run active on another tab"
            ? "Sudah ada proses di tab lain. Stop dulu di tab itu, lalu coba lagi."
            : "Gagal memulai. Coba lagi.",
      });
      return;
    }

    const ok = await waitEngineReady(5000);
    if (gen !== startGen) return;
    if (!ok) {
      setLocalState({
        status: "error",
        message:
          "Engine belum siap. Refresh halaman Facebook, lalu coba lagi.",
      });
      await sendBg("NAMES_ERROR", {
        message: "Engine belum siap.",
        runId: currentRunId,
      });
      return;
    }

    markBestPostRoot();
    setLocalState({ message: "Memulai ekstrak…" });
    const started = await engineCmd("START", {
      maxMs: 150_000,
      includeReplies,
      runId: currentRunId,
    });
    if (gen !== startGen) return;
    if (!started?.ok) {
      setLocalState({
        status: "error",
        message:
          started?.error === "Run active on another tab — stop it first"
            ? "Sudah ada proses di tab lain. Stop dulu, lalu coba lagi."
            : "Gagal memulai engine. Refresh postingan lalu coba lagi.",
      });
      await sendBg("NAMES_ERROR", {
        message: started?.error || "START failed",
        runId: currentRunId,
      });
      // Ensure MAIN engine is not left half-started
      await engineCmd("STOP");
    }
  }

  function stopExtract() {
    // Invalidate any in-flight startExtract
    startGen += 1;
    engineCmd("STOP");
    setLocalState({ status: "running", message: "Menghentikan…" });
    // Finalize if inject never answers
    if (stopFinalizeTimer) clearTimeout(stopFinalizeTimer);
    const stopRunId = currentRunId;
    stopFinalizeTimer = setTimeout(() => {
      if (status !== "running") return;
      if (currentRunId !== stopRunId) return;
      const list = names.slice();
      lastRunEndAt = Date.now();
      setLocalState({
        status: list.length ? "stopped" : "error",
        message: doneMessage("stopped", list.length, "facebook"),
      });
      sendBg("NAMES_DONE", {
        names: list,
        stopReason: "stopped",
        runId: stopRunId,
        postHint,
      });
    }, 5000);
  }

  async function doReset() {
    startGen += 1;
    cooldownActive = false;
    if (stopFinalizeTimer) {
      clearTimeout(stopFinalizeTimer);
      stopFinalizeTimer = null;
    }
    await engineCmd("STOP");
    currentRunId = null;
    setLocalState({
      status: "idle",
      names: [],
      message: "Buka 1 postingan Facebook, lalu klik Proses.",
      postHint: "",
      openResoUrl: "",
    });
    await sendBg("RESET");
  }

  function markBestPostRoot() {
    // Clear old marks
    document.querySelectorAll("[data-fnk-post-root]").forEach((el) => {
      el.removeAttribute("data-fnk-post-root");
    });

    // Permalink: mark largest article
    const arts = [
      ...document.querySelectorAll(
        'div[role="article"], div[data-pagelet*="FeedUnit"], div[data-pagelet*="Permalink"]'
      ),
    ];
    let best = null;
    let bestH = 0;
    for (const a of arts) {
      const h = a.getBoundingClientRect().height;
      if (h > bestH) {
        bestH = h;
        best = a;
      }
    }
    if (best) best.setAttribute("data-fnk-post-root", "1");
  }

  // Helper bersama dari shared.js (classic via manifest content_scripts —
  // tanpa salinan inline; shared.js dimuat sebelum content script ini).
  const { svgIcon, fbTargetLabel, resolveTheme, injectIconSprite } =
    globalThis.RS_SHARED;

  function createUi() {
    if (document.getElementById(ROOT_ID)) {
      ui = document.getElementById(ROOT_ID);
      return ui;
    }
    const root = document.createElement("div");
    root.id = ROOT_ID;
    // Default visibility: TERTUTUP selalu (flat minimal) — panel tidak
    // mengambang menutupi halaman saat scrolling. Buka lewat FAB atau ikon
    // di bar Like; hasil tetap terlihat di badge FAB.
    root.classList.add("fnk-collapsed");
        root.innerHTML = `
      <div class="fnk-panel" role="region" aria-label="FB Nama Komentar">
        <div class="fnk-header">
          ${svgIcon("facebook", "fnk-logo-ic")}
          <span class="fnk-title">Nama Komentar</span>
          <button type="button" class="fnk-min" data-fnk="min" title="Tutup" aria-label="Tutup panel">${svgIcon("close")}</button>
        </div>
        <div class="fnk-body">
          <div class="fnk-status" data-fnk="status" aria-live="polite"></div>
          <div class="fnk-count" data-fnk="count">0 nama</div>
          <label class="fnk-check">
            <input type="checkbox" data-fnk="replies" />
            ${svgIcon("forum")}
            <span>Balasan</span>
          </label>
          <div class="fnk-actions">
            <button type="button" class="fnk-btn fnk-primary" data-fnk="process-send" title="Rekap + Kirim ke ReSo" aria-label="Rekap + Kirim ke ReSo">${svgIcon("send")}</button>
            <button type="button" class="fnk-btn" data-fnk="stop" hidden title="Hentikan" aria-label="Hentikan">${svgIcon("stop")}</button>
            <button type="button" class="fnk-btn fnk-ghost" data-fnk="reset" title="Bersihkan hasil" aria-label="Bersihkan hasil">${svgIcon("restart_alt")}</button>
          </div>
          <a class="fnk-link" data-fnk="open-reso" hidden target="_blank" rel="noopener noreferrer">Buka rekap di ReSo &rarr;</a>
        </div>
      </div>
      <button type="button" class="fnk-fab" data-fnk="fab" data-count="" title="Nama Komentar" aria-label="Buka panel Nama Komentar">${svgIcon("forum")}</button>
    `;
(document.body || document.documentElement).appendChild(root);
    ui = root;

        root.addEventListener("click", (e) => {
      const t = e.target.closest("[data-fnk]");
      if (!t) return;
      const act = t.getAttribute("data-fnk");
      if (act === "process-send") rekapSend();
      if (act === "stop") stopExtract();
      if (act === "reset") doReset();
      if (act === "min") root.classList.add("fnk-collapsed");
      if (act === "fab") root.classList.remove("fnk-collapsed");
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t && t.getAttribute?.("data-fnk") === "replies") {
        includeReplies = !!t.checked;
        // Persist pref seketika (parity popup) — bukan hanya saat run dimulai.
        sendBg("SET_STATE", { patch: { includeReplies } });
      }
    });
    // Keyboard: Esc menutup panel (setara tombol min). Abaikan bila user
    // sedang mengetik di input/textarea/contenteditable halaman (mis. kolom
    // komentar FB) — Esc milik mereka, bukan panel.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !ui) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""))) return;
      if (!ui.classList.contains("fnk-collapsed")) {
        ui.classList.add("fnk-collapsed");
      }
    });

    applySettings();
    applyMode();
    return root;
  }

  /**
   * Apply Options (rsx_prefs): panel theme + default "sertakan balasan".
   * Runs on boot and whenever Options change (storage.onChanged).
   */
  function applySettings() {
    try {
      chrome.storage.local
        .get("rsx_prefs")
        .then((d) => {
          const prefs = d?.rsx_prefs || {};
          const root = document.getElementById(ROOT_ID);
          if (root) {
            root.setAttribute("data-rs-theme", resolveTheme(prefs.theme));
          }
          const v = prefs.includeReplies?.facebook;
          if (status !== "running" && typeof v === "boolean" && includeReplies !== v) {
            includeReplies = v;
            renderUi();
          }
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.rsx_prefs) applySettings();
    if (changes.rsx_enabled !== undefined) applyMode();
  });

  /** Small icon-only control near Like / Comment / Share */

  function findBestPost() {
    const posts = [
      ...document.querySelectorAll(
        'div[role="article"], div[data-pagelet*="FeedUnit"], div[data-pagelet*="Permalink"], div[data-pagelet*="CometSinglePost"]'
      ),
    ];
    let bestPost = null;
    let bestScore = -1;
    const vh = window.innerHeight || 800;
    for (const post of posts) {
      const r = post.getBoundingClientRect();
      if (r.height < 80) continue;
      const mid = (r.top + r.bottom) / 2;
      let score = 1000 - Math.abs(mid - vh / 2);
      const text = (post.innerText || "").slice(0, 500);
      if (/\b(Like|Suka|Comment|Komentar|Share|Bagikan)\b/i.test(text)) score += 300;
      if (/comment|komentar/i.test(text)) score += 200;
      if (score > bestScore) {
        bestScore = score;
        bestPost = post;
      }
    }
    return bestPost;
  }

  /**
   * Find the UFI action row (Like / Comment / Share) inside a post.
   * Toleran terhadap perubahan DOM Facebook (2025–2026): tombol aksi bisa
   * berlabel teks, ikon-only, atau ikon kecil tak berlabel di samping kotak
   * komentar — anchor boleh salah satu dari Like/Comment/Share, dan baris
   * cukup memuat 2+ aksi (tidak wajib Like pertama).
   */
  function actionLabel(btn) {
    return `${btn.innerText || ""} ${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("title") || ""}`
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function findActionRow(post) {
    if (!post) return null;
    const isLike = (t) =>
      /^(like|suka)\b/.test(t) ||
      t === "like" ||
      t === "suka" ||
      /beri reaksi|\breact\b/.test(t);
    const isComment = (t) =>
      /\bcomment\b|\bkomentar\b/.test(t) ||
      /\bleave a comment\b|\btulis komentar\b/.test(t);
    const isShare = (t) => /\bshare\b|\bbagikan\b/.test(t);

    const buttons = post.querySelectorAll('[role="button"]');
    for (const btn of buttons) {
      const t = actionLabel(btn);
      if (!isLike(t) && !isComment(t) && !isShare(t)) continue;
      let row = btn.parentElement;
      for (let i = 0; i < 8 && row; i++) {
        const labels = [...row.querySelectorAll('[role="button"]')]
          .map(actionLabel)
          .filter(Boolean)
          .join(" | ");
        const hasLike = isLike(labels) || /(^|\|)(like|suka)\b/.test(labels);
        const hasComment = isComment(labels) || /(^|\|)(comment|komentar)\b/.test(labels);
        const hasShare = isShare(labels) || /(^|\|)(share|bagikan)\b/.test(labels);
        const score = (hasLike ? 1 : 0) + (hasComment ? 1 : 0) + (hasShare ? 1 : 0);
        if (score >= 2) {
          // Prefer the tightest row that still has 2+ actions
          return row;
        }
        row = row.parentElement;
      }
    }
    return null;
  }


  // BEGIN-RESO-FBURLS
  /**
   * SINGLE SOURCE OF TRUTH untuk deteksi permalink Facebook — dipakai badge
   * panel (isFacebookPostPage), synthetic template engine (extractFbFeedbackIds),
   * dan pre-check. Disalin byte-identik ke inject-fb.js & content-fb.js; dijamin
   * fixture test FBURLS. Mengembalikan kandidat story/feedback id dari URL;
   * engine mem-probe tiap kandidat (urutan = prioritas) dan memakai yang benar
   * menghasilkan page_info — robust terhadap bentuk URL yang id-nya ambigu
   * (mis. album `set=a.X.Y.Z`, postingan multi-foto `set=pcb.<story>`,
   * dan `photos/a.<uid>.<fbid>`).
   */
  function extractFbFeedbackIds(url) {
    const out = [];
    const add = (id) => {
      if (typeof id !== "string" || !/^[A-Za-z0-9]{8,}$/.test(id)) return;
      if (!out.includes(id)) out.push(id);
    };
    if (!url || typeof url !== "string") return out;
    const href = url;

    // 1) Bentuk path yang membawa story/feedback id
    const direct = [
      /\/posts\/[^/?#]+\/([^/?#]+)/, // posts/<slug>/<id> (gaya baru)
      /\/posts\/([^/?#]+)/, // posts/<id> (klasik & grup)
      /\/permalink\.php\?story_fbid=([^&#]+)/,
      /\/story\.php\?story_fbid=([^&#]+)/,
      /\/photos\/a\.\d+\.(\d+)/, // photos/a.<uid>.<fbid> (album foto)
      /\/photos\/pcb\.(\d+)/, // photos/pcb.<story>[/<photo>] - multi-foto bentuk PATH (story = feedback post)
      /\/photos\/(\d+)/, // foto tunggal (id foto — probe memvalidasi)
      /\/videos\/(\d+)/,
      /\/reels?\/(\d+)/,
      /\/video\.php\?v=(\d+)/,
    ];
    for (const re of direct) {
      const m = href.match(re);
      if (m) add(m[1]);
    }

    // 2) Watch (query v=) — bentuk paling umum untuk permalink video
    const watch = href.match(/\/watch(?:[^?#]*\?|\?)[^#]*\bv=(\d+)/i);
    if (watch) add(watch[1]);

    // 3) Param umum (story_fbid/fbid/v, termasuk nilai pfbid alfanumerik)
    //    + set: pcb.<story> = postingan multi-foto (id-nya feedback/story id,
    //      prioritas tinggi karena `fbid` di URL tersebut id foto, bukan story)
    //      dan a.<album>.<user>.<story> (komponen terakhir = story id)
    try {
      const u = new URL(href);
      for (const key of ["story_fbid", "multi_permalinks"]) {
        const val = u.searchParams.get(key);
        // multi_permalinks bisa berisi daftar dipisah koma - ambil token pertama
        if (val) add(val.split(",")[0].trim());
      }
      const set = u.searchParams.get("set") || "";
      const parts = String(set).split(".");
      if (parts[0] === "pcb" && parts.length >= 2) add(parts[parts.length - 1]);
      for (const key of ["fbid", "v"]) {
        const val = u.searchParams.get(key);
        if (val) add(val);
      }
      if (parts[0] === "a" && parts.length >= 4) add(parts[3]);
    } catch {
      /* ignore */
    }
    return out;
  }

  /** Kandidat pertama (prioritas tertinggi). */
  function extractFbFeedbackId(url) {
    const ids = extractFbFeedbackIds(url);
    return ids.length ? ids[0] : null;
  }

  /** Apakah URL adalah halaman post permalink FB yang didukung engine? */
  function isFacebookPostPage(url) {
    return extractFbFeedbackIds(url).length > 0;
  }
  // END-RESO-FBURLS

  function renderUi() {
    if (!ui) createUi();
    ui.setAttribute("data-status", status || "idle");
    const statusEl = ui.querySelector('[data-fnk="status"]');
    const countEl = ui.querySelector('[data-fnk="count"]');
    const replies = ui.querySelector('[data-fnk="replies"]');
    const sendBtn = ui.querySelector('[data-fnk="process-send"]');
    const stopBtn = ui.querySelector('[data-fnk="stop"]');
    const fab = ui.querySelector('[data-fnk="fab"]');
    const openResoEl = ui.querySelector('[data-fnk="open-reso"]');
    const n = (names || []).length;
    if (statusEl) statusEl.textContent = message;
    if (countEl) countEl.textContent = n ? `${n} nama` : `0 nama`;
    if (replies) replies.checked = includeReplies;
    const running = status === "running";
    if (sendBtn) {
      sendBtn.disabled = running || cooldownActive;
      const label = running ? "Memproses…" : "Rekap + Kirim ke ReSo";
      sendBtn.setAttribute("aria-label", label);
      sendBtn.title = label;
    }
    if (stopBtn) stopBtn.hidden = !running;
    if (openResoEl) {
      if (openResoUrl) {
        openResoEl.href = openResoUrl;
        openResoEl.hidden = false;
      } else {
        openResoEl.hidden = true;
      }
    }
    if (fab) {
      fab.setAttribute("data-count", n > 0 ? String(n) : "");
      fab.classList.toggle("fnk-running", running);
      fab.classList.toggle(
        "fnk-done",
        (status === "done" || status === "partial" || status === "stopped") && n > 0
      );
      const fabTitle = running
        ? "Proses berjalan — buka panel untuk Stop"
        : n > 0
          ? `Buka panel — ${n} nama terkumpul (nama unik, bukan hitungan komentar)`
          : "Nama Komentar";
      fab.title = fabTitle;
      fab.setAttribute("aria-label", fabTitle);
    }
  }


  function placeUi() {
    createUi();
    renderUi();
  }


  function mapDone(stopReason, count) {
    if (stopReason === "stopped") return "stopped";
    if (stopReason === "timeout") return "partial";
    if (stopReason === "incomplete") return count ? "partial" : "error";
    if (stopReason === "synthetic_failed") return count ? "partial" : "error";
    if (stopReason === "live") return "error";
    if (stopReason === "rate_limit") return count ? "partial" : "error";
    if (
      stopReason === "error" ||
      stopReason === "no_template" ||
      stopReason === "no_login"
    )
      return "error";
    if (stopReason === "complete") return count ? "done" : "error";
    if (stopReason === "idle") return count ? "done" : "error";
    return count ? "done" : "error";
  }

  /**
   * Strict run match — reject spoofed/idle inject events.
   * READY is handled separately (no runId).
   */
  function isCurrentRun(runId) {
    if (!currentRunId) return false;
    if (typeof runId !== "string" || !runId) return false;
    return runId === currentRunId;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!acceptFromInject(data)) return;

    if (data.type === "READY") {
      engineReady = true;
      return;
    }

    if (data.type === "PROGRESS") {
      if (status !== "running") return;
      if (!isCurrentRun(data.runId)) return;
      const list = Array.isArray(data.names) ? data.names : [];
      setLocalState({
        status: "running",
        names: list,
        message:
          typeof data.message === "string"
            ? data.message
            : `Mengumpulkan… ${list.length} nama`,
        postHint:
          typeof data.postHint === "string" ? data.postHint : postHint,
      });
      sendBg("NAMES_PROGRESS", {
        names: list,
        message: data.message,
        postHint: data.postHint,
        runId: currentRunId,
      });
      return;
    }

    if (data.type === "DONE") {
      if (!isCurrentRun(data.runId)) return;
      if (stopFinalizeTimer) {
        clearTimeout(stopFinalizeTimer);
        stopFinalizeTimer = null;
      }
      const list = Array.isArray(data.names) ? data.names : [];
      const stopReason =
        typeof data.stopReason === "string" ? data.stopReason : "complete";
      lastRunEndAt = Date.now();
      if (stopReason === "rate_limit" || /rate\s*limit|429/i.test(data.postHint || "")) {
        lastRateLimitAt = Date.now();
      }
      const st = mapDone(stopReason, list.length);
      // Pesan akhir via helper tunggal (DONEMSG) — konsisten dengan popup &
      // platform lain. Suffix [graphql]/[dom] dihapus (mode tetap terlihat
      // di baris "Target:").
      const tip =
        !list.length && data.postHint && /Tip:/i.test(data.postHint)
          ? data.postHint.replace(/^[\s\S]*?Tip:/i, "Tip:")
          : "";
      const finalMsg = doneMessage(stopReason, list.length, "facebook", {
        tip,
      });
      setLocalState({
        status: st,
        names: list,
        message: finalMsg,
        postHint:
          typeof data.postHint === "string" ? data.postHint : postHint,
      });
      // Default visibility = TETAP TERTUTUP (flat minimal) — hasil terlihat
      // di badge FAB; panel hanya dibuka oleh user (FAB / ikon bar Like).
      sendBg("NAMES_DONE", {
        names: list,
        stopReason,
        postHint: data.postHint,
        runId: currentRunId,
      });
      return;
    }

    if (data.type === "ERROR") {
      if (!isCurrentRun(data.runId)) return;
      if (stopFinalizeTimer) {
        clearTimeout(stopFinalizeTimer);
        stopFinalizeTimer = null;
      }
      setLocalState({
        status: "error",
        message:
          typeof data.message === "string" ? data.message : "Error",
      });
      sendBg("NAMES_ERROR", { message: data.message, runId: currentRunId });
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "START_EXTRACT") {
      if (typeof msg.includeReplies === "boolean") includeReplies = msg.includeReplies;
      startExtract({ runId: msg.runId }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "STOP_EXTRACT") {
      stopExtract();
      sendResponse({ ok: true });
      return;
    }
  });

  function boot() {
    injectIconSprite();
    placeUi();
    // Default visibility: TETAP TERTUTUP (flat minimal) — hasil tersimpan
    // dipulihkan ke state panel, badge FAB menampilkan jumlah, tapi panel
    // tidak mengambang terbuka di atas halaman.
    sendBg("GET_STATE").then((res) => {
      if (!res?.ok || !res?.state) return;
      const st = res.state;
      const saved = Array.isArray(st.names) ? st.names : [];
      if (saved.length > 0 && st.status !== "running") {
        setLocalState({
          status: st.status === "idle" ? "done" : st.status,
          names: saved,
          message:
            typeof st.message === "string"
              ? st.message
              : `Hasil tersimpan — ${saved.length} nama. Klik Rekap + Kirim untuk mengirim.`,
          postHint: typeof st.postHint === "string" ? st.postHint : "",
        });
      }
    });
    sendBg("INJECT_MAIN").then(() => engineCmd("PING")).then((r) => {
      if (r?.ok) engineReady = true;
    });

    let lastHref = location.href;
    let navTimer = null;

    // Bandingkan URL "post" saja (path + story/reel id) — abaikan perubahan
    // query/fragment/hash yang dipicu scroll reel (FB autoplay/route reel
    // mengganti query tanpa pindah postingan). Tanpa ini, scroll container
    // komentar reel yang panjang memicu onNavigation → run reset ("Halaman
    // berubah") padahal postingan sama.
    function canonicalPostHref(href) {
      try {
        const u = new URL(href);
        // Ambil path + (untuk reel) id video agar tak terpengaruh query/fragment
        const path = u.pathname.replace(/\/+$/, "");
        return u.origin + path;
      } catch {
        return href;
      }
    }

    function onNavigation() {
      if (canonicalPostHref(location.href) === canonicalPostHref(lastHref)) return;
      // LOG: catat navigasi yang benar-benar mereset run (dibaca via getLog).
      try {
        const prev = canonicalPostHref(lastHref);
        const now = canonicalPostHref(location.href);
        const KEY = "fnk_fb_runlog_v1";
        const raw = localStorage.getItem(KEY);
        const arr = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr)) {
          arr.push({
            t: new Date().toISOString().slice(11, 23),
            run: currentRunId ? String(currentRunId).slice(-6) : "-",
            tag: "nav",
            msg: "RESET: URL post berubah",
            from: prev.slice(-45),
            to: now.slice(-45),
            running: status === "running" ? "yes" : "no",
          });
          localStorage.setItem(KEY, JSON.stringify(arr.slice(-300)));
        }
      } catch { /* ignore */ }
      lastHref = location.href;
      if (stopFinalizeTimer) {
        clearTimeout(stopFinalizeTimer);
        stopFinalizeTimer = null;
      }
      engineCmd("STOP");
      engineReady = false;
      currentRunId = null;
      setLocalState({
        status: "idle",
        names: [],
        message: "Halaman berubah. Klik Proses di postingan ini.",
        postHint: "",
      });
      sendBg("SET_STATE", {
        patch: {
          status: "idle",
          names: [],
          count: 0,
          message: "Halaman berubah. Klik Proses di postingan ini.",
          stopReason: null,
          postHint: "",
          runId: null,
        },
      });
      sendBg("INJECT_MAIN").then(() => engineCmd("PING")).then((r) => {
        if (r?.ok) engineReady = true;
      });
    }

    function scheduleNavCheck() {
      if (navTimer) clearTimeout(navTimer);
      navTimer = setTimeout(() => {
        onNavigation();
        if (!document.getElementById(ROOT_ID)) placeUi();
      }, 300);
    }

    // SPA navigation detection — no polling:
    // 1) DOM mutations (any route change rewrites the tree)
    try {
      new MutationObserver(scheduleNavCheck).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {
      /* ignore */
    }
    // 2) history API + popstate/hashchange (route changes without DOM churn)
    try {
      const h = window.history;
      const origPush = h.pushState;
      const origReplace = h.replaceState;
      h.pushState = function (...a) {
        const r = origPush.apply(this, a);
        scheduleNavCheck();
        return r;
      };
      h.replaceState = function (...a) {
        const r = origReplace.apply(this, a);
        scheduleNavCheck();
        return r;
      };
    } catch {
      /* ignore */
    }
    window.addEventListener("popstate", scheduleNavCheck);
    window.addEventListener("hashchange", scheduleNavCheck);
  }

  // document_start may run before body exists
  function safeBoot() {
    if (!document.documentElement) {
      setTimeout(safeBoot, 50);
      return;
    }
    if (document.body || document.readyState !== "loading") {
      boot();
    } else {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
      // also try after a tick (SPA)
      setTimeout(() => {
        if (!document.getElementById(ROOT_ID)) boot();
      }, 800);
    }
  }
  safeBoot();
})();
