/**
 * Content script — UI + bridge for TikTok Nama Komentar
 */
(function () {
  if (window.__TNK_CONTENT__) return;
  window.__TNK_CONTENT__ = true;

  const INJECT_SOURCE = "tt-nama-komentar-inject";
  const ROOT_ID = "tnk-root";

  let ui = null;
  let status = "idle";
  let names = [];
  let message = "Buka video, buka komentar, lalu Proses.";
  let videoHint = "";
  let includeReplies = false;
  let hasTemplate = false;
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
    const t = data.type;
    return (
      t === "READY" ||
      t === "PROGRESS" ||
      t === "DONE" ||
      t === "ERROR" ||
      t === "NEED_TEMPLATE"
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
  function normalizeNickname(raw) {
    if (typeof raw !== "string") return "";
    let name = raw
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) return "";
    if (name.startsWith("@") && !name.includes(" ")) name = name.slice(1);
    if (name.length < 1 || name.length > 100) return "";
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
        ? `Dihentikan — ${c} ${word}.${extra} Klik Copy.`
        : `Dihentikan — belum ada ${word}.${extra}`;
    }
    if (reason === "timeout") {
      return c
        ? `Waktu habis — ${c} ${word} (mungkin belum semua).${extra} Klik Copy.`
        : `Waktu habis — belum ada ${word}.${extra}`;
    }
    if (reason === "idle" || reason === "complete") {
      if (c) return `Selesai — ${c} ${word}.${extra} Klik Copy.`;
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

  /** Daftar nama yang terlihat — hormati filter pencarian & urutan A–Z. */

  function visible() {
    return names;
  }


  function mergeNames(list) {
    const map = new Map();
    for (const n of list || []) {
      const k = normalizeNickname(n);
      if (k && !map.has(k.toLowerCase())) map.set(k.toLowerCase(), k);
    }
    return [...map.values()];
  }

  function setLocal(patch) {
    if (patch.status) status = patch.status;
    if (patch.names) names = mergeNames(patch.names);
    if (patch.message != null) message = patch.message;
    if (patch.videoHint != null) videoHint = patch.videoHint;
    if (typeof patch.includeReplies === "boolean") includeReplies = patch.includeReplies;
    if (typeof patch.hasTemplate === "boolean") hasTemplate = patch.hasTemplate;
    render();
  }

  function extractAwemeFromLocation() {
    const patterns = [
      /tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/i,
      /tiktok\.com\/(?:embed|v)\/(\d+)/i,
      /\/video\/(\d+)/i,
      /\/photo\/(\d+)/i,
    ];
    for (const re of patterns) {
      const m = String(location.href).match(re);
      if (m) return m[1];
    }
    return null;
  }

  async function refreshTemplateFlag() {
    const awemeId = extractAwemeFromLocation();
    const res = await sendBg("GET_TEMPLATE", { awemeId });
    hasTemplate = !!res?.url;
    render();
    return res?.url || null;
  }

  function makeRunId() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /** Bumps on every start/stop so superseded async starts abort cleanly */
  let startGen = 0;

  /** Rekap + Kirim ke ReSo: ekstrak lalu otomatis kirim nama ke database. */
  async function rekapSend() {
    if (status === "running") return;
    await startExtract();
    const start = Date.now();
    while (Date.now() - start < 300000) {
      if (["done", "partial", "stopped", "error"].includes(status)) break;
      await new Promise((r) => setTimeout(r, 800));
    }
    const list = (names || []).slice();
    if (!list.length) {
      setLocal({ message: "Tidak ada nama untuk dikirim ke ReSo." });
      return;
    }
    const sh = globalThis.RS_SHARED || {};
    let hint = null;
    try {
      const r = typeof sh.scanPageForPostDate === "function" ? sh.scanPageForPostDate() : null;
      if (r && r.suggestedDate)
        hint = {
          suggestedDate: r.suggestedDate,
          suggestedTime: r.suggestedTime,
          suggestedIso: r.suggestedIso,
          label: r.label,
        };
    } catch { /* tanpa saran — pakai hari ini */ }
    // TikTok: createTime dari rehydration JSON lebih presisi daripada teks
    // relatif ("2 hari") — unix detik → tanggal+jam lokal.
    try {
      const el = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
      const ct =
        el && typeof sh.createTimeFromRehydration === "function"
          ? sh.createTimeFromRehydration(JSON.parse(el.textContent || "{}"))
          : null;
      if (ct && ct.date) {
        hint = {
          suggestedDate: ct.date,
          suggestedTime: ct.time,
          suggestedIso: ct.iso,
          label: `${ct.date} ${ct.time || ""}`.trim(),
        };
      }
    } catch { /* rehydration tak tersedia — tetap pakai hasil scan DOM */ }
    setLocal({ message: "Mengirim ke ReSo…" });
    try {
      const out = await sh.sendNamesToResoApi("tiktok", list, hint || {});
      setLocal({
        message:
          (hint && hint.label ? `Post ~${hint.label} — ` : "") +
          (out?.message || (out?.ok ? "Terkirim ke ReSo." : "Gagal kirim.")),
      });
    } catch (e) {
      setLocal({ message: `Gagal kirim ke ReSo: ${e?.message || e}` });
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
    if (gen !== startGen) return;

    // Cooldown antar-run (pola IG — konsisten lintas platform): jeda minimum
    // setelah run apa pun, lebih lama lagi setelah rate limit.
    const nowC = Date.now();
    const sinceEnd = lastRunEndAt ? nowC - lastRunEndAt : Infinity;
    const sinceRl = lastRateLimitAt ? nowC - lastRateLimitAt : Infinity;
    const coolMs =
      sinceRl < COOLDOWN_RATE_LIMIT_MS
        ? COOLDOWN_RATE_LIMIT_MS - sinceRl
        : Math.max(0, COOLDOWN_MS - sinceEnd);
    if (coolMs > 0) {
      const waitSec = Math.ceil(coolMs / 1000);
      setLocal({
        status: "idle",
        message: `Tunggu ${waitSec} dtk sebelum Proses lagi (cooldown anti rate-limit).`,
      });
      setTimeout(() => {
        if (status !== "running") {
          setLocal({ message: "Cooldown selesai — klik Proses untuk mulai." });
        }
      }, coolMs);
      return;
    }

    // Pre-check login (pola IG): replay API komentar butuh sesi TikTok.
    // Gagal cepat dengan pesan jelas alih-alih run yang sia-sia saat logout.
    const login = await sendBg("CHECK_TT_LOGIN");
    if (gen !== startGen) return;
    if (login && login.loggedIn === false) {
      const noLoginMsg =
        "Sesi TikTok tidak aktif — login di tiktok.com lalu Proses lagi.";
      setLocal({ status: "error", names: [], message: noLoginMsg, videoHint: "" });
      await sendBg("SET_STATE", {
        patch: {
          status: "error",
          names: [],
          count: 0,
          message: noLoginMsg,
          stopReason: "no_login",
          videoHint: "",
          runId: null,
        },
      });
      return;
    }

    currentRunId = opts.runId || makeRunId();
    setLocal({ status: "running", names: [], message: "Menyiapkan…" });
    // tabId stamped by background from sender.tab
    const stRes = await sendBg("SET_STATE", {
      patch: {
        status: "running",
        names: [],
        count: 0,
        message: "Menyiapkan…",
        includeReplies,
        runId: currentRunId,
      },
    });
    if (gen !== startGen) return;
    if (stRes && stRes.ok === false) {
      setLocal({
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
      setLocal({
        status: "error",
        message: "Engine belum siap. Refresh video TikTok, lalu coba lagi.",
      });
      await sendBg("NAMES_ERROR", {
        message: "Engine belum siap.",
        runId: currentRunId,
      });
      return;
    }

    const templateUrl =
      opts.templateUrl || (await refreshTemplateFlag()) || null;
    if (gen !== startGen) return;

    if (!templateUrl) {
      setLocal({
        message:
          "Mencoba buka komentar… jika gagal, klik ikon komentar manual dulu.",
      });
    } else {
      await engineCmd("SET_TEMPLATE", { templateUrl });
    }
    if (gen !== startGen) return;

    const started = await engineCmd("START", {
      maxMs: 120_000,
      includeReplies,
      awemeId: opts.awemeId || extractAwemeFromLocation(),
      templateUrl,
      runId: currentRunId,
    });
    if (gen !== startGen) return;
    if (!started?.ok) {
      setLocal({
        status: "error",
        message:
          started?.error === "Run active on another tab — stop it first"
            ? "Sudah ada proses di tab lain. Stop dulu, lalu coba lagi."
            : "Gagal memulai engine. Refresh video lalu coba lagi.",
      });
      await sendBg("NAMES_ERROR", {
        message: started?.error || "START failed",
        runId: currentRunId,
      });
      await engineCmd("STOP");
    }
  }

  function stopExtract() {
    startGen += 1;
    engineCmd("STOP");
    setLocal({ status: "running", message: "Menghentikan…" });
    if (stopFinalizeTimer) clearTimeout(stopFinalizeTimer);
    const stopRunId = currentRunId;
    stopFinalizeTimer = setTimeout(() => {
      if (status !== "running") return;
      if (currentRunId !== stopRunId) return;
      const list = names.slice();
      lastRunEndAt = Date.now();
      setLocal({
        status: list.length ? "stopped" : "error",
        message: doneMessage("stopped", list.length, "tiktok"),
      });
      sendBg("NAMES_DONE", {
        names: list,
        stopReason: "stopped",
        runId: stopRunId,
        videoHint,
      });
    }, 5000);
  }

  async function doReset() {
    startGen += 1;
    if (stopFinalizeTimer) {
      clearTimeout(stopFinalizeTimer);
      stopFinalizeTimer = null;
    }
    await engineCmd("STOP");
    currentRunId = null;
    setLocal({
      status: "idle",
      names: [],
      message: "Buka video TikTok, buka panel komentar, lalu klik Proses.",
      videoHint: "",
    });
    await sendBg("RESET");
  }

  async function copyNames() {
    const vis = visible();
    const text = vis.join("\n");
    if (!text) {
      setLocal({ message: "Belum ada nama untuk disalin." });
      return false;
    }
    try {
      await navigator.clipboard.writeText(text);
      setLocal({
        message: `Tersalin ${vis.length} nama. Paste di Excel (Ctrl+V).`,
      });
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setLocal({ message: `Tersalin ${vis.length} nama. Paste di Excel.` });
        return true;
      } catch {
        setLocal({ message: "Gagal copy. Coba lagi dari panel atau popup." });
        return false;
      } finally {
        ta.remove();
      }
    }
  }

  // Helper bersama dari shared.js (classic via manifest content_scripts —
  // tanpa salinan inline; shared.js dimuat sebelum content script ini).
  const { svgIcon, resolveTheme, injectIconSprite } = globalThis.RS_SHARED;

  function createUi() {
    if (document.getElementById(ROOT_ID)) {
      ui = document.getElementById(ROOT_ID);
      return ui;
    }
    const root = document.createElement("div");
    root.id = ROOT_ID;
    // Default visibility: TERTUTUP selalu (flat minimal) — panel tidak
    // mengambang menutupi halaman saat scrolling. Buka lewat FAB; hasil
    // tetap terlihat di badge FAB.
    root.classList.add("tnk-collapsed");
        root.innerHTML = `
      <div class="tnk-panel" role="region" aria-label="TikTok Nama Komentar">
        <div class="tnk-header">
          ${svgIcon("music_note", "tnk-logo-ic")}
          <span class="tnk-title">Nama Komentar</span>
          <button type="button" class="tnk-min" data-tnk="min" title="Tutup" aria-label="Tutup panel">${svgIcon("close")}</button>
        </div>
        <div class="tnk-body">
          <div class="tnk-status" data-tnk="status" aria-live="polite"></div>
          <div class="tnk-count" data-tnk="count">0 nama</div>
          <label class="tnk-check">
            <input type="checkbox" data-tnk="replies" />
            ${svgIcon("forum")}
            <span>Balasan</span>
          </label>
          <div class="tnk-actions">
            <button type="button" class="tnk-btn tnk-ghost" data-tnk="process" title="Rekap — ambil nama" aria-label="Rekap">${svgIcon("play_arrow")}</button>
            <button type="button" class="tnk-btn tnk-primary" data-tnk="process-send" title="Rekap + Kirim ke ReSo" aria-label="Rekap + Kirim ke ReSo">${svgIcon("send")}</button>
            <button type="button" class="tnk-btn" data-tnk="stop" hidden title="Hentikan" aria-label="Hentikan">${svgIcon("stop")}</button>
            <button type="button" class="tnk-btn tnk-success" data-tnk="copy" disabled title="Salin ke clipboard" aria-label="Salin nama">${svgIcon("content_copy")}</button>
            <button type="button" class="tnk-btn tnk-ghost" data-tnk="reset" title="Bersihkan hasil" aria-label="Bersihkan hasil">${svgIcon("restart_alt")}</button>
          </div>
        </div>
      </div>
      <button type="button" class="tnk-fab" data-tnk="fab" data-count="" title="Nama Komentar" aria-label="Buka panel Nama Komentar">${svgIcon("forum")}</button>
    `;
(document.body || document.documentElement).appendChild(root);
    ui = root;

        root.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tnk]");
      if (!t) return;
      const act = t.getAttribute("data-tnk");
      if (act === "process") startExtract();
      if (act === "process-send") rekapSend();
      if (act === "stop") stopExtract();
      if (act === "copy") copyNames();
      if (act === "reset") doReset();
      if (act === "min") root.classList.add("tnk-collapsed");
      if (act === "fab") root.classList.remove("tnk-collapsed");
    });
    root.addEventListener("change", (e) => {
      if (e.target?.getAttribute?.("data-tnk") === "replies") {
        includeReplies = !!e.target.checked;
        // Persist pref seketika (parity popup) — bukan hanya saat run dimulai.
        sendBg("SET_STATE", { patch: { includeReplies } });
      }
    });
    // Keyboard: Esc menutup panel (setara tombol min).
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !ui) return;
      if (!ui.classList.contains("tnk-collapsed")) {
        ui.classList.add("tnk-collapsed");
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
          const v = prefs.includeReplies?.tiktok;
          if (status !== "running" && typeof v === "boolean" && includeReplies !== v) {
            includeReplies = v;
            render();
          }
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }

  function render() {
    if (!ui) createUi();
    ui.setAttribute("data-status", status || "idle");
    const statusEl = ui.querySelector('[data-tnk="status"]');
    const countEl = ui.querySelector('[data-tnk="count"]');
    const replies = ui.querySelector('[data-tnk="replies"]');
    const processBtn = ui.querySelector('[data-tnk="process"]');
    const sendBtn = ui.querySelector('[data-tnk="process-send"]');
    const stopBtn = ui.querySelector('[data-tnk="stop"]');
    const copyBtn = ui.querySelector('[data-tnk="copy"]');
    const fab = ui.querySelector('[data-tnk="fab"]');
    const n = (names || []).length;
    if (statusEl) statusEl.textContent = message;
    if (countEl) countEl.textContent = n ? `${n} nama` : `0 nama`;
    if (replies) replies.checked = includeReplies;
    const running = status === "running";
    if (processBtn) {
      processBtn.disabled = running;
      const ic = processBtn.querySelector(".rs-ic");
      if (ic) ic.innerHTML = svgIcon(running ? "progress_activity" : "play_arrow");
      processBtn.setAttribute("aria-label", running ? "Memproses…" : "Rekap");
      processBtn.title = running ? "Memproses…" : "Rekap — ambil nama";
    }
    if (sendBtn) {
      sendBtn.disabled = running;
      const label = running ? "Memproses…" : "Rekap + Kirim ke ReSo";
      sendBtn.setAttribute("aria-label", label);
      sendBtn.title = label;
    }
    if (stopBtn) stopBtn.hidden = !running;
    if (copyBtn) {
      copyBtn.disabled = n === 0;
      copyBtn.setAttribute("aria-label", n ? `Salin nama (${n})` : `Salin nama`);
    }
    if (fab) {
      fab.setAttribute("data-count", n > 0 ? String(n) : "");
      fab.classList.toggle("tnk-running", running);
      fab.classList.toggle(
        "tnk-done",
        (status === "done" || status === "partial" || status === "stopped") && n > 0
      );
      const fabTitle = running
        ? "Proses berjalan — buka panel untuk Stop"
        : n > 0
          ? `Buka panel — ${n} nama terkumpul`
          : "Nama Komentar";
      fab.title = fabTitle;
      fab.setAttribute("aria-label", fabTitle);
    }
  }


  function mapDone(stopReason, count) {
    if (stopReason === "stopped") return "stopped";
    if (stopReason === "timeout") return "partial";
    if (stopReason === "rate_limit") return count ? "partial" : "error";
    if (stopReason === "no_login") return "error";
    if (
      stopReason === "error" ||
      stopReason === "no_template" ||
      stopReason === "no_video"
    )
      return "error";
    return count ? "done" : "error";
  }

  /** Pesan akhir run via helper tunggal (DONEMSG) — konsisten lintas platform. */

  function isCurrentRun(runId) {
    if (!currentRunId) return false;
    if (typeof runId !== "string" || !runId) return false;
    return runId === currentRunId;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!acceptFromInject(data)) return;

    if (data.type === "READY") {
      engineReady = true;
      return;
    }
    if (data.type === "NEED_TEMPLATE") {
      // Only while a run is active — parity isCurrentRun dengan PROGRESS/
      // DONE/ERROR: NEED_TEMPLATE stale/spoof (runId tak cocok) tidak memicu
      // GET_TEMPLATE+SET_TEMPLATE. (Engine mengirim runId via post().)
      if (status !== "running") return;
      if (!isCurrentRun(data.runId)) return;
      refreshTemplateFlag().then((url) => {
        if (url) engineCmd("SET_TEMPLATE", { templateUrl: url });
      });
      return;
    }
    if (data.type === "PROGRESS") {
      if (status !== "running") return;
      if (!isCurrentRun(data.runId)) return;
      const list = Array.isArray(data.names) ? data.names : [];
      setLocal({
        status: "running",
        names: list,
        message:
          typeof data.message === "string"
            ? data.message
            : `Mengumpulkan… ${list.length}`,
        videoHint:
          typeof data.videoHint === "string" ? data.videoHint : videoHint,
      });
      sendBg("NAMES_PROGRESS", {
        names: list,
        message: data.message,
        videoHint: data.videoHint,
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
      if (stopReason === "rate_limit" || /rate\s*limit|429/i.test(data.videoHint || "")) {
        lastRateLimitAt = Date.now();
      }
      setLocal({
        status: mapDone(stopReason, list.length),
        names: list,
        message: doneMessage(stopReason, list.length, "tiktok"),
        videoHint:
          typeof data.videoHint === "string" ? data.videoHint : videoHint,
      });
      sendBg("NAMES_DONE", {
        names: list,
        stopReason,
        videoHint: data.videoHint,
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
      setLocal({
        status: "error",
        message:
          typeof data.message === "string" ? data.message : "Error",
      });
      sendBg("NAMES_ERROR", { message: data.message, runId: currentRunId });
    }
  });

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (!msg?.type) return;
    if (msg.type === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "START_EXTRACT") {
      if (typeof msg.includeReplies === "boolean") includeReplies = msg.includeReplies;
      startExtract({
        awemeId: msg.awemeId,
        templateUrl: msg.templateUrl,
        runId: msg.runId,
      }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "STOP_EXTRACT") {
      stopExtract();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "COPY_FROM_PAGE") {
      copyNames().then((ok) => sendResponse({ ok }));
      return true;
    }
  });

  // Refresh badge "siap" TIDAK lewat storage.session: area session tidak
  // mengirim event onChanged ke content scripts (TRUSTED_CONTEXTS).
  // refreshTemplateFlag sudah dijalankan dari boot, GET_STATE, START/
  // SET_TEMPLATE, dan navigasi — selalu akurat via re-validasi GET_TEMPLATE
  // (TTL+shape), bukan nilai mentah.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.rsx_prefs) applySettings();
    if (changes.rsx_enabled !== undefined) applyMode();
  });

  function boot() {
    injectIconSprite();
    createUi();
    render();
    // Default visibility: TETAP TERTUTUP (flat minimal) — hasil tersimpan
    // dipulihkan ke state panel + badge FAB; panel tidak auto-buka.
    sendBg("GET_STATE").then((res) => {
      if (!res?.ok || !res?.state) return;
      const st = res.state;
      const saved = Array.isArray(st.names) ? st.names : [];
      // hasTemplate diterapkan TANPA SYARAT (pola popup: GET_STATE merekomputasi
      // TTL+shape) — badge selalu akurat walau tanpa hasil tersimpan, dan saat
      // service worker baru bangun.
      if (typeof st.hasTemplate === "boolean" && st.status !== "running") {
        hasTemplate = st.hasTemplate;
      }
      if (saved.length > 0 && st.status !== "running") {
        setLocal({
          status: st.status === "idle" ? "done" : st.status,
          names: saved,
          message:
            typeof st.message === "string"
              ? st.message
              : `Hasil tersimpan — ${saved.length} nama. Klik Copy.`,
          videoHint: typeof st.videoHint === "string" ? st.videoHint : "",
        });
      }
      render();
    });
    refreshTemplateFlag();
    sendBg("INJECT_MAIN").then(() => engineCmd("PING")).then((r) => {
      if (r?.ok) engineReady = true;
    });

    let lastHref = location.href;
    let navTimer = null;

    function onNavigation() {
      if (location.href === lastHref) return;
      lastHref = location.href;
      if (stopFinalizeTimer) {
        clearTimeout(stopFinalizeTimer);
        stopFinalizeTimer = null;
      }
      engineCmd("STOP");
      engineReady = false;
      currentRunId = null;
      setLocal({
        status: "idle",
        names: [],
        message: "Halaman berubah. Buka komentar video ini, lalu Proses.",
        videoHint: "",
      });
      sendBg("SET_STATE", {
        patch: {
          status: "idle",
          names: [],
          count: 0,
          message: "Halaman berubah. Buka komentar video ini, lalu Proses.",
          stopReason: null,
          videoHint: "",
          runId: null,
        },
      });
      sendBg("INJECT_MAIN").then(() => engineCmd("PING")).then((r) => {
        if (r?.ok) engineReady = true;
      });
      refreshTemplateFlag();
    }

    function scheduleNavCheck() {
      if (navTimer) clearTimeout(navTimer);
      navTimer = setTimeout(() => {
        onNavigation();
        if (!document.getElementById(ROOT_ID)) {
          createUi();
          render();
        }
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
