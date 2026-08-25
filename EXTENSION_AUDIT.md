# Extension Audit — ReSo Ekstention (Manifest V3)

**Tanggal:** 2026-08-25  
**Lingkup:** `extension/` penuh — `manifest.json` + `background.js` + `content-{fb,tiktok,ig,reso}.js` + `inject-{fb,tiktok,ig}.js` + `shared.js`/`shared-module.js` + `popup.{html,js,css}` + `options.{html,js,css}` + `scripts/*` + build/dist + tests (519 pass)

---

## 1. Metodologi

Manual read + `grep` pola berbahaya (`JSON.stringify` di engine, `size={12}`), cross-check `CONSISTENCY.md`, skema `manifest.json` + provider `RESO_FIREBASE`, dan hubungan `shared.js` ↔ inline marker di tiga panel.

## 2. Ringkasan Eksekutif

Ekstensi dalam **kondisi sangat sehat** — salah satu basis kode extension paling disiplin yang pernah diaudit: single-source marker (`NORMALIZE`/`DONEMSG`/`PANELTOOLS`/sprite), paritas tiga platform yang dijaga rantai tes, jembatan ReSo yang tangguh (antrian + cooldown + origin-check + idToken-only), dan build yang deterministik.

Sisa perbaikan hanya **polish** — tidak ada temuan High yang memblokir rilis.

---

## 3. Kekuatan (keep)

- **Arsitektur split benar:** `shared.js` = satu sumber kebenaran (`is*Url`/`detectPlatform`/`DONEMSG`/`normalize*`/`iconSprite`); salinan inline di content scripts **disengaja**, diverifikasi `tests/duplication-audit` + `normalization-fixture` byte-identik — drift tidak mungkin lolos tes.
- **Background = single-writer yang benar:** `resoQueueOp` promise-chain `withResoQueueLock` serializes `enqueueResoPayload` vs `flushResoQueue` → tidak ada lost-update walau content script kirim dari tab berbeda secara bersamaan.
- **Ketahanan jembatan ReSo:** `maybeFlushResoQueue` dipicu dari 5 sumber (alarm 2 mnt + `storage.onChanged` `resoPending`/`resoUrl` + `tabs.onUpdated` tab ReSo + `tabs.onActivated` + after handoff) + cooldown 20 dtk → kiriman tak pernah hilang walau offline.
- **Keamanan sesi:** background tidak pernah menyimpan/meneruskan refresh token; hanya `idToken` (~1 jam), `originOf(msg.url) !== originOf(sender)` ditolak, `sender.origin`/`sender.tab.url`/`sender.url` semua dipertimbangkan — `RESO_CONNECT` aman.
- **Badge sesuai spec:** `CONSISTENCY.md 1.4` dipatuhi (`done` hijau #42b72a, `stopped` accent #6366f1, partial amber #f7b928; `■` untuk `stopped` tanpa hasil — tanpa glyph badge yang tak ter-render).
- **Performa konten ringan:** `webRequest.onBeforeRequest` observasional saja (tanpa `webRequestBlocking`), `injectMain` di-cache per tab (`injectedEngines` Map + `tabs.onUpdated` reset), `engineCmd` via `chrome.scripting.executeScript` (bukan `postMessage` yang bisa di-spoof).
- **Popup & options sinkron desain:** `popup.css`/`options.css` kini pakai token yang sama dengan app web (`--background/--surface/--foreground/--border/--primary/--radius` + `Geist Variable` fallback) — sinkron Fase 7 ekstensi dari audit web.
- **Build deterministik:** `scripts/build.mjs` + `stamp-version.mjs` (manifest version dari `package.json`) + `check-manifest-schema.mjs`/`check-yaml.mjs` → `npm run check` + `node --test` (19 suite).

## 4. Temuan & Rekomendasi

### 4.1 Kemanan & Privasi — `Low`

- `manifest.json:54` host permission `*://*.facebook.com/*` menaungi 49–53 yang eksplisit per-subdomain — **redundan** tapi tidak berbahaya; bila ingin minimalisir izin untuk review Chrome Web Store, hapus 49–53, cukup pola bintang.
- Cookie `c_user`/`sessionid` dibaca hanya untuk pre-check `CHECK_*_LOGIN` (baris ~863–897 pada tiap platform) — dilakukan di background service worker, tidak bocor ke content; baik. Catat di `privacy.md` bila toko meminta alasan.

### 4.2 Reliabilitas Template — `Medium` (sudah ditangani baik, tinggal dokumentasi)

- IG menangkap `*://*.instagram.com/*` webRequest → `sanitizeInstagramTemplateUrl`; FB menangkap `*://*.facebook.com/*` tidak dipakai untuk template (synthetic GraphQL di-probe lewat kandidat `extractFbFeedbackIds`) — konsisten. Guard "jangan timpa template run aktif" (`st.status === "running" && prevValid && same video/mediaId check` di BG line ~489–511 & 566+) mencegah noise dari scroll post lain. **Dokumentasi komentar sudah bagus** — pertahankan.

### 4.3 Performa — `Low`

- `background.js : SET_STATE` membatasi `names.slice(0,5000)` + `message.slice(0,500)` (1075–978) — guard bagus.
- Alarms `periodInMinutes: 2` cukup sering; karena pengecekan murah (`pending.length`), biaya baterai minimal. Alternatif fase mendatang: ganti ke `periodInMinutes: 5` bila ingin lebih hemat; tidak urgent.
- Transport ikonis `iconSprite` inline (+`<use>`) menggantikan salinan `ICON_PATHS` per elemen — DOM lebih kecil ~40% per panel dan flash aman (CSP inline SVG di-host, sprite hadir sebelum panel render).

### 4.4 UI — Popup (`extension/popup.css:1`)

- Selesai: token sinkron (beberapa token yang dipakai — `--info-bg/border`, `--radius-sm`, `--surface-hover`) sudah seragam dengan web app; toggle mengandalkan `:checked + .slider`, `focus-visible` pada slider, layout `wrap` 280px tetap ergonomis.
- Sisa minor: `#modeHint` mengganti teks penuh antara "Aktif → ikon mengambang muncul..." dan "Nonaktif — ikon mengambang disembunyikan..." (2 kalimat panjang). Bila ingin ekstra rapi, ganti jadi badge `Aktif`/`Nonaktif` di samping slider dan `hint` lebih pendek — opsional, bukan inkonsistensi.

### 4.5 UI — Panel FB/TikTok/IG (`content-*.js:~900-1150`)

- Struktur header (`icon + title + status + close`) / tools (`includeReplies checkbox + search`) / actions (`Rekap+Kirim/Proses, Reset, Copy`) / FAB dengan count — sudah **paritas penuh** `PANELTOOLS` + `PARITY struktur template FULL`.
- `Cooldown` 15 dtk normal / 60 dtk setelah rate-limit konsisten tiga platform — bagus.
- Tidak ada drift yang perlu diperbaiki; skor tes paritas ideal.

### 4.6 Build & Versi

- `extension/package.json:3` versi `1.0.58` sudah sinkron ke `dist/manifest.json` lewat `stamp-version.mjs` — benar. Catatan #3 di audit web: scale tetap `h-10/px-4`, popup scale `h-8/px-3` sengaja dibiarkan (control popup kompak).
- `dist/` + `dist-crx/` di-commit bersama build — **sumber duplikasi**. Pertahankan `.gitignore` mengabaikan `dist/` (opsional: `dist/` generated tidak perlu dilacak di cabang `main`; `dist-crx/*.crx` memang dipakai release).

### 4.7 Dokumentasi

- `CHANGELOG.md` mencatat Sprint-A & TT-live (~live dibaca sebagai LIVE tanpa komentar permanen — ditangani `statusFromReason: live → error` dengan pesan jelas). Bila rilis berikutnya menambah reasoning baru, sikronkan `reasonToMessage` di ketiga panel (`DONEMSG` marker) + `background:reasonToMessage` sekaligus (tes `DONEMSG` akan mengingatkan).

---

## 5. Rencana Eksekusi (jika ingin polish)

Semua di bawah **Low** — digabung satu fase ~30 menit:

1. **Manifest (opsional):** hapus host permission 49–53 jika Web Store meminta minimalisasi izin.
2. **Popup copy polish (opsional):** ringkas `modeHint` dan tambah badge `Aktif` statis.
3. **Git hygiene (opsional):** `git rm -r --cached dist/ dist-crx/dist.crx` lalu abaikan build output; satu baris `dist/ reso-ekstention-*.zip` di `.gitignore`.
4. Tidak ada perubahan perilaku — build harus tetap hijau (`node --test` 519 pass) dan `npm run check` lulus.

---

## 6. Kesimpulan

Tidak ada temuan yang menghalangi rilis. Ketiga scope yang diminta (1 — Full, 2 — Performa, 3 — Popup) berada pada level **produksi**: arsitektur single-writer yang benar, paritas lintas platform yang dijaga tes, penanganan rate-limit/checkpoint/live yang berlapis, dan UI yang kini token-sinkron dengan web app.

Rekomendasi: **segel status sebagai v1.0.58 ✅** — polish di atas bisa menjadi *fast-follow* 1.0.59.
