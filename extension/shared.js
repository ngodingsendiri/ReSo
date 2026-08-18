/** Shared pure helpers — Nama Komentar (FB + TikTok + Instagram unified) */

// ===================== Platform Detection =====================

function isFacebookUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.hostname === "www.facebook.com" ||
      u.hostname === "web.facebook.com" ||
      u.hostname === "m.facebook.com" ||
      u.hostname.endsWith(".facebook.com")
    );
  } catch {
    return false;
  }
}

function isTikTokUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.hostname === "www.tiktok.com" ||
      u.hostname === "tiktok.com" ||
      u.hostname.endsWith(".tiktok.com")
    );
  } catch {
    return false;
  }
}

function isInstagramUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.hostname === "www.instagram.com" ||
      u.hostname === "instagram.com" ||
      u.hostname.endsWith(".instagram.com")
    );
  } catch {
    return false;
  }
}

/**
 * Detect which platform a URL belongs to.
 * @returns {"facebook"|"tiktok"|"instagram"|null}
 */
function detectPlatform(url) {
  if (isFacebookUrl(url)) return "facebook";
  if (isTikTokUrl(url)) return "tiktok";
  if (isInstagramUrl(url)) return "instagram";
  return null;
}

// ===================== Facebook Helpers =====================

// BEGIN-RESO-FBURLS
/**
 * SINGLE SOURCE OF TRUTH untuk deteksi permalink Facebook — dipakai badge
 * panel (isFacebookPostPage), synthetic template engine (extractFbFeedbackIds),
 * dan pre-check. Disalin byte-identik ke inject-fb.js & content-fb.js; dijamin   * fixture test FBURLS. Mengembalikan kandidat story/feedback id dari URL;
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
    /\/photos\/(\d+)/, // foto tunggal (id foto — probe memvalidasi)
    /\/videos\/(\d+)/,
    /\/reel\/(\d+)/,
    /\/video\.php\?v=(\d+)/,
  ];
  for (const re of direct) {
    const m = href.match(re);
    if (m) add(m[1]);
  }

  // 2) Watch (query v=) — bentuk paling umum untuk permalink video
  const watch = href.match(/\/watch(?:[^?#]*\?|\?)[^#]*\bv=(\d+)/i);
  if (watch) add(watch[1]);    // 3) Param umum (story_fbid/fbid/v, termasuk nilai pfbid alfanumerik)
    //    + set: pcb.<story> = postingan multi-foto (id-nya feedback/story id,
    //      prioritas tinggi karena `fbid` di URL tersebut id foto, bukan story)
    //      dan a.<album>.<user>.<story> (komponen terakhir = story id)
    try {
      const u = new URL(href);
      for (const key of ["story_fbid"]) {
        const val = u.searchParams.get(key);
        if (val) add(val);
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



/**
 * Label target yang bermakna dari postHint engine Facebook untuk baris
 * "Target:" (panel & popup). Token status/mode internal engine
 * (templates:N buffer:N, capture, dom, idle, graphql, hybrid, replies,
 * rate_limit, error) bukan target — dikosongkan; friendlyName (mis. nama
 * query GraphQL CometUFICommentsProviderPaginationQuery) tetap ditampilkan.
 * Salinan inline identik di content-fb.js (content script tak bisa import
 * module).
 * @param {string|null|undefined} hint
 * @returns {string}
 */
function fbTargetLabel(hint) {
  const s = typeof hint === "string" ? hint.trim() : "";
  if (!s) return "";
  if (
    /^(templates:\d+\s+buffer:\d+|capture|dom|idle|graphql|hybrid|replies|rate_limit|error)$/i.test(
      s
    )
  ) {
    return "";
  }
  return s;
}

/**
 * Label baris "Target:" Instagram — token internal `media <digits>` (kanal
 * status engine) dikosongkan; shortcode & hint lain tetap (parity fbTargetLabel).
 */
function igTargetLabel(hint) {
  const s = typeof hint === "string" ? hint.trim() : "";
  if (!s) return "";
  if (/^media\s+\d+$/i.test(s)) return "";
  return s;
}

/**
 * Resolusi tema (light/dark/system) — pilihan eksplisit menang; "system"
 * mengikuti prefers-color-scheme OS. Satu sumber: dipakai popup/options
 * (import shared.js) & ketiga panel (salinan inline di content-*.js,
 * di-awasi parity test seperti fbTargetLabel).
 * @param {string|undefined} theme
 * @returns {"light"|"dark"}
 */
function resolveTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Ikon Material Symbols rounded + logo brand (Simple Icons) untuk ketiga
 * panel — di-share via RS_SHARED (shared.js dimuat classic oleh manifest
 * sebelum content-*.js), TANPA salinan inline. Representasi: sprite sheet
 * inline tunggal (iconSprite + injectIconSprite) — svgIcon hanya referensi
 * <use>. Menambah ikon cukup di ICON_PATHS + RS_SHARED + shared-module.js.
 */
const ICON_PATHS = {
    close: "M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z",
    play_arrow: "M320-273v-414q0-17 12-28.5t28-11.5q5 0 10.5 1.5T381-721l326 207q9 6 13.5 15t4.5 19q0 10-4.5 19T707-446L381-239q-5 3-10.5 4.5T360-233q-16 0-28-11.5T320-273Zm80-207Zm0 134 210-134-210-134v268Z",
    stop: "M240-320v-320q0-33 23.5-56.5T320-720h320q33 0 56.5 23.5T720-640v320q0 33-23.5 56.5T640-240H320q-33 0-56.5-23.5T240-320Zm80 0h320v-320H320v320Zm160-160Z",
    content_copy: "M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-520q0-17 11.5-28.5T160-720q17 0 28.5 11.5T200-680v520h400q17 0 28.5 11.5T640-120q0 17-11.5 28.5T600-80H200Zm160-240v-480 480Z",
    restart_alt: "M393-132q-103-29-168-113.5T160-440q0-57 19-108.5t54-94.5q11-12 27-12.5t29 12.5q11 11 11.5 27T290-586q-24 31-37 68t-13 78q0 81 47.5 144.5T410-209q13 4 21.5 15t8.5 24q0 20-14 31.5t-33 6.5Zm174 0q-19 5-33-7t-14-32q0-12 8.5-23t21.5-15q75-24 122.5-87T720-440q0-100-70-170t-170-70h-3l16 16q11 11 11 28t-11 28q-11 11-28 11t-28-11l-84-84q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l84-84q11-11 28-11t28 11q11 11 11 28t-11 28l-16 16h3q134 0 227 93t93 227q0 109-65 194T567-132Z",
    progress_activity: "M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z",
    forum: "M280-240q-17 0-28.5-11.5T240-280v-80h520v-360h80q17 0 28.5 11.5T880-680v503q0 27-24.5 37.5T812-148l-92-92H280Zm-40-200-92 92q-19 19-43.5 8.5T80-377v-463q0-17 11.5-28.5T120-880h520q17 0 28.5 11.5T680-840v360q0 17-11.5 28.5T640-440H240Zm360-80v-280H160v280h440Zm-440 0v-280 280Z",
    // Kirim ke ReSo (Material "send" 24 — Simple Icons koordinat 24).
    send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
    // Logo brand (Simple Icons koordinat 24; music_note Material 960) —
    // tetap satu sumber (sprite sheet), bukan salinan per file.
    facebook: "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
    music_note: "M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-382q0-17 11.5-28.5T520-840h160q17 0 28.5 11.5T720-800v80q0 17-11.5 28.5T680-680H560v400q0 66-47 113t-113 47Z",
    instagram: "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077",
    // Popup & options (halaman extension — ikut sprite yang sama).
};
/** viewBox brand Simple Icons (koordinat 24) — selain itu Material 960. */
const ICON_VIEWBOX = {
  facebook: "0 0 24 24",
  instagram: "0 0 24 24",
  send: "0 0 24 24",
};

/**
 * Ikon panel sebagai referensi <use> ke sprite sheet (iconSprite) — bukan
 * salinan path per elemen: satu path per ikon di DOM, kebal CSP (SVG inline,
 * tanpa fetch eksternal), dan menambah ikon cukup sekali di ICON_PATHS.
 * @param {string} name
 * @param {string} [cls]
 * @returns {string}
 */
function svgIcon(name, cls = "") {
  return (
    '<svg class="rs-ic' +
    (cls ? ` ${cls}` : "") +
    `" data-ic="${name}" aria-hidden="true" width="20" height="20">` +
    `<use href="#rs-i-${name}"/></svg>`
  );
}

/** Sprite sheet ikon — <svg id="rs-icon-sprite"> tersembunyi berisi symbol
 *  dari ICON_PATHS; tiap ikon di panel hanya <use href="#rs-i-…"> (satu path
 *  per ikon di DOM, bukan per elemen). Di-injeksi sekali per dokumen oleh
 *  injectIconSprite(); disembunyikan via #rs-icon-sprite di content-*.css
 *  (bukan inline style — konsisten pola CSP halaman). */
function iconSprite() {
  let s = '<svg id="rs-icon-sprite" aria-hidden="true">';
  for (const name of Object.keys(ICON_PATHS)) {
    const vb = ICON_VIEWBOX[name] || "0 -960 960 960";
    s += `<symbol id="rs-i-${name}" viewBox="${vb}"><path fill="currentColor" d="${ICON_PATHS[name]}"/></symbol>`;
  }
  return s + "</svg>";
}

/** Injeksi sprite sheet ke dokumen (sekali, idempotent). Dipanggil saat boot
 *  content script SEBELUM panel dirender — <use> butuh symbol hadir. */
function injectIconSprite() {
  if (document.getElementById("rs-icon-sprite")) return;
  const host = document.body || document.documentElement;
  if (!host) return;
  host.insertAdjacentHTML("beforeend", iconSprite());
}

// ===================== Instagram Helpers =====================

/** Extract the shortcode from an Instagram post/reel URL (for UI hints only). */
function extractInstagramShortcode(url) {
  if (!url) return null;
  const m = String(url).match(
    /instagram\.com\/(?:share\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i
  );
  return m ? m[1] : null;
}

// ===================== TikTok Helpers =====================

function extractAwemeId(url) {
  if (!url) return null;
  const patterns = [
    /tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/i,
    /tiktok\.com\/(?:embed|v)\/(\d+)/i,
    /[?&]aweme_id=(\d+)/i,
    /[?&]item_id=(\d+)/i,
    /\/video\/(\d+)/i,
    /\/photo\/(\d+)/i,
  ];
  for (const re of patterns) {
    const m = String(url).match(re);
    if (m) return m[1];
  }
  return null;
}

// ===================== Name Normalization =====================
// The three blocks below (normalizeCommentName / normalizeNickname /
// normalizeInstagramUsername) are the SINGLE SOURCE OF TRUTH for name
// normalization. The MAIN-world engines (inject-fb.js, inject-tiktok.js,
// inject-ig.js) and content scripts (content-fb.js, content-tiktok.js,
// content-ig.js) carry byte-identical copies inside the marker blocks the
// fixture test (tests/normalization-fixture.test.mjs) reads and compares.

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

// BEGIN-RESO-NORMALIZE
function normalizeInstagramUsername(raw) {
  if (typeof raw !== "string") return "";
  let u = raw.replace(/\u200b|\u200c|\u200d|\ufeff/g, "").trim();
  if (/\s/.test(u)) return "";
  if (u.startsWith("@")) u = u.slice(1);
  u = u.trim();
  if (!u) return "";
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(u)) return "";
  if (/\.\./.test(u) || u.startsWith(".") || u.endsWith(".")) return "";
  u = u.toLowerCase();
  const blocked = [
    /^instagram$/i, /^post$/i, /^posts$/i, /^reel$/i, /^reels$/i,
    /^story$/i, /^stories$/i, /^explore$/i, /^direct$/i, /^inbox$/i,
    /^activity$/i, /^following$/i, /^followers$/i, /^follow$/i,
    /^saved$/i, /^settings$/i, /^help$/i, /^about$/i, /^terms$/i,
    /^privacy$/i, /^login$/i, /^signup$/i, /^report$/i, /^more$/i,
    /^comment$/i, /^reply$/i, /^share$/i, /^save$/i, /^like$/i,
    /^sent$/i, /^translate/i, /^view/i, /^username$/i, /^new$/i,
    /^edit/i, /^delete/i, /^cancel$/i, /^close$/i, /^copy/i,
    /^threads$/i, /^threadsapp$/i,
  ];
  if (blocked.some((re) => re.test(u))) return "";
  return u;
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
          stack.push(i);            // Objek komentar = yang membuka dengan __typename "Comment"
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



/** Kata untuk hasil per platform — Instagram = username, lainnya = nama. */
function wordFor(platform) {
  return platform === "instagram" ? "username" : "nama";
}



/**
 * Normalize a raw name string, filtering out UI labels, timestamps, URLs, etc.
 * @param {string} raw
 * @param {"facebook"|"tiktok"|"instagram"|null} platform
 * @returns {string} normalized name or empty string
 */
function normalizeName(raw, platform) {
  if (platform === "instagram") return normalizeInstagramUsername(raw);
  if (platform === "tiktok") return normalizeNickname(raw);
  return normalizeCommentName(raw);
}

// ===================== Name Merge & Clipboard =====================

function mergeNames(existing, incoming, platform) {
  const map = new Map();
  for (const n of existing || []) {
    const k = normalizeName(n, platform);
    if (k && !map.has(k.toLowerCase())) map.set(k.toLowerCase(), k);
  }
  for (const n of incoming || []) {
    const k = normalizeName(n, platform);
    if (k && !map.has(k.toLowerCase())) map.set(k.toLowerCase(), k);
  }
  return [...map.values()];
}

function namesToClipboardText(names, platform) {
  return (names || [])
    .map((n) => normalizeName(n, platform))
    .filter(Boolean)
    .join("\n");
}

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

/** Unduh file teks via blob (berfungsi di popup & content script). */
function downloadTextFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}



// ===================== Run ID =====================

function newRunId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Reject progress/done from a different run, or messages missing runId
 * while a run is already active.
 */
function isStaleRun(stateRunId, msgRunId) {
  if (!stateRunId) return false;
  if (!msgRunId) return true;
  return stateRunId !== msgRunId;
}

// ===================== Storage Keys =====================

// Facebook
const STORAGE_KEY_FB = "fnk_state";

// TikTok — template lives in session storage (not permanent local)
const STORAGE_KEY_TT = "tnk_state";
const URL_TEMPLATE_KEY = "tnk_comment_url";
const URL_META_KEY = "tnk_comment_meta";
/** Max age for a captured comment-list URL template */
const TEMPLATE_TTL_MS = 45 * 60 * 1000;

// Instagram — same replay pattern as TikTok, shorter TTL (more fragile)
const STORAGE_KEY_IG = "ing_state";
const IG_TEMPLATE_KEY = "ing_comment_url";
const IG_META_KEY = "ing_comment_meta";
/** Max age for a captured Instagram comments API template */
const IG_TEMPLATE_TTL_MS = 30 * 60 * 1000;

// Persisted across browser restarts (chrome.storage.local)
const SAVED_KEY = "rsx_saved"; // { facebook?: {names,count,savedAt}, tiktok?: {...} }
const PREFS_KEY = "rsx_prefs"; // { includeReplies: { facebook?: boolean, tiktok?: boolean } }

/**
 * Get the storage key for a platform.
 * @param {"facebook"|"tiktok"|"instagram"} platform
 */
function storageKeyFor(platform) {
  if (platform === "tiktok") return STORAGE_KEY_TT;
  if (platform === "instagram") return STORAGE_KEY_IG;
  return STORAGE_KEY_FB;
}

/**
 * Strip short-lived signing params before persisting a TikTok API URL.
 * @param {string} url
 * @returns {string|null}
 */
function sanitizeTikTokTemplateUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    for (const key of [
      "msToken",
      "X-Bogus",
      "X-Gnarly",
      "X-Dynosaur",
      "_signature",
      "signature",
    ]) {
      u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Validate a stored TikTok comment API template.
 * @param {string|null|undefined} url
 * @param {{capturedAt?: number, awemeId?: string|null}|null|undefined} meta
 * @param {string|null} [requiredAwemeId] if set, meta.awemeId must match when present
 * @returns {boolean}
 */
function isTikTokTemplateValid(url, meta, requiredAwemeId = null) {
  if (!url || typeof url !== "string") return false;
  if (!url.toLowerCase().includes("tiktok.com/api/comment/list")) return false;
  if (url.toLowerCase().includes("tiktok.com/api/comment/list/reply")) return false;
  const capturedAt = meta?.capturedAt;
  if (!capturedAt || typeof capturedAt !== "number") return false;
  if (Date.now() - capturedAt > TEMPLATE_TTL_MS) return false;
  if (
    requiredAwemeId &&
    meta?.awemeId &&
    String(meta.awemeId) !== String(requiredAwemeId)
  ) {
    return false;
  }
  return true;
}

// ===================== Default State =====================

const DEFAULT_STATE_FB = {
  status: "idle",
  names: [],
  count: 0,
  message: "Buka 1 postingan Facebook, lalu klik Proses.",
  tabId: null,
  updatedAt: 0,
  stopReason: null,
  postHint: "",
  includeReplies: true,
  runId: null,
};

const DEFAULT_STATE_TT = {
  status: "idle",
  names: [],
  count: 0,
  message: "Buka video TikTok, buka panel komentar, lalu klik Proses.",
  tabId: null,
  updatedAt: 0,
  stopReason: null,
  videoHint: "",
  includeReplies: false,
  hasTemplate: false,
  runId: null,
};

const DEFAULT_STATE_IG = {
  status: "idle",
  names: [],
  count: 0,
  message:
    "Buka 1 post/reel Instagram, pastikan sudah login, lalu klik Proses.",
  tabId: null,
  updatedAt: 0,
  stopReason: null,
  postHint: "",
  includeReplies: false,
  hasTemplate: false,
  runId: null,
};

function defaultStateFor(platform) {
  if (platform === "tiktok") return { ...DEFAULT_STATE_TT };
  if (platform === "instagram") return { ...DEFAULT_STATE_IG };
  return { ...DEFAULT_STATE_FB };
}

/**
 * Strip volatile pagination / app-noise params before persisting an
 * Instagram comments API template URL.
 * @param {string} url
 * @returns {string|null}
 */
function sanitizeInstagramTemplateUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (!u.href.includes("instagram.com/api/v1/media/")) return null;
    if (!u.href.includes("/comments/")) return null;
    if (u.href.includes("/inline_child_comments")) return null;
    for (const key of [
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
    ]) {
      u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Validate a stored Instagram comments API template.
 * @param {string|null|undefined} url
 * @param {{capturedAt?: number, mediaId?: string|null}|null|undefined} meta
 * @param {string|null} [requiredMediaId] when set, meta.mediaId must match when present
 * @returns {boolean}
 */
function isInstagramTemplateValid(url, meta, requiredMediaId = null) {
  if (!url || typeof url !== "string") return false;
  if (!url.includes("instagram.com/api/v1/media/")) return false;
  if (!url.includes("/comments/")) return false;
  if (url.includes("/inline_child_comments")) return false;
  const capturedAt = meta?.capturedAt;
  if (!capturedAt || typeof capturedAt !== "number") return false;
  if (Date.now() - capturedAt > IG_TEMPLATE_TTL_MS) return false;
  if (
    requiredMediaId &&
    meta?.mediaId &&
    String(meta.mediaId) !== String(requiredMediaId)
  ) {
    return false;
  }
  return true;
}

// ===================== Engine Options Sanitizer =====================

/**
 * Sanitize START / SET_TEMPLATE options before crossing into MAIN world.
 * Pure (no chrome.*) so it is unit-testable. The engines are isolated worlds;
 * every value that crosses the boundary is validated here.
 * @param {"START"|"SET_TEMPLATE"|string} cmd
 * @param {object} options
 * @param {"facebook"|"tiktok"|"instagram"} platform
 * @returns {object}
 */
function sanitizeEngineOptions(cmd, options, platform) {
  const raw = options && typeof options === "object" ? options : {};
  if (cmd === "SET_TEMPLATE") {
    const url =
      typeof raw.templateUrl === "string" ? raw.templateUrl.slice(0, 4000) : null;
    if (platform === "tiktok") {
      return {
        templateUrl:
          url &&
          url.toLowerCase().includes("tiktok.com/api/comment/list") &&
          !url.toLowerCase().includes("/list/reply")
            ? url
            : null,
      };
    }
    if (platform === "instagram") {
      return {
        templateUrl:
          url &&
          url.includes("instagram.com/api/v1/media/") &&
          url.includes("/comments/") &&
          !url.includes("/inline_child_comments")
            ? url
            : null,
      };
    }
    return { templateUrl: null };
  }
  if (cmd !== "START") return {};

  const maxMs = Number(raw.maxMs);
  const out = {
    maxMs: Number.isFinite(maxMs)
      ? Math.min(180_000, Math.max(8_000, maxMs))
      : platform === "tiktok"
        ? 120_000
        : 150_000,
    includeReplies:
      platform === "tiktok" || platform === "instagram"
        ? raw.includeReplies === true
        : raw.includeReplies !== false,
    runId:
      typeof raw.runId === "string" && raw.runId.length <= 80
        ? raw.runId
        : null,
  };
  if (platform === "tiktok") {
    const aweme =
      raw.awemeId != null ? String(raw.awemeId).replace(/\D/g, "").slice(0, 32) : "";
    out.awemeId = aweme || null;
    const url =
      typeof raw.templateUrl === "string" ? raw.templateUrl.slice(0, 4000) : null;
    out.templateUrl =
      url &&
      url.toLowerCase().includes("tiktok.com/api/comment/list") &&
      !url.toLowerCase().includes("/list/reply")
        ? url
        : null;
  }
  if (platform === "instagram") {
    const media =
      raw.mediaId != null ? String(raw.mediaId).replace(/\D/g, "").slice(0, 32) : "";
    out.mediaId = media || null;
    const url =
      typeof raw.templateUrl === "string" ? raw.templateUrl.slice(0, 4000) : null;
    out.templateUrl =
      url &&
      url.includes("instagram.com/api/v1/media/") &&
      url.includes("/comments/") &&
      !url.includes("/inline_child_comments")
        ? url
        : null;
  }
  return out;
}

// ===================== State Patch =====================

function applyStatePatch(prev, patch, platform) {
  const def = defaultStateFor(platform);
  const next = { ...def, ...prev, ...patch, updatedAt: Date.now() };
  if (Array.isArray(next.names)) {
    next.names = mergeNames([], next.names, platform);
    next.count = next.names.length;
  }
  return next;
}

// ===================== Reason → Message =====================

function reasonToMessage(reason, count, platform, extra) {
  return doneMessage(reason, count, platform, extra ? { extra } : {});
}

// ===================== Domain ReSo =====================
// Domain produksi = SUMBER TUNGGAL di sini; manifest.json memakai pola yang
// sama (test memastikan keduanya sinkron). Dipakai content-reso.js (handoff
// token sesi) dan sendNamesToResoApi (POST /api/engagement).
const RESO_URL = "https://reso.vercel.app";
const RESO_DEV_URL = "http://localhost:3000";
const RESO_MATCH_PATTERNS = [`${RESO_URL}/*`, `${RESO_DEV_URL}/*`];

// Mode ekstensi (toggle popup): false → FAB/panel di halaman disembunyikan.
const RSX_ENABLED_KEY = "rsx_enabled";
// ===== ReSo API — kirim langsung ke database (Opsi C) =====
// Alur baru: ekstraksi → otomatis kirim ke /api/engagement (Vercel) →
// dailyEngagement/{date} di-merge (dedupe case-insensitive) + engagedEmployeeIds
// dihitung ulang server-side pakai modul matching ReSo. Idempotent (diulang =
// update), satu hari bisa banyak post. TANPA membuka tab ReSo: token diambil
// dari chrome.storage (handoff sekali dari sesi login ReSo) dan di-refresh via
// Firebase REST (refresh token).
//
// Config = nilai publik firebase-applet-config.json repo ReSo (aman dibagikan,
// bukan secret).
const RESO_FIREBASE = {
  projectId: "gen-lang-client-0270545710",
  databaseId: "ai-studio-fb938bba-d23a-4dfc-9bc9-1fdee767fe1d",
  apiKey: "AIzaSyCNPs22_EDW9DlfjoO4myWv-TnEBR6YvBo",
};
const RESO_AUTH_KEY = "resoAuth";

/** Decode payload JWT (exp dalam detik). Gagal → 0 (anggap kedaluwarsa). */
function jwtExpSeconds(token) {
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(decodeURIComponent(escape(json)));
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

async function getResoAuth() {
  try {
    const data = await chrome.storage.local.get(RESO_AUTH_KEY);
    return data[RESO_AUTH_KEY] || null;
  } catch {
    return null;
  }
}

async function setResoAuth(auth) {
  await chrome.storage.local.set({ [RESO_AUTH_KEY]: auth });
}

/** Mint idToken baru dari refresh token (Firebase REST) — tanpa buka tab.
 *  Error definitif (refresh token dicabut/akun nonaktif) diberi kode
 *  `err.code` (kata pertama pesan Firebase, mis. INVALID_REFRESH_TOKEN)
 *  supaya pemanggil bisa membersihkan storage — error transien tidak punya
 *  kode yang dikenal. */
async function mintResoIdToken(refreshToken) {
  // 1) Coba Firebase REST langsung
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const r = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(RESO_FIREBASE.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.id_token) {
      return {
        idToken: data.id_token,
        refreshToken: data.refresh_token || refreshToken,
      };
    }
    const code = typeof data.error?.message === "string" ? data.error.message.split(" ")[0] : "";
    if (code && DEFINITIVE_AUTH_ERRORS.has(code)) {
      const err = new Error(data.error?.message || "Refresh token tidak valid.");
      err.code = code;
      throw err;
    }
  } catch (e) {
    if (e && typeof e.code === "string" && DEFINITIVE_AUTH_ERRORS.has(e.code)) throw e;
  }
  // 2) Fallback: mint via /api/token-refresh (server relay)
  try {
    const r = await fetch(`${RESO_URL}/api/token-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok && data.idToken) {
      return { idToken: data.idToken, refreshToken: data.refreshToken || refreshToken };
    }
    const errMsg = data?.error || "";
    if (errMsg.includes("INVALID_REFRESH_TOKEN") || errMsg.includes("TOKEN_EXPIRED")) {
      const err = new Error(errMsg);
      err.code = errMsg.split(" ")[0];
      throw err;
    }
  } catch (e) {
    if (e && typeof e.code === "string" && DEFINITIVE_AUTH_ERRORS.has(e.code)) throw e;
  }
  const err = new Error("Sesi ReSo kedaluwarsa — buka ReSo sekali untuk login ulang.");
  err.code = "MINT_FAILED";
  throw err;
}


/** Handoff token dari tab ReSo yang terbuka (content-reso.js → CustomEvent).
 *  Coba SEMUA tab ReSo, prefer produksi di atas dev (localhost:3000) — tab
 *  dev usang dengan sesi mati tidak boleh menaungi sesi produksi. Tab tanpa
 *  content script/balasan dilewati, bukan menghentikan handoff. */
async function handoffResoAuthFromTab() {
  const tabs = await chrome.tabs.query({ url: RESO_MATCH_PATTERNS });
  if (!tabs.length) return null;
  const prod = [];
  const dev = [];
  for (const t of tabs) {
    if (typeof t.url === "string" && t.url.startsWith(RESO_URL)) prod.push(t);
    else dev.push(t);
  }
  for (const tab of [...prod, ...dev]) {
    let r = null;
    try {
      r = await chrome.tabs.sendMessage(tab.id, { type: "GET_AUTH_TOKEN" });
    } catch {
      continue; // tab tanpa content script (masih loading) — coba tab lain
    }
    if (!r || !r.idToken) continue;
    const auth = {
      idToken: r.idToken,
      refreshToken: r.refreshToken || null,
      uid: r.uid || null,
      email: r.email || null,
      savedAt: Date.now(),
    };
    await setResoAuth(auth);
    return auth;
  }
  return null;
}

/** Kode error Firebase yang berarti refresh token tersimpan sudah TIDAK
 *  berguna (dicabut, kedaluwarsa, akun dinonaktifkan/dihapus) — auth wajib
 *  dibersihkan supaya run berikutnya langsung handoff, bukan mint mati lagi. */
const DEFINITIVE_AUTH_ERRORS = new Set([
  "INVALID_REFRESH_TOKEN",
  "TOKEN_EXPIRED",
  "USER_DISABLED",
  "USER_NOT_FOUND",
]);

/**
 * Pastikan idToken valid: (1) tersimpan & belum kedaluwarsa → pakai;
 * (2) punya refresh token → mint tanpa tab; (3) fallback handoff dari tab
 * ReSo. Kembalikan null jika tidak ada cara (butuh login ReSo dulu).
 */
async function ensureResoIdToken() {
  const stored = await getResoAuth();
  if (stored?.idToken && jwtExpSeconds(stored.idToken) * 1000 - 60000 > Date.now()) {
    return stored.idToken;
  }
  if (stored?.refreshToken) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const minted = await mintResoIdToken(stored.refreshToken);
        await setResoAuth({ ...stored, ...minted, savedAt: Date.now() });
        return minted.idToken;
      } catch (e) {
        if (e && typeof e.code === "string" && DEFINITIVE_AUTH_ERRORS.has(e.code)) {
          try { await chrome.storage.local.remove(RESO_AUTH_KEY); } catch {}
          break;
        }
        if (attempt === 0) continue;
      }
    }
  }
  const handoff = await handoffResoAuthFromTab();
  return handoff ? handoff.idToken : null;
}


/**
 * Kirim nama hasil ekstraksi ke ReSo via API (Opsi C). Tidak membuka tab;
 * tanggal = saran umur post (lapis 2) atau hari ini. Idempotent: kirim ulang
 * hanya update (dedupe server-side).
 * @param {"facebook"|"instagram"|"tiktok"} platform
 * @param {string[]} names
 * @param {{suggestedDate?: string, suggestedIso?: string, label?: string}} [hint]
 * @returns {Promise<{ok: boolean, date?: string, added?: number, existing?: number, unmatched?: number, message: string}>}
 */
async function sendNamesToResoApi(platform, names, hint) {
  const idToken = await ensureResoIdToken();
  if (!idToken) {
    return {
      ok: false,
      needsLogin: true,
      message: "Sesi ReSo belum tersambung. Buka ReSo (reso.vercel.app) sekali untuk login, lalu coba lagi.",
    };
  }
  const clean = Array.isArray(names)
    ? names.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim())
    : [];
  if (!clean.length) return { ok: false, message: "Tidak ada nama untuk dikirim." };
  const date =
    hint && typeof hint.suggestedDate === "string" && isValidISODate(hint.suggestedDate)
      ? hint.suggestedDate
      : localISODateOf(new Date());
  // Waktu posting (L3): ISO lokal dari deteksi post (suggestedIso), opsional —
  // API menyimpannya sebagai array per tanggal (satu hari bisa banyak post).
  const postedAt =
    hint && typeof hint.suggestedIso === "string" && isValidPostedIso(hint.suggestedIso)
      ? hint.suggestedIso
      : undefined;
  const body = { platform, names: clean, date, ...(postedAt ? { postedAt } : {}) };
  try {
    const r = await fetch(`${RESO_URL}/api/engagement`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, message: data?.error || `Gagal kirim ke ReSo (${r.status}).` };
    }
    const added = typeof data.added === "number" ? data.added : clean.length;
    const existing = typeof data.existing === "number" ? data.existing : 0;
    // Nama yang belum terpetakan ke pegawai (hitung dari respons API): kalau
    // > 0, operator diberi tahu di pesan sukses supaya bisa memetakan sekali
    // di dashboard — kiriman berikutnya otomatis match.
    const unmatched =
      typeof data.unmatched === "number" && data.unmatched > 0 ? data.unmatched : 0;
    let message =
      `Terkirim ke rekap ${data.date || date} — ${added} nama baru, ` +
      `${existing} sudah ada. Sudah tersimpan di DB — cek rekapnya di ReSo.`;
    if (unmatched > 0) {
      message +=
        ` ${unmatched} nama belum terpetakan di ReSo — buka dashboard untuk memetakan.`;
    }
    return {
      ok: true,
      date: data.date || date,
      added,
      existing,
      unmatched,
      message,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Gagal kirim ke ReSo: ${e && e.message ? e.message : e}`,
    };
  }
}

// ===== Lapis 2 — saran tanggal dari umur post (best-effort) =====
// Platform sosmed menampilkan waktu relatif ("Kemarin", "3 jam", "5d") atau
// absolut ("10 Agustus 2025"). Deteksi ini SELALU saran: tanggal rekap tetap
// keputusan operator di ReSo (payload membawa suggestedDate, aplikasi
// mengonfirmasi sekali klik sebelum pindah tanggal).

const MONTH_INDEX = {
  jan: 0, january: 0, januari: 0,
  feb: 1, february: 1, februari: 1,
  mar: 2, march: 2, maret: 2,
  apr: 3, april: 3,
  mei: 4, may: 4,
  jun: 5, june: 5, juni: 5,
  jul: 6, july: 6, juli: 6,
  agu: 7, aug: 7, august: 7, agustus: 7,
  sep: 8, september: 8,
  okt: 9, oct: 9, october: 9, oktober: 9,
  nov: 10, november: 10,
  des: 11, dec: 11, december: 11, desember: 11,
};

/** Validasi ISO lokal waktu posting "YYYY-MM-DDTHH:MM" (kalender nyata,
 *  jam ≤ 23, menit ≤ 59) — kencang supaya kiriman tidak pernah ditolak API. */
function isValidPostedIso(v) {
  if (typeof v !== "string") return false;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!m || !isValidISODate(m[1])) return false;
  return Number(m[2]) <= 23 && Number(m[3]) <= 59;
}

/** Validasi YYYY-MM-DD kalender nyata (bukan sekadar bentuk). */
function isValidISODate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function localISODateOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftISODate(iso, deltaDays) {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODateOf(new Date(y, m - 1, d + deltaDays));
}

/** Bangun tanggal lokal dengan day di-clamp ke panjang bulan (31 Mar − 1
 *  bulan → 28 Feb, bukan 3 Mar). */
function clampedLocalDate(y, monthIndex, day) {
  const first = new Date(y, monthIndex, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return localISODateOf(
    new Date(first.getFullYear(), first.getMonth(), Math.min(day, last))
  );
}

function shiftISOMonths(iso, deltaMonths) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1 + deltaMonths, 1);
  return clampedLocalDate(target.getFullYear(), target.getMonth(), d);
}

/** Satuan relatif → hari; null = butuh kalkulasi kalender (bulan/tahun). */
function relUnitDays(unit) {
  switch (unit) {
    case "detik": case "second": case "sec": case "dtk": case "s": return 1 / 86400;
    case "menit": case "minute": case "min": case "mnt": case "m": return 1 / 1440;
    case "jam": case "hour": case "hours": case "hr": case "hrs": case "j": case "h": return 1 / 24;
    case "hari": case "day": case "days": case "d": return 1;
    case "minggu": case "week": case "weeks": case "w": return 7;
    // bulan/tahun (termasuk singkatan FB "bln"/"thn") butuh kalkulasi kalender.
    case "bulan": case "bln": case "tahun": case "thn": return null;
    default: return null;
  }
}

/**
 * "HH:MM" 2 digit dari Date lokal.
 */
function hhmmOf(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** ISO lokal ringkas: "YYYY-MM-DD", atau "YYYY-MM-DDTHH:MM" bila punya jam. */
function localIsoOf(dateStr, timeStr) {
  return timeStr ? `${dateStr}T${timeStr}` : dateStr;
}

/** Parse "07.30" / "7:30" → "07:30"; null bila bukan jam valid. */
function parseClockTime(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Parse teks umur post (relatif atau absolut) → tanggal kalender lokal +
 * jam (bila teks/atribut memuatnya). Best-effort: hanya string pendek
 * (≤ 60 char) yang dikenali; hasil SELALU saran. `now` opsional untuk
 * determinisme test.
 * @param {string} text
 * @param {Date} [now]
 * @returns {{date: string, time: (string|null), iso: string, label: string}|null}
 */
function parsePostAgeText(text, now) {
  if (typeof text !== "string") return null;
  const t = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!t || t.length > 60) return null;
  const d = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  const today = localISODateOf(d);
  const nowTime = hhmmOf(d);

  // 1) Sekarang / baru saja
  if (/^(baru saja|just now|now)$/.test(t)) {
    return { date: today, time: nowTime, iso: `${today}T${nowTime}`, label: text.trim() };
  }

  // 2) Hari ini / kemarin (boleh + "pukul HH.MM")
  const day = t.match(/^(hari ini|today|kemarin|yesterday)(\s+pukul\s+([\d.:]+))?$/);
  if (day) {
    const back = day[1] === "kemarin" || day[1] === "yesterday" ? 1 : 0;
    const date = shiftISODate(today, -back);
    const time = day[3] ? parseClockTime(day[3]) : null;
    return { date, time, iso: localIsoOf(date, time), label: text.trim() };
  }

  // 3) Relatif: "N unit (yang lalu|lalu)?" | kompak "5d/3w/1y/2 hr" | "sehari"
  const rel = t.match(
    /^(?:se|satu\s)?(\d+)?\s*(detik|menit|jam|hari|minggu|bulan|bln|tahun|thn|second|seconds|minute|minutes|hour|hours|day|days|week|weeks|year|years|sec|min|hr|hrs|h|d|w|y|j|mnt|dtk|s)\s*(yang\s+lalu|lalu)?$/
  );
  if (rel) {
    const n = rel[1] ? Number(rel[1]) : 1;
    if (!Number.isFinite(n) || n <= 0 || n > 1000) return null;
    const days = relUnitDays(rel[2]);
    if (days !== null) {
      if (days < 1) {
        // Sub-hari: hitung dari "sekarang" supaya lintas tengah malam benar.
        const past = new Date(d.getTime() - Math.round(n * days * 86400000));
        const date = localISODateOf(past);
        const time = hhmmOf(past);
        return { date, time, iso: `${date}T${time}`, label: text.trim() };
      }
      const date = shiftISODate(today, -Math.round(n * days));
      return { date, time: null, iso: date, label: text.trim() };
    }
    if (rel[2] === "bulan" || rel[2] === "bln") {
      const date = shiftISOMonths(today, -n);
      return { date, time: null, iso: date, label: text.trim() };
    }
    const [y, m, dd] = today.split("-").map(Number);
    const date = clampedLocalDate(y - n, m - 1, dd);
    return { date, time: null, iso: date, label: text.trim() };
  }

  // 4) Absolut: "10 Agustus 2025" / "10 Agu" / "18 Agu pukul 07.30"
  const monthKeys = Object.keys(MONTH_INDEX)
    .sort((a, b) => b.length - a.length)
    .join("|");
  const abs = t.match(new RegExp(`^(\\d{1,2})\\s+(${monthKeys})\\s*(\\d{4})?(\\s+pukul\\s+([\\d.:]+))?$`));
  if (abs) {
    const dayNum = Number(abs[1]);
    const month = MONTH_INDEX[abs[2]];
    let year = abs[3] ? Number(abs[3]) : d.getFullYear();
    if (dayNum < 1 || dayNum > 31) return null;
    let dt = new Date(year, month, dayNum);
    if (dt.getMonth() !== month || dt.getDate() !== dayNum) return null;
    // Tanpa tahun & hasilnya di masa depan → tahun sebelumnya (post tak
    // mungkin di masa depan).
    if (!abs[3] && dt.getTime() > d.getTime()) {
      year -= 1;
      dt = new Date(year, month, dayNum);
    }
    const date = localISODateOf(dt);
    const time = abs[5] ? parseClockTime(abs[5]) : null;
    return { date, time, iso: localIsoOf(date, time), label: text.trim() };
  }

  // 5) ISO: "2025-08-10" atau "2025-08-10T07:30:00Z" (datetime attr).
  //    Datetime dengan Z dikonversi ke waktu LOKAL (offset perangkat) supaya
  //    tanggal & jam sesuai yang operator lihat di UI platform.
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:z)?)?$/i);
  if (iso) {
    const s = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (!isValidISODate(s)) return null;
    if (iso[4] !== undefined) {
      const h = Number(iso[4]);
      const min = Number(iso[5]);
      if (h > 23 || min > 59) return null;
      const local = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), h, min));
      const date = localISODateOf(local);
      const time = hhmmOf(local);
      return { date, time, iso: `${date}T${time}`, label: text.trim() };
    }
    return { date: s, time: null, iso: s, label: text.trim() };
  }

  return null;
}

/**
 * Scan DOM halaman post untuk umur post + jam: (1) atribut `data-utime`
 * (unix detik, FB klasik), (2) atribut `datetime` pada <time> (IG: ISO penuh
 * dengan Z), (3) fallback teks pendek + `aria-label` (FB: "18 Agu pukul
 * 07.30"). Best-effort — hasilnya saran, bukan keputusan. Dipanggil content
 * scripts saat Rekap+Kirim.
 * @param {Element|Document|null} [root]
 * @param {Date} [now]
 * @returns {{suggestedDate: string, suggestedTime: (string|null), suggestedIso: string, label: string}|null}
 */
function scanPageForPostDate(root, now) {
  const doc = root || (typeof document !== "undefined" ? document : null);
  if (!doc || typeof doc.querySelectorAll !== "function") return null;
  const found = { suggestedDate: null, suggestedTime: null, suggestedIso: null, label: "" };
  const setFrom = (r, label) => {
    if (found.suggestedDate || !r || !r.date) return;
    found.suggestedDate = r.date;
    found.suggestedTime = r.time || null;
    found.suggestedIso = r.iso || null;
    found.label = label || r.label || "";
  };
  const consider = (raw, label) => {
    if (found.suggestedDate || typeof raw !== "string") return;
    const t = raw.trim().replace(/\s+/g, " ");
    if (!t || t.length > 60) return;
    setFrom(parsePostAgeText(t, now), label);
  };

  // 1) data-utime (FB): unix detik → tanggal+jam lokal.
  let els = [];
  try {
    els = doc.querySelectorAll("[data-utime]");
  } catch {
    els = [];
  }
  for (const el of els) {
    const raw = el.getAttribute && el.getAttribute("data-utime");
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      const dt = new Date(n * 1000);
      if (!isNaN(dt.getTime()) && dt.getFullYear() >= 2010) {
        const txt = (el.textContent || "").trim().replace(/\s+/g, " ");
        const date = localISODateOf(dt);
        const time = hhmmOf(dt);
        setFrom(
          { date, time, iso: `${date}T${time}` },
          txt && txt.length <= 60 ? txt : `${date} ${time}`
        );
        break;
      }
    }
  }

  // 2) time[datetime] (IG): atribut datetime penuh (bisa Z → konversi lokal).
  if (!found.suggestedDate) {
    try {
      els = doc.querySelectorAll("time[datetime]");
    } catch {
      els = [];
    }
    for (const el of els) {
      const dt = el.getAttribute && el.getAttribute("datetime");
      const txt = (el.textContent || "").trim().replace(/\s+/g, " ");
      if (typeof dt === "string" && isValidISODate(dt.slice(0, 10))) {
        const r = parsePostAgeText(dt, now);
        setFrom(r, txt && txt.length <= 60 ? txt : (r && r.date));
        if (found.suggestedDate) break;
      }
    }
  }

  // 3) Fallback teks + aria-label (FB/IG: "18 Agu pukul 07.30").
  if (!found.suggestedDate) {
    let all = [];
    try {
      all = doc.querySelectorAll("time, a, span, strong, h1, h2, h3");
    } catch {
      all = [];
    }
    const limit = Math.min(all.length, 400);
    for (let i = 0; i < limit; i++) {
      const el = all[i];
      const aria = el.getAttribute && el.getAttribute("aria-label");
      consider(aria, null);
      if (found.suggestedDate) break;
      consider(el.textContent);
      if (found.suggestedDate) break;
    }
  }
  return found.suggestedDate ? found : null;
}

/**
 * createTime TikTok dari data rehydration (`__UNIVERSAL_DATA_FOR_REHYDRATION__`).
 * Pure — terima hasil JSON.parse, kembalikan {date, time, iso}|null.
 * Defensif terhadap pergeseran struktur (beberapa jalur dicoba); angka di
 * luar rentang masuk akal (sebelum 2010) diabaikan.
 * @param {unknown} data
 * @returns {{date: string, time: string, iso: string}|null}
 */
function createTimeFromRehydration(data) {
  if (!data || typeof data !== "object") return null;
  const scope = data.__DEFAULT_SCOPE__ || data.DefaultScope || data;
  const vd =
    scope && typeof scope === "object"
      ? scope["webapp.video-detail"] ||
        (scope.webapp && typeof scope.webapp === "object" && scope.webapp["video-detail"])
      : null;
  if (!vd || typeof vd !== "object") return null;
  const item =
    (vd.itemInfo && typeof vd.itemInfo === "object" && vd.itemInfo.itemStruct) ||
    vd.itemStruct ||
    null;
  const sec = item && item.createTime;
  if (sec === undefined || sec === null) return null;
  const n = typeof sec === "number" ? sec : Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  const dt = new Date(n * 1000);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2010) return null;
  const date = localISODateOf(dt);
  const time = hhmmOf(dt);
  return { date, time, iso: `${date}T${time}` };
}

// ===================== Registry global (dual-mode) =====================
// shared.js berlaku sebagai CLASSIC script (content scripts: dimuat via
// manifest content_scripts SEBELUM content-*.js) sekaligus MODULE (di-import
// side-effect oleh shared-module.js lalu di-re-export bernama untuk
// popup/options/background/tests). Tanpa statement import/export di file ini
// agar valid di kedua mode. Menambah helper: definisikan di sini + daftarkan
// di RS_SHARED + re-export di shared-module.js.
globalThis.RS_SHARED = {
  isFacebookUrl,
  isTikTokUrl,
  isInstagramUrl,
  detectPlatform,
  extractFbFeedbackIds,
  extractFbFeedbackId,
  isFacebookPostPage,
  fbTargetLabel,
  igTargetLabel,
  resolveTheme,
  svgIcon,
  iconSprite,
  injectIconSprite,
  extractInstagramShortcode,
  extractAwemeId,
  normalizeInstagramUsername,
  parseTikTokComments,
  parseIgComments,
  extractGraphqlNames,
  wordFor,
  doneMessage,
  normalizeName,
  mergeNames,
  namesToClipboardText,
  mergeAcrossPlatforms,
  filterNames,
  sortNamesAz,
  downloadTextFile,
  newRunId,
  isStaleRun,
  STORAGE_KEY_FB,
  STORAGE_KEY_TT,
  URL_TEMPLATE_KEY,
  URL_META_KEY,
  TEMPLATE_TTL_MS,
  STORAGE_KEY_IG,
  IG_TEMPLATE_KEY,
  IG_META_KEY,
  IG_TEMPLATE_TTL_MS,
  SAVED_KEY,
  PREFS_KEY,
  storageKeyFor,
  sanitizeTikTokTemplateUrl,
  isTikTokTemplateValid,
  DEFAULT_STATE_FB,
  DEFAULT_STATE_TT,
  DEFAULT_STATE_IG,
  defaultStateFor,
  sanitizeInstagramTemplateUrl,
  isInstagramTemplateValid,
  sanitizeEngineOptions,
  applyStatePatch,
  reasonToMessage,
  RESO_URL,
  RESO_DEV_URL,
  RESO_MATCH_PATTERNS,
  RSX_ENABLED_KEY,
  RESO_FIREBASE,
  jwtExpSeconds,
  getResoAuth,
  setResoAuth,
  mintResoIdToken,
  handoffResoAuthFromTab,
  ensureResoIdToken,
  sendNamesToResoApi,
  parsePostAgeText,
  scanPageForPostDate,
  createTimeFromRehydration,
};
