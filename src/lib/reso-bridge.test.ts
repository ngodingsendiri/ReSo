/**
 * Reso bridge regression checks (run: npm run test:bridge → tsx src/lib/reso-bridge.test.ts)
 */
import { platformToCode, buildFillPatch, decideResoFill, RESO_FILL_EVENT, type ResoRawInputs } from './reso-bridge';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

const empty: ResoRawInputs = { igRawInput: '', fbRawInput: '', tiktokRawInput: '' };

// Kontrak event — nama harus sama persis dengan content script ReSoEx
assert(RESO_FILL_EVENT === 'reso:fill-engagement', 'nama CustomEvent sesuai kontrak ekstensi');

// Pemetaan platform ekstensi → kode field rekap
assert(platformToCode('facebook') === 'fb', 'facebook → fb');
assert(platformToCode('instagram') === 'ig', 'instagram → ig');
assert(platformToCode('tiktok') === 'tiktok', 'tiktok → tiktok');
assert(platformToCode('youtube') === null, 'platform tak dikenal → null');
assert(platformToCode(undefined) === null, 'undefined → null');

// FB: isi fbRawInput, field lain tidak tersentuh
const fb = buildFillPatch(empty, { platform: 'facebook', names: ['Andi', ' Budi ', ''] });
assert(fb !== null && fb.fbRawInput === 'Andi\nBudi', 'FB: nama digabung per baris, blank/trim dirapikan');
assert(fb !== null && fb.igRawInput === '' && fb.tiktokRawInput === '', 'FB: field lain tidak berubah');

// IG & TikTok
const ig = buildFillPatch(empty, { platform: 'instagram', names: ['@budi_s'] });
assert(ig !== null && ig.igRawInput === '@budi_s', 'IG: username masuk igRawInput');
const tt = buildFillPatch(empty, { platform: 'tiktok', names: ['tester'] });
assert(tt !== null && tt.tiktokRawInput === 'tester', 'TikTok: nickname masuk tiktokRawInput');

// Validasi: tidak boleh menimpa field lain, dan payload invalid → null
assert(
  buildFillPatch({ igRawInput: 'ig-ada', fbRawInput: '', tiktokRawInput: '' }, { platform: 'facebook', names: ['Andi'] })?.igRawInput === 'ig-ada',
  'FB fill tidak menimpa igRawInput yang sudah ada'
);
assert(buildFillPatch(empty, { platform: 'facebook', names: [] }) === null, 'nama kosong → null');
assert(buildFillPatch(empty, { platform: 'facebook', names: ['  ', ''] }) === null, 'nama blank saja → null');
assert(buildFillPatch(empty, { platform: 'youtube', names: ['Andi'] }) === null, 'platform tak dikenal → null');
assert(buildFillPatch(empty, null) === null, 'payload null → null');
assert(buildFillPatch(empty, { platform: 'instagram', names: [1, null, {}] }) === null, 'tanpa nama string valid → null');

// ---- Lapis 2: decideResoFill (saran tanggal dari umur post) ----

// Tanpa saran / saran sama dengan tanggal aktif → apply langsung
assert(
  decideResoFill('2026-08-12', empty, { platform: 'facebook', names: ['Andi'] }).action === 'apply',
  'tanpa suggestedDate → apply'
);
assert(
  decideResoFill('2026-08-12', empty, { platform: 'facebook', names: ['Andi'], suggestedDate: '2026-08-12' }).action === 'apply',
  'suggestedDate = tanggal aktif → apply'
);
assert(
  decideResoFill('2026-08-12', empty, { platform: 'facebook', names: ['Andi'], suggestedDate: '10-08-2026' }).action === 'apply',
  'suggestedDate format invalid → apply (diabaikan)'
);

// Saran berbeda dari tanggal aktif → confirm + targetDate
const confirm = decideResoFill('2026-08-12', empty, {
  platform: 'tiktok',
  names: ['tester'],
  suggestedDate: '2026-08-10',
  label: 'Kemarin',
});
assert(confirm.action === 'confirm', 'saran berbeda → confirm');
assert(confirm.targetDate === '2026-08-10', 'confirm membawa targetDate saran');
assert(confirm.label === 'Kemarin', 'confirm membawa label saran');
assert(confirm.patch !== undefined && confirm.patch.tiktokRawInput === 'tester', 'confirm tetap membawa patch');

// Payload invalid → none
assert(decideResoFill('2026-08-12', empty, { platform: 'youtube', names: ['Andi'] }).action === 'none', 'platform tak dikenal → none');
assert(decideResoFill('2026-08-12', empty, null).action === 'none', 'payload null → none');
