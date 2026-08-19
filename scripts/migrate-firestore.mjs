#!/usr/bin/env node
/**
 * scripts/migrate-firestore.mjs — Salin data dari proyek Firebase lama ke baru.
 *
 * Model multi-tenant: tiap dinas = database `db-<uid>`. Script ini:
 *   1. Daftar semua database di proyek SUMBER (hanya yang db-*)
 *   2. Untuk tiap db-<uid>, salin SEMUA koleksi ke db-<uid> yang sama di TARGET
 *      (buat database target dulu bila belum ada).
 *
 * Butuh 2 service account (JSON). Cara:
 *   node scripts/migrate-firestore.mjs <path-old-sa.json> <path-new-sa.json>
 *   atau set env OLD_SA / NEW_SA berisi isi JSON.
 *
 * Aman dijalankan ulang (idempoten): dokumen ditulis ulang (merge).
 */
import { Firestore } from '@google-cloud/firestore';
import { readFileSync } from 'node:fs';

// Koleksi yang disalin (semua data operasional).
const COLLECTIONS = ['employees', 'dailyEngagement', 'admins', 'users', 'settings'];

function loadSA(name) {
  const path = process.env[name];
  if (path) {
    if (path.trim().startsWith('{')) return JSON.parse(path);
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  return null;
}

function getSA(argvName, envName) {
  const i = process.argv.indexOf(argvName);
  if (i !== -1 && process.argv[i + 1]) {
    const p = process.argv[i + 1];
    if (p.trim().startsWith('{')) return JSON.parse(p);
    return JSON.parse(readFileSync(p, 'utf8'));
  }
  const fromEnv = loadSA(envName);
  if (fromEnv) return fromEnv;
  throw new Error(`Service account tidak ditemukan (arg ${argvName} atau env ${envName})`);
}

// ---- JWT RS256 + access token (tanpa dependency tambahan) ----
import crypto from 'node:crypto';
function signJwt(header, payload, key) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(data), key);
  return `${data}.${sig.toString('base64url')}`;
}
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase',
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
  );
  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Gagal dapat access token: ' + JSON.stringify(d));
  return d.access_token;
}

async function listDatabases(projectId, token) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  return (d.databases || [])
    .map((x) => x.name.split('/').pop())
    .filter((name) => name.startsWith('db-'));
}

async function createDatabase(projectId, token, dbId) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=${encodeURIComponent(dbId)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `projects/${projectId}/databases/${dbId}`, type: 'FIRESTORE_NATIVE', locationId: 'asia-southeast2' }),
    },
  );
  if (!r.ok) {
    const text = await r.text();
    // 409 = sudah ada → bukan error
    if (r.status === 409) return false;
    throw new Error(`Gagal buat db ${dbId}: ${text.slice(0, 200)}`);
  }
  return true;
}

async function copyDatabase(oldFs, newFs, dbId, project) {
  console.log(`\n=== ${dbId} ===`);
  for (const coll of COLLECTIONS) {
    let count = 0;
    const srcRef = oldFs.collection(coll);
    const destRef = newFs.collection(coll);
    // Iterate all docs in source collection
    const query = srcRef.orderBy('__name__').limit(300);
    let last = null;
    while (true) {
      let q = query;
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = newFs.batch();
      snap.docs.forEach((doc) => {
        batch.set(destRef.doc(doc.id), doc.data(), { merge: true });
        count++;
      });
      await batch.commit();
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < 300) break;
    }
    console.log(`  ${coll}: ${count} dokumen disalin`);
  }
}

const oldSa = getSA('--old-sa', 'OLD_SA');
const newSa = getSA('--new-sa', 'NEW_SA');

const oldProject = oldSa.project_id;
const newProject = newSa.project_id;
console.log(`Sumber: ${oldProject}\nTarget: ${newProject}`);

const oldToken = await accessToken(oldSa);
const newToken = await accessToken(newSa);

const oldFs = new Firestore({ projectId: oldProject, credentials: oldSa, databaseId: '(default)' });
const dbs = await listDatabases(oldProject, oldToken);
console.log(`Database sumber: ${dbs.length ? dbs.join(', ') : '(tidak ada db-*)'}`);

// Juga salin default database bila ada data (opsional, di-bypass karena model db-*)
// Salin tiap db-<uid>
let any = false;
for (const dbId of dbs) {
  any = true;
  await createDatabase(newProject, newToken, dbId);
  const oldDb = new Firestore({ projectId: oldProject, credentials: oldSa, databaseId: dbId });
  const newDb = new Firestore({ projectId: newProject, credentials: newSa, databaseId: dbId });
  try {
    await copyDatabase(oldDb, newDb, dbId, newProject);
  } finally {
    oldDb.terminate();
    newDb.terminate();
  }
}
oldFs.terminate();
console.log(any ? '\nMigrasi selesai.' : '\nTidak ada database db-* untuk dimigrasi.');
