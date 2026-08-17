/**
 * Jembatan ekstensi ReSoEx → ReSo (Opsi A v1).
 *
 * ReSoEx mengekstrak nama komentator di halaman FB/TikTok/IG lalu mengirimnya
 * ke content script di domain ReSo; aplikasi menerima CustomEvent
 * `RESO_FILL_EVENT` (detail = { platform, names }) dan mengisi textarea
 * platform yang bersangkutan pada tanggal yang sedang dipilih di dashboard
 * (default hari ini). Operator tetap review lalu simpan — alur rekap harian
 * tidak berubah.
 *
 * Fungsi di file ini murni (tanpa React/Firebase) agar mudah diuji, dipakai
 * oleh EngagementDashboard. Kontrak payload platform mengikuti nama platform
 * ekstensi (facebook/instagram/tiktok), dipetakan ke kode field rekap
 * (fb/ig/tiktok) yang dipakai matching.ts.
 */

import { parseLocalISODate } from './date';

export const RESO_FILL_EVENT = 'reso:fill-engagement';

export type ResoPlatformCode = 'ig' | 'fb' | 'tiktok';

export interface ResoFillPayload {
  platform?: string;
  names?: unknown;
  /** Lapis 2 — saran tanggal post (deteksi umur post best-effort di ekstensi). */
  suggestedDate?: string;
  /** Label saran (mis. "Kemarin", "10 Agustus") untuk ditampilkan. */
  label?: string;
}

export interface ResoRawInputs {
  igRawInput: string;
  fbRawInput: string;
  tiktokRawInput: string;
}

/** Nama platform ekstensi → kode field rekap ReSo (fb/ig/tiktok). */
export function platformToCode(platform: string | null | undefined): ResoPlatformCode | null {
  if (platform === 'facebook') return 'fb';
  if (platform === 'instagram') return 'ig';
  if (platform === 'tiktok') return 'tiktok';
  return null;
}

/**
 * Hitung patch textarea dari payload ekstensi. Mengembalikan null jika
 * payload tidak valid (platform tak dikenal / tidak ada nama), sehingga
 * pemanggil cukup: `const patch = buildFillPatch(state, detail); if (patch) apply(patch)`.
 * Nama digabung satu per baris — format yang sama dengan paste manual
 * (matching.ts memecah pada [\n,;]+).
 */
export function buildFillPatch(
  state: ResoRawInputs,
  payload: ResoFillPayload | null | undefined
): ResoRawInputs | null {
  if (!payload || typeof payload !== 'object') return null;
  const code = platformToCode(payload.platform);
  if (!code) return null;
  if (!Array.isArray(payload.names)) return null;
  const text = (payload.names as unknown[])
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    .map((n) => n.trim())
    .join('\n');
  if (!text) return null;
  const patch: ResoRawInputs = { ...state };
  if (code === 'ig') patch.igRawInput = text;
  else if (code === 'fb') patch.fbRawInput = text;
  else patch.tiktokRawInput = text;
  return patch;
}

/** Validasi YYYY-MM-DD kalender nyata (bukan sekadar bentuk). */
function isValidISODate(v: string | null | undefined): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const dt = parseLocalISODate(v);
  return !Number.isNaN(dt.getTime());
}

export interface ResoFillDecision {
  /**
   * - `none`    — payload tidak valid, abaikan.
   * - `apply`   — isi langsung ke tanggal aktif (tanpa saran / saran = aktif).
   * - `confirm` — saran tanggal berbeda: tampilkan konfirmasi sekali klik
   *               (pindah ke tanggal saran ATAU isi di tanggal aktif).
   */
  action: 'none' | 'apply' | 'confirm';
  patch?: ResoRawInputs;
  targetDate?: string;
  label?: string;
}

/**
 * Keputusan pengisian textarea dari payload ekstensi. Lapis 2: `suggestedDate`
 * (deteksi umur post best-effort) memicu `confirm` saat berbeda dari tanggal
 * aktif — tanggal rekap tetap keputusan operator, bukan tebakan ekstensi.
 */
export function decideResoFill(
  selectedDate: string,
  state: ResoRawInputs,
  payload: ResoFillPayload | null | undefined
): ResoFillDecision {
  const patch = buildFillPatch(state, payload);
  if (!patch) return { action: 'none' };
  const suggested = payload?.suggestedDate;
  if (!isValidISODate(suggested) || suggested === selectedDate) {
    return { action: 'apply', patch };
  }
  return {
    action: 'confirm',
    patch,
    targetDate: suggested,
    label:
      typeof payload?.label === 'string' && payload.label.trim()
        ? payload.label.trim().slice(0, 60)
        : undefined,
  };
}
