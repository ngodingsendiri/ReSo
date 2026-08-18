/**
 * POST /api/token-refresh — auto-login extension tanpa dashboard.
 *
 * Extension menyimpan refreshToken di chrome.storage (didapat dari
 * token-handoff saat dashboard terbuka). Saat kirim data, extension
 * panggil endpoint ini untuk dapat idToken segar, lalu pakai idToken
 * untuk /api/engagement.
 *
 * Flow:
 *   extension → POST /api/token-refresh { refreshToken }
 *             → Firebase REST securetoken (rotate)
 *             → { idToken, refreshToken }
 *   extension → POST /api/engagement { ... } + Bearer idToken
 *
 * Zero env var: pakai API key Firebase client (publik).
 * Rate limit: in-memory per IP (perluas jika pakai multi-instance).
 */

import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

const API_KEY = firebaseConfig.apiKey as string;

const API_VERSION = '1.0.0';

// ---- Rate limit (in-memory per IP, window 60 dtk) ----
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20; // per menit per IP
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

// Bersihkan map tiap 5 menit supaya tidak memory leak
const _rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 300_000);
if (_rateLimitCleanup.unref) _rateLimitCleanup.unref();

// ---- Helpers ----
function json(res: unknown, status: number, data: unknown) {
  const r = res as {
    status: (s: number) => { json: (d: unknown) => void };
    setHeader?: (k: string, v: string) => void;
  };
  r.setHeader?.('Access-Control-Allow-Origin', '*');
  r.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
  r.setHeader?.('Access-Control-Allow-Headers', 'Content-Type');
  r.status(status).json(data);
}

function error(res: unknown, status: number, message: string) {
  json(res, status, { ok: false, error: message, version: API_VERSION });
}

// ---- Firebase REST: rotate refresh token ----
async function rotateRefreshToken(
  refreshToken: string,
): Promise<{ idToken: string; refreshToken: string } | null> {
  if (!refreshToken) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  let r: Response;
  try {
    r = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );
  } catch {
    return null;
  }
  const data = (await r.json().catch(() => ({}))) as {
    id_token?: unknown;
    refresh_token?: unknown;
  };
  if (!r.ok || typeof data.id_token !== 'string' || !data.id_token) return null;
  return {
    idToken: data.id_token,
    refreshToken:
      typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : refreshToken,
  };
}

// ---- Handler ----
export default async function handler(req: unknown, res: unknown) {
  const r = req as {
    method?: string;
    headers?: Record<string, string | undefined>;
    body?: unknown;
  };

  // CORS preflight
  if (r.method === 'OPTIONS') {
    const raw = res as {
      status: (s: number) => { json: (d: unknown) => void };
      setHeader?: (k: string, v: string) => void;
    };
    raw.setHeader?.('Access-Control-Allow-Origin', '*');
    raw.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
    raw.setHeader?.('Access-Control-Allow-Headers', 'Content-Type');
    raw.status(204).json({});
    return;
  }

  if (r.method !== 'POST') {
    error(res, 405, 'Metode tidak diizinkan.');
    return;
  }

  // Rate limit
  const ip =
    (r.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (r.headers?.['x-real-ip'] as string) ||
    'unknown';
  if (!checkRateLimit(ip)) {
    error(res, 429, 'Terlalu banyak permintaan. Coba lagi dalam satu menit.');
    return;
  }

  try {
    const body = (r.body || {}) as { refreshToken?: unknown };

    if (typeof body.refreshToken !== 'string' || !body.refreshToken.trim()) {
      error(res, 400, 'Field `refreshToken` wajib diisi (string).');
      return;
    }

    const result = await rotateRefreshToken(body.refreshToken.trim());

    if (!result) {
      error(res, 401, 'Refresh token tidak valid atau kedaluwarsa. Login ulang di dashboard ReSo.');
      return;
    }

    json(res, 200, {
      ok: true,
      idToken: result.idToken,
      refreshToken: result.refreshToken,
      version: API_VERSION,
      message: 'Token berhasil diperbarui.',
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    error(res, err.status || 500, err.message || 'Terjadi kesalahan.');
  }
}
