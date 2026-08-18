/**
 * POST /api/engagement — jalur tulis otomatis dari ekstensi ReSoEx.
 *
 * Mendukung dua mode:
 *   - Single: { platform, names, date, postedAt? }
 *   - Batch:  { posts: [{ platform, names, date, postedAt? }, ...] }
 *
 * Zero env var, idempotent, optimistic concurrency (precondition + retry).
 * Rate limit: in-memory per IP (60 req/menit).
 */

const API_VERSION = '1.0.0';

// ---- Rate limit (in-memory per IP, window 60 dtk) ----
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

const _rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 300_000);
if (_rateLimitCleanup.unref) _rateLimitCleanup.unref();

import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import {
  buildEngagementPatch,
  isValidDateStr,
  isValidPostedAt,
  mergePostedAt,
  isDateTooFarFuture,
  ADMIN_EMAILS,
  type ExtPlatform,
} from '../src/lib/engagement-api.js';
import type { MatchableEmployee } from '../src/lib/matching.js';

const PROJECT = firebaseConfig.projectId as string;
const DATABASE = firebaseConfig.firestoreDatabaseId as string;
const API_KEY = firebaseConfig.apiKey as string;

const fsBase = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;

/** Maksimal retry saat write gagal karena precondition conflict (lost-update guard). */
const MAX_WRITE_RETRIES = 2;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function json(res: unknown, status: number, data: unknown) {
  const r = res as { status: (s: number) => { json: (d: unknown) => void }; setHeader?: (k: string, v: string) => void };
  r.setHeader?.('Access-Control-Allow-Origin', '*');
  r.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
  r.setHeader?.('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  r.status(status).json(data);
}

function error(res: unknown, status: number, message: string) {
  json(res, status, { ok: false, error: message, version: API_VERSION });
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

async function isAdminUser(uid: string, email: string, idToken: string): Promise<boolean> {
  if (ADMIN_EMAILS.includes(email)) return true;
  const r = await fetch(`${fsBase}/admins/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return r.ok;
}

// ---- Data ----
async function fetchEmployees(idToken: string): Promise<MatchableEmployee[]> {
  const out: MatchableEmployee[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) qs.set('pageToken', pageToken);
    const r = await fetch(`${fsBase}/employees?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!r.ok) {
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

async function fetchEngagementDoc(idToken: string, date: string): Promise<{ doc: Record<string, unknown> | null; updateTime: string | null }> {
  const r = await fetch(`${fsBase}/dailyEngagement/${encodeURIComponent(date)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (r.status === 404) return { doc: null, updateTime: null };
  if (!r.ok) {
    throw Object.assign(new Error('Gagal membaca rekap harian.'), { status: 502 });
  }
  const data = (await r.json()) as {
    name?: string;
    fields?: Record<string, unknown>;
    updateTime?: string;
  };
  return {
    doc: decodeDoc({ name: data.name, fields: data.fields }),
    updateTime: data.updateTime || null,
  };
}

type WriteResult = { ok: boolean; conflict: boolean; message: string };

async function writeEngagement(
  idToken: string,
  date: string,
  patch: Record<string, unknown>,
  currentDocument?: { exists?: boolean; updateTime?: string },
): Promise<WriteResult> {
  const fields = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, enc(v)]));
  const updateMask = Object.keys(patch)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };

  const buildBody = (precondition?: { exists?: boolean; updateTime?: string }) => {
    const obj: Record<string, unknown> = { fields };
    const cp = precondition || currentDocument;
    if (cp) obj.currentDocument = cp;
    return JSON.stringify(obj);
  };

  let r = await fetch(`${fsBase}/dailyEngagement/${encodeURIComponent(date)}?${updateMask}`, {
    method: 'PATCH',
    headers,
    body: buildBody(),
  });

  if (r.status === 404) {
    // Dokumen belum ada → buat lewat POST (documentId = tanggal, exists:false).
    r = await fetch(`${fsBase}/dailyEngagement?documentId=${encodeURIComponent(date)}`, {
      method: 'POST',
      headers,
      body: buildBody({ exists: false }),
    });
  }

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    const isConflict =
      r.status === 409 ||
      text.includes('ALREADY_EXISTS') ||
      text.includes('ABORTED') ||
      text.includes('FAILED_PRECONDITION');
    return {
      ok: false,
      conflict: isConflict,
      message: `Gagal menyimpan rekap (${r.status}). ${text.slice(0, 200)}`,
    };
  }

  return { ok: true, conflict: false, message: '' };
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
      posts?: Array<{
        platform?: string;
        names?: unknown;
        date?: string;
        postedAt?: unknown;
      }>;
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
    const admin = await isAdminUser(user.uid, user.email, idToken);
    if (!admin) {
      error(res, 403, 'Akun ini bukan admin ReSo.');
      return;
    }

    // ---- Rate limit ----
    const ip =
      (r.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (r.headers?.['x-real-ip'] as string) ||
      'unknown';
    if (!checkRateLimit(ip)) {
      error(res, 429, 'Terlalu banyak permintaan. Coba lagi dalam satu menit.');
      return;
    }

    const employees = await fetchEmployees(idToken);

    // ---- Normalize: single → array (batch)
    const posts = Array.isArray(body.posts)
      ? body.posts
      : [{ platform, names, date, postedAt }];

    const results: Array<Record<string, unknown>> = [];

    for (const post of posts) {
      const p = post as {
        platform?: string;
        names?: unknown;
        date?: unknown;
        postedAt?: unknown;
      };

      // Validate each post
      if (p.postedAt !== undefined && !isValidPostedAt(p.postedAt)) {
        results.push({ ok: false, error: 'postedAt invalid', date: p.date, platform: p.platform });
        continue;
      }
      if (!isValidDateStr(p.date)) {
        results.push({ ok: false, error: 'date invalid', date: p.date, platform: p.platform });
        continue;
      }
      if (isDateTooFarFuture(p.date as string)) {
        results.push({ ok: false, error: 'tanggal terlalu jauh ke masa depan', date: p.date, platform: p.platform });
        continue;
      }
      if (p.platform !== 'facebook' && p.platform !== 'instagram' && p.platform !== 'tiktok') {
        results.push({ ok: false, error: 'platform harus facebook|instagram|tiktok', date: p.date, platform: p.platform });
        continue;
      }
      if (!Array.isArray(p.names) || !p.names.some((n: unknown) => typeof n === 'string' && (n as string).trim())) {
        results.push({ ok: false, error: 'names harus array minimal 1 nama', date: p.date, platform: p.platform });
        continue;
      }

      // Optimistic concurrency: baca doc → merge → tulis dengan precondition.
      let writeOk = false;
      let lastErr: { status?: number; message?: string } | null = null;

      for (let attempt = 0; attempt <= MAX_WRITE_RETRIES; attempt++) {
        try {
          const docInfo = await fetchEngagementDoc(idToken, p.date as string);
          const existing = docInfo.doc;
r
          const result = buildEngagementPatch(
            existing as Parameters<typeof buildEngagementPatch>[0],
            p.platform as ExtPlatform,
            p.names,
            employees,
            p.date as string,
          );
          if (!result) {
            results.push({ ok: false, error: 'nama tidak valid atau pegawai kosong', date: p.date, platform: p.platform });
            writeOk = true; // skip, bukan error
            break;
          }
r
          const nowIso = new Date().toISOString();
          result.patch.updatedAt = { __ts: nowIso };
          result.patch.autoFilledAt = { __ts: nowIso };
          result.patch.autoFilledCount = result.added;

          if (p.postedAt !== undefined) {
            result.patch.postedAt = mergePostedAt(existing?.postedAt, p.postedAt as string);
          }

          const currentDocument = existing
            ? { updateTime: docInfo.updateTime || undefined }
            : { exists: false };

          const writeResult = await writeEngagement(idToken, p.date as string, result.patch, currentDocument);

          if (writeResult.conflict && attempt < MAX_WRITE_RETRIES) continue;

          if (!writeResult.ok) {
            results.push({ ok: false, error: writeResult.message, date: p.date, platform: p.platform });
            writeOk = true; // error sudah di-push
            break;
          }

          results.push({
            ok: true,
            date: p.date,
            platform: p.platform,
            added: result.added,
            existing: result.existing,
            unmatched: result.unmatched,
            message: `${result.added} nama baru, ${result.existing} sudah ada.`,
          });
          writeOk = true;
          break;
        } catch (e) {
          lastErr = e as { status?: number; message?: string };
          if (attempt < MAX_WRITE_RETRIES) continue;
        }
      }

      if (!writeOk) {
        results.push({ ok: false, error: lastErr?.message || 'Gagal menyimpan', date: p.date, platform: p.platform });
      }
    }

    // Single mode: kembalikan flat (backwards compatible)
    if (!Array.isArray(body.posts)) {
      const first = results[0];
      if (first) {
        json(res, first.ok ? 200 : (first.error?.toString().includes('502') ? 502 : 400), {
          ok: first.ok,
          date: first.date,
          platform: first.platform,
          added: first.added,
          existing: first.existing,
          unmatched: first.unmatched,
          message: first.ok
            ? `Tersimpan ke rekap ${first.date} — ${first.added} nama baru, ${first.existing} sudah ada.`
            : first.error,
          version: API_VERSION,
        });
      } else {
        error(res, 400, 'Tidak ada data diproses.');
      }
      return;
    }

    // Batch mode
    json(res, 200, {
      ok: results.every((r) => r.ok),
      processed: results.length,
      results,
      version: API_VERSION,
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    error(res, err.status || 500, err.message || 'Terjadi kesalahan.');
  }
}
