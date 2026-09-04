/**
 * Tes fetchWithTimeout — kontrak anti-hang:
 *  1. fetch cepat → respons diteruskan apa adanya.
 *  2. fetch menggantung → FetchTimeoutError dalam ≤ timeoutMs (bukan hang).
 *  3. fetch lambat tapi masih selesai sebelum batas → sukses (timer bersih).
 *  4. Abort dari pemanggil (init.signal) → AbortError ASLI diteruskan,
 *     bukan FetchTimeoutError (pembeda penting).
 *  5. Setelah resolve, tidak ada abort susulan (timer dibersihkan).
 *
 * Run: npx tsx src/lib/fetch-with-timeout.test.ts
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, FetchTimeoutError } from './fetch-with-timeout';

/** Stub fetch yang TIDAK pernah settle kecuali sinyal abort-nya dihentikan. */
function hangingFetch() {
  return (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
}

it('fetchWithTimeout: fetch cepat → respons diteruskan + timer tidak abort', async () => {
  const response = new Response('ok', { status: 200 });
  let sawSignal = false;
  const stub = async (_i: RequestInfo | URL, init?: RequestInit) => {
    sawSignal = !!init?.signal;
    return response;
  };
  const orig = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    const res = await fetchWithTimeout('https://example.test', { method: 'GET' }, 500);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
    assert.ok(sawSignal, 'fetch dipanggil dengan sinyal AbortController');
  } finally {
    globalThis.fetch = orig;
  }
});

it('fetchWithTimeout: fetch menggantung → FetchTimeoutError ≤ batas', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = hangingFetch() as typeof fetch;
  try {
    const t0 = Date.now();
    await assert.rejects(
      () => fetchWithTimeout('https://example.test', undefined, 80),
      (err: unknown) => err instanceof FetchTimeoutError && err.timeoutMs === 80,
    );
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 2000, `timeout memicu cepat (<2s), aktual ${elapsed}ms`);
  } finally {
    globalThis.fetch = orig;
  }
});

it('fetchWithTimeout: fetch lambat tapi selesai sebelum batas → sukses', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_i: RequestInfo | URL) => {
    await new Promise((r) => setTimeout(r, 30));
    return new Response('late but ok', { status: 200 });
  }) as typeof fetch;
  try {
    const res = await fetchWithTimeout('https://example.test', undefined, 200);
    assert.equal(await res.text(), 'late but ok');
  } finally {
    globalThis.fetch = orig;
  }
});

it('fetchWithTimeout: abort dari pemanggil → AbortError asli, bukan FetchTimeoutError', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = hangingFetch() as typeof fetch;
  try {
    const controller = new AbortController();
    const p = fetchWithTimeout('https://example.test', { signal: controller.signal }, 5000);
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(
      () => p,
      (err: unknown) => (err as { name?: string })?.name === 'AbortError' && !(err instanceof FetchTimeoutError),
    );
  } finally {
    globalThis.fetch = orig;
  }
});

it('fetchWithTimeout: setelah resolve, tidak ada abort susulan (timer bersih)', async () => {
  let aborted = false;
  const orig = globalThis.fetch;
  globalThis.fetch = ((_i: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; });
    return Promise.resolve(new Response('clean', { status: 200 }));
  }) as typeof fetch;
  try {
    await fetchWithTimeout('https://example.test', undefined, 30);
    // Tunggu lebih lama dari timeout — kalau timer bocor, abort akan memicu.
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(aborted, false, 'tidak ada abort setelah fetch selesai');
  } finally {
    globalThis.fetch = orig;
  }
});