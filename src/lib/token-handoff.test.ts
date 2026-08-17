/**
 * Token handoff — regression checks (run: npx tsx src/lib/token-handoff.test.ts)
 */
import { createTokenHandoffHandler, rotateRefreshToken, type HandoffTokenProvider } from './token-handoff';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let n = 0;
function ok(msg: string) {
  n += 1;
  console.log(`  ok ${n} — ${msg}`);
}

const OK_RESPONSE = {
  ok: true,
  status: 200,
  json: async () => ({ id_token: 'tok-fresh', refresh_token: 'rt-fresh' }),
} as unknown as Response;

// ---- rotateRefreshToken ----
{
  const r = await rotateRefreshToken('rt0', 'k', (async () => OK_RESPONSE) as unknown as typeof fetch);
  assert(r?.idToken === 'tok-fresh' && r?.refreshToken === 'rt-fresh', 'mint sukses → pasangan segar');
  ok('mint sukses → pasangan segar');
}

{
  const r = await rotateRefreshToken('rt0', 'k', (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id_token: 'tok-fresh' }),
  }) as unknown as Response) as unknown as typeof fetch);
  assert(r?.refreshToken === 'rt0', 'tanpa refresh_token baru → token lama dipertahankan');
  ok('tanpa refresh_token baru → token lama dipertahankan');
}

{
  const r = await rotateRefreshToken('rt0', 'k', (async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'INVALID_REFRESH_TOKEN' } }),
  }) as unknown as Response) as unknown as typeof fetch);
  assert(r === null, 'non-ok → null');
  ok('non-ok → null');
}

{
  const r = await rotateRefreshToken('rt0', 'k', (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ refresh_token: 'rt-x' }),
  }) as unknown as Response) as unknown as typeof fetch);
  assert(r === null, 'id_token bukan string / kosong → null');
  ok('id_token bukan string / kosong → null');
}

{
  const r = await rotateRefreshToken('rt0', 'k', (async () => {
    throw new Error('network');
  }) as unknown as typeof fetch);
  assert(r === null, 'fetch throw → null');
  ok('fetch throw → null');
}

{
  let called = false;
  const r = await rotateRefreshToken('', 'k', (async () => {
    called = true;
    return OK_RESPONSE;
  }) as unknown as typeof fetch);
  assert(r === null && !called, 'refresh token kosong → null tanpa panggil fetch');
  ok('refresh token kosong → null tanpa panggil fetch');
}

// ---- createTokenHandoffHandler ----
function makeHarness(provider: HandoffTokenProvider, origin = 'https://reso.vercel.app') {
  const dispatched: { type: string; detail: Record<string, unknown> }[] = [];
  const handler = createTokenHandoffHandler(provider, origin, (ev) => {
    dispatched.push({ type: ev.type, detail: ev.detail as Record<string, unknown> });
  });
  const fire = (detail: unknown) => handler(new CustomEvent('reso:get-token', { detail }));
  return { dispatched, fire };
}

{
  const { dispatched, fire } = makeHarness(async () => ({
    idToken: 'tok1', refreshToken: 'rt1', uid: 'u1', email: 'a@b.c',
  }));
  fire({ requestId: 'req-1', origin: 'https://reso.vercel.app', respondTo: 'reso:token-response-req-1' });
  await new Promise((r) => setTimeout(r, 0));
  assert(dispatched.length === 1, 'tepat satu respons');
  assert(dispatched[0].type === 'reso:token-response-req-1', 'respons di channel unik per permintaan');
  assert(dispatched[0].detail.requestId === 'req-1', 'requestId ikut respons');
  assert(dispatched[0].detail.origin === 'https://reso.vercel.app', 'origin di-echo ke respons');
  assert(dispatched[0].detail.idToken === 'tok1' && dispatched[0].detail.refreshToken === 'rt1', 'token dikirim');
  ok('respons di channel unik + echo requestId/origin + token');
}

{
  const { dispatched, fire } = makeHarness(async () => ({
    idToken: 'tok1', refreshToken: 'rt1', uid: 'u1', email: 'a@b.c',
  }));
  fire({ requestId: 'req-x', origin: 'https://evil.example', respondTo: 'reso:token-response-req-x' });
  await new Promise((r) => setTimeout(r, 0));
  assert(dispatched.length === 0, 'origin tidak cocok → tidak dilayani');
  ok('origin tidak cocok → tidak dilayani');
}

{
  const { dispatched, fire } = makeHarness(async () => ({
    idToken: 'tok1', refreshToken: 'rt1', uid: 'u1', email: 'a@b.c',
  }));
  fire({ requestId: 'req-dup', origin: 'https://reso.vercel.app', respondTo: 'reso:token-response-req-dup' });
  fire({ requestId: 'req-dup', origin: 'https://reso.vercel.app', respondTo: 'reso:token-response-req-dup' });
  await new Promise((r) => setTimeout(r, 0));
  assert(dispatched.length === 1, 'guard sekali-pakai: requestId sama dibalas sekali');
  ok('guard sekali-pakai: requestId sama dibalas sekali');
}

{
  const { dispatched, fire } = makeHarness(async () => ({
    idToken: 'tok1', refreshToken: 'rt1', uid: 'u1', email: 'a@b.c',
  }));
  fire({ origin: 'https://reso.vercel.app', respondTo: 'reso:token-response-a' });
  fire({ requestId: 42, origin: 'https://reso.vercel.app', respondTo: 'reso:token-response-b' });
  fire({ requestId: '', origin: 'https://reso.vercel.app', respondTo: 'reso:token-response-c' });
  await new Promise((r) => setTimeout(r, 0));
  assert(dispatched.length === 0, 'requestId tidak valid → diabaikan');
  ok('requestId tidak valid → diabaikan');
}

{
  const { dispatched, fire } = makeHarness(async () => null);
  fire({ requestId: 'req-n', origin: 'https://reso.vercel.app', respondTo: 'reso:token-response-req-n' });
  await new Promise((r) => setTimeout(r, 0));
  assert(dispatched[0]?.detail.error === 'no-user', 'provider null → error no-user');
  ok('provider null → error no-user');
}

{
  const { dispatched, fire } = makeHarness(async () => {
    throw new Error('mint rusak');
  });
  fire({ requestId: 'req-e', origin: 'https://reso.vercel.app', respondTo: 'reso:token-response-req-e' });
  await new Promise((r) => setTimeout(r, 0));
  assert(dispatched[0]?.detail.error === 'mint rusak', 'provider throw → error pesan');
  ok('provider throw → error pesan');
}

{
  const { dispatched, fire } = makeHarness(async () => ({
    idToken: 'tok1', refreshToken: 'rt1', uid: 'u1', email: 'a@b.c',
  }));
  fire({ requestId: 'req-fb', origin: 'https://reso.vercel.app' });
  await new Promise((r) => setTimeout(r, 0));
  assert(dispatched[0]?.type === 'reso:token-response', 'tanpa respondTo → fallback nama tetap');
  ok('tanpa respondTo → fallback nama tetap');
}

console.log(`\ntoken-handoff: ${n} checks OK`);
