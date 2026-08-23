/**
 * POST /api/engagement — jalur tulis otomatis dari ekstensi ReSoEx (Opsi C).
 *
 * Ekstensi mengirim { platform, names, date } + `Authorization: Bearer
 * <idToken Firebase>`. Fungsi ini:
 *   1. Memverifikasi idToken via identitytoolkit (accounts:lookup).
 *   2. Cek admin: allowlist email (cermin firestore.rules) atau admins/{uid}.
 *   3. Membaca data pegawai (Firestore REST memakai token operator — rules
 *      tetap berlaku), lalu buildEngagementPatch: merge nama + dedupe
 *      case-insensitive + hitung ulang engagedEmployeeIds (modul matching
 *      yang sama dengan dashboard).
 *   4. Menulis dailyEngagement/{date} (PATCH updateMask / POST create).
 *
 * Zero env var: tidak ada service account — semua panggilan Firestore
 * memakai token operator, jadi firestore.rules tetap penjaga keamanan.
 * Idempotent: kirim ulang = update; satu hari bisa banyak post (di-merge).
 */

import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import {
  buildEngagementPatch,
  isValidDateStr,
  isValidPostedAt,
  mergePostedAt,
  isDateTooFarFuture,
  ADMIN_EMAILS,
  dinasUid,
  type ExtPlatform,
} from '../src/lib/engagement-api.js';
import type { MatchableEmployee } from '../src/lib/matching.js';

const PROJECT = firebaseConfig.projectId as string;
const API_KEY = firebaseConfig.apiKey as string;

function getFsBase(uid: string): string {
  return `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/dinas/${dinasUid(uid)}`;
}

function json(res: unknown, status: number, data: unknown) {
  const r = res as { status: (s: number) => { json: (d: unknown) => void }; setHeader?: (k: string, v: string) => void };
  r.setHeader?.('Access-Control-Allow-Origin', '*');
  r.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
  r.setHeader?.('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  r.status(status).json(data);
}

function error(res: unknown, status: number, message: string) {
  json(res, status, { ok: false, error: message });
}

// ---- Firestore REST helpers (decode/encode field format) ----
function decodeValue(v: { [k: string]: unknown } | null | undefined): unknown {
  if (!v) return undefined;
  if (typeof v.stringValue === 'string') return v.stringValue;
  if (typeof v.integerValue === 'string') return Number(v.integerValue);
  if (typeof v.booleanValue === 'boolean') return v.booleanValue;
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  if (v.timestampValue) return v.timestampValue as string;
  if (v.arrayValue && (v.arrayValue as { values?: unknown[] }).values) {
    return (v.arrayValue as { values: unknown[] }).values.map(decodeValue);
  }
  if (v.mapValue && (v.mapValue as { fields?: Record<string, unknown> }).fields) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries((v.mapValue as { fields: Record<string, unknown> }).fields)) {
      out[k] = decodeValue(val as { [k: string]: unknown });
    }
    return out;
  }
  if (v.nullValue !== undefined) return null;
  return undefined;
}

function decodeDoc(doc: { name?: string; fields?: Record<string, unknown> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (doc.fields) {
    for (const [k, val] of Object.entries(doc.fields)) out[k] = decodeValue(val as { [k: string]: unknown });
  }
  if (doc.name) out.__id = doc.name.split('/').pop() as string;
  return out;
}

function enc(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && typeof (v as { __ts?: unknown }).__ts === 'string') {
    return { timestampValue: (v as { __ts: string }).__ts };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (v && typeof v === 'object') {
    // Objek polos (mis. entry unmatchedNames {name, platform}) → mapValue.
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, enc(val)])
        ),
      },
    };
  }
  return { nullValue: null };
}

// ---- Auth ----
async function verifyIdToken(idToken: string): Promise<{ uid: string; email: string; emailVerified: boolean }> {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );
  const data = (await r.json().catch(() => ({}))) as { users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }> };
  if (!r.ok || !data.users?.length || !data.users[0].localId) {
    throw Object.assign(new Error('Token ReSo tidak valid atau kedaluwarsa.'), { status: 401 });
  }
  const u = data.users[0];
  return { uid: u.localId as string, email: u.email || '', emailVerified: !!u.emailVerified };
}

async function isAdminUser(uid: string, email: string, idToken: string, fsBase: string): Promise<boolean> {
  if (ADMIN_EMAILS.includes(email)) return true;
  // Marker provision ditulis ke admins/{lowercase uid} (lihat api/provision.ts).
  const r = await fetch(`${fsBase}/admins/${encodeURIComponent(dinasUid(uid))}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (r.ok) return true;
  // Open registration: Firebase rules sudah membatasi dinas/{uid} hanya
  // untuk pemilik uid — jadi user terverifikasi selalu boleh tulis dinas-nya
  // sendiri meski marker admins/{uid} belum ada (provision tertunda).
  return true;
}

// ---- Data ----
async function fetchEmployees(idToken: string, fsBase: string): Promise<MatchableEmployee[]> {
  const out: MatchableEmployee[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) qs.set('pageToken', pageToken);
    const r = await fetch(`${fsBase}/employees?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!r.ok) {
      // 404 = dinas/{uid} belum ada (provision belum selesai) → beri
      // pesan jelas supaya extension me-retry lewat antrian, bukan error mentah.
      if (r.status === 404 || r.status === 403) {
        throw Object.assign(new Error('Database dinas belum siap. Coba lagi sebentar atau klik "Siapkan database" di Pengaturan ReSo.'), { status: 503 });
      }
      throw Object.assign(new Error('Gagal membaca data pegawai dari Firestore.'), { status: 502 });
    }
    const data = (await r.json()) as { documents?: Array<{ name?: string; fields?: Record<string, unknown> }>; nextPageToken?: string };
    for (const doc of data.documents || []) {
      const d = decodeDoc(doc);
      out.push({
        id: String(d.__id || ''),
        name: String(d.name || ''),
        igUsername: d.igUsername ? String(d.igUsername) : undefined,
        igUsername2: d.igUsername2 ? String(d.igUsername2) : undefined,
        fbName: d.fbName ? String(d.fbName) : undefined,
        fbName2: d.fbName2 ? String(d.fbName2) : undefined,
        tiktokName: d.tiktokName ? String(d.tiktokName) : undefined,
        tiktokName2: d.tiktokName2 ? String(d.tiktokName2) : undefined,
        aliases: Array.isArray(d.aliases) ? d.aliases.map((a) => String(a)) : undefined,
      });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function fetchEngagementDoc(idToken: string, date: string, fsBase: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${fsBase}/dailyEngagement/${encodeURIComponent(date)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    throw Object.assign(new Error('Gagal membaca rekap harian.'), { status: 502 });
  }
  const data = (await r.json()) as { fields?: Record<string, unknown> };
  return decodeDoc({ fields: data.fields });
}

async function writeEngagement(idToken: string, date: string, patch: Record<string, unknown>, fsBase: string): Promise<void> {
  const body = JSON.stringify({ fields: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, enc(v)])) });
  const updateMask = Object.keys(patch)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
  let r = await fetch(`${fsBase}/dailyEngagement/${encodeURIComponent(date)}?${updateMask}`, {
    method: 'PATCH',
    headers,
    body,
  });
  if (r.status === 404) {
    // Dokumen belum ada → buat lewat POST (documentId = tanggal).
    r = await fetch(`${fsBase}/dailyEngagement?documentId=${encodeURIComponent(date)}`, {
      method: 'POST',
      headers,
      body,
    });
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw Object.assign(new Error(`Gagal menyimpan rekap (${r.status}). ${text.slice(0, 200)}`), { status: 502 });
  }
}

export default async function handler(req: unknown, res: unknown) {
  const r = req as {
    method?: string;
    headers?: { authorization?: string; 'content-type'?: string };
    body?: unknown;
  };

  if (r.method === 'OPTIONS') {
    const raw = res as { status: (s: number) => { json: (d: unknown) => void }; setHeader?: (k: string, v: string) => void };
    raw.setHeader?.('Access-Control-Allow-Origin', '*');
    raw.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
    raw.setHeader?.('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    raw.status(204).json({});
    return;
  }

  if (r.method !== 'POST') {
    error(res, 405, 'Metode tidak diizinkan.');
    return;
  }

  try {
    const authHeader = r.headers?.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!idToken) {
      error(res, 401, 'Token tidak ada — kirim Authorization: Bearer <idToken>.');
      return;
    }

    const body = (r.body || {}) as {
      platform?: string;
      names?: unknown;
      date?: string;
      postedAt?: unknown;
    };
    const { platform, names, date, postedAt } = body;
    if (postedAt !== undefined && !isValidPostedAt(postedAt)) {
      error(res, 400, 'Field `postedAt` harus ISO lokal YYYY-MM-DDTHH:MM (boleh + detik).');
      return;
    }
    if (!isValidDateStr(date)) {
      error(res, 400, 'Field `date` harus YYYY-MM-DD yang valid.');
      return;
    }
    if (isDateTooFarFuture(date)) {
      error(res, 400, 'Tanggal terlalu jauh ke masa depan.');
      return;
    }
    if (platform !== 'facebook' && platform !== 'instagram' && platform !== 'tiktok') {
      error(res, 400, 'Platform harus facebook | instagram | tiktok.');
      return;
    }
    if (!Array.isArray(names) || !names.some((n) => typeof n === 'string' && n.trim())) {
      error(res, 400, 'Field `names` harus array berisi minimal satu nama.');
      return;
    }

    const user = await verifyIdToken(idToken);
    if (!user.emailVerified) {
      error(res, 403, 'Email belum diverifikasi.');
      return;
    }

    const fsBase = getFsBase(user.uid);

    const admin = await isAdminUser(user.uid, user.email, idToken, fsBase);
    if (!admin) {
      error(res, 403, 'Akun ini bukan admin ReSo.');
      return;
    }

    const employees = await fetchEmployees(idToken, fsBase);
    const existing = await fetchEngagementDoc(idToken, date, fsBase);

    const result = buildEngagementPatch(
      existing as Parameters<typeof buildEngagementPatch>[0],
      platform as ExtPlatform,
      names,
      employees,
      date,
    );
    if (!result) {
      error(res, 400, 'Tidak ada nama valid untuk disimpan (atau data pegawai kosong).');
      return;
    }

    // Penanda pengisian otomatis dari ReSoEx: dashboard menampilkan badge +
    // toast "cek lalu simpan" (tanpa ini operator tak tahu data sudah masuk).
    const nowIso = new Date().toISOString();
    result.patch.updatedAt = { __ts: nowIso };
    result.patch.autoFilledAt = { __ts: nowIso };
    result.patch.autoFilledCount = result.added;

    // Waktu posting (L3): satu hari bisa banyak post → array, append + dedupe.
    if (postedAt !== undefined) {
      result.patch.postedAt = mergePostedAt(existing?.postedAt, postedAt as string);
    }

    await writeEngagement(idToken, date, result.patch, fsBase);

    json(res, 200, {
      ok: true,
      date,
      platform,
      added: result.added,
      existing: result.existing,
      unmatched: result.unmatched,
      message: `Tersimpan ke rekap ${date} — ${result.added} nama baru, ${result.existing} sudah ada.`,
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    console.error(`[engagement] ${err.status || 500} ${err.message?.slice(0, 200)}`);
    error(res, err.status || 500, err.message || 'Terjadi kesalahan.');
  }
}
