/**
 * re-ex extreme-stress.test.ts — Stress test ekstrem untuk ReSo app.
 * Mensimulasikan input bermusuhan, payload raksasa, konkurensi, dan
 * edge-case yang jarang terjadi di produksi tapi bisa crash.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchEmployeesToEngagement,
  matchEngagementDetail,
  normalizeMatchText,
  mergeUniqueLines,
  MatchableEmployee,
} from './matching';
import { buildEngagementPatch, isValidDateStr, isValidPostedAt, mergePostedAt, isDateTooFarFuture, dinasUid } from './engagement-api';
import { createTokenHandoffHandler } from './token-handoff';

const EMPLOYEES: MatchableEmployee[] = [
  { id: 'e1', name: 'Budi Santoso', fbName: 'Budi Santoso', igUsername: 'budi_s', tiktokName: '@budi_s', aliases: [] },
  { id: 'e2', name: 'Siti Nurhaliza', fbName: 'Siti Nurhaliza', igUsername: 'siti_n', tiktokName: '@siti_n', aliases: ['siti'] },
  { id: 'e3', name: 'Andi Wijaya', fbName: 'Andi Wijaya', igUsername: 'andiw', tiktokName: '@andiw', aliases: ['andi'] },
];

// ===================== 1. normalizeMatchText — fuzz =====================

it('STRESS: normalizeMatchText — 10.000 random string (tidak crash)', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 10_000; i++) {
    const len = Math.floor(rnd() * 500) + 1;
    const chars = [];
    for (let j = 0; j < len; j++) {
      const r = rnd();
      if (r < 0.3) chars.push(String.fromCodePoint(0x20 + Math.floor(rnd() * 0x5E)));
      else if (r < 0.5) chars.push(String.fromCodePoint(0x1F600 + Math.floor(rnd() * 100)));
      else if (r < 0.7) chars.push(String.fromCodePoint(0x600 + Math.floor(rnd() * 0x500)));
      else chars.push("\x00\x01\x02\x1B\x7F\x80\xFF"[Math.floor(rnd() * 7)]);
    }
    const r = normalizeMatchText(chars.join(''));
    assert.ok(typeof r === 'string', 'tidak crash: ' + r.length);
  }
});

it('STRESS: normalizeMatchText — null/undefined/number/object (tidak crash)', () => {
  assert.equal(normalizeMatchText(null), '');
  assert.equal(normalizeMatchText(undefined), '');
  assert.equal(normalizeMatchText(123), '123');
  assert.equal(normalizeMatchText({}), '[object object]');
});

// ===================== 2. matchEmployeesToEngagement — fuzz =====================

it('STRESS: matchEmployeesToEngagement — 5.000 random input (tidak crash)', () => {
  let seed = 99999;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 5_000; i++) {
    const len = Math.floor(rnd() * 200) + 1;
    const chars = [];
    for (let j = 0; j < len; j++) {
      const r = rnd();
      if (r < 0.4) chars.push(String.fromCodePoint(0x41 + Math.floor(rnd() * 26)));
      else if (r < 0.6) chars.push(String.fromCodePoint(0x30 + Math.floor(rnd() * 10)));
      else if (r < 0.8) chars.push(' \n,;');
      else chars.push(String.fromCodePoint(0x1F300 + Math.floor(rnd() * 50)));
    }
    const result = matchEmployeesToEngagement(chars.join(''), EMPLOYEES, 'fb');
    assert.ok(Array.isArray(result), 'return array: ' + typeof result);
  }
});

it('STRESS: matchEmployeesToEngagement — SQLi / XSS / injection payload', () => {
  const xss = [
    "<script>alert(1)</script>' OR 1=1 --",
    "Robert'); DROP TABLE Employees;--",
    '{{7*7}}', '${7*7}', '<img src=x onerror=alert(1)>',
    'javascript:alert(1)', '\\u0027 OR 1=1 --',
  ];
  for (const payload of xss) {
    const r = matchEmployeesToEngagement(payload, EMPLOYEES, 'fb');
    assert.ok(Array.isArray(r), 'tidak crash: ' + payload.slice(0, 30));
  }
});

it('STRESS: matchEmployeesToEngagement — 10.000 baris input', () => {
  const lines = [];
  for (let i = 0; i < 10_000; i++) lines.push(`User Ke-${i}`);
  const result = matchEmployeesToEngagement(lines.join('\n'), EMPLOYEES, 'fb');
  assert.ok(Array.isArray(result), '10.000 baris → array');
  assert.ok(result.length <= EMPLOYEES.length, 'hanya match ke pegawai yang ada');
});

it('STRESS: matchEmployeesToEngagement — null/undefined input', () => {
  assert.deepEqual(matchEmployeesToEngagement(null as unknown as string, EMPLOYEES, 'fb'), []);
  assert.deepEqual(matchEmployeesToEngagement(undefined as unknown as string, EMPLOYEES, 'fb'), []);
  assert.deepEqual(matchEmployeesToEngagement('', EMPLOYEES, 'fb'), []);
  assert.deepEqual(matchEmployeesToEngagement('  ', EMPLOYEES, 'fb'), []);
});

// ===================== 3. mergeUniqueLines — stress =====================

it('STRESS: mergeUniqueLines — 10.000 baris + 10.000 sama (dedupe)', () => {
  const existing = Array.from({ length: 5_000 }, (_, i) => `User ${i}`).join('\n');
  const additions = Array.from({ length: 10_000 }, (_, i) => `User ${i % 5000}`);
  const result = mergeUniqueLines(existing, additions);
  const lines = result.split('\n');
  assert.equal(lines.length, 5000, 'dedupe: 5000 baris unik');
});

it('STRESS: mergeUniqueLines — 100.000 baris (performansi)', () => {
  const existing = Array.from({ length: 50_000 }, (_, i) => `User ${i}`).join('\n');
  const additions = Array.from({ length: 50_000 }, (_, i) => `Person ${i}`);
  const result = mergeUniqueLines(existing, additions);
  assert.ok(result.length > 0, '100.000 baris digabung');
  const lines = result.split('\n');
  assert.equal(lines.length, 100_000, '100.000 baris unik');
});

// ===================== 4. matchEngagementDetail — edge case =====================

it('STRESS: matchEngagementDetail — 1.000 baris, hail mary', () => {
  const lines = Array.from({ length: 1000 }, (_, i) => `Orang Asing ${i}`);
  const result = matchEngagementDetail(lines.join('\n'), EMPLOYEES, 'fb');
  assert.ok(Array.isArray(result.matchedIds), 'matchedIds array');
  assert.ok(Array.isArray(result.unmatched), 'unmatched array');
  assert.equal(result.unmatched.length, 1000, '1000 baris tidak match');
});

it('STRESS: matchEngagementDetail — null/undefined input', () => {
  assert.deepEqual(matchEngagementDetail(null as unknown as string, EMPLOYEES, 'fb'), { matchedIds: [], unmatched: [] });
  assert.deepEqual(matchEngagementDetail(undefined as unknown as string, EMPLOYEES, 'fb'), { matchedIds: [], unmatched: [] });
  assert.deepEqual(matchEngagementDetail('', EMPLOYEES, 'fb'), { matchedIds: [], unmatched: [] });
});

// ===================== 5. engagement-api — buildEngagementPatch =====================

it('STRESS: buildEngagementPatch — existing null, names raksasa', () => {
  const names = Array.from({ length: 10_000 }, (_, i) => `Nama User ${i}`);
  const r = buildEngagementPatch(null, 'facebook', names, EMPLOYEES, '2026-08-23');
  assert.ok(r, 'return objek dengan existing null');
  assert.ok(String(r.patch.fbRawText).includes('Nama User 0'), 'raw text tersimpan');
});

it('STRESS: buildEngagementPatch — names non-array / null / undefined', () => {
  assert.equal(buildEngagementPatch(null, 'facebook', null, EMPLOYEES, '2026-08-23'), null);
  assert.equal(buildEngagementPatch(null, 'facebook', 'string', EMPLOYEES, '2026-08-23'), null);
  assert.equal(buildEngagementPatch(null, 'facebook', [123, {}, null], EMPLOYEES, '2026-08-23'), null);
});

it('STRESS: buildEngagementPatch — platform invalid', () => {
  // @ts-expect-error — platform invalid
  const r = buildEngagementPatch(null, 'invalid', ['Andi'], EMPLOYEES, '2026-08-23');
  assert.equal(r, null, 'platform invalid → null');
});

it('STRESS: buildEngagementPatch — employees kosong / null', () => {
  const r = buildEngagementPatch(null, 'facebook', ['Andi'], [], '2026-08-23');
  assert.equal(r, null, 'employees kosong → null');
  assert.equal(buildEngagementPatch(null, 'facebook', ['Andi'], null, '2026-08-23'), null);
});

it('STRESS: dinasUid — mixed case / null / undefined', () => {
  assert.equal(dinasUid('eeWzyza6xvcBKcmucxMidMBTmOw1'), 'eewzyza6xvcbkcmucxmidmbtmow1');
  assert.equal(dinasUid('ABC-123'), 'abc-123');
  assert.equal(dinasUid(null as unknown as string), '');
  assert.equal(dinasUid(undefined as unknown as string), '');
});

it('STRESS: isValidDateStr — fuzz tanggal', () => {
  for (let i = 0; i < 10_000; i++) {
    const y = Math.floor(Math.random() * 10000) - 1;
    const m = Math.floor(Math.random() * 30) - 1;
    const d = Math.floor(Math.random() * 60) - 1;
    const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const r = isValidDateStr(s);
    assert.equal(typeof r, 'boolean', 'return boolean: ' + s);
  }
});

it('STRESS: isValidPostedAt — fuzz', () => {
  for (let i = 0; i < 10_000; i++) {
    const s = `${Math.floor(Math.random() * 100000)}-${Math.floor(Math.random() * 100)}-${Math.floor(Math.random() * 100)}T${Math.floor(Math.random() * 100)}:${Math.floor(Math.random() * 100)}`;
    const r = isValidPostedAt(s);
    assert.equal(typeof r, 'boolean', 'return boolean: ' + s);
  }
});

it('STRESS: mergePostedAt — 10.000 append', () => {
  let arr: string[] | undefined;
  for (let i = 0; i < 10_000; i++) {
    const iso = `2026-08-23T${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`;
    arr = mergePostedAt(arr, iso);
  }
  assert.ok(Array.isArray(arr) && arr.length > 0, 'append 10.000 postedAt');
});

it('STRESS: isDateTooFarFuture — fuzz', () => {
  const now = new Date('2026-08-23T00:00:00Z');
  for (let i = 0; i < 1000; i++) {
    const s = `2026-08-${String((i % 28) + 1).padStart(2, '0')}`;
    const r = isDateTooFarFuture(s, now);
    assert.equal(typeof r, 'boolean', 'return boolean: ' + s);
  }
});

// ===================== 6. token-handoff — edge case =====================

it('STRESS: createTokenHandoffHandler — requestId null/invalid', () => {
  const events: unknown[] = [];
  const handler = createTokenHandoffHandler(
    async () => ({ idToken: 'tok', uid: 'u', email: null }),
    'https://reso.sekretariat.fun',
    (ev) => events.push(ev),
  );
  // detail tanpa requestId → diabaikan (tidak dispatch, tidak crash)
  handler(new CustomEvent('reso:get-token', { detail: {} }));
  handler(new CustomEvent('reso:get-token', { detail: { requestId: 123 } }));
  handler(new CustomEvent('reso:get-token', { detail: { requestId: '' } }));
  assert.equal(events.length, 0, 'requestId invalid → tidak dispatch');
});

it('STRESS: createTokenHandoffHandler — origin beda → diabaikan', () => {
  const events: unknown[] = [];
  const handler = createTokenHandoffHandler(
    async () => ({ idToken: 'tok', uid: 'u', email: null }),
    'https://reso.sekretariat.fun',
    (ev) => events.push(ev),
  );
  handler(new CustomEvent('reso:get-token', {
    detail: { requestId: 'r1', origin: 'https://evil.example', respondTo: 'chan' },
  }));
  assert.equal(events.length, 0, 'origin lain → tidak dilayani');
});

it('STRESS: createTokenHandoffHandler — provider null → error no-user', async () => {
  const events: CustomEvent[] = [];
  const handler = createTokenHandoffHandler(
    async () => null,
    'https://reso.sekretariat.fun',
    (ev) => events.push(ev),
  );
  handler(new CustomEvent('reso:get-token', {
    detail: { requestId: 'r1', origin: 'https://reso.sekretariat.fun', respondTo: 'chan' },
  }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(events.length, 1, 'provider null → satu respons');
  assert.equal((events[0].detail as { error?: string }).error, 'no-user');
});

it('STRESS: createTokenHandoffHandler — provider throw → error pesan', async () => {
  const events: CustomEvent[] = [];
  const handler = createTokenHandoffHandler(
    async () => { throw new Error('boom'); },
    'https://reso.sekretariat.fun',
    (ev) => events.push(ev),
  );
  handler(new CustomEvent('reso:get-token', {
    detail: { requestId: 'r2', origin: 'https://reso.sekretariat.fun', respondTo: 'chan' },
  }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(events.length, 1, 'provider throw → satu respons');
  assert.equal((events[0].detail as { error?: string }).error, 'boom');
});

it('STRESS: createTokenHandoffHandler — guard sekali-pakai: duplikat diabaikan', async () => {
  const events: CustomEvent[] = [];
  const handler = createTokenHandoffHandler(
    async () => ({ idToken: 'tok', uid: 'u', email: null }),
    'https://reso.sekretariat.fun',
    (ev) => events.push(ev),
  );
  handler(new CustomEvent('reso:get-token', {
    detail: { requestId: 'dup', origin: 'https://reso.sekretariat.fun', respondTo: 'chan' },
  }));
  handler(new CustomEvent('reso:get-token', {
    detail: { requestId: 'dup', origin: 'https://reso.sekretariat.fun', respondTo: 'chan' },
  }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(events.length, 1, 'requestId sama → dibalas sekali');
});