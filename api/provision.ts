/**
 * POST /api/provision — bootstrap dinas (single-database, open registration).
 *
 * Model baru: 1 database `(default)`, pemisahan dinas via subcollection
 * `dinas/{uid}/...`. Provision hanya: verifikasi idToken → tulis
 * `dinas/{uid}/admins/{uid}` sebagai marker (rules mengizinkan karena
 * `request.auth.uid == dinasUid`). Tidak perlu service account / Admin SDK.
 */

import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

const PROJECT = firebaseConfig.projectId as string;
const API_KEY = firebaseConfig.apiKey as string;

function json(res: unknown, status: number, data: unknown) {
  const r = res as { status: (s: number) => { json: (d: unknown) => void }; setHeader?: (k: string, v: string) => void };
  r.setHeader?.('Access-Control-Allow-Origin', '*');
  r.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
  r.setHeader?.('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  r.status(status).json(data);
}

// ---- Verifikasi idToken ----
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

export default async function handler(req: unknown, res: unknown) {
  const r = req as { method?: string; headers?: { authorization?: string }; body?: unknown };

  if (r.method === 'OPTIONS') {
    const raw = res as { status: (s: number) => { json: (d: unknown) => void }; setHeader?: (k: string, v: string) => void };
    raw.setHeader?.('Access-Control-Allow-Origin', '*');
    raw.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
    raw.setHeader?.('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    raw.status(204).json({});
    return;
  }

  if (r.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Metode tidak diizinkan.' });
    return;
  }

  try {
    const authHeader = r.headers?.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!idToken) {
      json(res, 401, { ok: false, error: 'Token tidak ada.' });
      return;
    }

    const user = await verifyIdToken(idToken);
    if (!user.emailVerified) {
      json(res, 403, { ok: false, error: 'Email belum diverifikasi.' });
      return;
    }

    const u = user.uid.toLowerCase();
    const markerUrl =
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/dinas/${u}/admins/${u}`;
    const markerBody = {
      fields: {
        email: { stringValue: user.email },
        name: { stringValue: user.email },
        addedAt: { timestampValue: new Date().toISOString() },
      },
    };

    // Tulis marker admins/{uid} — rules mengizinkan karena request.auth.uid == dinasUid.
    const marker = await fetch(markerUrl, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(markerBody),
    });

    if (!marker.ok) {
      const text = await marker.text().catch(() => '');
      console.log(`[provision] marker write failed for ${u}: ${text.slice(0, 200)}`);
    }

    json(res, 200, {
      ok: true,
      uid: user.uid,
      databaseId: '(default)',
      message: 'Dinas siap digunakan.',
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    json(res, err.status || 500, { ok: false, error: err.message || 'Terjadi kesalahan.' });
  }
}