/**
 * Simulasi level kode untuk api/engagement.ts (relay Vercel) — mock global
 * fetch: identitytoolkit (verifikasi token), Firestore REST (employees,
 * dailyEngagement read/write). Di luar folder api/ supaya tidak ikut
 * ter-deploy sebagai function. Run: npx tsx src/lib/engagement-api.handler.test.ts
 */
import handler from '../../api/engagement';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function makeRes() {
  return {
    _status: 0 as number,
    _data: null as unknown,
    _headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this._headers[k] = v;
    },
    status(s: number) {
      this._status = s;
      return { json: (d: unknown) => { this._data = d; } };
    },
  };
}

const EMPLOYEE_DOC = {
  name: 'projects/p/databases/d/documents/employees/e1',
  fields: {
    name: { stringValue: 'Andi Wijaya' },
    nip: { stringValue: '19800101' },
    fbName: { stringValue: 'Andi Wijaya' },
  },
};

const EXISTING_DOC = {
  fields: {
    date: { stringValue: '2026-08-17' },
    fbRawText: { stringValue: 'Andi Wijaya\nOrang Lain' },
    fbEngagedEmployeeIds: { arrayValue: { values: [{ stringValue: 'e1' }] } },
    postedAt: { arrayValue: { values: [{ stringValue: '2026-08-17T07:30' }] } },
  },
};

let fetchLog: Array<{ url: string; method: string; body?: string }> = [];

async function runScenario(opts: {
  token: string;
  body: unknown;
  existing?: boolean;
  method?: string;
}): Promise<{ status: number; data: unknown; writes: Array<{ url: string; method: string; body?: string }> }> {
  fetchLog = [];
  const res = makeRes() as unknown as ReturnType<typeof makeRes> & {
    _status: number;
    _data: unknown;
    _headers: Record<string, string>;
  };
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    fetchLog.push({ url, method, body });

    const respond = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

    if (url.includes('identitytoolkit.googleapis.com/v1/accounts:lookup')) {
      const b = JSON.parse(body || '{}');
      if (b.idToken === 'tok-invalid') return respond(400, { error: { message: 'INVALID_ID_TOKEN' } });
      if (b.idToken === 'tok-nonadmin') {
        return respond(200, { users: [{ localId: 'u2', email: 'orang.lain@gmail.com', emailVerified: true }] });
      }
      return respond(200, { users: [{ localId: 'u1', email: 'ngerjaindiri@gmail.com', emailVerified: true }] });
    }
    if (url.includes('/admins/')) return respond(404, { error: { message: 'NOT_FOUND' } });
    if (url.includes('/employees')) return respond(200, { documents: [EMPLOYEE_DOC] });
    if (url.includes('/dailyEngagement')) {
      if (method === 'POST') return respond(200, {});
      if (method === 'PATCH') {
        // PATCH di dokumen yang tidak ada → 404 (memicu fallback create)
        return opts.existing ? respond(200, {}) : respond(404, { error: { message: 'NOT_FOUND' } });
      }
      // GET
      if (opts.existing) return respond(200, EXISTING_DOC);
      return respond(404, { error: { message: 'NOT_FOUND' } });
    }
    return respond(500, { error: { message: `unexpected ${url}` } });
  }) as typeof fetch;

  try {
    const req = {
      method: opts.method || 'POST',
      headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
      body: opts.body,
    };
    await handler(req, res);
    return {
      status: res._status,
      data: res._data,
      writes: fetchLog.filter((f) => f.url.includes('firestore.googleapis.com') && (f.method === 'PATCH' || f.method === 'POST')),
    };
  } finally {
    globalThis.fetch = origFetch;
  }
}

let n = 0;
function ok(msg: string) {
  n += 1;
  console.log(`  ok ${n} — ${msg}`);
}

// 1. Happy path: kirim pertama → POST create, added=1
{
  const r = await runScenario({ token: 'tok-admin', body: { platform: 'facebook', names: ['Andi Wijaya'], date: '2026-08-17' } });
  assert(r.status === 200, `status 200, dapat ${r.status}`);
  const d = r.data as { ok: boolean; added: number; existing: number; date: string };
  assert(d.ok && d.added === 1 && d.existing === 0 && d.date === '2026-08-17', 'added=1, existing=0, date benar');
  assert(r.writes.length === 2 && r.writes[1].method === 'POST', `dokumen baru dibuat via POST (write ke-2), dapat ${JSON.stringify(r.writes)}`);
  const wb = JSON.parse(r.writes[1].body || '{}');
  assert(wb.fields.fbRawText.stringValue === 'Andi Wijaya', 'fbRawText tertulis');
  assert(wb.fields.fbEngagedEmployeeIds.arrayValue.values[0].stringValue === 'e1', 'engagedEmployeeIds hasil matching tertulis');
  assert(typeof wb.fields.autoFilledAt.timestampValue === 'string', 'penanda autoFilledAt (timestamp) tertulis');
  assert(typeof wb.fields.updatedAt.timestampValue === 'string', 'updatedAt (timestamp) tertulis');
  assert(wb.fields.autoFilledCount.integerValue === '1', 'autoFilledCount = jumlah nama baru');
  ok('kirim pertama → create + matching ids + penanda ReSoEx');
}

// 1b. Multi-tenant: semua operasi diarahkan ke subtree dinas/{uid} (single DB)
{
  const r = await runScenario({ token: 'tok-admin', body: { platform: 'facebook', names: ['Andi Wijaya'], date: '2026-08-17' } });
  assert(r.status === 200, `status 200, dapat ${r.status}`);
  const urls = r.writes.map((w) => w.url);
  for (const u of urls) {
    assert(u.includes('/documents/dinas/u1/'), `URL Firestore memakai dinas/u1 (uid dari token), dapat ${u}`);
  }
  // fetchLog juga berisi GET employees (read) — pastikan ikut ke dinas/u1 juga
  const reads = fetchLog.filter((f) => f.url.includes('firestore.googleapis.com') && f.method === 'GET');
  for (const r2 of reads) {
    assert(r2.url.includes('/documents/dinas/u1/'), `read juga ke dinas/u1, dapat ${r2.url}`);
  }
  ok('multi-tenant → semua operasi (read+write) diarahkan ke dinas/{uid} dari token');
}

// 1c. Nama tidak cocok → masuk antrian unmatchedNames (mapValue, bukan null)
{
  const r = await runScenario({ token: 'tok-admin', body: { platform: 'facebook', names: ['Andi Wijaya', 'Orang Lain'], date: '2026-08-17' } });
  assert(r.status === 200, `status 200, dapat ${r.status}`);
  const d = r.data as { unmatched: number };
  assert(d.unmatched === 1, `unmatched=1 di respons, dapat ${d.unmatched}`);
  const wb = JSON.parse(r.writes[1].body || '{}');
  const un = wb.fields.unmatchedNames.arrayValue.values;
  assert(
    JSON.stringify(un) ===
      JSON.stringify([
        {
          mapValue: {
            fields: {
              name: { stringValue: 'Orang Lain' },
              platform: { stringValue: 'fb' },
            },
          },
        },
      ]),
    `unmatchedNames tertulis sebagai mapValue (Orang Lain/fb), dapat ${JSON.stringify(un)}`
  );
  ok('nama belum terpetakan → unmatchedNames ditulis + dilaporkan');
}

// 1c. postedAt (L3): body membawa postedAt → tertulis sebagai array di create
{
  const r = await runScenario({
    token: 'tok-admin',
    body: { platform: 'facebook', names: ['Andi Wijaya'], date: '2026-08-17', postedAt: '2026-08-17T09:45' },
  });
  assert(r.status === 200, `status 200, dapat ${r.status}`);
  const wb = JSON.parse(r.writes[1].body || '{}');
  const arr = wb.fields.postedAt?.arrayValue?.values;
  assert(
    JSON.stringify(arr) === JSON.stringify([{ stringValue: '2026-08-17T09:45' }]),
    `postedAt tertulis di create, dapat ${JSON.stringify(arr)}`
  );
  ok('postedAt dikirim → disimpan ke dokumen (array)');
}

// 1d. postedAt invalid → 400
{
  const r = await runScenario({
    token: 'tok-admin',
    body: { platform: 'facebook', names: ['Andi Wijaya'], date: '2026-08-17', postedAt: '17-08-2026 07:30' },
  });
  assert(r.status === 400, `postedAt invalid ditolak (${r.status})`);
  ok('postedAt invalid → 400');
}

// 1e. postedAt saat doc sudah ada → append + dedupe (satu hari banyak post)
{
  const r = await runScenario({
    token: 'tok-admin',
    body: { platform: 'facebook', names: ['Andi Wijaya'], date: '2026-08-17', postedAt: '2026-08-17T14:05' },
    existing: true,
  });
  assert(r.status === 200, `status 200, dapat ${r.status}`);
  const wb = JSON.parse(r.writes[0].body || '{}');
  const arr = wb.fields.postedAt?.arrayValue?.values;
  assert(
    JSON.stringify(arr) ===
      JSON.stringify([{ stringValue: '2026-08-17T07:30' }, { stringValue: '2026-08-17T14:05' }]),
    `postedAt append + urut, dapat ${JSON.stringify(arr)}`
  );
  // kirim nilai yang sama lagi → tetap dua entry (idempoten)
  const r2 = await runScenario({
    token: 'tok-admin',
    body: { platform: 'facebook', names: ['Andi Wijaya'], date: '2026-08-17', postedAt: '2026-08-17T14:05' },
    existing: true,
  });
  const wb2 = JSON.parse(r2.writes[0].body || '{}');
  const arr2 = wb2.fields.postedAt?.arrayValue?.values;
  assert(
    JSON.stringify(arr2) ===
      JSON.stringify([{ stringValue: '2026-08-17T07:30' }, { stringValue: '2026-08-17T14:05' }]),
    `postedAt dedupe saat diulang, dapat ${JSON.stringify(arr2)}`
  );
  ok('postedAt append + dedupe (idempoten)');
}

// 2. Idempotent: doc sudah ada → PATCH, added=0 existing=1
{
  const r = await runScenario({ token: 'tok-admin', body: { platform: 'facebook', names: ['Andi Wijaya'], date: '2026-08-17' }, existing: true });
  const d = r.data as { ok: boolean; added: number; existing: number };
  assert(r.status === 200 && d.added === 0 && d.existing === 1, 'diulang → update, 0 baru 1 sudah ada');
  assert(r.writes.length === 1 && r.writes[0].method === 'PATCH' && r.writes[0].url.includes('updateMask'), 'update via PATCH + updateMask');
  const wb2 = JSON.parse(r.writes[0].body || '{}');
  assert(wb2.fields.autoFilledAt.timestampValue !== undefined, 'update juga membawa penanda');
  ok('idempotent → PATCH update');
}

// 3. Open registration: user terverifikasi (bukan allowlist) = admin dinas-nya sendiri
{
  const r = await runScenario({ token: 'tok-nonadmin', body: { platform: 'facebook', names: ['Andi Wijaya'], date: '2026-08-17' } });
  assert(r.status === 200, `open-registration user boleh tulis dinas sendiri (${r.status})`);
  // Pastikan ditulis ke dinas/u2 (uid dari token), bukan dinas lain
  for (const w of r.writes) {
    assert(w.url.includes('/documents/dinas/u2/'), `tulis ke dinas/u2, dapat ${w.url}`);
  }
  ok('open registration → user terverifikasi boleh tulis dinas sendiri (dinas/u2)');
}

// 4. Token invalid → 401
{
  const r = await runScenario({ token: 'tok-invalid', body: { platform: 'facebook', names: ['Andi Wijaya'], date: '2026-08-17' } });
  assert(r.status === 401, `token invalid ditolak (${r.status})`);
  ok('token invalid → 401');
}

// 5. Tanggal buruk → 400
{
  const r = await runScenario({ token: 'tok-admin', body: { platform: 'facebook', names: ['Andi Wijaya'], date: '17-08-2026' } });
  assert(r.status === 400, `tanggal buruk ditolak (${r.status})`);
  ok('tanggal buruk → 400');
}

// 6. OPTIONS → CORS 204
{
  const r = await runScenario({ token: '', body: {}, method: 'OPTIONS' });
  assert(r.status === 204, `preflight OK (${r.status})`);
  ok('OPTIONS preflight → 204 + CORS');
}

console.log(`\napi/engagement handler: ${n} checks OK`);
