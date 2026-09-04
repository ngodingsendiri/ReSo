/**
 * MAIN-world engine — FB Nama Komentar v1.5
 * Mesin GraphQL pagination aktif (setara store-grade), output hanya nama.
 *
 * Primary: capture Facebook /api/graphql comment requests → replay with cursor
 * Secondary: always-on response buffer + multi-strategy DOM
 */
(function () {
  const SOURCE = "fb-nama-komentar-inject";
  const VERSION = 8;

  if (window.__FNK_ENGINE__) {
    // Engine already live; ENGINE_CMD uses non-enumerable __RESO_FNK__
    return;
  }
  window.__FNK_ENGINE__ = true;

  /** @type {Map<string, string>} */
  const nameMap = new Map();
  // S7: flag diagnosa lapangan (set localStorage "rsx_debug"="1").
  const DEBUG = (() => {
    try {
      return localStorage.getItem("rsx_debug") === "1";
    } catch {
      return false;
    }
  })();

  // ---------------- RUN LOG (audit trail per run) ----------------
  // Log ring-buffer setiap keputusan engine (mode, scroll, expand, navigasi,
  // pagination, alasan berhenti) supaya masalah lapangan bisa dilacak TANPA
  // menebak. Disimpan di localStorage `fnk_fb_runlog_v1` (maks 300 baris) dan
  // bisa dibaca lewat `window.__RESO_FNK__.getLog()`.
  const RUNLOG_KEY = "fnk_fb_runlog_v1";
  const RUNLOG_MAX = 300;
  let runLog = [];
  try {
    const raw = localStorage.getItem(RUNLOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) runLog = arr.slice(-RUNLOG_MAX);
  } catch { /* ignore */ }

  function flushLog() {
    try {
      localStorage.setItem(RUNLOG_KEY, JSON.stringify(runLog.slice(-RUNLOG_MAX)));
    } catch { /* quota — abaikan */ }
  }

  /**
   * Catat satu event engine.
   * @param {string} tag kategori singkat (mis. "run", "scroll", "expand", "gql")
   * @param {string} msg deskripsi
   * @param {Record<string, unknown>} [extra] data ringkas (angka/string saja)
   */
  function logEvent(tag, msg, extra) {
    try {
      const entry = {
        t: new Date().toISOString().slice(11, 23),
        run: currentRunId ? String(currentRunId).slice(-6) : "-",
        tag: String(tag).slice(0, 16),
        msg: String(msg).slice(0, 180),
      };
      if (extra && typeof extra === "object") {
        for (const [k, v] of Object.entries(extra)) {
          if (v == null) continue;
          const val = typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60);
          entry[String(k).slice(0, 12)] = val;
        }
      }
      runLog.push(entry);
      if (runLog.length > RUNLOG_MAX) runLog = runLog.slice(-RUNLOG_MAX);
      flushLog();
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.debug(`[ReSo:${entry.tag}] ${entry.msg}`, extra || "");
      }
    } catch { /* logging tidak boleh menggagalkan run */ }
  }

  function getRunLog(limit) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(limit, RUNLOG_MAX) : 120;
    return runLog.slice(-n);
  }

  function clearRunLog() {
    runLog = [];
    try { localStorage.removeItem(RUNLOG_KEY); } catch { /* ignore */ }
  }
  /** @type {string[]} */
  const gqlBuffer = [];
  const GQL_BUFFER_MAX = 50;
  // L3.3-AUDIT: payload respons FB bisa multi-MB; simpan hanya awalan untuk
  // drain ulang (live-harvest tetap memproses teks PENUH saat respons datang,
  // jadi pemotongan ini hanya menghemat memori, bukan akurasi).
  const MAX_BUFFER_TEXT = 512_000;
  // L3.2-AUDIT: prefilter komentar-bentuk (bukan sekadar "name") — payload
  // feed/notify tidak lagi memenuhi ring buffer.
  const BUFFER_SHAPE =
    /"__typename"\s*:\s*"(?:Comment|XFBComment)"|"comment_parent"|"reply_parent_comment"|"commentsAfterCursor"|"(?:feedbackID|feedback_id)"|"author"\s*:\s*\{[\s\S]{0,600}?"name"\s*:/;

  /**
   * Captured GraphQL request templates for comment pagination.
   * @type {Map<string, {url:string, params:Record<string,string>, variables:any, friendlyName:string, capturedAt:number}>}
   */
  const gqlTemplates = new Map();
  /** Last top-level comment list template key */
  let lastTopLevelKey = null;
  /** Last reply template key */
  let lastReplyKey = null;

  let running = false;
  let stopFlag = false;
  let lastNewAt = Date.now();
  let includeReplies = true;
  let currentRunId = null;
  /**
   * Feedback id postingan yang sedang di-paginate (di-set saat probe memilih
   * template). Dipakai memfilter nama dari respons GraphQL halaman (hook
   * fetch/XHR) agar komentar postingan LAIN tidak bocor ke hasil.
   */
  let activeFeedbackId = null;
  /** Total GraphQL requests this run (budget guard — protect the user's account) */
  let requestBudget = 0;
  const REQUEST_BUDGET = 350;
  /** S1: estimasi jumlah komentar post dari run terakhir (0 = tak diketahui). */
  let lastRunTotalCount = 0;
  /** L1.1-AUDIT: doc_id → jumlah gagal probe (diagnosa doc_id mati via rsx_debug). Bounded 20 entries. */
  const probeStats = new Map();
  const PROBE_STATS_MAX = 20;
  function trackProbeStat(key) {
    probeStats.set(key, (probeStats.get(key) || 0) + 1);
    if (probeStats.size > PROBE_STATS_MAX) {
      const first = probeStats.keys().next().value;
      probeStats.delete(first);
    }
  }
  /** @type {Element | null} */
  let postRoot = null;
  let engineMode = "idle"; // graphql | hybrid | dom

  // Fix reel: komentar reel dirender di `complementary`/slider (LUAR postRoot) —
  // scrape/expand wajib jatuh ke document bila postRoot tidak lagi memuat komentar.
  function rootOrDocument() {
    try {
      if (typeof document !== "undefined" && postRoot && document.contains(postRoot) && postRoot.querySelectorAll('[role="article"]').length) {
        return postRoot;
      }
    } catch { /* ignore */ }
    return typeof document !== "undefined" ? document : null;
  }

  // Muat template pagination tersimpan (doc_id) dari sesi sebelumnya — jadi
  // postingan baru bisa langsung paginate GraphQL tanpa buka komentar dulu.
  try {
    for (const t of loadStoredTemplates()) {
      if (!t || !t.friendlyName || !t.doc_id) continue;
      const variables = { ...(t.variables || {}) };
      // Mulai dari halaman 1: bersihkan state pagination lama
      delete variables.after;
      delete variables.before;
      delete variables.cursor;
      delete variables.commentsAfterCursor;
      delete variables.repliesAfterCursor;
      variables.isPaginating = false;
      variables.isInitialFetch = true;
      gqlTemplates.set(`__stored__${t.friendlyName}`, {
        url: t.url || "https://www.facebook.com/api/graphql/",
        params: { doc_id: t.doc_id },
        variables,
        friendlyName: t.friendlyName,
        capturedAt: 0,
      });
    }
  } catch {
    /* ignore */
  }

  /** Data-plane only (PROGRESS/DONE/ERROR). Control plane is ENGINE_CMD via executeScript. */
  function post(type, payload = {}) {
    window.postMessage(
      { source: SOURCE, type, runId: currentRunId, ...payload },
      "*"
    );
  }

  // ---------------- names ----------------
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

  // BEGIN-RESO-PARSERS
  /**
   * SINGLE SOURCE OF TRUTH untuk parsing payload komentar — dipakai engine
   * MAIN-world (inject-fb.js / inject-tiktok.js / inject-ig.js) lewat salinan
   * byte-identik di dalam marker yang sama — dijamin fixture test PARSERS.
   * Semua fungsi murni: hanya memetakan payload JSON/teks ke daftar nama
   * (tanpa normalisasi/dedupe — pemanggil yang menormalkan).
   */

  /** TikTok: nickname dari payload comment/list (jalur array + fallback walk). */
  function parseTikTokComments(data, includeReplies) {
    const out = [];
    const arrays = [];
    if (Array.isArray(data?.comments)) arrays.push(data.comments);
    if (Array.isArray(data?.data?.comments)) arrays.push(data.data.comments);
    if (Array.isArray(data?.comments?.list)) arrays.push(data.comments.list);

    const takeUser = (user) => {
      if (!user || typeof user !== "object") return;
      const nick = user.nickname || user.nickName;
      if (typeof nick === "string") out.push(nick);
    };

    if (arrays.length) {
      for (const comments of arrays) {
        for (const c of comments) {
          if (!c || typeof c !== "object") continue;
          takeUser(c.user);
          if (typeof c.nickname === "string") out.push(c.nickname);
          // Hanya balasan tertanam saat user memilih ikut sertakan
          if (includeReplies) {
            const replies = c.reply_comment || c.reply_comments || c.comments;
            if (Array.isArray(replies)) {
              for (const r of replies) takeUser(r?.user);
            }
          }
        }
      }
      return out;
    }

    // Fallback: hanya node berbentuk komentar (hindari pohon balasan dalam saat nonaktif)
    const walk = (v, depth = 0) => {
      if (depth > 28 || v == null) return;
      if (Array.isArray(v)) {
        for (const item of v) walk(item, depth + 1);
        return;
      }
      if (typeof v !== "object") return;
      const looksComment =
        v.user &&
        (v.cid != null ||
          v.comment_id != null ||
          v.text != null ||
          v.create_time != null ||
          v.digg_count != null);
      if (looksComment) takeUser(v.user);
      for (const k of Object.keys(v)) {
        if (
          !includeReplies &&
          (k === "reply_comment" || k === "reply_comments")
        ) {
          continue;
        }
        walk(v[k], depth + 1);
      }
    };
    walk(data, 0);
    return out;
  }

  /** Instagram: username dari payload comments (top-level). */
  function parseIgComments(data) {
    const out = [];
    const comments = Array.isArray(data?.comments) ? data.comments : [];
    for (const c of comments) {
      if (!c || typeof c !== "object") continue;
      const u = c?.user?.username || "";
      if (u) out.push(u);
    }
    return out;
  }

  /** Facebook: nama dari teks GraphQL (pola regex — cermin extractNamesFromText);
   *  balasan ikut hanya saat includeReplies (cermin isReplyComment di walkJson). */
  function extractGraphqlNames(text, includeReplies) {
    const out = [];
    if (!text || typeof text !== "string") return out;
    const patterns = [
      /"__typename"\s*:\s*"Comment"[\s\S]{0,1500}?"author"\s*:\s*\{[\s\S]{0,600}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"/g,
      /"author"\s*:\s*\{[\s\S]{0,400}?"__typename"\s*:\s*"User"[\s\S]{0,300}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"/g,
      /"author"\s*:\s*\{[\s\S]{0,300}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"[\s\S]{0,300}?"__typename"\s*:\s*"User"/g,
      /"created_time"\s*:\s*\d+[\s\S]{0,500}?"author"\s*:\s*\{[\s\S]{0,400}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"/g,
      /"author"\s*:\s*\{[\s\S]{0,400}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"[\s\S]{0,500}?"created_time"\s*:\s*\d+/g,
      /"body"\s*:\s*\{[^}]{0,200}"text"\s*:\s*"[^"]{0,500}"[\s\S]{0,400}?"author"\s*:\s*\{[\s\S]{0,400}?"name"\s*:\s*"((?:\\.|[^"\\]){2,100})"/g,
    ];
    // Apakah Comment di sekitar match adalah balasan — cermin isReplyComment
    // (comment_parent/reply_parent_comment/comment_direct_parent truthy, atau
    // depth > 0), plus penanda is_reply:true. Batas objek komentar dihitung
    // sekali lewat teks (string-aware, satu pass), jadi field komentar tetangga
    // maupun sub-pohon balasan tidak ikut terbaca (comment_parent:null pada
    // komentar top-level tetap lolos). Lazy: hanya dijalankan saat nonaktif.
    let commentSpans = null;
    const isReplyAt = (index) => {
      if (!commentSpans) {
        const starts = [];
        const ends = new Map();
        const stack = [];
        let inStr = false;
        let esc = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === "\\") esc = true;
            else if (ch === '"') inStr = false;
            continue;
          }
          if (ch === '"') inStr = true;
          else if (ch === "{") {
            stack.push(i);
            // Objek komentar = yang membuka dengan __typename "Comment"
            // (Relay menaruh __typename di posisi pertama).
            if (/^\s*"__typename"\s*:\s*"Comment"/.test(text.slice(i + 1, i + 41)))
              starts.push(i);
          } else if (ch === "}") {
            const open = stack.pop();
            if (open !== undefined) ends.set(open, i + 1);
          }
        }
        commentSpans = { starts, ends };
      }
      const { starts, ends } = commentSpans;
      // Objek komentar terdekat yang mengandung match (cari mundur dari start
      // terakhir ≤ index sampai ujung objeknya melewati index).
      let lo = 0;
      let hi = starts.length - 1;
      let pos = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= index) {
          pos = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      while (pos >= 0) {
        const start = starts[pos];
        const end = ends.get(start) ?? text.length;
        if (end > index) {
          // Kanan: berhenti di objek komentar tertanam berikutnya (sub-pohon
          // balasan), atau ujung objek — mana yang lebih dulu.
          const next = pos + 1 < starts.length ? starts[pos + 1] : end;
          const ctx = text.slice(start, Math.min(next, end));
          if (
            /"(?:comment_parent|reply_parent_comment|comment_direct_parent)"\s*:\s*\{/.test(
              ctx
            )
          )
            return true;
          const depth = /"depth"\s*:\s*(\d+)/.exec(ctx);
          if (depth && Number(depth[1]) > 0) return true;
          if (/"(?:is_reply|isReply)"\s*:\s*true/.test(ctx)) return true;
          return false;
        }
        pos--;
      }
      // Tanpa konteks objek komentar (mis. urutan field non-Relay) → bukan balasan.
      return false;
    };
    const seen = new Set();
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (!includeReplies && isReplyAt(m.index)) continue;
        let name;
        try {
          name = JSON.parse(`"${m[1]}"`);
        } catch {
          name = m[1];
        }
        if (typeof name === "string" && name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          out.push(name);
        }
      }
    }
    return out;
  }
  // END-RESO-PARSERS

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

  function addName(raw) {
    const name = normalizeCommentName(raw);
    if (!name) return false;
    const key = name.toLowerCase();
    if (nameMap.has(key)) return false;
    nameMap.set(key, name);
    lastNewAt = Date.now();
    return true;
  }

  function snapshot() {
    return [...nameMap.values()];
  }

  // ---------------- GraphQL name extract ----------------
  function extractNamesFromText(text) {
    if (!text || typeof text !== "string") return 0;
    const before = nameMap.size;
    for (const name of extractGraphqlNames(text, includeReplies)) addName(name);
    try {
      const cleaned = text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;/, "").trim();
      for (const chunk of splitJsonChunks(cleaned)) {
        try {
          walkJson(JSON.parse(chunk), 0);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return nameMap.size - before;
  }

  function isCommentLike(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (obj.__typename === "Comment" || obj.__typename === "XFBComment") return true;
    if (obj.comment_parent || obj.reply_parent_comment || obj.comment_direct_parent)
      return true;
    if (
      obj.author &&
      (obj.body || obj.created_time != null || obj.legacy_fbid != null || obj.depth != null)
    )
      return true;
    return false;
  }

  function isReplyComment(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (obj.comment_parent || obj.reply_parent_comment || obj.comment_direct_parent)
      return true;
    if (typeof obj.depth === "number" && obj.depth > 0) return true;
    return false;
  }

  function walkJson(value, depth) {
    if (depth > 50 || value == null) return;
    if (typeof value === "string") {
      if (value.length > 80 && /author|Comment/.test(value)) extractNamesFromText(value);
      return;
    }
    if (typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walkJson(item, depth + 1);
      return;
    }
    // Skip non-comment objects that have "name" but are sticker/attachment/media metadata
    const typeName = value.__typename || "";
    if (
      /^(Sticker|StickerPack|GIF|AnimatedImage|Photo|Video|Attachment|ExternalUrl|Page)$/i.test(typeName)
    ) {
      return; // Don't descend into media/attachment nodes
    }
    if (isCommentLike(value) && value.author?.name) {
      if (includeReplies || !isReplyComment(value)) addName(value.author.name);
    }
    if (value.node && isCommentLike(value.node) && value.node.author?.name) {
      if (includeReplies || !isReplyComment(value.node))
        addName(value.node.author.name);
    }
    for (const k of Object.keys(value)) {
      // Skip media/attachment keys that may contain name-like fields
      if (k === "profile_picture" || k === "image" || k === "sprite") continue;
      if (k === "sticker" || k === "sticker_pack" || k === "attached_sticker") continue;
      if (k === "gif_image" || k === "animated_image") continue;
      walkJson(value[k], depth + 1);
    }
  }

  function splitJsonChunks(text) {
    const out = [];
    const trimmed = text.trim();
    if (!trimmed) return out;
    try {
      JSON.parse(trimmed);
      return [trimmed];
    } catch {
      /* multi */
    }
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === "{" || ch === "[") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(trimmed.slice(start, i + 1));
          start = -1;
        }
      }
    }
    if (!out.length) out.push(trimmed);
    return out;
  }

  // ---------------- page_info / cursor from GraphQL response ----------------
  function findPageInfo(obj) {
    // Kumpulkan SEMUA page_info + konteksnya, lalu pilih milik koneksi komentar
    // TOP-LEVEL. DFS lama mengembalikan yang PERTAMA ditemukan — dan karena
    // objek koneksi Relay menyimpan `edges` sebelum `page_info`, koneksi
    // balasan yang tertanam di dalam edges (replies_connection, dll.) selalu
    // ditemukan lebih dulu. Akibatnya loop utama memakai cursor/has_next_page
    // milik koneksi BALASAN untuk query top-level → pagination berhenti
    // prematur di halaman 1 (atau memakai cursor balasan yang salah).
    const candidates = [];
    const walk = (v, path) => {
      if (path.length > 40 || !v || typeof v !== "object") return;
      if (Array.isArray(v)) {
        for (const item of v) walk(item, path);
        return;
      }
      // Koneksi Relay: { edges: [...], page_info: {...} } — page_info milik
      // koneksi INI. JANGAN turun ke edges: di sanalah koneksi balasan
      // tertanam (page_info-nya bukan milik koneksi yang sedang di-paginate).
      const pi = v.page_info ?? v.pageInfo ?? null;
      if (
        Array.isArray(v.edges) &&
        pi &&
        ("has_next_page" in pi || "hasNextPage" in pi) &&
        ("end_cursor" in pi || "endCursor" in pi)
      ) {
        candidates.push({
          page: {
            hasNext:
              pi.has_next_page === true ||
              pi.hasNextPage === true ||
              pi.has_next_page === 1,
            endCursor: pi.end_cursor ?? pi.endCursor ?? null,
          },
          inReplySubtree: path.some((k) => /reply|replie/i.test(String(k))),
          edgeCount: v.edges.length,
          depth: path.length,
        });
        return;
      }
      // Fallback: objek page_info telanjang (bentuk non-koneksi).
      if (
        ("has_next_page" in v || "hasNextPage" in v) &&
        ("end_cursor" in v || "endCursor" in v)
      ) {
        candidates.push({
          page: {
            hasNext:
              v.has_next_page === true ||
              v.hasNextPage === true ||
              v.has_next_page === 1,
            endCursor: v.end_cursor ?? v.endCursor ?? null,
          },
          inReplySubtree: path.some((k) => /reply|replie/i.test(String(k))),
          edgeCount: -1,
          depth: path.length,
        });
        return;
      }
      for (const k of Object.keys(v)) walk(v[k], path.concat(k));
    };
    walk(obj, []);
    if (!candidates.length) return null;
    // Prioritas: bukan sub-pohon balasan → edges terbanyak (koneksi komentar
    // utama, bukan set balasan kecil) → paling dangkal. Koneksi balasan
    // tertanam tidak pernah masuk daftar (di-skip saat traversal), tapi
    // penanda ini tetap menjaga bentuk payload lain yang masih mengeksposnya.
    candidates.sort((a, b) => {
      if (Number(a.inReplySubtree) !== Number(b.inReplySubtree)) {
        return Number(a.inReplySubtree) - Number(b.inReplySubtree);
      }
      if (b.edgeCount !== a.edgeCount) return b.edgeCount - a.edgeCount;
      return a.depth - b.depth;
    });
    // Bentuk publik tetap { hasNext, endCursor } (sama seperti sebelumnya) —
    // field ranking tidak pernah bocor ke pemanggil.
    return candidates[0].page;
  }

  /**
   * Estimasi jumlah komentar postingan dari respons GraphQL (field
   * total_count pada node feedback/comments). Diambil NILAI MAKSIMUM yang
   * ditemukan (node berbeda bisa membawa subset), cap 100 ribu sanity.
   * Dipakai untuk progres "N/±M" dan konteks keterisian hasil di DONE.
   */
  function findTotalCount(obj) {
    let best = 0;
    const walk = (v, depth) => {
      if (depth > 30 || v == null || typeof v !== "object") return;
      if (Array.isArray(v)) {
        for (const x of v) walk(x, depth + 1);
        return;
      }
      for (const k of Object.keys(v)) {
        const val = v[k];
        if (
          (k === "total_count" || k === "totalCount") &&
          typeof val === "number" &&
          Number.isFinite(val) &&
          val > best &&
          val <= 100000
        ) {
          best = val;
        } else if (val && typeof val === "object") {
          walk(val, depth + 1);
        }
      }
    };
    walk(obj, 0);
    return best;
  }

  function findFeedbackIds(obj, out = new Set(), depth = 0) {
    if (depth > 40 || !obj || typeof obj !== "object") return out;
    if (Array.isArray(obj)) {
      for (const i of obj) findFeedbackIds(i, out, depth + 1);
      return out;
    }
    if (typeof obj.id === "string" && /^feedback[:_]/i.test(obj.id)) out.add(obj.id);
    if (typeof obj.feedback_id === "string") out.add(obj.feedback_id);
    if (obj.__typename === "Feedback" && typeof obj.id === "string") out.add(obj.id);
    // common Relay id shape
    if (
      typeof obj.id === "string" &&
      obj.id.length > 10 &&
      typeof obj.__typename === "string" &&
      /feedback/i.test(obj.__typename)
    )
      out.add(obj.id);
    for (const k of Object.keys(obj)) findFeedbackIds(obj[k], out, depth + 1);
    return out;
  }

  // ---------------- capture GraphQL requests (store-grade) ----------------
  const COMMENT_FRIENDLY =
    /comment|ufi|feedback|reply|replies|depth\d*comments|CommentsList|CometUFI|CommentList/i;

  function isGraphqlUrl(url) {
    if (!url) return false;
    const u = String(url).toLowerCase();
    return u.includes("graphql") || u.includes("/api/graphql");
  }

  function parseBodyToParams(body) {
    const params = {};
    if (body == null) return params;
    if (typeof body === "string") {
      if (body.startsWith("{")) {
        try {
          const j = JSON.parse(body);
          Object.keys(j).forEach((k) => {
            params[k] = typeof j[k] === "string" ? j[k] : JSON.stringify(j[k]);
          });
          return params;
        } catch {
          /* form */
        }
      }
      try {
        const usp = new URLSearchParams(body);
        usp.forEach((v, k) => {
          params[k] = v;
        });
      } catch {
        /* ignore */
      }
      return params;
    }
    if (typeof body === "object" && typeof body.entries === "function") {
      // FormData / URLSearchParams
      try {
        for (const [k, v] of body.entries()) params[k] = String(v);
      } catch {
        /* ignore */
      }
    }
    return params;
  }

  function captureGraphqlRequest(url, body) {
    if (!isGraphqlUrl(url)) return;
    const params = parseBodyToParams(body);
    const friendly =
      params.fb_api_req_friendly_name ||
      params.friendly_name ||
      params.__req ||
      "";
    if (!friendly || !COMMENT_FRIENDLY.test(String(friendly))) {
      // still buffer response; only templates for comment-ish names
      if (!params.doc_id && !params.variables) return;
      if (!COMMENT_FRIENDLY.test(JSON.stringify(params).slice(0, 500))) return;
    }
    let variables = null;
    if (params.variables) {
      try {
        variables =
          typeof params.variables === "string"
            ? JSON.parse(params.variables)
            : params.variables;
      } catch {
        variables = null;
      }
    }
    const key = String(friendly || params.doc_id || "comment");
    const entry = {
      url: String(url).split("?")[0] || "https://www.facebook.com/api/graphql/",
      params: { ...params },
      variables,
      friendlyName: key,
      capturedAt: Date.now(),
    };
    gqlTemplates.set(key, entry);
    persistGqlTemplate(entry);

    // Classify top-level vs reply
    const lower = key.toLowerCase();
    if (/reply|depth1|depth_1|replies/i.test(lower)) {
      lastReplyKey = key;
    } else {
      lastTopLevelKey = key;
    }
  }

  function pushGqlBuffer(text) {
    if (!text || text.length < 60) return;
    // L3.2-AUDIT: bentuk komentar diperlukan — payload "name" generik
    // (feed, notifikasi, composer) tidak masuk buffer.
    if (!BUFFER_SHAPE.test(text)) return;
    // L3.3-AUDIT: cap memori per entri (lihat MAX_BUFFER_TEXT).
    gqlBuffer.push(text.length > MAX_BUFFER_TEXT ? text.slice(0, MAX_BUFFER_TEXT) : text);
    if (gqlBuffer.length > GQL_BUFFER_MAX) gqlBuffer.shift();
  }

  /**
   * Feedback id dari body request GraphQL (variabel `feedbackID`/`feedback_id`
   * saja — jangan `id`, karena itu bisa id komentar untuk query balasan).
   * Kosong = request tak bisa diklasifikasikan (balasan, bentuk tak dikenal).
   */
  function feedbackIdsFromReqBody(body) {
    if (body == null) return [];
    let vars = null;
    try {
      const params = parseBodyToParams(body);
      vars =
        typeof params.variables === "string"
          ? JSON.parse(params.variables)
          : params.variables;
    } catch {
      vars = null;
    }
    if (!vars || typeof vars !== "object") return [];
    const out = new Set();
    for (const k of ["feedbackID", "feedback_id"]) {
      const v = vars[k];
      if (typeof v === "string" && v) out.add(v);
    }
    return [...out];
  }

  /** Base64 Relay form dari id feedback ("feedback:<id>"). */
  function fbIdB64(id) {
    if (typeof id !== "string" || !id) return id;
    try {
      return btoa(`feedback:${id}`);
    } catch {
      return id;
    }
  }

  /** Cocokkan dua representasi id feedback (mentah vs base64 Relay). */
  function fbIdsMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    try {
      return a === fbIdB64(b) || b === fbIdB64(a);
    } catch {
      return false;
    }
  }

  /** Normalisasi id feedback dari variabel template (base64 Relay → mentah). */
  function normalizeFeedbackId(v) {
    if (typeof v !== "string" || !v) return v;
    if (v.length > 25 && /^[A-Za-z0-9+/=]+$/.test(v)) {
      try {
        const m = atob(v).match(/^feedback[:_](\d+)$/);
        if (m) return m[1];
      } catch {
        /* bukan base64 */
      }
    }
    return v;
  }

  /** Id feedback dari variabel template pagination TOP-LEVEL. Prioritas:
   *  feedbackID → feedback_id → id (bentuk lama). Aman memakai `id` di sini
   *  karena template dipilih dari orderedCandidates (friendlyName top-level,
   *  query ber-key feedback id) — berbeda dengan feedbackIdsFromReqBody yang
   *  sengaja TIDAK membaca `id` (query balasan menaruh id KOMENTAR di situ). */
  function feedbackIdFromTemplateVars(variables) {
    if (!variables || typeof variables !== "object") return "";
    return (
      String(variables.feedbackID || variables.feedback_id || "") ||
      (typeof variables.id === "string" ? variables.id : "")
    );
  }

  /**
   * Apakah respons GraphQL dari request `reqIds` boleh diekstrak namanya?
   * Rule: id URL (permalink) + id postingan yang sedang di-paginate. Request
   * tanpa feedback id (balasan, bentuk tak dikenal) tetap diproses.
   */
  function isTargetCommentResponse(reqIds) {
    if (!reqIds || !reqIds.length) return true;
    // Id URL bisa mentah, request FB asli membawa base64 Relay
    // ("feedback:<id>" encoded) — cocokkan kedua bentuk.
    const allowed = [...new Set(feedbackIdsFromUrl())];
    if (activeFeedbackId) allowed.push(activeFeedbackId);
    return reqIds.some((id) => allowed.some((a) => fbIdsMatch(a, id)));
  }

  // ---------------- persistensi template pagination (doc_id) ----------------
  const TPL_STORAGE_KEY = "fnk_fb_gql_tpl_v1";

  /** Template pagination tersimpan (doc_id terbaru) — dipakai ulang untuk
   *  template sintetik di postingan lain tanpa perlu buka komentar dulu. */
  function loadStoredTemplates() {
    try {
      const raw = localStorage.getItem(TPL_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  /** Simpan template pagination (ber-doc_id) terbaik ke localStorage. */
  function persistGqlTemplate(entry) {
    try {
      if (!entry || !entry.params || !entry.params.doc_id) return;
      if (!isPaginationLike(entry)) return;
      const list = loadStoredTemplates();
      const clean = {
        friendlyName: entry.friendlyName,
        url: entry.url,
        doc_id: entry.params.doc_id,
        variables: entry.variables,
        capturedAt: entry.capturedAt,
      };
      const idx = list.findIndex((t) => t.friendlyName === clean.friendlyName);
      if (idx === 0 && list[0] && list[0].doc_id === clean.doc_id) return;
      if (idx >= 0) list.splice(idx, 1);
      list.unshift(clean);
      localStorage.setItem(TPL_STORAGE_KEY, JSON.stringify(list.slice(0, 3)));
    } catch {
      /* ignore */
    }
  }

  /** Template pagination terbaik dari sesi sebelumnya (doc_id paling baru). */
  function bestStoredPaginationTemplate() {
    const list = loadStoredTemplates();
    for (const t of list) {
      if (t && t.doc_id && isPaginationLike(t)) return t;
    }
    return null;
  }

  function drainGqlBuffer() {
    let n = 0;
    const items = gqlBuffer.splice(0);
    for (const t of items) n += extractNamesFromText(t);
    return n;
  }

  // ---------------- S3: pre-seed hasil run sebelumnya ----------------
  // Re-run setelah partial tidak lagi mulai dari nol: nama run sebelumnya
  // di-post yang sama di-load kembali (scoped ke feedback id, TTL 7 hari).
  const NAMES_STORE_KEY = "fnk_fb_names_v1";

  // Preseed diperbaiki: simpan per-feedback-id (MAP), bukan satu entry global.
  // Satu entry global bikin nama dari post/reel LAIN bocor ke rekap berikutnya
  // (photo 17 komentar terekap 25 karena preseed reel 1379 sebelumnya). Kini hanya
  // dimuat bila feedback id URL persis cocok dengan kunci.
  function loadPriorNames(urlIds) {
    try {
      const raw = localStorage.getItem(NAMES_STORE_KEY);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry) return null;
      if (!(entry.at > 0 && Date.now() - entry.at < 7 * 86400_000)) return null;
      const store = entry.map || (entry.fbid ? { [entry.fbid]: entry.names } : {});
      const ids = Array.isArray(urlIds) ? urlIds : [];
      for (const fbid of Object.keys(store)) {
        if (ids.some((id) => fbIdsMatch(id, fbid))) {
          const names = store[fbid];
          if (Array.isArray(names)) return names.filter((n) => typeof n === "string" && n);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  function persistNames(fbid, names) {
    try {
      if (!fbid || !Array.isArray(names) || !names.length) return;
      const raw = localStorage.getItem(NAMES_STORE_KEY);
      let map = {};
      try {
        const prev = JSON.parse(raw);
        map = prev && prev.map ? prev.map : prev && prev.fbid ? { [prev.fbid]: prev.names } : {};
      } catch { /* ignore */ }
      // Jangan menimpa fbid lain; cap 5 entry agar localStorage tidak membengkak.
      map[fbid] = names.slice(0, 2000);
      const keys = Object.keys(map);
      if (keys.length > 5) delete map[keys[0]];
      localStorage.setItem(
        NAMES_STORE_KEY,
        JSON.stringify({ map, at: Date.now() })
      );
    } catch {
      /* ignore */
    }
  }

  // Always-on hooks
  if (!window.__FNK_NET__) {
    window.__FNK_NET__ = true;
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const req = args[0];
      const url = typeof req === "string" ? req : req?.url || "";
      let body = args[1]?.body;
      if (body == null && req && typeof req === "object" && req.clone) {
        try {
          // Request object — can't always read body twice; skip
        } catch {
          /* ignore */
        }
      }
      try {
        if (isGraphqlUrl(url) && body != null) captureGraphqlRequest(url, body);
      } catch {
        /* ignore */
      }
      const res = await origFetch.apply(this, args);
      const reqIds = feedbackIdsFromReqBody(args[1]?.body);
      try {
        if (isGraphqlUrl(url)) {
          res
            .clone()
            .text()
            .then((t) => {
              // Anti kontaminasi lintas post: hanya proses respons yang request-
              // nya membawa feedback id postingan target (atau tak terklasifikasi).
              if (!isTargetCommentResponse(reqIds)) return;
              pushGqlBuffer(t);
              if (running) extractNamesFromText(t);
            })
            .catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return res;
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__fnk_url = url;
      this.__fnk_method = method;
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      try {
        const body = args[0];
        this.__fnk_body = body;
        if (isGraphqlUrl(this.__fnk_url) && body != null) {
          captureGraphqlRequest(this.__fnk_url, body);
        }
      } catch {
        /* ignore */
      }
      this.addEventListener("load", function () {
        try {
          if (!isGraphqlUrl(this.__fnk_url)) return;
          if (typeof this.responseText === "string") {
            if (
              !isTargetCommentResponse(
                feedbackIdsFromReqBody(this.__fnk_body)
              )
            )
              return;
            pushGqlBuffer(this.responseText);
            if (running) extractNamesFromText(this.responseText);
          }
        } catch {
          /* ignore */
        }
      });
      return origSend.apply(this, args);
    };
  }

  // ---------------- tokens / replay (active GraphQL pagination) ----------------

  // Cached anti-forgery tokens — RINGAN (tanpa menserialisasi seluruh DOM
  // Facebook yang megabyte): require() dulu, scan <script> terbatas, input
  // form, dan innerHTML hanya sebagai fallback terakhir (di-cache 5 menit).
  const TOKEN_CACHE_TTL = 5 * 60 * 1000;
  const tokenCache = { dtsg: null, lsd: null, at: 0 };
  /** S4: token basi di tengah run — buang cache agar replay berikutnya
   *  mengambil DTSG/LSD segar (dipanggil setelah graphql_error beruntun). */
  function bustTokenCache() {
    try {
      tokenCache.dtsg = null;
      tokenCache.lsd = null;
      tokenCache.at = 0;
    } catch {
      /* ignore */
    }
  }

  /**
   * Cari token di dalam <script> tag saja (bukan documentElement.innerHTML):
   * baca tiap tag, lewati yang raksasa (>400 KB, mis. payload feed/video),
   * dan cek pola regex yang diberikan. Jauh lebih ringan daripada serialisasi
   * seluruh DOM — DTSGInitialData/LSD selalu ada di script JSON/inline kecil.
   */
  function findTokenInScripts(patterns) {
    try {
      const scripts = document.querySelectorAll("script");
      const limit = Math.min(scripts.length, 60);
      for (let i = 0; i < limit; i++) {
        const t = scripts[i].textContent || "";
        if (!t || t.length > 400_000) continue;
        if (!/DTSG|dtsg|LSD|lsd|fb_dtsg/i.test(t)) continue;
        for (const re of patterns) {
          const m = t.match(re);
          if (m && m[1]) return m[1];
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function getDtsg() {
    const now = Date.now();
    if (tokenCache.dtsg && now - tokenCache.at < TOKEN_CACHE_TTL) {
      return tokenCache.dtsg;
    }
    let token = null;
    // 1) Modul sudah dimuat di memory — paling cepat, tanpa scan DOM.
    try {
      if (typeof require === "function") {
        const d =
          require("DTSGInitialData") ||
          require("DTSG") ||
          require("DTSGInitData");
        if (d?.token) token = d.token;
      }
    } catch {
      /* ignore */
    }
    // 2) Scan <script> tag (terbatas & ringan).
    if (!token) {
      token = findTokenInScripts([
        /"DTSGInitialData",\[\],\{"token":"([^"]+)"/,
        /"token":"([A-Za-z0-9_:-]{8,})"[,}][^"]{0,40}DTSG/,
        /"dtsg":\{"token":"([^"]+)"/,
      ]);
    }
    // 3) Form token (halaman klasik).
    if (!token) {
      try {
        const inp = document.querySelector('input[name="fb_dtsg"]');
        if (inp?.value) token = inp.value;
      } catch {
        /* ignore */
      }
    }
    // 4) Fallback terakhir — mahal; di-cache 5 mnt jadi maksimal sekali per TTL.
    if (!token) {
      try {
        const html = document.documentElement?.innerHTML || "";
        let m = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/);
        if (m) token = m[1];
        if (!token) {
          m = html.match(/"token":"([A-Za-z0-9_:-]{8,})"[,}][^"]{0,40}DTSG/);
          if (m) token = m[1];
        }
        if (!token) {
          m = html.match(/name="fb_dtsg"\s+value="([^"]+)"/);
          if (m) token = m[1];
        }
        if (!token) {
          m = html.match(/"dtsg":\{"token":"([^"]+)"/);
          if (m) token = m[1];
        }
      } catch {
        /* ignore */
      }
    }
    if (token) {
      tokenCache.dtsg = token;
      tokenCache.at = now;
    }
    return token;
  }

  function getLsd() {
    const now = Date.now();
    if (tokenCache.lsd && now - tokenCache.at < TOKEN_CACHE_TTL) {
      return tokenCache.lsd;
    }
    let token = null;
    // 1) Modul dari memory dulu.
    try {
      if (typeof require === "function") {
        const d = require("LSD") || require("LSDInitData");
        if (d?.token) token = d.token;
      }
    } catch {
      /* ignore */
    }
    // 2) Scan <script> tag (ringan).
    if (!token) {
      token = findTokenInScripts([/"LSD",\[\],\{"token":"([^"]+)"/]);
    }
    // 3) Form token.
    if (!token) {
      try {
        const inp = document.querySelector('input[name="lsd"]');
        if (inp?.value) token = inp.value;
      } catch {
        /* ignore */
      }
    }
    // 4) Fallback terakhir (innerHTML) — di-cache 5 mnt.
    if (!token) {
      try {
        const html = document.documentElement?.innerHTML || "";
        const m = html.match(/"LSD",\[\],\{"token":"([^"]+)"/);
        if (m) token = m[1];
      } catch {
        /* ignore */
      }
    }
    if (token) {
      tokenCache.lsd = token;
      tokenCache.at = now;
    }
    return token;
  }

  function getUserId() {
    try {
      const c = document.cookie.match(/(?:^|;\s*)c_user=(\d+)/);
      if (c) return c[1];
      if (typeof require === "function") {
        const u = require("CurrentUserInitialData");
        if (u?.USER_ID) return String(u.USER_ID);
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function setCursorOnVariables(variables, cursor) {
    if (!variables || typeof variables !== "object") return variables;
    const v = JSON.parse(JSON.stringify(variables));
    const cursorKeys = [
      "commentsAfterCursor",
      "after",
      "cursor",
      "before",
      "comments_after_cursor",
      "repliesAfterCursor",
      "replies_after_cursor",
      "endCursor",
      "end_cursor",
    ];
    let set = false;
    const walk = (obj, depth) => {
      if (depth > 8 || !obj || typeof obj !== "object") return;
      for (const k of Object.keys(obj)) {
        if (cursorKeys.includes(k)) {
          obj[k] = cursor;
          set = true;
        } else if (obj[k] && typeof obj[k] === "object") {
          walk(obj[k], depth + 1);
        }
      }
    };
    walk(v, 0);
    // common top-level patterns
    if (!set) {
      if ("commentsAfterCursor" in v) v.commentsAfterCursor = cursor;
      else if ("after" in v) v.after = cursor;
      else v.commentsAfterCursor = cursor;
    }
    return v;
  }

  // ---------------- ukuran halaman replay ----------------
  /**
   * Naikkan ukuran halaman pada variabel replay (`first`/`count`/`limit`/…)
   * ke minimal PAGE_SIZE_MIN agar thread besar (ratusan komentar) selesai
   * dalam lebih sedikit ronde — mengurangi paparan window duplikat, pemakaian
   * budget request, dan risiko berhenti prematur oleh guard idle. Nilai di luar
   * rentang dikepang ke [PAGE_SIZE_MIN..PAGE_SIZE_MAX]. Deep-copy: template
   * tersimpan TIDAK termutasi.
   */
  const PAGE_SIZE_MIN = 25;
  const PAGE_SIZE_MAX = 50;
  function bumpPageSizes(variables) {
    const KEYS = ["first", "count", "limit", "pageSize", "page_size"];
    let v;
    try {
      v = JSON.parse(JSON.stringify(variables ?? {}));
    } catch {
      return {};
    }
    if (!v || typeof v !== "object") return v;
    const walk = (obj, depth) => {
      if (depth > 4 || !obj || typeof obj !== "object") return;
      for (const k of Object.keys(obj)) {
        const val = obj[k];
        if (
          KEYS.includes(k) &&
          typeof val === "number" &&
          Number.isFinite(val) &&
          val >= 0
        ) {
          // Ke pang [MIN..MAX]: 5 -> 25 (ronde lebih sedikit), 100 -> 50
          // (jangan serak permintaan raksasa), 30 -> 30 (biarkan).
          const n = Math.round(val);
          if (n < PAGE_SIZE_MIN) obj[k] = PAGE_SIZE_MIN;
          else if (n > PAGE_SIZE_MAX) obj[k] = PAGE_SIZE_MAX;
        } else if (val && typeof val === "object") {
          walk(val, depth + 1);
        }
      }
    };
    walk(v, 0);
    return v;
  }

  /**
   * S6 (murni, teruji): susun parameter body replay — ukuran halaman
   * dinaikkan (bumpPageSizes), cursor di-set pada kunci yang dikenal,
   * token anti-forgery & identitas di-refresh, default Relay diisi.
   * Dipisahkan dari fetch agar logika request bisa diuji tanpa jaringan.
   */
  function composeReplayParams(template, cursor, tokens) {
    const params = { ...template.params };
    let variables = template.variables
      ? setCursorOnVariables(bumpPageSizes(template.variables), cursor)
      : { after: cursor };
    const dtsg = tokens?.dtsg;
    if (dtsg) params.fb_dtsg = dtsg;
    const lsd = tokens?.lsd;
    if (lsd) params.lsd = lsd;
    const uid = tokens?.uid;
    if (uid) {
      if ("__user" in params) params.__user = uid;
      if ("av" in params) params.av = uid;
    }
    params.variables =
      typeof variables === "string" ? variables : JSON.stringify(variables);
    if (!params.fb_api_req_friendly_name && template.friendlyName) {
      params.fb_api_req_friendly_name = template.friendlyName;
    }
    if (!params.fb_api_caller_class) {
      params.fb_api_caller_class = "RelayModern";
    }
    if (!params.server_timestamps) params.server_timestamps = "true";
    return params;
  }

  async function graphqlReplay(template, cursor) {
    requestBudget += 1;
    // Refresh anti-forgery tokens
    const params = composeReplayParams(template, cursor, {
      dtsg: getDtsg(),
      lsd: getLsd(),
      uid: getUserId(),
    });

    const body = new URLSearchParams();
    Object.keys(params).forEach((k) => {
      if (params[k] != null) body.set(k, String(params[k]));
    });

    const url = template.url || "https://www.facebook.com/api/graphql/";
    let res;
    let text = "";
    // V1.0.86 (audit tangguh): fetch TANPA timeout = run bisa hang selamanya
    // saat koneksi menggantung — deadline hanya membatasi retry, bukan await.
    // AbortController: timeout 15 dtk + abort langsung saat Stop ditekan
    // (stopFlag dicek tiap 200 ms) agar Stop selalu responsif.
    const ctl = new AbortController();
    const fetchTimer = setTimeout(() => ctl.abort(), 15_000);
    const stopWatch = setInterval(() => {
      if (stopFlag) ctl.abort();
    }, 200);
    try {
      res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-FB-Friendly-Name":
            params.fb_api_req_friendly_name || template.friendlyName || "Comments",
          Accept: "*/*",
        },
        body: body.toString(),
        signal: ctl.signal,
      });
      text = await res.text();
    } catch (err) {
      const e = new Error("Jaringan terganggu — coba lagi.");
      e.kind = "network";
      throw e;
    } finally {
      clearTimeout(fetchTimer);
      clearInterval(stopWatch);
    }
    // Sesi kadaluarsa: FB redirect ke halaman login
    if (res.redirected && /login/i.test(res.url)) {
      const e = new Error("Sesi Facebook tidak aktif — login lalu Proses lagi.");
      e.kind = "no_login";
      throw e;
    }
    // HTTP 200 tapi isi HTML login (token kadaluarsa) — bukan data komentar
    if (/<html[\s>]/i.test(text) && /login|masuk/i.test(text)) {
      const e = new Error("Sesi Facebook tidak aktif — login lalu Proses lagi.");
      e.kind = "no_login";
      throw e;
    }
    if (!res.ok) {
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after"));
        const e = new Error(
          "Rate limit Facebook (HTTP 429) — jeda sejenak lalu coba lagi."
        );
        e.kind = "rate_limit";
        e.retryAfter = Number.isFinite(ra) && ra > 0 ? ra : null;
        throw e;
      }
      const e = new Error(`GraphQL HTTP ${res.status}`);
      e.kind = "http";
      throw e;
    }
    pushGqlBuffer(text);
    extractNamesFromText(text);

    let json = null;
    try {
      const cleaned = text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;/, "").trim();
      const chunks = splitJsonChunks(cleaned);
      json = JSON.parse(chunks[0]);
    } catch {
      /* ignore */
    }

    // Feedback id salah / post tidak publik / GraphQL error → berhenti dini
    // (probe kandidat berikutnya, bukan diam-diam jatuh ke "idle").
    if (json && Array.isArray(json.errors) && json.errors.length) {
      const first = json.errors[0] || {};
      const msg = typeof first.message === "string" ? first.message : "";
      const e = new Error(
        `GraphQL: ${msg.slice(0, 120) || "feedback tidak ditemukan"}`
      );
      e.kind = "graphql_error";
      throw e;
    }

    const page = json ? findPageInfo(json) : null;
    // S1: estimasi jumlah komentar post (progres N/±M + deteksi hasil jauh
    // di bawah ekspektasi).
    const totalCount = json ? findTotalCount(json) : 0;
    // also harvest reply expansion ids for later
    const replyIds = [];
    if (includeReplies && json) {
      const walk = (o, d = 0) => {
        if (d > 35 || !o || typeof o !== "object") return;
        if (Array.isArray(o)) {
          o.forEach((x) => walk(x, d + 1));
          return;
        }
        if (
          isCommentLike(o) &&
          o.feedback?.id &&
          (o.feedback?.replies_fields?.total_count > 0 ||
            o.feedback?.replies_connection)
        ) {
          replyIds.push(o.feedback.id);
        }
        if (o.node) walk(o.node, d + 1);
        for (const k of Object.keys(o)) {
          if (k !== "node") walk(o[k], d + 1);
        }
      };
      walk(json);
    }

    return {
      ok: res.ok,
      status: res.status,
      page,
      totalCount,
      replyIds: [...new Set(replyIds)].slice(0, 40),
      textSlice: text.slice(0, 200),
    };
  }

  /**
   * graphqlReplay dengan ketahanan: backoff adaptif 429 (hormati Retry-After,
   * eskalasi 8s → 16s, maks 2 retry, hanya jika sisa waktu cukup), retry cepat
   * untuk blip jaringan, heartbeat PROGRESS selama menunggu. Error no_login
   * diteruskan agar run berhenti aman.
   */
  async function graphqlReplayWithBackoff(template, cursor, deadline) {
    let attempt = 0;
    for (;;) {
      try {
        return await graphqlReplay(template, cursor);
      } catch (err) {
        const kind = err && err.kind;
        if (kind === "no_login") throw err;
        if (kind === "rate_limit") {
          const ra = err.retryAfter;
          const waitMs =
            ra && ra > 0
              ? Math.min(ra, 20) * 1000
              : attempt === 0
                ? 8000
                : 16000;
          if (attempt >= 2 || Date.now() + waitMs > deadline) throw err;
          attempt++;
          post("PROGRESS", {
            names: snapshot(),
            message: `Rate limit (429) — jeda ${Math.round(waitMs / 1000)} dtk…`,
            postHint: "rate_limit",
          });
          if (!(await sleepWhile(waitMs))) throw err;
          continue;
        }
        if (kind === "network" && attempt === 0) {
          attempt++;
          if (Date.now() + 1500 > deadline) throw err;
          // Stop ditekan saat menunggu retry → hentikan dengan reason benar
          // ("stopped"), bukan error jaringan yang menyesatkan.
          if (!(await sleepWhile(1200))) {
            const e = new Error("Dihentikan");
            e.kind = "stopped";
            throw e;
          }
          continue;
        }
        throw err;
      }
    }
  }

  /** Capture-shaped → likely a real comments pagination query (not composer/teaser). */
  function isPaginationLike(t) {
    if (!t) return false;
    let v = t.variables;
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        v = null;
      }
    }
    const flat = JSON.stringify(v || {});
    return /cursor|page_info|has_next_page|commentsAfterCursor|feedbackID|feedback_id|comments\b/i.test(
      flat
    );
  }

  /** Apakah variabel template membawa salah satu feedback id dari URL? */
  function matchesFeedback(t, ids) {
    if (!t || !ids || !ids.length) return false;
    let v = t.variables;
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        v = null;
      }
    }
    const flat = JSON.stringify(v || {});
    return ids.some((id) => {
      if (flat.includes(`"feedbackID":"${id}"`)) return true;
      if (flat.includes(`"feedback_id":"${id}"`)) return true;
      if (flat.includes(`"id":"${id}"`)) return true;
      // Variabel template asli FB membawa id dalam bentuk base64 Relay
      const b64 = fbIdB64(id);
      if (b64 !== id) {
        if (flat.includes(`"feedbackID":"${b64}"`)) return true;
        if (flat.includes(`"feedback_id":"${b64}"`)) return true;
        if (flat.includes(`"id":"${b64}"`)) return true;
      }
      return false;
    });
  }

  /** Ordered candidates: URL-matched → shaped → last top-level → newest. */
  function orderedCandidates() {
    const nonReply = [...gqlTemplates.values()]
      .filter((t) => t.friendlyName && !/reply|depth1|replies/i.test(t.friendlyName))
      .sort((a, b) => b.capturedAt - a.capturedAt);
    if (!nonReply.length) return [];
    const ids = feedbackIdsFromUrl();
    const out = [];
    const push = (t) => {
      if (t && !out.includes(t)) out.push(t);
    };
    // 1) Template yang id feedback-nya cocok dengan URL (anti salah post —
    //    setara mediaId filter IG v1.0.15)
    if (ids.length) {
      for (const t of nonReply) {
        if (isPaginationLike(t) && matchesFeedback(t, ids)) push(t);
      }
    }
    // 2) Template pagination-like terbaru
    for (const t of nonReply) if (isPaginationLike(t)) push(t);
    // 3) Top-level terakhir yang ter-capture
    if (lastTopLevelKey && gqlTemplates.has(lastTopLevelKey)) {
      push(gqlTemplates.get(lastTopLevelKey));
    }
    // 4) Sisanya (fallback)
    for (const t of nonReply) push(t);
    return out;
  }

  /** Id feedback pertama dari URL permalink (via blok FBURLS). */
  function feedbackIdFromUrl() {
    return extractFbFeedbackId(String(location.href));
  }

  /** Semua kandidat id feedback dari URL, urut prioritas (via blok FBURLS). */
  function feedbackIdsFromUrl() {
    return extractFbFeedbackIds(String(location.href));
  }

  /**
   * Build the comments pagination query directly from candidate feedback ids
   * in the URL (like standalone scrapers do), so the user does not have to
   * open/scroll the comment list first. Urutan kandidat = prioritas probe;
   * probe memvalidasi id mana yang benar menghasilkan page_info.
   */
  /**
   * doc_id untuk CometUFICommentsProviderPaginationQuery. Prioritas: template
   * tersimpan (localStorage) → daftar fallback dari scraper publik (terbaru
   * dulu). Probe memvalidasi tiap kandidat, jadi doc_id basi hanya membuat
   * kandidat itu dilewati — tidak memutus run.
   */
  const PAGINATION_DOC_IDS = [
    "25399415259725176", // 2026 — crawler FB aktif
    "5676025945801633", // 2025 — FacebookMasterTool
    "4712008195539492", // 2024 — Crawl_Facebook_Data_Toolbox
  ];

  function buildSyntheticPaginationTemplates() {
    const ids = feedbackIdsFromUrl();
    if (!ids.length) return [];
    const stored = bestStoredPaginationTemplate();
    const docIds = [];
    if (stored && stored.doc_id) docIds.push(stored.doc_id);
    for (const d of PAGINATION_DOC_IDS) {
      if (!docIds.includes(d)) docIds.push(d);
    }
    const base = {
      url: "https://www.facebook.com/api/graphql/",
      friendlyName: "CometUFICommentsProviderPaginationQuery",
      capturedAt: Date.now(),
    };
    // Urutan kandidat (L1.2-AUDIT): INTERLEAVE peringkat doc+id — pasangan
    // dengan total peringkat terkecil diprobe lebih dulu (doc terbaik × tiap
    // id, lalu doc cadangan × id utama…). Urutan lama membiarkan doc pertama
    // menghabiskan seluruh slot sehingga doc fallback pada id utama tak pernah
    // terjangkau di URL multi-id (album/korsel).
    const cands = [];
    docIds.forEach((docId, di) => {
      ids.slice(0, 3).forEach((id, ii) => {
        cands.push({ docId, id, rank: di + ii, di, ii });
      });
    });
    // Tie-break: peringkat sama → utamakan ID UTAMA (ii terkecil) agar doc
    // fallback selalu menjangkau id story utama lebih dulu.
    cands.sort((a, b) => a.rank - b.rank || a.ii - b.ii || a.di - b.di);
    return cands.slice(0, 5).map(({ docId, id }) => {
      // Feedback id Relay wajib base64 "feedback:<id>" — id mentah ditolak
      // (dikonfirmasi 3 scraper independen 2024–2026).
      const feedbackID = fbIdB64(id);
      return {
        ...base,
        params: { doc_id: docId },
        variables: {
          after: null,
          before: null,
          count: 20,
          first: 20,
          feedbackID,
          id: feedbackID,
          focusCommentID: null,
          includeNestedComments: true,
          isInitialFetch: true,
          isPaginating: true,
          last: null,
          scale: 1,
          useDefaultActor: false,
          feedLocation: "NEWSFEED",
          feedbackSource: 1,
          // Paksa mode "Semua Komentar" (kronologis, tanpa filter "paling
          // relevan") — tanpa ini FB default ke RANKED_THREADED yang hanya
          // mengembalikan sebagian komentar dan pagination berhenti dini.
          commentsIntentToken: "RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1",
          topLevelViewOption: "RANKED_UNFILTERED",
          sortKey: "RANKED_UNFILTERED",
          __relay_internal__pv__IsWorkUserrelayprovider: false,
        },
      };
    });
  }

  /**
   * Paksa mode "Semua Komentar" pada template replay: clone variabel dengan
   * `sortKey: "RANKED_UNFILTERED"` (kronologis, unfiltered). Mengembalikan
   * template asli bila sudah ber-mode itu atau variabel tak bisa dikloning
   * (probe memvalidasi varian ini dulu, lalu jatuh ke varian asli).
   */
  function forceAllComments(t) {
    if (!t || !t.variables || typeof t.variables !== "object") return t;
    if (t.variables.sortKey === "RANKED_UNFILTERED") return t;
    try {
      const variables = JSON.parse(JSON.stringify(t.variables));
      variables.sortKey = "RANKED_UNFILTERED";
      return { ...t, variables };
    } catch {
      return t;
    }
  }

  /**
   * Varian feedLocation — sebagian struktur permalink (foto tunggal & album/
   * multi-foto) menolak `feedLocation: "NEWSFEED"` dengan edges kosong walau
   * feedback id-nya benar; halaman permalink itu sendiri dilaporkan FB sebagai
   * lokasi "PERMALINK". Diprobe sebagai fallback TERAKHIR per kandidat
   * (probe memvalidasi; varian gagal hanya membuang satu request).
   */
  function forceFeedLocation(t, loc) {
    if (!t || !t.variables || typeof t.variables !== "object") return t;
    if (t.variables.feedLocation === loc) return t;
    try {
      const variables = JSON.parse(JSON.stringify(t.variables));
      variables.feedLocation = loc;
      return { ...t, variables };
    } catch {
      return t;
    }
  }

  /** Kunci anti kontaminasi: aktifkan feedback id dari variabel template. */
  function lockFeedbackId(t) {
    if (t && t.variables) {
      activeFeedbackId =
        normalizeFeedbackId(feedbackIdFromTemplateVars(t.variables)) || null;
    } else {
      activeFeedbackId = null;
    }
  }

  async function paginateGraphql(maxMs) {
    const candidates = orderedCandidates();
    if (!candidates.length) return { mode: "none", reason: "no_template" };
    const deadline = Date.now() + maxMs;

    // Verify which candidate actually paginates (probe page 1 once).
    // Tiap kandidat di-probe dengan varian "Semua Komentar" (sortKey
    // RANKED_UNFILTERED) dulu — jadi hasil tidak bergantung pada pilihan
    // sortir yang tampil di halaman — lalu jatuh ke varian asli (mode user)
    // bila FB menolak varian paksa.
    let template = null;
    let selectedCand = null;
    let lastProbeErr = null;
    // S4: dua kegagalan probe beruntun berbau token basi — bust cache DTSG/LSD
    // agar varian berikutnya mengambil token segar.
    let probeErrStreak = 0;
    for (const cand of candidates.slice(0, 3)) {
      if (stopFlag) return { mode: "graphql", reason: "stopped" };
      // Urutan varian per kandidat (masing-masing divalidasi probe):
      // 1) "Semua Komentar" + feedLocation asli (umumnya NEWSFEED)
      // 2) template apa adanya (mode user)
      // 3) "Semua Komentar" + feedLocation PERMALINK — fallback khusus
      //    struktur foto tunggal/album/multi-foto yang menolak NEWSFEED.
      const allCommentsVariant = forceAllComments(cand);
      const variants = [
        allCommentsVariant,
        cand,
        forceFeedLocation(allCommentsVariant, "PERMALINK"),
      ].filter((v, i, arr) => v && arr.indexOf(v) === i);
      for (const variant of variants) {
        if (stopFlag) return { mode: "graphql", reason: "stopped" };
        try {
          const probe = await graphqlReplayWithBackoff(variant, null, deadline);
          if (probe.page && probe.page.hasNext !== undefined) {
            template = variant;
            selectedCand = cand;
            break;
          }
        } catch (err) {
          lastProbeErr = err;
          // Rate limit saat probe = jangan lanjut hammer; berhenti aman
          if (err && err.kind === "rate_limit") {
            return {
              mode: "graphql",
              reason: "rate_limit",
              error: String(err.message || err),
            };
          }
          if (err && err.kind === "no_login") {
            return {
              mode: "graphql",
              reason: "no_login",
              error: String(err.message || err),
            };
          }
          // S4: graphql_error/http beruntun → curigai token basi.
          if (err && (err.kind === "graphql_error" || err.kind === "http")) {
            probeErrStreak++;
            // L1.1-AUDIT: catat gagal probe per doc_id (diagnosa doc mati).
            const docKey =
              String((cand && cand.params && cand.params.doc_id) || "?");
            trackProbeStat(docKey);
            if (probeErrStreak >= 2) {
              bustTokenCache();
              probeErrStreak = 0;
            }
          }
          /* coba varian berikutnya */
        }
      }
      if (template) break;
    }
    if (!template) {
      // Probe gagal semua — jangan paksa pagination yang pasti error
      if (lastProbeErr) {
        return {
          mode: "graphql",
          reason: nameMap.size ? "timeout" : "error",
          error: String(lastProbeErr.message || lastProbeErr),
        };
      }
      template = candidates[0];
    }

    // Kunci target: nama dari respons GraphQL halaman hanya diproses untuk
    // feedback id ini (anti kontaminasi postingan lain di feed). Normalisasi
    // bentuk base64 Relay → mentah agar cocok dengan id URL. Fallback ke `id`
    // (template bentuk lama) — tanpa itu, di halaman feed (URL tanpa id)
    // isTargetCommentResponse menolak SEMUA respons ber-feedbackID dan nama
    // dari request FB asli terbuang (replay engine tetap jalan, harvest
    // always-on hilang).
    lockFeedbackId(template);

    // L2.1-AUDIT: kandidat cadangan untuk rotasi saat cursor tidak efektif
    // (shift() dari daftar = tidak akan dipilih dua kali).
    const spareCandidates = candidates.filter((t) => t !== selectedCand);
    let rotations = 0;
    const ROTATE_MAX = 2;

    engineMode = "graphql";
    post("PROGRESS", {
      names: snapshot(),
      message: `Mode GraphQL (pagination aktif)… ${template.friendlyName}`,
      postHint: template.friendlyName,
    });

    const start = Date.now();
    // Selalu mulai dari halaman pertama (cursor null) agar run ini mengambil
    // dari awal secara lengkap — abaikan cursor tersimpan di variabel template.
    let cursor = null;

    let pages = 0;
    let idle = 0;
    let reason = "complete";
    let totalEstimate = 0; // S1: estimasi jumlah komentar (maks antar halaman)
    const replyQueue = [];

    let emptyPages = 0;
    let gqlErrStreak = 0;
    // S2 (kejujuran hasil): apakah FB pernah menyatakan has_next_page:false?
    // Bila tidak dan loop keluar via guard, run dilaporkan "incomplete"
    // (partial) — bukan "complete" yang berkesan tuntas.
    let sawExplicitEnd = false;
    while (running && !stopFlag && Date.now() - start < maxMs) {
      if (requestBudget >= REQUEST_BUDGET) {
        reason = "timeout";
        break;
      }
      const before = nameMap.size;
      let result;
      try {
        result = await graphqlReplayWithBackoff(template, cursor, deadline);
        gqlErrStreak = 0;
      } catch (err) {
        const kind = err && err.kind;
        if (kind === "rate_limit")
          return {
            mode: "graphql",
            reason: "rate_limit",
            error: String(err.message || err),
          };
        if (kind === "no_login")
          return {
            mode: "graphql",
            reason: "no_login",
            error: String(err.message || err),
          };
        if (kind === "stopped") return { mode: "graphql", reason: "stopped" };
        // S4: satu graphql_error transien (mis. DTSG dirotasi FB saat run)
        // → bust cache token lalu coba cursor yang sama SEKALI sebelum menyerah.
        if (kind === "graphql_error" && gqlErrStreak === 0) {
          gqlErrStreak++;
          bustTokenCache();
          if (!(await sleepWhile(800))) {
            reason = "stopped";
            break;
          }
          continue;
        }
        return {
          mode: "graphql",
          reason: nameMap.size ? "timeout" : "error",
          error: String(err?.message || err),
        };
      }

      pages++;
      // Fase B: heartbeat DOM tiap 2 halaman — harvest + auto-expand "Lihat komentar lain" (keluhan harus scroll manual). reel → rootOrDocument (complementary)
      // Guard: di harness isolasi (tanpa document/window) helper DOM di-skip supaya tak crash.
      // V1.0.85: TANPA scroll container di sini — replay GraphQL tidak butuh
      // scroll (nama datang dari respons, bukan visibilitas); scroll list yang
      // kasat mata hanya mengecoh & menggeser posisi user. Klik expand saja;
      // scroll container (bila satu-satunya cara) ditangani fase expandDomLoop
      // dengan guard + restore posisi.
      if (pages % 2 === 0 && typeof document !== "undefined" && typeof window !== "undefined") {
        const r = rootOrDocument();
        try { scrapeDomNames(r); } catch {}
        try {
          const btns = findExpandButtons(r);
          // JANGAN scrollIntoView / window.scrollBy / scroll container: semua
          // menggeser halaman/list secara kasat mata → user kehilangan posisi.
          // Klik saja; FB tetap merespons klik walau tombol di luar viewport.
          for (const b of btns.slice(0, 4)) { try { b.click(); } catch {} }
        } catch {}
      }
      // Budget guard: never paginate forever on huge threads
      if (pages > 120) {
        reason = "timeout";
        break;
      }
      if (result.replyIds?.length) replyQueue.push(...result.replyIds);
      // S1: simpan estimasi terbesar yang pernah dilihat FB.
      if (result.totalCount > totalEstimate) totalEstimate = result.totalCount;

      // Catatan: hindari nested template literal di sini — extractor test
      // brace-aware tidak menangani backtick bersarang.
      const estSuffix = totalEstimate ? "/±" + totalEstimate : "";
      post("PROGRESS", {
        names: snapshot(),
        message:
          "GraphQL halaman " +
          pages +
          "… " +
          nameMap.size +
          estSuffix +
          " nama",
        postHint: template.friendlyName,
      });

      if (nameMap.size === before) idle++;
      else idle = 0;
      // Nama baru masih mengalir (≤2,5 dtk) — tahan hitungan idle agar tidak
      // berhenti prematur saat FB melayani halaman demi halaman (parity TT/IG).
      if (Date.now() - lastNewAt < 2500) idle = Math.max(0, idle - 1);

      // Halaman kosong / JSON gagal diparse — retry cursor sama 2× sebelum menyerah
      if (!result.page) {
        emptyPages++;
        if (emptyPages <= 2 && Date.now() - start < maxMs - 3000) {
          await sleepWhile(700 + Math.random() * 500);
          continue;
        }
        reason = "incomplete";
        break;
      }
      emptyPages = 0;

      const hasNext = result.page.hasNext;
      const endCursor = result.page.endCursor;

      if (hasNext === false) {
        sawExplicitEnd = true;
        reason = "complete";
        break;
      }
      if (hasNext === true && !endCursor) {
        // FB bilang masih ada, tapi tanpa cursor — tidak bisa lanjut
        reason = "incomplete";
        break;
      }
      // Guard idle: halaman tanpa nama baru BERULANG. 6x (bukan 4x) - window
      // hasil FB kadang tumpang-tindih (re-ranking "Semua Komentar") sehingga
      // halaman berisi nama lama padahal thread belum tuntas; beri toleransi
      // lebih sebelum menyerah di thread besar.
      if (idle >= 3 && rotations < ROTATE_MAX && spareCandidates.length) {
        // L2.1-AUDIT: 3 halaman tanpa nama baru = cursor/template kemungkinan
        // tidak efektif — rotasi ke kandidat cadangan (probe cepat), jangan
        // tunggu guard idle memutus seluruh fase GraphQL.
        const nextCand = spareCandidates.shift();
        let switched = false;
        try {
          const v = forceAllComments(nextCand);
          const p2 = await graphqlReplayWithBackoff(v, null, deadline);
          if (p2.page && p2.page.hasNext !== undefined) {
            template = v;
            lockFeedbackId(template);
            cursor = null;
            idle = 0;
            emptyPages = 0;
            rotations++;
            switched = true;
            post("PROGRESS", {
              names: snapshot(),
              message: "Beralih ke template pagination cadangan…",
              postHint: "rotate",
            });
          }
        } catch (err) {
          const kind = err && err.kind;
          if (kind === "rate_limit")
            return {
              mode: "graphql",
              reason: "rate_limit",
              error: String(err.message || err),
            };
          if (kind === "no_login")
            return {
              mode: "graphql",
              reason: "no_login",
              error: String(err.message || err),
            };
          const docKey = String(
            (nextCand && nextCand.params && nextCand.params.doc_id) || "?"
          );
          trackProbeStat(docKey);
          /* kandidat cadangan berikutnya */
        }
        if (switched) continue;
      }
      if (idle >= 6) {
        reason = "incomplete";
        break;
      }
      if (endCursor === cursor) {
        // Cursor berulang: pagination tak bisa maju. Bila FB belum pernah
        // menyatakan habis, ini truncation terselubung — laporkan jujur
        // sebagai incomplete, bukan "complete" berkesan tuntas.
        reason = sawExplicitEnd ? "complete" : "incomplete";
        break;
      }
      cursor = endCursor;
      if (!(await sleepWhile(500 + Math.random() * 700))) {
        reason = "stopped";
        break;
      }
    }

      if (stopFlag) reason = "stopped";
      else if (Date.now() - start >= maxMs) reason = "timeout";
      lastRunTotalCount = totalEstimate;

    // Optional replies via reply template
    if (
      includeReplies &&
      !stopFlag &&
      lastReplyKey &&
      gqlTemplates.has(lastReplyKey) &&
      replyQueue.length
    ) {
      const replyTpl = gqlTemplates.get(lastReplyKey);
      post("PROGRESS", {
        names: snapshot(),
        message: `Mengambil balasan… antrean ${replyQueue.length}`,
        postHint: "replies",
      });
      // Tanpa slice target: REPLY_BUDGET (per-request) sudah menjadi batas
      // tunggal — memotong daftar target hanya membuat pengulas-via-balasan
      // hilang di thread ramai padahal budget global masih longgar.
      const unique = [...new Set(replyQueue)];
      // Budget balasan naik (40 -> 100): jumlah komentar FB di UI ikut
      // menghitung balasan - dengan cap 25 target/40 request, pengulas lewat
      // balasan sering tidak terrekap pada thread ramai.
      const REPLY_BUDGET = 100;
      let replyRequests = 0;
      let replyFailStreak = 0;
      for (const fbId of unique) {
        if (stopFlag || Date.now() - start >= maxMs) break;
        if (replyRequests >= REPLY_BUDGET) break;
        try {
          // inject feedback id into variables if present
          const vars = replyTpl.variables
            ? JSON.parse(JSON.stringify(replyTpl.variables))
            : {};
          // Reply queries may name the feedback field differently per template
          // shape — set whichever key the captured variables actually use.
          if ("id" in vars) vars.id = fbId;
          else if ("feedbackID" in vars) vars.feedbackID = fbId;
          else if ("feedback_id" in vars) vars.feedback_id = fbId;
          else vars.id = fbId;
          const tpl = {
            ...replyTpl,
            variables: vars,
            params: { ...replyTpl.params },
          };
          let rCursor = null;
          for (let p = 0; p < 8 && !stopFlag; p++) {
            if (
              replyRequests >= REPLY_BUDGET ||
              requestBudget >= REQUEST_BUDGET ||
              Date.now() - start >= maxMs
            )
              break;
            const r = await graphqlReplayWithBackoff(
              { ...tpl, variables: setCursorOnVariables(vars, rCursor) },
              rCursor,
              deadline
            );
            replyRequests++;
            if (!r.page?.hasNext || !r.page?.endCursor) break;
            rCursor = r.page.endCursor;
            if (!(await sleepWhile(400 + Math.random() * 400))) break;
          }
          replyFailStreak = 0;
        } catch (err) {
          const kind = err && err.kind;
          // 429 / sesi kadaluarsa di balasan = hentikan seluruh run (jangan hammer)
          if (kind === "no_login")
            return {
              mode: "graphql",
              reason: "no_login",
              error: String(err.message || err),
            };
          if (kind === "rate_limit")
            return {
              mode: "graphql",
              reason: "rate_limit",
              error: String(err.message || err),
            };
          if (kind === "stopped") return { mode: "graphql", reason: "stopped" };
          replyFailStreak++;
          if (replyFailStreak >= 2) break;
        }
        post("PROGRESS", {
          names: snapshot(),
          message: `Balasan… ${nameMap.size} nama`,
          postHint: "replies",
        });
      }
    }

    return { mode: "graphql", reason, pages };
  }

  // ---------------- DOM fallback (kept as secondary) ----------------
  // ---------------- Scroll safety (v1.0.85: rekap tanpa menggeser viewport) ----------------
  // Utilitas agar operasi scroll engine: (1) TIDAK pernah menggeser kolom
  // halaman/feed (hanya container komentar dalam yang boleh di-scroll),
  // (2) menonaktifkan scroll-anchoring browser pada container yang kita
  // scroll programatik (anchoring melawan & membuat "halaman bergoyang" saat
  // konten di atas viewport berubah), dan (3) memulihkan posisi window +
  // container setelah run — KECUALI user scroll manual di tengah run.
  let userScrolledDuringRun = false;
  let scrollWatchersActive = false;
  /** Container yang sedang kita set overflow-anchor:none (dipulihkan akhir run). */
  let anchorDisabledEl = null;

  function onUserScrollGesture() {
    userScrolledDuringRun = true;
  }
  function onUserScrollKey(e) {
    if (
      e &&
      ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(e.key)
    ) {
      userScrolledDuringRun = true;
    }
  }
  /** Aktif/nonaktifkan pantauan scroll manual user (wheel/touch/keyboard). */
  function watchUserScroll(active) {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (active && !scrollWatchersActive) {
      userScrolledDuringRun = false;
      scrollWatchersActive = true;
      try {
        window.addEventListener("wheel", onUserScrollGesture, { passive: true });
        window.addEventListener("touchmove", onUserScrollGesture, { passive: true });
        window.addEventListener("keydown", onUserScrollKey, true);
      } catch { /* ignore */ }
    } else if (!active && scrollWatchersActive) {
      scrollWatchersActive = false;
      try {
        window.removeEventListener("wheel", onUserScrollGesture);
        window.removeEventListener("touchmove", onUserScrollGesture);
        window.removeEventListener("keydown", onUserScrollKey, true);
      } catch { /* ignore */ }
    }
  }

  /**
   * Apakah elemen adalah kolom halaman utama (scroll di sana = scroll halaman,
   * bukan scroll daftar komentar). Container seperti ini TIDAK boleh disentuh.
   */
  function isPageScroller(sc) {
    if (!sc) return false;
    try {
      if (
        sc === document.scrollingElement ||
        sc === document.documentElement ||
        sc === document.body
      )
        return true;
      const vh = window.innerHeight || 800;
      const vw = window.innerWidth || 1200;
      const r = sc.getBoundingClientRect();
      // Kolom utama: selebar ~viewport & menempel atas (feed/permalink/grup).
      if (r.width >= vw * 0.7 && r.height >= vh * 0.9 && Math.abs(r.top) <= 60)
        return true;
    } catch { /* ignore */ }
    return false;
  }

  /** Nearest ancestor yang BENAR-BENAR scrollable (overflow auto/scroll). */
  function nearestScrollable(el) {
    let n = el ? el.parentElement : null;
    while (n && n !== document.body && n !== document.documentElement) {
      try {
        const st = getComputedStyle(n);
        const oy = st.overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 8)
          return n;
      } catch { /* ignore */ }
      n = n.parentElement;
    }
    return null;
  }

  /**
   * Geser sc (nearest scrollable container) SEAGAK MINIMAL mungkin agar el
   * terlihat — tidak pernah menyentuh window/feed. Mengembalikan delta.
   */
  function scrollElIntoViewportMinimal(el, sc) {
    if (!el || !sc || typeof sc.scrollTop !== "number") return 0;
    try {
      const cTop = sc.getBoundingClientRect().top;
      const eTop = el.getBoundingClientRect().top;
      const eBot = el.getBoundingClientRect().bottom;
      const cBot = cTop + sc.clientHeight;
      let delta = 0;
      if (eTop < cTop + 60) delta = eTop - (cTop + 60);
      else if (eBot > cBot - 60) delta = eBot - (cBot - 60);
      if (delta !== 0) {
        disableScrollAnchor(sc);
        sc.scrollTop += delta;
      }
      return delta;
    } catch { /* ignore */ }
    return 0;
  }

  /** Nonaktifkan scroll-anchoring browser pada container yang kita scroll. */
  function disableScrollAnchor(sc) {
    if (!sc || sc === anchorDisabledEl) return;
    try {
      if (anchorDisabledEl) anchorDisabledEl.style.removeProperty("overflow-anchor");
    } catch { /* ignore */ }
    anchorDisabledEl = sc;
    try { sc.style.setProperty("overflow-anchor", "none"); } catch { /* ignore */ }
  }
  /** Pulihkan overflow-anchor container yang kita nonaktifkan (akhir run). */
  function restoreScrollAnchor() {
    if (!anchorDisabledEl) return;
    try { anchorDisabledEl.style.removeProperty("overflow-anchor"); } catch { /* ignore */ }
    anchorDisabledEl = null;
  }

  /**
   * Elemen di dalam subtree [aria-hidden=true] — di FB ini = konten di
   * belakang dialog/modal (post lain di feed). Jangan di-harvest/di-scroll
   * bila modal sedang terbuka (hindari kontaminasi nama post lain).
   */
  function isBehindModal(el) {
    try {
      let n = el;
      while (n) {
        const nt = n.nodeType;
        // Hanya elemen (nodeType 1) yang dicek; fixture test tanpa nodeType
        // tetap boleh berjalan (nodeType undefined disamakan elemen).
        if (nt !== 1 && nt !== undefined) break;
        if (n.getAttribute && n.getAttribute("aria-hidden") === "true") return true;
        n = n.parentElement;
      }
    } catch { /* ignore */ }
    return false;
  }

  /** Apakah ada dialog/modal FB yang sedang terbuka (konten belakang di-hidden). */
  function isModalOpen() {
    try {
      if (typeof document === "undefined" || typeof isVisible === "undefined") return false;
      return !!qsa('[role="dialog"], [aria-modal="true"]', document).some(
        (d) => isVisible(d)
      );
    } catch { /* ignore */ }
    return false;
  }

  function qsa(sel, root) {
    try {
      return [...(root || document).querySelectorAll(sel)];
    } catch {
      return [];
    }
  }

  function isVisible(el) {
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  }

  function isProfileHref(href) {
    if (!href || href === "#" || href.includes("javascript:")) return false;
    if (!/facebook\.com|^\//i.test(href)) return false;
    // Profil anggota grup: /groups/<gid>/user/<uid> — bentuk link penulis
    // komentar di post grup. Diizinkan SEBELUM pengecualian `/groups/`
    // (beranda/posting/foto grup BUKAN profil dan tetap ditolak). Struktur
    // `/user/<uid numeric>` adalah penanda profil pengguna, bukan halaman
    // grup — uid non-numerik (bukan profil sah) tidak lolos.
    if (/\/groups\/[^/?#]+\/user\/\d+/i.test(href)) return true;
    if (
      /\/(posts|photos|videos|reel|watch|stories|story\.php|permalink\.php|events|marketplace|gaming|ads|help|settings|privacy|policies|login|groups|pages)/i.test(
        href
      )
    )
      return false;
    if (href.includes("comment_id")) return false;
    return (
      /profile\.php\?id=\d+/i.test(href) ||
      /facebook\.com\/[A-Za-z0-9.\u00C0-\u024F_-]{2,}/i.test(href) ||
      /^\/[A-Za-z0-9.\u00C0-\u024F_-]{2,}(\/|\?|$)/i.test(href)
    );
  }

  function findPostRoot() {
    const marked = document.querySelector("[data-fnk-post-root='1']");
    if (marked) return marked;
    const candidates = [
      ...document.querySelectorAll(
        'div[role="article"], div[data-pagelet*="FeedUnit"], div[data-pagelet*="Permalink"], div[data-pagelet*="CometSinglePost"]'
      ),
    ];
    let best = null;
    let bestScore = -1;
    const vh = window.innerHeight || 800;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2;
      let score = 1000 - Math.abs(mid - vh / 2);
      const t = (el.innerText || "").slice(0, 300);
      if (/comment|komentar|most relevant|paling relevan/i.test(t)) score += 400;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return (
      best ||
      document.querySelector('[role="main"]') ||
      document.body ||
      document.documentElement
    );
  }

  function scrapeDomNames(root) {
    // Scope ke container komentar bila di-scope; kalau tanpa scope / document,
    // pakai postRoot atau document. Filter komentar berbasis aria-label yang
    // menentukan kelayakan, bukan scope (deteksi otomatis container rapuh).
    const scope = root || postRoot || document;
    const before = nameMap.size;
    const modalOpen =
      typeof isModalOpen === "function" &&
      typeof isBehindModal === "function" &&
      !!isModalOpen();

    // L4.1-AUDIT: EN + ID + ES/PT/FR (connector "de/da/di" untuk bentuk
    // "Comentario de X", "Resposta da X", dsb.)
    const labelPatterns = [
      /^(?:Comment|Reply|Komentar|Balasan|Comentario|Respuesta|Resposta|R\u00e9ponse)\s+(?:by|oleh|dari|from|de|da|di)?\s*(?:la\s+|o\s+|a\s+)?(.+)$/i,
      /^(.+?)\s+(?:commented|berkomentar|replied|membalas|coment\u00f3|comentou|r\u00e9pondu|a comment\u00e9|membalas)\b/i,
    ];
    qsa("[aria-label]", scope).forEach((el) => {
      if (modalOpen && isBehindModal(el)) return;
      const label = el.getAttribute("aria-label") || "";
      if (label.length < 3 || label.length > 160) return;
      for (const re of labelPatterns) {
        const m = label.match(re);
        if (m) {
          addName(m[1].split(/\s{2,}|\s+[·•]\s+/)[0]);
          return;
        }
      }
    });

    qsa('[role="article"]', scope).forEach((art) => {
      if (modalOpen && isBehindModal(art)) return;
      const ariaRaw = art.getAttribute("aria-label") || "";
      if (/^(post by|posting by|post oleh|status by|shared by)\b/i.test(ariaRaw.trim()))
        return;
      const aria = ariaRaw.toLowerCase();
      const looksComment =
        /comment|komentar|reply|balas/.test(aria) ||
        (art.querySelector('[role="button"]') &&
          /like|suka|reply|balas/i.test(art.innerText || ""));
      if (!looksComment && !aria) {
        const btns = [...art.querySelectorAll('[role="button"]')]
          .map((b) => (b.innerText || "").toLowerCase())
          .join(" ");
        if (!/(like|suka)/.test(btns) || !/(reply|balas)/.test(btns)) return;
      }
      // Fallback 1: nama dari aria-label "Komentar oleh X" — penting untuk
      // photo-viewer dialog di mana komentar [role=article] tidak selalu punya
      // <a> link profil di dalamnya.
      if (ariaRaw) {
        const m = ariaRaw.match(/^(?:comment|reply|komentar|balasan|comentario|respuesta|resposta|r\u00e9ponse)\s+(?:by|oleh|dari|from|de|da|di)\s+(?:la\s+|o\s+|a\s+)?(.{1,80})/i);
        if (m && m[1]) {
          addName(m[1].split(/\s{2,}|\s+[·•]\s+/)[0]);
        }
      }
      for (const a of art.querySelectorAll('a[role="link"], a[href]')) {
        const href = a.href || "";
        if (!isProfileHref(href)) continue;
        const text = (a.innerText || "").replace(/\s+/g, " ").trim();
        if (text && text.length < 80) {
          addName(text);
          break;
        }
      }
    });

    qsa('[role="button"]', scope).forEach((btn) => {
      if (modalOpen && isBehindModal(btn)) return;
      if (!isVisible(btn)) return;
      const t = `${btn.innerText || ""} ${btn.getAttribute("aria-label") || ""}`
        .trim()
        .toLowerCase();
      if (!/^(reply|balas)\b/i.test(t)) return;
      let row = btn.parentElement;
      for (let i = 0; i < 8 && row; i++) {
        if (row.getAttribute?.("role") === "article") break;
        if (row.querySelector("a[href]")) break;
        row = row.parentElement;
      }
      if (!row) return;
      if (/^(post by|post oleh)\b/i.test((row.getAttribute?.("aria-label") || "").trim()))
        return;
      for (const a of row.querySelectorAll("a[href]")) {
        if (!isProfileHref(a.href || "")) continue;
        const text = (a.innerText || "").replace(/\s+/g, " ").trim();
        if (text) {
          addName(text);
          break;
        }
      }
    });

    return nameMap.size - before;
  }

  function findExpandButtons(root) {
    // EN + ID + ES/PT/FR — FB melayani locale lain sesuai akun/region.
    // JANGAN sertakan "tampilkan"/"show" sendirian — terlalu generik dan
    // match "Tampilkan lebih sedikit" (false positive yang mengacaukan guard).
    const soft =
      /view more comments|see more comments|lihat komentar|previous comments|komentar sebelumnya|view more replies|lihat balasan|tampilkan balasan|show replies|more comments|more replies|lihat selengkapnya|see more|show more comments|all comments|semua komentar|ver m\u00e1s comentarios|m\u00e1s respuestas|ver mais coment\u00e1rios|ver mais respostas|afficher plus de commentaires|plus de r\u00e9ponses/i;
    const out = [];
    const modalOpen =
      typeof isModalOpen === "function" &&
      typeof isBehindModal === "function" &&
      !!isModalOpen();
    // Fix reel: tombol "Lihat komentar lain" di reel adalah <button> polos (tanpa role) — selector lama hanya role/span/a sehingga reel tak kebaca. Tambah button.
    qsa('[role="button"], button, div[tabindex="0"], span[dir="auto"], a[role="link"]', root || document).forEach((el) => {
      if (!isVisible(el)) return;
      if (modalOpen && isBehindModal(el)) return;
      const t = `${el.innerText || ""} ${el.getAttribute("aria-label") || ""}`
        .replace(/\s+/g, " ")
        .trim();
      if (t && t.length < 120 && soft.test(t)) out.push(el);
    });
    return out;
  }

  async function tryOpenComments(scope) {
    // Preserve original early-return untuk test harness (scope >1 article → true tanpa klik)
    if (scope && scope.querySelectorAll('[role="article"]').length > 1) {
      // Real browser: auto-expand hidden "Lihat komentar lain" tanpa user klik manual (hanya bila helper tersedia)
      try {
        if (typeof findExpandButtons === 'function' && typeof findScrollContainer === 'function') {
          const _root = scope || (typeof postRoot !== 'undefined' ? postRoot : null) || document;
          const _isStopped = () => { try { return typeof stopFlag !== 'undefined' && stopFlag; } catch { return false; } };
          for (let i = 0; i < 6 && !_isStopped(); i++) {
            let btns; try { btns = findExpandButtons(_root); } catch { break; }
            if (!btns.length) break;
            let clicked = false;
            for (const b of btns.slice(0, 3)) {
              // Tanpa scrollIntoView (menggeser feed → run reset); klik langsung.
              try { b.click(); clicked = true; await sleepWhile(400); } catch {}
            }
            if (!clicked) break;
            await sleepWhile(600);
            // (v1.0.85) Tanpa scroll container di sini — komentar sudah terbuka
            // & expand sudah diklik. Scroll daftar yang kasat mata hanya
            // menggeser posisi user; scroll container (bila satu-satunya cara
            // memuat batch lazy) ditangani expandDomLoop dengan guard + restore.
          }
        }
      } catch {}
      return true;
    }
    const COMMENT_COUNT = /^\d[\d.,\s]*(?:k|rb)?\s*(?:komentar|comments?|comentarios|coment\u00e1rios)\b/i;
    const VIEW_COMMENTS =
      /view.*(?:comment|komentar)|lihat.*komentar|lihat\s+semua\s+komentar|ver.*(comment|komentari)|voir.*commentaire|\bkomentari\b|\bcomment\b/i;
    const els = qsa(
      '[role="button"], button, a[role="link"], [role="tab"], [aria-label], span[dir="auto"]',
      scope || document
    );
    const modalOpen =
      typeof isModalOpen === "function" &&
      typeof isBehindModal === "function" &&
      !!isModalOpen();
    for (const el of els) {
      if (!isVisible(el)) continue;
      if (modalOpen && isBehindModal(el)) continue;
      const t = `${el.innerText || ""} ${el.getAttribute("aria-label") || ""}`
        .replace(/\s+/g, " ")
        .trim();
      if (!t || t.length > 120) continue;
      if (!COMMENT_COUNT.test(t) && !VIEW_COMMENTS.test(t)) continue;
      try {
        // V1.0.85: JANGAN scrollIntoView — ia menggeser SEMUA ancestor
        // scrollable (termasuk feed) → halaman pindah postingan lain & user
        // kehilangan posisi. Klik langsung; FB merespons klik walau tombol di
        // luar viewport (validasi v1.0.83). Bila klik pertama tak membuka apa
        // pun, fallback scroll MINIMAL hanya di nearest scrollable container
        // (bukan window/feed), lalu coba sekali lagi.
        el.click();
        await sleepWhile(700);
        let _hasGql = (() => { try { return typeof gqlTemplates !== 'undefined' && gqlTemplates.size > 0; } catch { return false; } })();
        let _hasArticles = (() => { try { return (scope || document).querySelectorAll('[role="article"]').length > 1; } catch { return false; } })();
        if (!_hasGql && !_hasArticles) {
          const _sc =
            typeof nearestScrollable === "function" ? nearestScrollable(el) : null;
          if (_sc && typeof scrollElIntoViewportMinimal === "function") {
            try {
              scrollElIntoViewportMinimal(el, _sc);
              el.click();
              await sleepWhile(700);
            } catch { /* ignore */ }
            _hasGql = (() => { try { return typeof gqlTemplates !== 'undefined' && gqlTemplates.size > 0; } catch { return false; } })();
            _hasArticles = (() => { try { return (scope || document).querySelectorAll('[role="article"]').length > 1; } catch { return false; } })();
          }
        }
        if (_hasGql || _hasArticles) return true;
        // Real browser auto-expand setelah terbuka (tanpa tunggu user) — guard helper
        try {
          if (typeof findExpandButtons === 'function') {
            const _root = scope || (typeof postRoot !== 'undefined' ? postRoot : null) || document;
            for (let k = 0; k < 3; k++) {
              let btns; try { btns = findExpandButtons(_root); } catch { break; }
              if (!btns.length) break;
              for (const b of btns.slice(0, 2)) { try { b.click(); await sleepWhile(300); } catch {} }
              const _isStopped = (() => { try { return typeof stopFlag !== 'undefined' && stopFlag; } catch { return false; } })();
              if (_isStopped) break;
            }
            const _hasExpand = (() => { try { return findExpandButtons(_root).length > 0; } catch { return false; } })();
            if (_hasExpand || _hasArticles) return true;
          }
        } catch {}
      } catch {
        /* ignore */
      }
    }
    return false;
  }

  /**
   * Paksa dropdown sortir komentar ke "Semua Komentar" (kronologis, unfiltered).
   *
   * Facebook default menyortir "Paling relevan" — yang HANYA menampilkan
   * sebagian komentar. Bila GraphQL capture gagal dan engine jatuh ke DOM
   * fallback, hasilnya hanya komentar relevan. Klik menu sortir lalu pilih
   * "Semua Komentar" supaya DOM fallback & capture melihat SEMUA komentar.
   *
   * Best-effort & idempotent: bila sudah "Semua Komentar" / menu tak ada,
   * tidak melakukan apa-apa.
   */
  /**
   * Tunggu menu dropdown [role="menu"] yang terlihat muncul.
   *
   * Facebook (Comet) me-render menu lewat PORTAL ke document.body — di luar
   * postRoot — jadi menu dicari di SELURUH dokumen, bukan di dalam post.
   * Poll sampai muncul (bukan sleep tetap) karena render menu async.
   */
  async function waitVisibleMenu(maxMs) {
    const end = Date.now() + maxMs;
    while (Date.now() < end) {
      const menu = qsa('[role="menu"]', document).find((m) => isVisible(m));
      if (menu) return menu;
      if (!(await sleepWhile(150))) return null;
    }
    return null;
  }

  async function setAllCommentsSort(scope) {
    const root = scope || postRoot || document;

    // 1) Cari tombol sortir: label "Paling relevan" / "Most relevant" / "Relevan".
    //    (Opsi aktif bisa juga "Terbaru"/"Newest" — tetap buka menunya supaya
    //    bisa pindah ke "Semua Komentar".) Fallback aria-label "sort/urutkan
    //    komentar" bila label teks berubah.
    // L4.2-AUDIT: + ES/PT/FR.
    const SORT_LABEL =
      /paling relevan|most relevant|^relevan$|^recent$|^terbaru$|^newest$|m\u00e1s relevantes|mais relevantes|mais recentes|pertinence|^r\u00e9cent/i;
    const SORT_ARIA_FALLBACK =
      /(?:sort|urutkan|urutan|ordenar|trier)\b[^]{0,40}(?:comment|komentar|comentari)|(?:comment|komentar|coment\u00e1rio)[^]{0,40}\b(?:sort|urutkan|urutan|ordenar|trier)/i;
    const ALL_COMMENTS =
      /^\s*(semua\s+komentar|all\s+comments|todos\s+los\s+comentarios|todos\s+os\s+coment\u00e1rios|tous\s+les\s+commentaires)\b/i;

    const isSortTrigger = (el) => {
      if (!isVisible(el)) return false;
      const t = `${el.innerText || ""} ${el.getAttribute("aria-label") || ""}`
        .replace(/\s+/g, " ")
        .trim();
      if (!t || t.length >= 60) return false;
      return SORT_LABEL.test(t) || SORT_ARIA_FALLBACK.test(t);
    };

    const triggerSel =
      '[role="button"], div[role="combobox"], [aria-haspopup="menu"], [aria-label]';
    let sortButton = qsa(triggerSel, root).find(isSortTrigger);
    // Beberapa bentuk render menaruh trigger sortir DI LUAR postRoot — coba
    // juga di seluruh dokumen sebelum menyerah.
    if (!sortButton) {
      sortButton = qsa(triggerSel, document).find(isSortTrigger);
    }
    if (!sortButton) return;

    // Sudah "Semua Komentar" → tidak perlu apa-apa (idempotent).
    const current =
      `${sortButton.innerText || ""} ${sortButton.getAttribute("aria-label") || ""}`;
    if (ALL_COMMENTS.test(current)) return;

    try {
      // JANGAN scrollIntoView di sini: pada dialog/permalink, scrollIntoView
      // menggeser ancestor (termasuk feed) → halaman pindah postingan →
      // onNavigation → run reset. Klik langsung; FB tetap membuka menu.
      sortButton.click();

      // 2) Menu muncul lewat PORTAL di document.body — tunggu sampai tampil.
      const menu = await waitVisibleMenu(1800);
      if (!menu) {
        try { document.body.click(); } catch { /* ignore */ }
        return;
      }

      // 3) Dari menu terbuka, pilih opsi "Semua Komentar" / "All comments".
      // Fix: menu item FB kini membawa deskripsi panjang ("Paling relevan Tampilkan komentar teman...") >60 char — filter <60 lama menghalangi klik, menu hanya muncul tanpa terpilih (laporan user 36 komentar → 11).
      for (const el of qsa('[role="menuitem"], [role="option"]', menu)) {
        if (!isVisible(el)) continue;
        const t = `${el.innerText || ""} ${el.getAttribute("aria-label") || ""}`
          .replace(/\s+/g, " ")
          .trim();
        if (t && t.length < 200 && ALL_COMMENTS.test(t)) {
          el.click();
          await sleepWhile(700);
          return;
        }
      }
      // Tidak ada opsi "Semua Komentar" → tutup menu (hindari mengganggu).
      try { document.body.click(); } catch { /* ignore */ }
      await sleepWhile(200);
    } catch {
      /* ignore */
    }
  }

  /** Scrollable comment container (so we scroll the list, not the whole page). */
  /**
   * Cari container komentar yang bisa di-scroll. Hanya elemen yang BENAR-BENAR
   * memuat `[role=article]` (komentar) yang boleh di-scroll — JANGAN pilih
   * container feed/profil (sh besar tapi berisi banyak postingan) karena
   * scroll di sana menggeser halaman ke postingan Berikutnya → memicu navigasi
   * dan reset rekap ("Halaman berubah"). Ini akar bug "posisi postingan
   * bergeser ke postingan kedua saat rekap jalan".
   */
  function findScrollContainer(root) {
    if (!root) return null;
    const els = [root, ...root.querySelectorAll("*")];
    let modalOpen = false;
    if (typeof isModalOpen === "function" && typeof isBehindModal === "function") {
      try { modalOpen = !!isModalOpen(); } catch { /* ignore */ }
    }
    let best = null;
    let bestArts = 0;
    for (let i = 0; i < els.length && i < 3000; i++) {
      const el = els[i];
      // Konten di belakang dialog/modal (post lain) jangan dipilih sebagai
      // scroller — scroll di sana bisa menggeser feed saat modal terbuka.
      if (modalOpen && isBehindModal(el)) continue;
      try {
        // Wajib memuat komentar [role=article] — feed wrapper tidak memuat
        // artikel komentar secara langsung, hanya banyak postingan.
        const arts = el.querySelectorAll('[role="article"]').length;
        if (arts > 0 && el.scrollHeight > el.clientHeight + 80) {
          const st = getComputedStyle(el);
          if (st.overflowY === "auto" || st.overflowY === "scroll") {
            // Pilih container TERDALAM yang masih memuat SEMUA komentar
            // (artikel terbanyak, tapi bila sama pilih yang scrollHeight lebih
            // KECIL = lebih dalam/lebih spesifik). Memilih yang scrollHeight
            // terbesar cenderung mengambil wrapper luar yang juga memuat feed →
            // scroll di sana menggeser halaman ke postingan lain.
            if (
              arts > bestArts ||
              (arts === bestArts && best && el.scrollHeight < best.scrollHeight)
            ) {
              bestArts = arts;
              best = el;
            }
          }
        }
      } catch { /* ignore */ }
    }
    return best;
  }

  async function expandDomLoop(maxMs) {
    const start = Date.now();
    const savedScrollY = window.scrollY;
    // Fix reel: komentar reel & photo album ada di container komentar (tanpa
    // scoping ke postRoot yang isinya salah). Scrape tetap filter komentar via
    // aria-label; scroller dicari di document agar container virtualized terjaring.
    const root = document;
    const scroller = findScrollContainer(document);
    // V1.0.85: simpan posisi container komentar (bukan hanya window) agar bisa
    // dipulihkan setelah loop; dan JANGAN sentuh container yang merupakan
    // kolom halaman (scroll di sana = geser viewport user ke postingan lain).
    const savedScrollerTop =
      scroller && typeof scroller.scrollTop === "number" ? scroller.scrollTop : 0;
    const scrollerIsPage = isPageScroller(scroller);
    if (scroller && !scrollerIsPage) disableScrollAnchor(scroller);
    logEvent("dom", "expandDomLoop mulai", {
      scroller: scroller ? `sh${scroller.scrollHeight}/ch${scroller.clientHeight}` : "none",
      arts: scroller ? scroller.querySelectorAll('[role="article"]').length : 0,
      page: scrollerIsPage ? "kolom-halaman" : "no",
      names: nameMap.size,
    });
    let idle = 0;
    let rounds = 0;
    while (running && !stopFlag && Date.now() - start < maxMs) {
      rounds++;
      const before = nameMap.size;
      scrapeDomNames(root);
      drainGqlBuffer();
      const btns = findExpandButtons(root);
      if (btns.length) {
        logEvent("expand", `klik ${Math.min(btns.length, 6)} tombol expand`, {
          found: btns.length,
          text: (btns[0].innerText || "").trim().slice(0, 40),
        });
      }
      for (const b of btns.slice(0, 6)) {
        try {
          // TANPA scrollIntoView — itu menggeser feed/ancestor → run reset.
          b.click();
        } catch {
          /* ignore */
        }
        await sleepWhile(400);
      }
      // Scroll HANYA bila masih ada tombol "Lihat komentar lain" (masih ada
      // batch tersembunyi). Di dialog SinglePost/album yang SEMUA komentar sudah
      // dirender TANPA tombol expand, scroll justru menggeser dialog FB dan
      // memicu onNavigation → run reset. Ini akar bug "scroll aneh & status
      // postingan berubah".
      const hasExpandBtn = findExpandButtons(root).length > 0;
      try {
        if (scroller && !scrollerIsPage && hasExpandBtn) {
          // Scroll SEKALI ke bawah (scrollTop = scrollHeight) — bukan loop
          // `+=800` yang memantul (container FB me-reset ke atas) dan idle
          // tanpa hasil. Setelah mentok bawah, set flag agar tidak scroll lagi.
          const beforeTop = scroller.scrollTop;
          if (!scroller.__reso_scrolledOnce) {
            scroller.__reso_scrolledOnce = true;
            scroller.scrollTop = scroller.scrollHeight;
            logEvent("scroll", "scroll pertama ke bawah", {
              from: beforeTop,
              to: scroller.scrollTop,
              sh: scroller.scrollHeight,
              ch: scroller.clientHeight,
            });
          }
          const atBottom =
            scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 40;
          if (!atBottom) {
            scroller.scrollTop = scroller.scrollHeight;
            logEvent("scroll", "scroll lanjut (belum di bawah)", {
              from: beforeTop,
              to: scroller.scrollTop,
              sh: scroller.scrollHeight,
            });
          }
        } else if (!scroller) {
          if (rounds === 1) logEvent("scroll", "TIDAK scroll: container komentar tidak ditemukan");
        } else if (scrollerIsPage) {
          if (rounds === 1) logEvent("scroll", "TIDAK scroll: container = kolom halaman (hindari geser viewport)");
        } else if (!hasExpandBtn) {
          if (rounds === 1) logEvent("scroll", "TIDAK scroll: tidak ada tombol expand (semua komentar sudah dimuat)");
        }
      } catch (e) {
        logEvent("scroll", "error scroll", { err: String(e?.message || e).slice(0, 60) });
      }
      post("PROGRESS", {
        names: snapshot(),
        message: `Fallback DOM… ${nameMap.size} nama (putaran ${rounds})`,
        postHint: "dom",
      });
      if (nameMap.size === before) idle++;
      else idle = 0;
      if (nameMap.size !== before) {
        logEvent("dom", `nama bertambah`, { from: before, to: nameMap.size, round: rounds });
      }
      if (nameMap.size === 0 && idle >= 18) {
        logEvent("dom", "break: 18 putaran tanpa nama sama sekali", { rounds });
        break;
      }
      if (nameMap.size > 0 && idle >= 12) {
        // Setelah scroll ke bawah (scrolledOnce) dan sudah lama tidak ada nama
        // baru → batch sudah habis ter-load. Jangan break dini sebelum scroll
        // sekali (reel masih perlu scroll bera tahap untuk ter-load batch lazy).
        const alreadyScrolled = (() => {
          try { return !!scroller?.__reso_scrolledOnce; } catch { return true; }
        })();
        if (alreadyScrolled) {
          logEvent("dom", "break: idle 12 & sudah scroll", { names: nameMap.size, rounds });
          break;
        }
        const atBottom = (() => {
          try {
            if (!scroller) return true;
            return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 20;
          } catch { return true; }
        })();
        const remaining = findExpandButtons(document);
        if (atBottom && remaining.length === 0) {
          logEvent("dom", "break: di bawah & tanpa tombol expand", { names: nameMap.size, rounds });
          break;
        }
        // Tidak akan pernah scroll (tanpa tombol expand) tapi juga tidak
        // atBottom → loop akan berputar sia-sia sampai budget habis.
        // Berhenti: DOM sudah tidak menghasilkan nama baru 12 putaran.
        if (!scroller || remaining.length === 0) {
          logEvent("dom", "break: idle 12 & tak ada jalur expand/scroll lagi", {
            names: nameMap.size,
            rounds,
            scroller: scroller ? "ada" : "none",
          });
          break;
        }
      }
      if (!(await sleepWhile(500))) break;
    }
    // Restore posisi window + container komentar — KECUALI user scroll manual
    // di tengah run (hormati posisi mereka, jangan snap paksa).
    if (!userScrolledDuringRun) {
      try { window.scrollTo(0, savedScrollY); } catch { /* ignore */ }
      try {
        if (scroller && !scrollerIsPage && typeof scroller.scrollTop === "number") {
          scroller.scrollTop = savedScrollerTop;
        }
      } catch { /* ignore */ }
    } else {
      logEvent("scroll", "TIDAK restore expandDomLoop: user scroll manual selama run");
    }
    restoreScrollAnchor();
    logEvent("dom", "expandDomLoop selesai", { names: nameMap.size, rounds, ms: Date.now() - start });
    return nameMap.size ? "complete" : "idle";
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Sleep interruptible — resolve false kalau Stop ditekan (cek tiap 200 ms). */
  async function sleepWhile(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (stopFlag) return false;
      await sleep(Math.min(200, Math.max(20, end - Date.now())));
    }
    return true;
  }

  // ---------------- main run ----------------
  /**
   * S6 (murni, teruji): keputusan budget pass DOM. Thread dengan < 25 nama
   * layak usaha lebih keras (45 dtk — kemungkinan GraphQL hanya dapat
   * sebagian); selebihnya cukup pass rapat 12 dtk. Selalu dibatasi sisa waktu.
   */
  function chooseDomBudget(size, remainingMs) {
    const rem = Math.max(0, Number(remainingMs) || 0);
    return size < 25 ? Math.min(45_000, rem) : Math.min(12_000, rem);
  }

  /**
   * O-AUDIT (murni, teruji): vonis GraphQL yang tidak boleh ditimpa fase DOM.
   * incomplete/timeout/rate_limit/no_login/stopped = informasi keterisian yang
   * lebih jujur daripada "complete" optimistik milik expandDomLoop.
   */
  const VERDICT_PRESERVED = new Set([
    "incomplete",
    "timeout",
    "rate_limit",
    "no_login",
    "stopped",
  ]);

  async function runExtract(options = {}) {    const myRunId = options.runId || String(Date.now());

    if (running) {
      stopFlag = true;
      const t0 = Date.now();
      while (running && Date.now() - t0 < 4000) await sleep(80);
      running = false;
      stopFlag = false;
    }

    running = true;
    stopFlag = false;
    nameMap.clear();
    // Reset diagnosa per-run.
    probeStats.clear();
    lastRunTotalCount = 0;
    currentRunId = myRunId;
    includeReplies = options.includeReplies !== false;
    engineMode = "hybrid";
    options._startedAt = Date.now();
    logEvent("run", "RUN START", {
      url: location.pathname.slice(0, 60),
      replies: includeReplies,
      ids: feedbackIdsFromUrl().slice(0, 2).join(","),
      arts: document.querySelectorAll('[role="article"]').length,
    });
    postRoot = findPostRoot();
    if (postRoot) {
      try {
        postRoot.setAttribute("data-fnk-active", "1");
      } catch {
        /* ignore */
      }
    }
    lastNewAt = Date.now();
    activeFeedbackId = null;
    // S3: pre-seed hasil run sebelumnya pada post yang sama — "Proses lagi"
    // menjadi AKUMULATIF, bukan mulai dari nol (re-run setelah partial).
    let seededCount = 0;
    try {
      const prior = loadPriorNames(feedbackIdsFromUrl());
      if (prior?.length) {
        for (const n of prior) if (addName(n)) seededCount++;
      }
    } catch {
      /* ignore */
    }
    // Simpan posisi scroll agar di akhir run halaman kembali ke postingan
    // yang sama (bukan melayang ke postingan di atas/bawahnya).
    const savedScrollY = window.scrollY;
    // V1.0.85: pantau scroll manual user selama run. Bila user sengaja pindah
    // posisi di tengah run, restore di akhir DIBATALKAN (hormati user) —
    // jangan snap paksa kembali ke posisi awal.
    watchUserScroll(true);

    post("PROGRESS", {
      names: snapshot(),
      message: seededCount
        ? `Melanjutkan ${seededCount} nama dari run sebelumnya…`
        : "Memulai mesin GraphQL (pagination aktif)… buka komentar bila perlu",
      postHint: `templates:${gqlTemplates.size} buffer:${gqlBuffer.length}`,
    });

    try {
      // 1) Ensure comments are loading so we capture GraphQL templates
      const openOk = await tryOpenComments(postRoot);
      logEvent("open", "tryOpenComments", {
        ok: openOk,
        arts: document.querySelectorAll('[role="article"]').length,
      });
      // 1a) Paksa "Semua Komentar" (bukan "Paling relevan") supaya DOM fallback
      //     & capture melihat SEMUA komentar — tanpa perlu user mengganti
      //     dropdown sortir secara manual. Beri waktu section komentar
      //     ter-render dulu (tombol sortir baru muncul setelah komentar terbuka).
      await sleepWhile(600);
      await setAllCommentsSort(rootOrDocument());
      logEvent("sort", "setAllCommentsSort dijalankan");
      await sleepWhile(800);
      drainGqlBuffer();
      scrapeDomNames(rootOrDocument());
      logEvent("scrape", "scrape awal", { names: nameMap.size });

      // 1b) Synthetic template langsung dari feedback id di URL (permalink).
      //     Selalu ditambahkan saat URL memberi id — bukan hanya saat tidak ada
      //     capture: di halaman permalink yang tepat, synthetic (id dari URL)
      //     memenangkan urutan candidate via filter feedbackId di
      //     orderedCandidates (anti salah post, setara mediaId filter IG).
      //     Sekaligus membuat halaman album/watch/slug-posts langsung bisa
      //     paginate GraphQL tanpa perlu komentar ter-capture dulu.
      if (!stopFlag && feedbackIdsFromUrl().length) {
        const syns = buildSyntheticPaginationTemplates();
        syns.forEach((syn, i) => {
          gqlTemplates.set(
            syns.length > 1 ? `__synthetic__${i}` : "__synthetic__",
            syn
          );
        });
        if (syns.length) {
          lastTopLevelKey =
            syns.length > 1 ? "__synthetic__0" : "__synthetic__";
        }
      }

      // 2) If no template yet, scroll/expand a bit to trigger FB requests
      if (gqlTemplates.size === 0) {
        post("PROGRESS", {
          names: snapshot(),
          message: "Menunggu request GraphQL komentar dari Facebook…",
          postHint: "capture",
        });
        for (let i = 0; i < 12 && !stopFlag && gqlTemplates.size === 0; i++) {
          for (const b of findExpandButtons(rootOrDocument()).slice(0, 3)) {
            try {
              b.click();
            } catch {
              /* ignore */
            }
          }
          scrapeDomNames(rootOrDocument());
          drainGqlBuffer();
          await sleepWhile(700);
          post("PROGRESS", {
            names: snapshot(),
            message: `Menunggu GraphQL… template=${gqlTemplates.size}, nama=${nameMap.size}`,
            postHint: "capture",
          });
        }
      }

      const maxMs = options.maxMs || 150_000;
      const startedAt = options._startedAt || Date.now();
      let finalReason = "idle";

      // Reserve time for DOM harvest so GraphQL cannot consume the entire budget
      const reserveDomMs = 12_000;
      const gqlBudget = Math.max(20_000, maxMs - reserveDomMs);

      // 3) Primary: GraphQL pagination (synthetic dari URL + template capture)
      if (gqlTemplates.size > 0 && !stopFlag) {
        logEvent("gql", "mulai paginateGraphql", { tpl: gqlTemplates.size, budget: gqlBudget });
        const g = await paginateGraphql(gqlBudget);
        finalReason = g.reason || "complete";
        engineMode = g.mode === "graphql" ? "graphql" : engineMode;
        logEvent("gql", "paginateGraphql selesai", {
          reason: finalReason,
          mode: g.mode,
          names: nameMap.size,
          err: g.error ? String(g.error).slice(0, 50) : undefined,
        });
        if (g.error) {
          post("PROGRESS", {
            names: snapshot(),
            message: `GraphQL error: ${g.error} — fallback DOM`,
            postHint: "error",
          });
        }
      } else if (!stopFlag) {
        logEvent("gql", "SKIP paginateGraphql (tanpa template)", { tpl: gqlTemplates.size });
      }

      // 4) Secondary: always brief DOM harvest; deeper when GraphQL yielded
      // few names — thread dengan puluhan/ratusan pengulas butuh pass DOM
      // lebih panjang bila GraphQL hanya memperoleh sebagian (mis. probe
      // gagal → mode capture/DOM murni).
      if (!stopFlag) {
        const remaining = Math.max(0, maxMs - (Date.now() - startedAt));
        const domBudget = chooseDomBudget(nameMap.size, remaining);
        if (domBudget >= 1500) {
          engineMode =
            gqlTemplates.size > 0 && nameMap.size > 0
              ? "hybrid"
              : nameMap.size
                ? "hybrid"
                : "dom";
          post("PROGRESS", {
            names: snapshot(),
            message: `Melengkapi lewat DOM… (${nameMap.size} nama)`,
            postHint: "dom",
          });
          const domReason = await expandDomLoop(domBudget);
          // O-AUDIT: vonis GraphQL yang jujur (belum tuntas / dibatasi /
          // diblokir) TIDAK BOLEH ditimpa oleh hasil optimistik fase DOM
          // ("complete" = pass DOM selesai, bukan thread habis).
          if (
            nameMap.size > 0 &&
            !VERDICT_PRESERVED.has(finalReason)
          ) {
            finalReason = domReason;
          }
        }
      }

      // 5) Final harvest — rootOrDocument (reel: komentar di complementary; anti kontaminasi tetap terjaga via scope yang memuat komentar)
      drainGqlBuffer();
      scrapeDomNames(rootOrDocument());

      if (stopFlag) finalReason = "stopped";
      if (nameMap.size > 0 && finalReason === "idle") finalReason = "complete";
      if (nameMap.size === 0 && finalReason === "complete") finalReason = "idle";

      if (currentRunId === myRunId) {
        const names = snapshot();
        let tip = "";
        // S1: bila estimasi FB jauh di atas hasil (≥2x), beri konteks —
        // total_count menghitung komentar (incl. balasan); nama unik kita
        // memang lebih kecil secara alami, jadi ini info, bukan alarm.
        if (
          lastRunTotalCount &&
          names.length &&
          names.length * 2 < lastRunTotalCount
        ) {
          tip = ` Post ±${lastRunTotalCount} komentar menurut Facebook (${names.length} nama unik terkumpul).`;
        }
        if (finalReason === "rate_limit") {
          tip += " Rate limit (429) — berhenti agar akun aman. Tunggu beberapa saat, lalu Proses lagi.";
        } else if (finalReason === "no_login") {
          tip += " Sesi Facebook tidak aktif — login di facebook.com lalu Proses lagi.";
        } else if (!names.length) {
          tip =
            " Tip: buka permalink post, buka list komentar sampai terlihat, tunggu 2–3 dtk, lalu Proses lagi (biar GraphQL ter-capture).";
        }
        // S3: simpan hasil untuk pre-seed run berikutnya pada post yang sama.
        try {
          persistNames(
            activeFeedbackId || feedbackIdFromUrl(),
            names
          );
        } catch {
          /* ignore */
        }
        // S7: diagnosa lapangan — set localStorage "rsx_debug"="1" utk aktif.
        if (DEBUG) {
          console.info("[ReSo FB] done", {
            mode: engineMode,
            reason: finalReason,
            captured: names.length,
            totalEstimate: lastRunTotalCount,
            templates: gqlTemplates.size,
            probeFails: [...probeStats.entries()],
          });
        }
        post("DONE", {
          names,
          stopReason: finalReason,
          postHint: `${engineMode}${tip}`,
        });
        logEvent("run", "RUN DONE", {
          reason: finalReason,
          mode: engineMode,
          names: names.length,
          est: lastRunTotalCount,
          tpl: gqlTemplates.size,
          ms: Date.now() - (options._startedAt || Date.now()),
        });
      }
    } catch (err) {
      logEvent("run", "RUN ERROR", { err: String(err?.message || err).slice(0, 80) });
      if (currentRunId === myRunId) {
        post("ERROR", {
          message: String(err?.message || err),
          stopReason: "error",
        });
      }
    } finally {
      if (currentRunId === myRunId) {
        running = false;
        stopFlag = false;
        try {
          postRoot?.removeAttribute?.("data-fnk-active");
        } catch {
          /* ignore */
        }
        // Kembalikan posisi scroll ke titik sebelum run dimulai — KECUALI user
        // scroll manual selama run berjalan (hormati posisi mereka).
        if (!userScrolledDuringRun) {
          try {
            window.scrollTo(0, savedScrollY);
          } catch {
            /* ignore */
          }
        } else {
          logEvent("scroll", "TIDAK restore run: user scroll manual selama run");
        }
        watchUserScroll(false);
        restoreScrollAnchor();
      }
    }
  }

  function stopExtract() {
    stopFlag = true;
  }

  // Control plane: non-enumerable API for background executeScript only.
  // Page scripts can still discover it (MAIN world limit) — not via postMessage.
  try {
    Object.defineProperty(window, "__RESO_FNK__", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        version: VERSION,
        start: (opts) => {
          runExtract(opts || {});
        },
        stop: () => {
          stopExtract();
        },
        ping: () => ({ ok: true, version: VERSION, running }),
        // Audit trail: log keputusan engine per run (mode, scroll, expand,
        // navigasi, alasan berhenti) — dibaca oleh background/agen diagnosa.
        getLog: (limit) => getRunLog(limit),
        clearLog: () => {
          clearRunLog();
          return { ok: true };
        },
      }),
    });
  } catch {
    window.__RESO_FNK__ = {
      version: VERSION,
      start: runExtract,
      stop: stopExtract,
      ping: () => ({ ok: true, version: VERSION, running }),
      getLog: (limit) => getRunLog(limit),
      clearLog: () => {
        clearRunLog();
        return { ok: true };
      },
    };
  }

  post("READY", { version: VERSION });
})();
