/**
 * POST /api/provision — bootstrap database per dinas (multi-tenant).
 *
 * Dipanggil dashboard saat login pertama user: memastikan database `db-<uid>`
 * ada + menulis `admins/{uid}` (user adalah admin database-nya sendiri).
 *
 * Membutuhkan service account di env var `GOOGLE_SERVICE_ACCOUNT` (JSON).
 * Tanpa itu endpoint tetap hidup: verifikasi token tetap jalan, dan database
 * dibuat manual di Firebase Console (pesan error yang jelas).
 *
 * Alur: verifikasi idToken → cek database ada → buat bila belum → tulis admins/{uid}.
 * Semua panggilan Firestore memakai token operator (rules tetap penjaga).
 */

import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
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

// ---- Verifikasi idToken (identitytoolkit accounts:lookup) ----
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

// ---- JWT RS256 sign (tanpa dependency tambahan) ----
function signJwt(header: object, payload: object, privateKeyPem: string): string {
  const enc = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(data), privateKeyPem);
  return `${data}.${sig.toString('base64url')}`;
}

// ---- Dapatkan access token dari service account (OAuth2 JWT flow) ----
async function getAccessToken(sa: {
  client_email: string;
  private_key: string;
  token_uri: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const assertion = signJwt(header, claims, sa.private_key);
  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { access_token?: string };
  if (!r.ok || !data.access_token) {
    throw Object.assign(new Error('Gagal mendapatkan access token service account.'), { status: 502 });
  }
  return data.access_token;
}

async function dbExists(accessToken: string, dbId: string): Promise<boolean> {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${encodeURIComponent(dbId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return r.ok;
}

async function createDb(accessToken: string, dbId: string): Promise<void> {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases?databaseId=${encodeURIComponent(dbId)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `projects/${PROJECT}/databases/${dbId}`,
        type: 'FIRESTORE_NATIVE',
        locationId: 'asia-southeast2',
      }),
    },
  );
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw Object.assign(new Error(`Gagal membuat database: ${text.slice(0, 200)}`), { status: 502 });
  }
}

async function writeAdmin(dbId: string, uid: string, email: string): Promise<void> {
  // Pakai Admin SDK Firestore (bypass rules) supaya bisa menulis admins/{uid}
  // pada database yang baru dibuat — bootstrap admin untuk user itu.
  const adminFirestore = new Firestore({
    projectId: PROJECT,
    credentials: {
      client_email: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT as string).client_email,
      private_key: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT as string).private_key,
    },
    databaseId: dbId,
  });
  try {
    await adminFirestore.doc(`admins/${uid}`).set(
      {
        email,
        name: email,
        addedAt: new Date(),
      },
      { merge: true },
    );
  } finally {
    adminFirestore.terminate().catch(() => {});
  }
}

// ===== Rules keamanan (cermin firestore.rules) — dipakai saat membuat database
// baru supaya db-<uid> langsung terproteksi (default deny-all + admin via
// admins/{uid} + bootstrap allowlist). JAGA SINKRON dengan firestore.rules.
const RULES_SOURCE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
    function isSignedIn() {
      return request.auth != null && request.auth.token.email_verified == true;
    }
    function isAuthorized() {
      let allowedEmails = [
        'ngerjaindiri@gmail.com',
        'sipencil@gmail.com',
        'abiemputra.asn@gmail.com'
      ];
      return isSignedIn() && (
        request.auth.token.email in allowedEmails ||
        exists(/databases/$(database)/documents/admins/$(request.auth.uid))
      );
    }
    function isAdmin() { return isAuthorized(); }
    function isValidId(id) {
      return id is string && id.size() > 0 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$');
    }
    function incoming() { return request.resource.data; }
    function optionalString(data, key, maxLen) {
      return !(key in data) || (data[key] is string && data[key].size() <= maxLen);
    }
    function optionalStringList(data, key, maxItems) {
      return !(key in data) || (data[key] is list && data[key].size() <= maxItems);
    }
    function optionalIdList(data, key) {
      return !(key in data) || (data[key] is list && data[key].size() <= 500);
    }
    function isValidUser(data) {
      return (!('role' in data) || (data.role is string && data.role in ['user', 'admin']));
    }
    function isValidEmployee(data) {
      return data.keys().hasAll(['name', 'nip']) &&
             data.name is string && data.name.size() > 0 && data.name.size() < 100 &&
             data.nip is string && data.nip.size() > 0 && data.nip.size() < 50 &&
             optionalString(data, 'bidang', 100) &&
             optionalString(data, 'igUsername', 50) &&
             optionalString(data, 'igUsername2', 50) &&
             optionalString(data, 'fbName', 100) &&
             optionalString(data, 'fbName2', 100) &&
             optionalString(data, 'tiktokName', 100) &&
             optionalString(data, 'tiktokName2', 100);
    }
    function isValidDailyEngagement(data) {
      return data.keys().hasAll(['date']) &&
             data.date is string && data.date.size() == 10 &&
             data.date.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$') &&
             optionalString(data, 'igRawText', 50000) &&
             optionalString(data, 'fbRawText', 50000) &&
             optionalString(data, 'tiktokRawText', 50000) &&
             optionalStringList(data, 'igLinks', 100) &&
             optionalStringList(data, 'fbLinks', 100) &&
             optionalStringList(data, 'tiktokLinks', 100) &&
             optionalIdList(data, 'igEngagedEmployeeIds') &&
             optionalIdList(data, 'fbEngagedEmployeeIds') &&
             optionalIdList(data, 'tiktokEngagedEmployeeIds') &&
             optionalStringList(data, 'postedAt', 100);
    }
    function isValidSetting(data) {
      return (!('value' in data) || (data.value is string && data.value.size() <= 5000000));
    }
    match /users/{userId} {
      allow read: if isAuthorized() && request.auth.uid == userId;
      allow create: if isAuthorized() && request.auth.uid == userId && isValidUser(incoming());
      allow update: if isAuthorized() && request.auth.uid == userId && isValidUser(incoming()) &&
                       (!('role' in incoming()) || incoming().role == existing().role);
      allow delete: if isAdmin();
    }
    match /admins/{adminId} {
      allow read: if isAuthorized();
      allow create, update: if isAdmin() && isValidId(adminId) &&
                            incoming().keys().hasAll(['email']) &&
                            incoming().email is string && incoming().email.size() > 0 && incoming().email.size() < 100;
      allow delete: if isAdmin() && isValidId(adminId);
    }
    match /employees/{employeeId} {
      allow list, get: if isAuthorized();
      allow create: if isAdmin() && isValidId(employeeId) && isValidEmployee(incoming());
      allow update: if isAdmin() && isValidId(employeeId) && isValidEmployee(incoming());
      allow delete: if isAdmin() && isValidId(employeeId);
    }
    match /dailyEngagement/{dateId} {
      allow list, get: if isAuthorized();
      allow create: if isAdmin() && isValidId(dateId) && isValidDailyEngagement(incoming());
      allow update: if isAdmin() && isValidId(dateId) && isValidDailyEngagement(incoming());
      allow delete: if isAdmin() && isValidId(dateId);
    }
    match /settings/{settingId} {
      allow list: if isAuthorized();
      allow get: if isAuthorized() || settingId == 'appLogo';
      allow create: if isAdmin() && isValidId(settingId) && isValidSetting(incoming());
      allow update: if isAdmin() && isValidId(settingId) && isValidSetting(incoming());
      allow delete: if isAdmin() && isValidId(settingId);
    }
  }
}`;

async function deployRules(accessToken: string, dbId: string): Promise<void> {
  // 1. Buat ruleset
  const rs = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: { files: [{ name: 'firestore.rules', content: RULES_SOURCE }] },
    }),
  });
  const rsData = (await rs.json().catch(() => ({}))) as { name?: string };
  if (!rs.ok || !rsData.name) {
    throw Object.assign(new Error('Gagal membuat ruleset untuk database baru.'), { status: 502 });
  }
  // 2. Pasang release ke database
  const release = `cloud.firestore/${encodeURIComponent(dbId)}`;
  const rel = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/${release}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `projects/${PROJECT}/releases/${release}`,
        rulesetName: rsData.name,
      }),
    },
  );
  if (!rel.ok) {
    const text = await rel.text().catch(() => '');
    throw Object.assign(new Error(`Gagal deploy rules: ${text.slice(0, 200)}`), { status: 502 });
  }
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

    const dbId = `db-${user.uid.toLowerCase()}`;

    // Ambil service account dari env var (opsional)
    const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!saRaw) {
      json(res, 503, {
        ok: false,
        error:
          'Database belum dibuat. Hubungi admin untuk membuat database ' +
          `${dbId} di Firebase Console (atau atur env GOOGLE_SERVICE_ACCOUNT untuk pembuatan otomatis).`,
      });
      return;
    }

    const sa = JSON.parse(saRaw) as { client_email: string; private_key: string; token_uri: string };

    // Buat database bila belum ada + tulis admins/{uid}
    const accessToken = await getAccessToken(sa);
    let created = false;
    if (!(await dbExists(accessToken, dbId))) {
      await createDb(accessToken, dbId);
      created = true;
    }
    await writeAdmin(dbId, user.uid, user.email);
    // Pasang rules keamanan ke database ini (baru maupun yang sudah ada) —
    // memastikan db-<uid> selalu terlindungi.
    await deployRules(accessToken, dbId);

    json(res, 200, {
      ok: true,
      uid: user.uid,
      databaseId: dbId,
      created,
      message: created
        ? `Database ${dbId} dibuat + Anda terdaftar sebagai admin.`
        : `Database ${dbId} sudah ada — Anda terdaftar sebagai admin.`,
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    json(res, err.status || 500, { ok: false, error: err.message || 'Terjadi kesalahan.' });
  }
}