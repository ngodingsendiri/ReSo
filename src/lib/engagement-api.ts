/**
 * Engagement API — pure logic untuk jalur tulis ekstensi (Opsi C).
 *
 * Ekstensi ReSoEx mengirim {platform, names, date} ke /api/engagement;
 * fungsi di sini menggabungkan nama hasil ekstraksi ke dokumen rekap
 * harian (`dailyEngagement/{date}`) dengan dedupe case-insensitive, lalu
 * menghitung ulang `engagedEmployeeIds` memakai modul matching yang sama
 * dengan dashboard (single source of truth). Idempotent: diulang = update,
 * dan satu hari bisa menampung banyak post (setiap kirim di-merge).
 */

import {
  matchEmployeesToEngagement,
  matchEngagementDetail,
  mergeUniqueLines,
  type EngagementPlatform,
} from './matching.js';

/**
 * KONVENSI PATH DINAS — SATU-SATUNYA sumber kebenaran untuk segmen uid di
 * subtree `dinas/<uid>/...`. UID Firebase Auth bisa berisi huruf campur
 * (mis. `eeWzyza6xvcBKcmucxMidMBTmOw1`); subtree dinas SELALU ditulis dengan
 * huruf kecil. JANGAN pernah baca/tulis `dinas/{uid}` tanpa lewat helper ini —
 * beda case antara jalur tulis & baca = data terbelah jadi 2 subtree
 * (bug `dinas/{raw}` vs `dinas/{lowercase}` yang pernah bikin rekap "hilang").
 *
 * Dipakai konsisten di: client (dinasCollection/dinasDoc), API Vercel
 * (api/engagement.ts, api/provision.ts), dan firestore.rules
 * (isAllowedDinas membandingkan `uid.lower()`).
 */
export function dinasUid(uid: string): string {
  return String(uid || '').toLowerCase();
}

/** Platform dari sisi ekstensi (popup ReSoEx). */
export type ExtPlatform = 'facebook' | 'instagram' | 'tiktok';

export const EXT_PLATFORMS: ExtPlatform[] = ['facebook', 'instagram', 'tiktok'];

export const PLATFORM_FIELD: Record<ExtPlatform, { raw: string; ids: string }> = {
  facebook: { raw: 'fbRawText', ids: 'fbEngagedEmployeeIds' },
  instagram: { raw: 'igRawText', ids: 'igEngagedEmployeeIds' },
  tiktok: { raw: 'tiktokRawText', ids: 'tiktokEngagedEmployeeIds' },
};

export const PLATFORM_CODE: Record<ExtPlatform, EngagementPlatform> = {
  facebook: 'fb',
  instagram: 'ig',
  tiktok: 'tiktok',
};

export interface EngagementDocLike {
  date?: string;
  igRawText?: string;
  fbRawText?: string;
  tiktokRawText?: string;
  igEngagedEmployeeIds?: string[];
  fbEngagedEmployeeIds?: string[];
  tiktokEngagedEmployeeIds?: string[];
  autoFilledAt?: unknown;
  verifiedAt?: unknown;
  unmatchedNames?: unknown;
  postedAt?: unknown;
  [key: string]: unknown;
}

export interface BuildEngagementPatchResult {
  /** Field siap-tulis (Firestore plain): date + rawText + engagedEmployeeIds. */
  patch: Record<string, unknown>;
  /** Jumlah nama yang benar-benar baru (setelah dedupe case-insensitive). */
  added: number;
  /** Jumlah nama yang sudah ada di rekap tanggal itu. */
  existing: number;
  /** Jumlah nama platform ini yang tidak cocok dengan pegawai mana pun. */
  unmatched: number;
}

/**
 * Gabungkan nama ekstraksi ke dokumen rekap harian dan hitung ulang id
 * pegawai yang ter-match. Mengembalikan null jika tidak ada nama valid,
 * platform tak dikenal, atau daftar pegawai kosong.
 */
export function buildEngagementPatch(
  existing: EngagementDocLike | null,
  platform: ExtPlatform,
  names: unknown,
  employees: Parameters<typeof matchEmployeesToEngagement>[1] | null | undefined,
  date: string,
): BuildEngagementPatchResult | null {
  const field = PLATFORM_FIELD[platform];
  if (!field) return null;

  const clean = Array.isArray(names)
    ? names
        .filter((n) => typeof n === 'string' && n.trim())
        .map((n) => n.trim())
    : [];
  if (!clean.length) return null;
  if (!Array.isArray(employees) || !employees.length) return null;

  const before = typeof existing?.[field.raw] === 'string' ? (existing[field.raw] as string) : '';
  const merged = mergeUniqueLines(before, clean);

  const ids = matchEmployeesToEngagement(merged, employees, PLATFORM_CODE[platform]);

  // Antrian "nama belum terpetakan": baris di merged yang tidak cocok dengan
  // pegawai mana pun. Entry platform LAIN di dokumen dipertahankan; entry
  // platform ini dihitung ulang dari merged — jadi nama yang sudah dipetakan
  // admin (lewat alias) otomatis hilang dari antrian pada kiriman berikutnya.
  const detail = matchEngagementDetail(merged, employees, PLATFORM_CODE[platform]);
  const existingUnmatched = Array.isArray(existing?.unmatchedNames)
    ? (existing.unmatchedNames as Array<{ name?: unknown; platform?: unknown }>)
    : [];
  const seen = new Set<string>();
  const unmatchedNames: Array<{ name: string; platform: string }> = [];
  const pushUnmatched = (name: unknown, plat: unknown) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const key = `${name.trim().toLowerCase()}|${plat}`;
    if (seen.has(key)) return;
    seen.add(key);
    unmatchedNames.push({ name: name.trim(), platform: String(plat) });
  };
  for (const u of existingUnmatched) {
    if (u && u.platform !== PLATFORM_CODE[platform]) pushUnmatched(u.name, u.platform);
  }
  for (const name of detail.unmatched) pushUnmatched(name, PLATFORM_CODE[platform]);

  // Hitung added/existing KONSISTEN dengan mergeUniqueLines: pemisah [\n,;]+,
  // key trim()+toLowerCase(). Sebelumnya split(/\n+/) + normalisasi whitespace
  // meleset: existing ber-koma/titik-koma → overcount (dianggap baru padahal
  // merge mendedupe), spasi ganda → undercount (dianggap duplikat padahal
  // merge menambah baris).
  const beforeKeys = new Set(
    before
      .split(/[\n,;]+/)
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean)
  );
  const added = clean.filter((n) => !beforeKeys.has(n.trim().toLowerCase())).length;
  const existingCount = clean.length - added;

  return {
    patch: {
      date,
      [field.raw]: merged,
      [field.ids]: ids,
      unmatchedNames,
    },
    added,
    existing: existingCount,
    unmatched: detail.unmatched.length,
  };
}

/** Validasi tanggal YYYY-MM-DD kalender nyata. */
export function isValidDateStr(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Validasi waktu posting ISO lokal "YYYY-MM-DDTHH:MM" (boleh + detik):
 * tanggal harus kalender nyata, jam 00-23, menit 00-59.
 */
export function isValidPostedAt(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return false;
  if (!isValidDateStr(m[1])) return false;
  const h = Number(m[2]);
  const min = Number(m[3]);
  return h <= 23 && min <= 59;
}

/**
 * Tambahkan waktu posting ke array existing (dedupe, urut kemunculan tetap).
 * Idempotent: kirim ulang nilai yang sama tidak menduplikasi entry.
 */
export function mergePostedAt(existing: unknown, value: string): string[] {
  const base = Array.isArray(existing)
    ? existing.filter((t): t is string => typeof t === 'string' && isValidPostedAt(t))
    : [];
  if (base.includes(value)) return base;
  return [...base, value];
}

/** Tolak tanggal yang terlalu jauh ke masa depan (toleransi +1 hari WIB). */
export function isDateTooFarFuture(v: string, now = new Date()): boolean {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const [y, m, d] = today.split('-').map(Number);
  const max = new Date(Date.UTC(y, m - 1, d + 1));
  const [vy, vm, vd] = v.split('-').map(Number);
  return new Date(Date.UTC(vy, vm - 1, vd)) > max;
}

/**
 * Daftar tanggal (urut naik) yang rekapnya diisi otomatis ReSoEx
 * (autoFilledAt ada) tapi belum diverifikasi operator (verifiedAt belum).
 * Dipakai dashboard untuk tombol "Terima semua rekap otomatis".
 * Parameter struktural minimal supaya bisa menerima DailyEngagement dari
 * dashboard (tanpa index signature) maupun EngagementDocLike di sisi API.
 */
export function collectUnverifiedAutoFilled(
  docs:
    | Record<string, { autoFilledAt?: unknown; verifiedAt?: unknown } | undefined>
    | null
    | undefined
): string[] {
  if (!docs) return [];
  return Object.entries(docs)
    .filter(([, d]) => !!d?.autoFilledAt && !d?.verifiedAt)
    .map(([date]) => date)
    .sort();
}

/** Cerminan allowlist email admin dari firestore.rules (isAuthorized). */
export const ADMIN_EMAILS: string[] = [
  'ngerjaindiri@gmail.com',
  'sipencil@gmail.com',
  'abiemputra.asn@gmail.com',
];
