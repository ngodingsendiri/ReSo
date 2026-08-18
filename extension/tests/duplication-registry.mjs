/**
 * Registri parity helper lintas platform — SATU SUMBER data yang dipakai:
 * - tests/ui-consistency.test.mjs     (PARITY helper plumbing: salinan identik)
 * - tests/duplication-audit.test.mjs  (pendeteksi duplikasi baru yang belum
 *   terdaftar — gagal kalau ada fungsi baru yang disalin antar file)
 *
 * Aturan: fungsi yang diduplikasi antar file TANPA blok marker (NORMALIZE /
 * DONEMSG / PARSERS / PANELTOOLS / FBURLS sudah di-awasi marker test) WAJIB
 * didaftarkan di PARITY_REGISTRY — salinannya harus identik (whitespace-
 * normalized). Pair 2-file = alur platform memang berbeda (FB: template
 * sintetik dari URL, render bernama renderUi, tanpa NEED_TEMPLATE) — hanya
 * pasangan yang benar-benar identik yang didaftarkan.
 */

export const PARITY_REGISTRY = {
  // Catatan: fbTargetLabel/igTargetLabel/resolveTheme/svgIcon TIDAK lagi di
  // registry — kini satu sumber di shared.js (dual-mode classic/module),
  // content script memakainya via globalThis.RS_SHARED (tanpa salinan inline).
  // engine (inject): plumbing pesan + kontrol run
  post: ["inject-fb.js", "inject-tiktok.js", "inject-ig.js"],
  snapshot: ["inject-fb.js", "inject-tiktok.js", "inject-ig.js"],
  stopExtract: ["inject-fb.js", "inject-tiktok.js", "inject-ig.js"],
  sleepWhile: ["inject-fb.js", "inject-tiktok.js", "inject-ig.js"],
  setTemplate: ["inject-tiktok.js", "inject-ig.js"],
  // content: send/engine/panel plumbing
  sendBg: ["content-fb.js", "content-tiktok.js", "content-ig.js"],
  engineCmd: ["content-fb.js", "content-tiktok.js", "content-ig.js"],
  visible: ["content-fb.js", "content-tiktok.js", "content-ig.js"],
  makeRunId: ["content-fb.js", "content-tiktok.js", "content-ig.js"],
  isCurrentRun: ["content-fb.js", "content-tiktok.js", "content-ig.js"],
  waitEngineReady: ["content-fb.js", "content-tiktok.js", "content-ig.js"],
  acceptFromInject: ["content-tiktok.js", "content-ig.js"], // FB: inject-fb tak pernah post NEED_TEMPLATE
  // applyMode: mode ekstensi ON/OFF dari popup (RSX_ENABLED_KEY) — dipakai
  // ketiga panel, identik (popup switch satu-satunya kontrol mode).
  applyMode: ["content-fb.js", "content-tiktok.js", "content-ig.js"],
};

/**
 * Naming parity — fungsi dengan nama DAN tanda tangan yang sama wajib ada di
 * semua file, tapi body sengaja berbeda per platform. Berbeda dari
 * PARITY_REGISTRY (salinan harus identik): di sini hanya penamaan yang dikunci
 * — rename di satu file langsung membuat test merah, sedangkan body per
 * platform bebas (stop reason platform memang beda).
 */
export const PARITY_NAMES = {
  // mapDone: FB punya complete/idle eksplisit, IG blocked/checkpoint, TT
  // no_video — body beda karena stop reason platform beda, nama seragam.
  mapDone: ["content-fb.js", "content-tiktok.js", "content-ig.js"],
};

/**
 * Duplikasi identik yang sengaja TIDAK didaftarkan (kebetulan sama tapi
 * konsep terpisah / pair yang sengaja dibiarkan). Kosong saat ini — semua
 * duplikat identik sudah terdaftar atau di dalam blok marker. Tambah ke sini
 * hanya bila ada alasan tertulis (why).
 */
export const PARITY_EXCLUSIONS = [
  // { name: "namaFungsi", why: "alasan" },
];

/**
 * Ekstrak deklarasi `function name(`..`}` (brace-balanced), LEWATI default
 * value ber-brace (`payload = {}`): cari `) {` penutup parameter dulu, baru
 * brace badan fungsi. Mengembalikan null bila tidak ditemukan (pemanggil
 * menentukan apakah itu error — test parity meng-assert, audit melewatinya).
 */
export function extractFnBalanced(src, name) {
  const idx = src.indexOf(`function ${name}(`);
  if (idx < 0) return null;
  let paramsEnd = src.indexOf(") {", idx);
  if (paramsEnd < 0) paramsEnd = src.indexOf("){", idx);
  if (paramsEnd < 0) return null;
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
  if (depth !== 0) return null;
  return src.slice(idx, i + 1);
}

/**
 * Span blok marker (BEGIN-RESO-<K> .. END-RESO-<K>) sebagai [start, end)
 * offset karakter — untuk audit duplikasi: fungsi di dalam marker sudah
 * di-awasi marker parity test, tidak perlu didaftarkan di registry.
 */
export function findMarkerSpans(src) {
  const spans = [];
  const re = /BEGIN-RESO-(\w+)/g;
  let m;
  while ((m = re.exec(src))) {
    const kind = m[1];
    const endRe = new RegExp(`END-RESO-${kind}`);
    const after = src.slice(m.index + m[0].length);
    const endMatch = endRe.exec(after);
    if (!endMatch) continue;
    spans.push([m.index, m.index + m[0].length + endMatch.index + endMatch[0].length]);
  }
  return spans;
}
