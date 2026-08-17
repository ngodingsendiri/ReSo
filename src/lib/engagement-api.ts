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
  mergeUniqueLines,
  type EngagementPlatform,
} from './matching';

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
  [key: string]: unknown;
}

export interface BuildEngagementPatchResult {
  /** Field siap-tulis (Firestore plain): date + rawText + engagedEmployeeIds. */
  patch: Record<string, unknown>;
  /** Jumlah nama yang benar-benar baru (setelah dedupe case-insensitive). */
  added: number;
  /** Jumlah nama yang sudah ada di rekap tanggal itu. */
  existing: number;
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

  // Hitung added/existing: nama ekstraksi yang sudah ada (case-insensitive)
  // di teks sebelum merge = duplikat.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const beforeLines = before
    .split(/\n+/)
    .map(norm)
    .filter(Boolean);
  const added = clean.filter((n) => !beforeLines.includes(norm(n))).length;
  const existingCount = clean.length - added;

  return {
    patch: {
      date,
      [field.raw]: merged,
      [field.ids]: ids,
    },
    added,
    existing: existingCount,
  };
}

/** Validasi tanggal YYYY-MM-DD kalender nyata. */
export function isValidDateStr(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Tolak tanggal yang terlalu jauh ke masa depan (toleransi +1 hari WIB). */
export function isDateTooFarFuture(v: string, now = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  const [y, m, d] = today.split('-').map(Number);
  const max = new Date(Date.UTC(y, m - 1, d + 1));
  const [vy, vm, vd] = v.split('-').map(Number);
  return new Date(Date.UTC(vy, vm - 1, vd)) > max;
}

/** Cerminan allowlist email admin dari firestore.rules (isAuthorized). */
export const ADMIN_EMAILS: string[] = [
  'ngerjaindiri@gmail.com',
  'sipencil@gmail.com',
  'abiemputra.asn@gmail.com',
];
