/**
 * Engagement API — regression checks (run: npx tsx src/lib/engagement-api.test.ts)
 */
import {
  buildEngagementPatch,
  isValidDateStr,
  isDateTooFarFuture,
  isValidPostedAt,
  mergePostedAt,
  collectUnverifiedAutoFilled,
  ADMIN_EMAILS,
  type EngagementDocLike,
} from './engagement-api';
import type { MatchableEmployee } from './matching';

const employees: MatchableEmployee[] = [
  { id: 'e1', name: 'Budi Santoso', igUsername: '@budi_s', fbName: 'Budi Santoso FB', tiktokName: '@buditk' },
  { id: 'e2', name: 'Siti Aminah', igUsername: 'siti_aminah', fbName: 'Siti Aminah', tiktokName: 'siti.tt' },
  { id: 'e3', name: 'Andi Wijaya', igUsername: 'andiw' },
];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let n = 0;
function ok(msg: string) {
  n += 1;
  console.log(`  ok ${n} — ${msg}`);
}

// ---- merge + match (fb) ----
{
  const doc = { date: '2026-08-17', fbRawText: 'Budi Santoso FB\nOrang Lain', fbEngagedEmployeeIds: ['e1'] };
  const r = buildEngagementPatch(doc, 'facebook', ['Andi Wijaya', 'budi santoso fb'], employees, '2026-08-17');
  assert(r !== null, 'patch dihasilkan');
  assert(r!.patch.date === '2026-08-17', 'date ikut patch');
  assert(
    r!.patch.fbRawText === 'Budi Santoso FB\nOrang Lain\nAndi Wijaya',
    'merge: nama baru ditambahkan, duplikat case-insensitive di-skip',
  );
  assert(r!.added === 1 && r!.existing === 1, 'added=1 (Andi Wijaya), existing=1 (budi santoso fb dup)');
  const ids = r!.patch.fbEngagedEmployeeIds as string[];
  assert(ids.includes('e1') && ids.includes('e3'), 'engagedEmployeeIds dihitung ulang dari teks gabungan (e1+e3)');
  ok('fb: merge + dedupe + recompute ids');
}

// ---- tiktok & ig field mapping ----
{
  const r = buildEngagementPatch(null, 'tiktok', ['@buditk'], employees, '2026-08-17');
  assert(r !== null && r!.patch.tiktokRawText === '@buditk', 'tiktokRawText terisi');
  assert((r!.patch.tiktokEngagedEmployeeIds as string[]).includes('e1'), 'tiktok ids dihitung');
  const r2 = buildEngagementPatch(null, 'instagram', ['andiw'], employees, '2026-08-17');
  assert(r2 !== null && r2!.patch.igRawText === 'andiw' && (r2!.patch.igEngagedEmployeeIds as string[]).includes('e3'), 'ig mapping benar');
  ok('tiktok & ig field mapping');
}

// ---- idempotent: kirim ulang post sama = update, tanpa duplikat ----
{
  const first = buildEngagementPatch(null, 'facebook', ['Andi Wijaya'], employees, '2026-08-17');
  assert(first !== null, 'kirim pertama');
  const second = buildEngagementPatch(
    { date: '2026-08-17', fbRawText: first!.patch.fbRawText as string },
    'facebook',
    ['Andi Wijaya'],
    employees,
    '2026-08-17',
  );
  assert(second !== null && second!.added === 0 && second!.existing === 1, 'diulang = update (0 baru, 1 sudah ada)');
  assert(second!.patch.fbRawText === first!.patch.fbRawText, 'teks tidak berubah saat diulang');
  ok('idempotent — post sama diulang = update');
}

// ---- multi-post per hari: dua post beda di tanggal sama digabung ----
{
  const a = buildEngagementPatch(null, 'facebook', ['Andi Wijaya'], employees, '2026-08-17')!;
  const b = buildEngagementPatch(
    { date: '2026-08-17', fbRawText: a.patch.fbRawText as string },
    'facebook',
    ['Siti Aminah'],
    employees,
    '2026-08-17',
  )!;
  assert(
    b.patch.fbRawText === 'Andi Wijaya\nSiti Aminah',
    'dua post hari sama digabung ke satu rekap',
  );
  ok('multi-post per hari di-merge ke tanggal sama');
}

// ---- statistik added/existing konsisten dengan mergeUniqueLines ----
{
  // Existing ber-koma: Andi sudah ada (merge memecah koma & mendedupe) → 1 baru, 1 sudah ada
  const r = buildEngagementPatch(
    { fbRawText: 'Andi Wijaya, Budi Santoso FB' },
    'facebook',
    ['Andi Wijaya', 'Siti Aminah'],
    employees,
    '2026-08-17',
  )!;
  assert(r.patch.fbRawText === 'Andi Wijaya\nBudi Santoso FB\nSiti Aminah', 'existing koma dipecah jadi baris + dedupe');
  assert(r.added === 1 && r.existing === 1, 'existing koma: added=1 (Siti), existing=1 (Andi dedupe)');

  // Existing spasi ganda: key merge 'andi  wijaya' ≠ 'andi wijaya' → baris BARU ditambahkan
  const r2 = buildEngagementPatch(
    { fbRawText: 'Andi  Wijaya' },
    'facebook',
    ['Andi Wijaya'],
    employees,
    '2026-08-17',
  )!;
  assert(r2.patch.fbRawText === 'Andi  Wijaya\nAndi Wijaya', 'spasi ganda tetap ditambahkan oleh merge');
  assert(r2.added === 1 && r2.existing === 0, 'spasi ganda: added=1 (konsisten dengan merge)');
  ok('statistik added/existing konsisten dengan merge');
}

// ---- validasi input ----
{
  assert(buildEngagementPatch(null, 'facebook', [], employees, '2026-08-17') === null, 'names kosong → null');
  assert(buildEngagementPatch(null, 'facebook', ['  ', null, 'Andi Wijaya'], employees, '2026-08-17') !== null, 'entry non-string difilter');
  assert(buildEngagementPatch(null, 'facebook', ['Andi Wijaya'], null, '2026-08-17') === null, 'employees null → null');
  assert(buildEngagementPatch(null, 'youtube' as 'facebook', ['Andi Wijaya'], employees, '2026-08-17') === null, 'platform tak dikenal → null');
  ok('validasi input (empty, filter, employees, platform)');
}

// ---- tanggal ----
{
  assert(isValidDateStr('2026-08-17') === true, 'tanggal valid');
  assert(isValidDateStr('2026-02-30') === false, '30 Feb invalid');
  assert(isValidDateStr('17-08-2026') === false, 'format salah invalid');
  assert(isValidDateStr(123) === false, 'non-string invalid');
  assert(isDateTooFarFuture('2099-01-01') === true, 'masa depan jauh ditolak');
  assert(isDateTooFarFuture('2026-08-17') === false, 'hari ini diterima');
  assert(ADMIN_EMAILS.length === 3, 'allowlist admin ada (cermin rules)');
  ok('validasi tanggal + allowlist');
}

// ---- waktu posting (L3) ----
{
  assert(isValidPostedAt('2026-08-17T07:30') === true, 'ISO lokal tanpa detik valid');
  assert(isValidPostedAt('2026-08-17T07:30:00') === true, 'ISO lokal dengan detik valid');
  assert(isValidPostedAt('2026-08-17 07:30') === false, 'spasi bukan T → invalid');
  assert(isValidPostedAt('2026-08-17T25:30') === false, 'jam > 23 invalid');
  assert(isValidPostedAt('2026-08-17T07:60') === false, 'menit > 59 invalid');
  assert(isValidPostedAt('2026-02-30T07:30') === false, 'tanggal kalender palsu invalid');
  assert(isValidPostedAt(123) === false, 'non-string invalid');
  assert(isValidPostedAt(null) === false, 'null invalid');

  assert(JSON.stringify(mergePostedAt(undefined, '2026-08-17T07:30')) === JSON.stringify(['2026-08-17T07:30']), 'existing kosong → satu entry');
  assert(
    JSON.stringify(mergePostedAt(['2026-08-17T07:30'], '2026-08-17T07:30')) ===
      JSON.stringify(['2026-08-17T07:30']),
    'duplikat → tidak bertambah (idempoten)'
  );
  assert(
    JSON.stringify(mergePostedAt(['2026-08-17T07:30'], '2026-08-17T14:05')) ===
      JSON.stringify(['2026-08-17T07:30', '2026-08-17T14:05']),
    'kiriman kedua → append (satu hari banyak post)'
  );
  assert(
    JSON.stringify(mergePostedAt(['2026-08-17T07:30', 'rusak'], '2026-08-17T14:05')) ===
      JSON.stringify(['2026-08-17T07:30', '2026-08-17T14:05']),
    'entry tidak valid dibuang saat merge'
  );
  ok('validasi + merge waktu posting');
}

// ---- status verifikasi rekap otomatis ----
{
  const docs: Record<string, EngagementDocLike> = {
    '2026-08-10': { date: '2026-08-10', autoFilledAt: { seconds: 1 }, autoFilledCount: 3 },
    '2026-08-11': { date: '2026-08-11', autoFilledAt: { seconds: 1 }, verifiedAt: { seconds: 2 } },
    '2026-08-12': { date: '2026-08-12' },
    '2026-08-13': { date: '2026-08-13', autoFilledAt: { seconds: 1 } },
  };
  const unverified = collectUnverifiedAutoFilled(docs);
  assert(
    JSON.stringify(unverified) === JSON.stringify(['2026-08-10', '2026-08-13']),
    'hanya auto-filled tanpa verifiedAt, urut naik'
  );
  assert(collectUnverifiedAutoFilled(null)?.length === 0, 'null → kosong');
  assert(collectUnverifiedAutoFilled({})?.length === 0, 'map kosong → kosong');
  const onlyVerified: Record<string, EngagementDocLike> = {
    '2026-08-14': { date: '2026-08-14', verifiedAt: { seconds: 1 } },
  };
  assert(
    collectUnverifiedAutoFilled(onlyVerified)?.length === 0,
    'verified tanpa autoFilled tidak terhitung'
  );
  ok('collectUnverifiedAutoFilled (filter + urut)');
}

console.log(`\nengagement-api: ${n} checks OK`);
