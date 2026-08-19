# Changelog

Semua perubahan penting dicatat di sini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/), versi mengikuti [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Jembatan ReSo tangguh: antrian kiriman tertunda + status koneksi (P1)
- **Koreksi fatal konteks handoff**: `handoffResoAuthFromTab` di-shared.js memanggil `chrome.tabs.query` — API yang TIDAK tersedia di content script. Panel "Rekap + Kirim" (content script) yang memicu handoff (token expired/missing + mint gagal) melempar `Cannot read properties of undefined (reading 'query')` → pesan mentah di panel. Sekarang handoff **didelegasikan ke background** (`RESO_HANDOFF_AUTH` di message router) saat `chrome.tabs` tidak tersedia; popup/background/options tetap pakai jalur langsung. `sendNamesToResoApi` juga di-hardening: error auth tak terduga → pesan `needsLogin` ramah, bukan TypeError mentah.
- **Kiriman tidak pernah hilang — antrian `resoPending`**: `sendNamesToResoApi` memecah POST inti menjadi `postResoEngagement` (retry cepat 1× untuk blip jaringan / 5xx / 429 / **401**; error definitif 400/403/404 ditandai `retryable:false`). Gagal transien → payload disimpan ke `chrome.storage.local` (gabung nama untuk platform+date+postedAt sama) & pesan panel menyebut "masuk antrian ReSo". Definitive 4xx TIDAK di-antri.
- **Flush otomatis dari background**: `flushResoQueue` mengirim ulang antrian (sukses → hapus, transien → pertahankan, definitif → buang, tanpa token → pertahankan + `needsLogin`, **401 → pertahankan SEMUA sisa + berhenti** supaya flush berikutnya me-mint token segar — data tidak pernah terbuang gara-gara token basi). Dipicu alarm berkala 2 menit (permission `alarms` baru), `chrome.storage.onChanged` saat antrian berubah, `tabs.onActivated`, `tabs.onUpdated` (tab ReSo selesai dimuat), `runtime.onStartup`, dan pesan `RESO_FLUSH_NOW` (tombol popup). Cooldown 20 dtk mencegah hantaman API.
- **Anti lost-update antar-konteks**: content script tidak lagi menulis antrian langsung — mendelegasikan `RESO_ENQUEUE` ke background (fallback tulis lokal bila background mati). Background jadi SATU-SATUNYA penulis antrian: semua mutasi (enqueue + flush) di-serialize lewat lock rantaian-Promise (`withResoQueueLock`) → tidak ada window race yang menghapus kiriman.
- **Status koneksi nyata**: `api/health.ts` (Vercel function baru, CORS + nol env var) + `checkResoConnection` di shared.js (auth tersedia? API terjangkau via `/api/health`, hasil di-cache 30 dtk supaya popup tidak menunggu timeout tiap dibuka? berapa antrian?) → dipakai popup: indikator "ReSo: Terhubung / Belum tersambung / N kiriman antri" + tombol "Kirim ulang antrian" saat ada antrian (pesan `RESO_CONN_STATUS`).
- **Bug status "Belum tersambung" padahal ReSo sudah dibuka & login**: `checkResoConnection` tadinya hanya membaca token dari cache storage — token baru diambil lewat handoff saat kirim/flush, sehingga cukup membuka popup (ReSo sudah terbuka & login) selalu menampilkan "Belum tersambung — buka ReSo untuk login". Sekarang `checkResoConnection` **menyambungkan dulu** (handoff dari tab ReSo terbuka / mint via refresh token) bila belum punya token valid → indikator langsung "Terhubung". Tanpa tab ReSo atau belum login → tetap "Belum tersambung". Test: 3 kasus baru (handoff laku → connected; tiada tab → tidak; tab belum login → tidak).

### Domain ReSo dinamis (publikasi ramah-fork) + app push
- **Akar bug laporan**: `RESO_URL` di-hardcode `https://reso.vercel.app` → pesan "Buka ReSo (reso.vercel.app)" & API/health/handoff salah sasaran bila user deploy ke domain lain (mis. `rekapsosmed.vercel.app`). Domain sekarang **tidak di-hardcode**: `getResoUrl()` (shared.js) membaca `resoUrl` storage, fallback default. Semua `POST /api/engagement`, `GET /api/health`, `handoffResoAuthFromTab`, dan pesan `needsLogin` memakai domain dinamis itu.
- **App push (web → ekstensi)**: app mendorong token sesi ke ekstensi lewat `RESO_CONNECT` (`src/lib/extension-bridge.ts` → `chrome.runtime.sendMessage(EXTENSION_ID, …)`) saat login & tiap fokus; ekstensi mempelajari `url` origin-nya sendiri. Butuh `extensionId` di `firebase-applet-config.json` (isi saat publikasi). Ekstensi terima push HANYA bila `sender.url` origin = `url` payload (anti-spoof); bila `resoUrl` di-pin, push domain lain ditolak (`applyResoConnect`).
- **Options page baru** (`options.html/js/css` + `options_page` di manifest): field **URL ReSo** untuk pin manual domain (jangkar keamanan & fallback instan bila app belum push). Memvalidasi https/http-localhost.
- **Popup**: status kini menampilkan domain terhubung; tombol **"Buka ReSo"** (buka tab domain), **"Kirim ulang antrian"**, **"Putuskan"** (lupa koneksi).
- **`externally_connectable`** ditambah di manifest (`matches: https://*/*`) agar web app bisa kirim pesan ke ekstensi.
- **Hardening app push (audit)**: `applyResoConnect` kini menolak token yang `aud` (projectId Firebase) ≠ `RESO_FIREBASE.projectId` — situs asing yang tahu ID ekstensi tak bisa menyuntik token project lain. Validasi origin pengirim = `url` (sudah ada) + pin URL di Options tetap jadi jangkar terkuat: siapa pun yang mem-fork wajib isi `extensionId` & (disarankan) pin URL di Options.
- **FIX KRITIS audit — sesi app tak boleh dibatalkan**: push (`extension-bridge.ts`) & handoff (`App.tsx` provideTokens) tadinya mengirim **refresh token** (bahkan melalui `rotateRefreshToken`). Firebase `securetoken` MEMUTAR & MENCABUT refresh token sumber tiap mint → memberi ekstensi refresh token (asli/rotasi) diam-diam **membatalkan sesi login dashboard ReSo sendiri** (operator logout). Sekarang keduanya HANYA mengirim `idToken` (~1 jam); ekstensi me-refresh lewat push ulang saat tab ReSo fokus + handoff ulang saat tab ReSo terbuka. `rotateRefreshToken` tetap ada (teruji) tapi dilarang pakai untuk provisioning ekstensi. `external_connectable`/origin/aud tetap valid.
- Test: `getResoUrl` default/dipelajari; `applyResoConnect` tolak skema salah / tanpa idToken / pin salah; `sendNamesToResoApi` & `checkResoConnection` menarget domain dipelajari (bukan hardcoded).
- **Test anti-drift config**: `RESO_FIREBASE` (projectId / firestoreDatabaseId / apiKey) dikorek silang dengan `firebase-applet-config.json` repo — kunci Firebase yang di-hardcode ekstensi tidak bisa melenceng diam-diam.
- Test: `reso-api` +7 (handoff content-script via runtime; delegasi gagal → null; kirim transien → antri; 400 → tidak antri; dedupe enqueue; flush sukses/transien/definitif/tanpa-token; `checkResoConnection` auth+reachable+pending). Audit P1 lanjutan: +5 (`RESO_ENQUEUE` delegasi, fallback lokal, 401 retryable+antri, flush 401 pertahankan, config sinkron). ReSoEx **390 total / 389 pass** (1 gagal hanya `dist/manifest.json` saat belum build).


## [1.0.51] — 18 Agustus 2026

### Test E2E alur `rekapSend` — hint postedAt/suggestedIso diteruskan sampai body API (P3)
- **`tests/rekap-send.test.mjs`** (baru): menjalankan `rekapSend` **ASLI** ketiga content script (diekstrak & dieksekusi; engine di-stub di seam `startExtract`) dengan `document` palsu, tapi scanner/parser (`scanPageForPostDate`/`createTimeFromRehydration`) **dan** `sendNamesToResoApi` **ASLI** dari shared.js (fetch + chrome di-stub) — rantai penuh diverifikasi: `rekapSend` → deteksi tanggal DOM → hint → `POST /api/engagement` → `body.postedAt`.
- **FB**: `data-utime` (unix detik) → hint `{suggestedDate, suggestedTime, suggestedIso, label}` identik + `postedAt` di body + pesan panel ber-prefix label. **IG**: `time[datetime]` dengan `Z` → dikonversi ke waktu lokal (ekspektasi dihitung dari zona mesin, deterministik). **TT**: `createTimeFromRehydration` **menang atas** scan DOM — konflik tanggal dibuktikan (data-utime berbeda di DOM, hint & `postedAt` tetap dari rehydration).
- Fallback: DOM tanpa tanggal → hint `{}` diteruskan, tanpa `postedAt` di body (tanggal default hari ini di sisi API); tanpa nama → `sendNamesToResoApi` tidak dipanggil + pesan "Tidak ada nama untuk dikirim ke ReSo." (keduanya loop 3 platform).
- **Jalur kegagalan (loop 3 platform)**: API balas error (400, `{error}`) → pesan error tampil di panel **dengan prefix label post** (`Post ~9 Agu pukul 07.30 — Tanggal tidak valid`) & `postedAt` tetap dikirim; fetch gagal (network) → pesan `Gagal kirim ke ReSo: network down` (body dibangun lengkap sebelum gagal); `sendNamesToResoApi` melempar → catch luar rekapSend → `Gagal kirim ke ReSo: boom` (tanpa prefix label — bentuk pesan dikunci).
- **Harness `makeFullHarness` menjalankan `startExtract` ASLI** (sebelumnya di-stub): fungsi content script asli (sendBg, engineCmd, waitEngineReady, acceptFromInject, isCurrentRun, mapDone, doneMessage, mergeNames, normalize, startExtract, rekapSend) + **listener pesan engine asli** diekstrak & dieksekusi; hanya background (chrome.runtime.sendMessage), engine (DONE sinkron saat START), document, location yang di-stub. Test baru (loop 3 platform):
  - **Engine dijalankan SEBELUM kirim**: urutan satu timeline diverifikasi `SET_STATE` (running) → `ENGINE_CMD:START` → `POST /api/engagement`; nama yang dikirim = hasil DONE engine (ternormalisasi), bukan stub; hint tanggal & `postedAt` tetap diteruskan; pesan done engine (`Selesai — 1 nama`) muncul di panel.
  - **Cooldown antar-run memblokir engine**: `lastRunEndAt` baru → status tetap idle, pesan "Tunggu 15 dtk… (cooldown anti rate-limit)", `ENGINE_CMD:START` TIDAK dikirim, timer dicatat (stub setTimeout, tanpa menunggu 15 dtk) & simulasi selesai → "Cooldown selesai — klik Proses untuk mulai."
  - **Cooldown rate-limit lebih lama**: `lastRateLimitAt` baru → pesan "Tunggu 60 dtk…", timer ≈ 60 dtk, engine tetap diblokir. Test: **373/373**.

### Audit keamanan alur token ReSo — handoff multi-tab, bersihkan refresh token mati, validasi sender (P2)
- **`handoffResoAuthFromTab` kini mencoba SEMUA tab ReSo, bukan hanya tab pertama**, dan **prefer produksi** (`reso.vercel.app`) di atas dev (`localhost:3000`) — tab dev usang dengan sesi mati tidak lagi menaungi sesi produksi; tab tanpa content script/balasan dilewati, bukan menghentikan handoff.
- **`ensureResoIdToken` membersihkan auth tersimpan saat mint gagal definitif** (`INVALID_REFRESH_TOKEN` / `TOKEN_EXPIRED` / `USER_DISABLED` / `USER_NOT_FOUND`): run berikutnya langsung handoff, tidak mencoba mint mati berulang kali. Error transien (network / API key) tetap mempertahankan auth untuk percobaan berikut.
- **`mintResoIdToken` menandai error Firebase dengan kode** `err.code` (kata pertama pesan, mis. `INVALID_REFRESH_TOKEN`) supaya pemanggil bisa membedakan error definitif vs transien.
- **`content-reso.js` memvalidasi `sender.id === chrome.runtime.id`** — hanya konteks ekstensi sendiri yang bisa memicu handoff token (defense-in-depth; halaman web tidak bisa mengirim pesan runtime tanpa `externally_connectable`).
- Test: `reso-api` +7 (mint definitif → bersihkan + handoff; mint definitif tanpa tab → null; mint non-definitif → auth dipertahankan; prefer produksi + skip tab gagal; semua tab gagal → null; sender non-ekstensi & tanpa id diabaikan). ReSoEx **362/362**.

### Waktu posting disimpan di ReSo — `postedAt` (L3)
- **ReSoEx**: `sendNamesToResoApi` kini mengirim `postedAt` (ISO lokal dari deteksi post, `hint.suggestedIso`) bersama `{platform, names, date}` — opsional, tanpa field = perilaku lama.
- **ReSo api/engagement.ts**: menerima `postedAt`, divalidasi (`isValidPostedAt`: ISO lokal `YYYY-MM-DDTHH:MM`, tanggal kalender nyata), disimpan sebagai **array** `postedAt` di `dailyEngagement/{date}` (append + dedupe via `mergePostedAt` — satu hari bisa banyak post, kirim ulang tidak menduplikasi).
- **Dashboard ReSo**: header modal rekap menampilkan "Waktu posting: 07:30 · 14:05" (dari array `postedAt`) — tipe `DailyEngagement.postedAt?: string[]`.
- Test: ReSoEx +1 (`reso-api`), ReSo `engagement-api` +1 blok (validasi+merge) & handler +3 skenario (create, append+dedupe, invalid→400). ReSoEx **355/355**, ReSo api 9 + handler 10 checks.

### Tanggal + jam posting: parser "pukul", data-utime, aria-label, TikTok createTime (P2)
- **`parsePostAgeText` kini mengembalikan `{date, time, iso, label}`** (bukan hanya tanggal): format absolut "8 Agu pukul 07.30"/"18 Agustus 2026 pukul 07.30" dikenali (sebelumnya GAGAL total → rekap jatuh ke hari ini), waktu sub-hari dihitung presisi ("3 jam" dari 02:00 → 23:00 kemarin), "Kemarin/Hari ini pukul …" mempertahankan jam, dan `time[datetime]` ISO dengan `Z` dikonversi ke waktu lokal (sesuai yang operator lihat di UI).
- **`scanPageForPostDate` menambah dua sumber**: atribut `data-utime` (unix detik, FB) dan `aria-label` ("18 Agu pukul 07.30", FB) sebelum fallback teks biasa.
- **TikTok**: `createTimeFromRehydration` (baru, shared.js) membaca `createTime` dari `__UNIVERSAL_DATA_FOR_REHYDRATION__` (defensif terhadap struktur, angka di luar rentang diabaikan); `rekapSend` TikTok memakai hasilnya (lebih presisi dari teks relatif).
- Test `reso-bridge`: 6 test baru (absolut+pukul, waktu sub-hari, ISO Z→lokal, data-utime, aria-label, rehydration). Test: **354/354**.

### Deteksi umur post: singkatan FB "bln"/"thn" (P3)
- `parsePostAgeText` kini mengenali **"1 bln"** (bulan) dan **"1 thn"** (tahun) — singkatan yang dipakai Facebook Indonesia untuk umur post. Sebelumnya post sebulan/setahun lalu yang tampil sebagai "1 bln"/"1 thn" tidak terdeteksi dan rekap jatuh ke tanggal hari ini; sekarang saran tanggal mengikuti tanggal post (dengan clamp akhir bulan yang sama). Test bertambah di `reso-bridge`: 5 kasus relatif + 2 clamp.

### Validasi skema manifest MV3 di CI (P3)
- **`scripts/check-manifest-schema.mjs`** (baru): validator semantik zero-dependensi yang meng-encode aturan yang benar-benar diperiksa Chrome saat load-unpacked — format `version` (1-4 integer), match patterns (`scheme://host/path`, wildcard hanya di label kiri), whitelist `permissions` (nama tak dikenal = ditolak Chrome), `run_at` enum, ukuran kunci ikon, `background.type` module, `suggested_key` (satu tombol akhir, tanpa modifier duplikat), referensi file ada, dan kunci top-level tak dikenal (guard kode mati). Dijalankan di `npm run check` → otomatis masuk CI.
- Alasan tidak pakai file skema resmi: Chromium modern tidak lagi menyediakan JSON Schema manifest top-level (penerapannya di C++ `manifest_*.cc`), jadi validator semantik ini penggantinya yang selalu hijau tanpa dependensi.
- Cross-check dengan `web-ext lint`: 0 error format (2 error yang muncul adalah syarat Firefox — `background.scripts` fallback + gecko id — yang tidak berlaku untuk Chrome).
- Test baru `tests/manifest-schema.test.mjs` (11 kasus: 2 manifest asli valid + 9 negatif). Test: **348/348**.

## [1.0.50] — 17 Agustus 2026

### Konsistensi versi artifact (P2)
- **Versi manifest kini di-stamp otomatis** dari `package.json` saat build (`scripts/stamp-version.mjs`) — zip `reso-ekstention-<versi>.zip` dijamin berisi `manifest.json` dengan versi yang sama (sebelumnya manifest bisa tertinggal, mis. zip v1.0.50 berisi manifest 1.0.49).
- **Guard versi di `scripts/zip.mjs`**: release gagal bila `dist/manifest.json` ≠ `package.json` — mismatch seperti ini ketahuan sebelum release, bukan sesudahnya.

### Ekstensi minimalis: toggle mode + panel 6 fitur (P1)
- **Popup jadi switch mode ekstensi** (ON/OFF): tidak ada lagi panel penuh di popup. Saat ON, FAB + panel muncul di halaman FB/TikTok/IG; saat OFF disembunyikan. Status tersimpan di `chrome.storage.local` (`rsx_enabled`), sinkron real-time lewat `storage.onChanged`.
- **Panel disederhanakan ke 6 aksi inti**: Rekap, Copas (Salin), Rekap + Kirim ke ReSo, Hentikan, Bersihkan hasil, dan checkbox Balasan (centang). Semua fitur lain dihapus: pencarian, urutan A–Z, badge Siap/Belum, preview list, chip inline FB, swap, menu/opsi, backup/restore, dan halaman options.
- **Satu sumber ikon dipangkas**: sprite 28 → **11 symbol** (hanya ikon yang benar-benar dipakai panel minimal — logo, kontrol panel, swap Proses, dan tombol Rekap+Kirim). Halaman `options.html`/`options.js`/`options.css` dihapus total; `background.js` kehilangan menu konteks & handler state lama, badge tetap hormati mode.
- **Test disesuaikan dengan panel minimal**: test hint/badge/list/chip/search/swap dihapus, snapshot sprite 11 symbol & panel 9 svg, parity count ditulis ulang (filter/sort dihapus). `duplication-registry`: `applyMode` didaftarkan, `toggleSort`/`mergeAll`/`setTemplate` dibuang. Test: **337/337**, zip 411,7 KB (sebelumnya 478 KB).

### Tutup gap data: antrian nama belum terpetakan di pesan sukses (P3)
- `sendNamesToResoApi` kini mem-parse field `unmatched` dari respons `/api/engagement` dan memasukkannya ke pesan sukses popup: *"… N nama belum terpetakan di ReSo — buka dashboard untuk memetakan."* — operator langsung tahu ada nama yang belum match ke pegawai dan bisa memetakan sekali (kiriman berikutnya otomatis match). Tanpa field/0 → pesan normal tidak berubah. Test: **357/357** (+2 assertion `reso-api`).

### Mitigasi paparan refreshToken pada handoff token (P2)
- **content-reso.js**: saluran balasan UNIK per permintaan (`reso:token-response-<requestId>`) — skrip halaman yang sekadar mendengarkan nama event tetap tidak melihat apa pun; guard sekali-pakai (satu permintaan dibalas tepat sekali, duplikat diabaikan); cek origin respons (wajib echo origin halaman, selain itu diabaikan); validasi bentuk respons (hanya field dikenal, koersi tipe aman; `refreshToken` boleh kosong = mode idToken-only).
- **ReSo (App.tsx + `src/lib/token-handoff.ts`)**: sebelum token dikirim, refresh token sesi di-ROTASI — mint pasangan segar via REST securetoken, jadi token sesi utama **tidak pernah keluar dari halaman**; ekstensi hanya menerima rantai turunan. Guard sekali-pakai per requestId + cek origin + channel balasan dari request. Jika rotasi gagal → hanya idToken (masa ~1 jam) yang dikirim, ekstensi handoff ulang saat kedaluwarsa.
- Test: ReSoEx **355/355** (5 test baru content-reso), ReSo `token-handoff` **13 checks**. Catatan jujur: refresh token Firebase tidak bisa dicabut dari sisi client — revoke sejati butuh Admin SDK `revokeRefreshTokens(uid)` yang menandai SEMUA token user (sesi dashboard ikut logout).

### Bersihkan kode mati jembatan Opsi A (P3)
- Jembatan isi textarea Opsi A dihapus total setelah tombol **Kirim ke ReSo** dicabut: `sendNamesToReso` + `buildResoFillPayload` (shared.js/shared-module.js), handler `FILL_RESO_TEXTAREA` di content-reso.js, dan ikon `send` dari sprite (28 → 27 symbol). Di repo ReSo: `src/lib/reso-bridge.ts` + test-nya dihapus, script `test:bridge` dibuang, EngagementDashboard kehilangan state/effect/modal konfirmasi pengisian. Test `bridge-simulation` (rantai lintas repo) ikut dihapus. Parser umur post (`parsePostAgeText`/`scanPageForPostDate`) **dipertahankan** — masih dipakai saran tanggal Rekap+Kirim (Opsi C). Test: 350/350.

### Hapus fitur Ekspor CSV (P3)
- Tombol **Simpan ke CSV** dihapus dari popup dan panel ketiga platform (FB/TikTok/IG) — alur utama sekarang **Rekap + Kirim ke ReSo** (Opsi C) atau Copy; ekspor file `.csv` tidak lagi disediakan.
- `csvContent` + ikon `download` dihapus dari shared.js (sprite 29 → 28 symbol), `exportCsv`/`downloadTextFile` lokal di content script dibuang (helper `downloadTextFile` di shared.js tetap dipakai Backup JSON). Test diperbarui: `normalization-fixture` & `ui-consistency` (CORE_ACTIONS/RENDER_KEYS/KEYS tanpa `csv`, snapshot sprite 28).

## [1.0.49] — 2026-08-17

### Rekap + Kirim otomatis ke database ReSo via API (Opsi C) — satu tombol (P1)
- **Alur baru**: tombol **Rekap + Kirim** (ganti "Mulai ambil nama") — setelah ekstraksi selesai, hasil **otomatis dikirim ke database ReSo** lewat `POST /api/engagement`, tanpa klik kirim terpisah dan tanpa membuka tab ReSo. Tombol "Kirim ke ReSo" (jembatan isi textarea Opsi A) dihapus dari popup.
- **API ReSo** (repo terpisah, `api/engagement.ts` — Vercel serverless, **zero env var**): verifikasi idToken via identitytoolkit `accounts:lookup`, cek admin (allowlist email cermin `firestore.rules` + `admins/{uid}`), baca data pegawai via Firestore REST **memakai token operator** (rules tetap penjaga), lalu `buildEngagementPatch` (`src/lib/engagement-api.ts`, murni & teruji): merge `mergeUniqueLines` (dedupe case-insensitive) + hitung ulang `engagedEmployeeIds` via modul matching yang sama dengan dashboard. Tulis `dailyEngagement/{date}` — **PATCH updateMask** (doc ada) atau **POST create** (baru). **Idempotent**: kirim ulang = update (0 baru, N sudah ada); **1 hari bisa banyak post** — setiap kirim di-merge ke tanggal sama.
- **Sesi**: ekstensi menyimpan `{idToken, refreshToken}` di `chrome.storage.local` — handoff **sekali** dari tab ReSo yang sudah login (`content-reso.js` branch `GET_AUTH_TOKEN` → CustomEvent `reso:get-token` → `App.tsx` membalas `reso:token-response` dengan idToken+refreshToken), lalu refresh token di-mint via Firebase `securetoken` REST **tanpa tab terbuka**. Prioritas: token fresh → mint → handoff → pesan "buka ReSo sekali".
- **Tanggal**: saran umur post (lapis 2) atau hari ini lokal; API menolak tanggal masa depan. Status popup: `Post ~Kemarin — Terkirim ke rekap 2026-08-16 — 2 nama baru, 1 sudah ada.`
- **Manifest**: host_permissions + `https://reso.vercel.app/*` (API) dan `https://securetoken.googleapis.com/*` (mint token). `vercel.json` ReSo mengecualikan `api/` dari rewrite SPA.
- **Test**: ReSoEx `tests/reso-api.test.mjs` (+9 → **364/364**): kirim dengan token valid (Bearer + body), expired → mint dari refresh token, tanpa token → handoff dari tab, tanpa apa pun → needsLogin tanpa fetch, tanggal default hari ini, `jwtExpSeconds`, `ensureResoIdToken` prioritas, dan `content-reso.js` GET_AUTH_TOKEN round trip + timeout. ReSo `npm run test:api` (12 cek): `buildEngagementPatch` (merge/dedupe/recompute ids/idempotent/multi-post/validasi) + simulasi handler `api/engagement.ts` (create vs PATCH, non-admin 403, token invalid 401, tanggal buruk 400, OPTIONS 204).
- **ReSo menyesuaikan diri** (repo terpisah): API menulis penanda `autoFilledAt` (timestamp) + `autoFilledCount` ke dokumen; dashboard (sudah real-time via `onSnapshot`) menampilkan **toast "Rekap {tanggal} diisi otomatis dari ReSoEx — cek lalu simpan"** (sekali per tanggal per sesi), **badge hijau "Dari ReSoEx"** di header modal input, dan **titik hijau di kalender** untuk tanggal ber-`autoFilledAt` (legenda "Dari ReSoEx") — operator langsung tahu data sudah masuk dan tinggal review → simpan (tambah link, dsb.). Pengisian memakai **merge aman**: ketikan manual operator di textarea dipertahankan (dedupe case-insensitive, efek terpisah agar tidak ke-gerus re-render), toast statistik "X ditambahkan, Y sudah ada". `DailyEngagement` di `types.ts` diperluas; simulasi handler mengecek penanda tertulis di create & update.
- **Catatan**: fitur ini mensupersede keputusan "isi textarea + review lalu simpan" (Opsi A) atas permintaan owner — data langsung tersimpan, dashboard ReSo tetap menampilkan & bisa diedit sebelum/tanpa simpan ulang. Domain produksi tetap satu-sumber di `RESO_URL` (shared.js) — jika domain resmi berbeda, ubah satu konstanta.

### Jembatan ReSoEx → ReSo (Opsi A v1) — tombol "Kirim ke ReSo" (P2)
- **Ekstensi**: tombol **Kirim ke ReSo** di popup (ikon `send`, per platform) mengirim hasil ekstraksi ke aplikasi ReSo: `sendNamesToReso` (shared.js) memakai tab ReSo yang sudah terbuka (yang aktif lebih dulu) atau membuat tab baru dan menunggu load, lalu `chrome.tabs.sendMessage` → content script `content-reso.js` (baru, domain `https://reso.vercel.app/*` + `http://localhost:3000/*` di manifest) meneruskan sebagai CustomEvent `reso:fill-engagement`. Satu-sumber domain: `RESO_URL`/`RESO_MATCH_PATTERNS` di shared.js, test memastikan manifest sinkron.
- **ReSo** (repo terpisah, `src/lib/reso-bridge.ts` + hook di EngagementDashboard): textarea platform terisi otomatis pada **tanggal yang sedang dipilih** di dashboard (default hari ini) — operator tetap review lalu simpan (alur rekap tidak berubah, selaras specify.md §7). Payload tidak membawa tanggal: tanggal ditentukan konteks dashboard, bukan tebakan ekstensi.
- **Test**: ReSoEx `tests/reso-bridge.test.mjs` (+7 → **342/342**): payload valid/invalid, kirim ke tab ada/baru (tunggu complete)/error, sinkron manifest. ReSo `src/lib/reso-bridge.test.ts` (`npm run test:bridge`): pemetaan platform, patch textarea, kontrak nama event.
- **Lapis 2 — saran tanggal dari umur post (best-effort)**: saat kirim, popup meminta `GET_POST_AGE` ke tab aktif; content script memindai DOM via `scanPageForPostDate` (shared.js) — `time[datetime]` dulu, lalu teks relatif pendek (`Kemarin`, `2 hari`, `5d`, `10 Agustus`, ISO). `parsePostAgeText` memetakan ke tanggal kalender lokal (sub-hari dihitung dari "sekarang" agar lintas tengah malam benar; absolut tanpa tahun yang jatuh di masa depan → tahun sebelumnya). Hasil dikirim sebagai `suggestedDate` + `label` di payload — **SELALU saran**: ReSo menampilkan banner konfirmasi sekali klik ("Pindah ke rekap X" / "Isi di tanggal aktif") saat saran berbeda dari tanggal aktif; tanggal rekap tetap keputusan operator (specify.md §7).
- **Test lapis 2**: `tests/reso-bridge.test.mjs` (+8 → **350/350**): parser relatif/absolut/ISO + lintas tengah malam + clamp akhir bulan (31 Mar − 1 bulan → 28 Feb; 29 Feb − 1 tahun → 28 Feb) + non-umur-post → null; scanner DOM (datetime menang, fallback teks); hint valid/invalid di payload; passthrough hint saat kirim. ReSo `decideResoFill` (apply/confirm/none) diuji di `src/lib/reso-bridge.test.ts`.
- **Simulasi level kode lintas repo** (`tests/bridge-simulation.test.mjs`, +4 → **354/354**, auto-skip bila repo ReSo tak tersedia): rantai penuh dengan KODE ASLI — popup (`sendNamesToReso`) → `chrome.tabs.sendMessage` → `content-reso.js` (di-eval dengan stub chrome/window) → CustomEvent `reso:fill-engagement` → `decideResoFill` (import `reso-bridge.ts` asli repo ReSo via Node type-stripping) → apply/confirm → textarea terisi. Termasuk cross-check `reso-bridge.test.ts` repo ReSo lulus di Node tanpa `npm install`.
- Ikon `send` baru di sprite (Material 24) — snapshot ikon ui-consistency diperbarui 28 → 29.

## [1.0.48] — 2026-08-17

### Validasi sintaks YAML workflow di CI — `scripts/check-yaml.mjs` (P3)
- **Bug yang dicegah**: workflow YAML yang rusak tidak terlihat sampai di-push — GitHub langsung menggagalkan run-nya dengan 0 job (persis release.yml v1.0.47: baris lanjutan `--notes` di kolom 0 memutus literal block `run: |` dan menjadi key root `Artifact` yang tak dikenal). Checker ini jalan dari `npm run check` → CI menolak file workflow yang rusak SEBELUM push.
- **`scripts/check-yaml.mjs`** (baru, zero-dependensi — pola zip.mjs): memvalidasi semua `.github/workflows/*.yml` — (1) TAB & indentasi tidak konsisten; (2) block scalar `|`/`>` — konten wajib lebih dalam dari key-nya (akar bug v1.0.47); (3) kutip tidak seimbang di luar block scalar; (4) ekspresi `${{ }}` tidak seimbang (termasuk di dalam `run:` — GitHub mengevaluasinya di mana pun); (5) baris bukan key/item; (6) key duplikat (warning); (7) skema workflow GitHub: key root hanya dari set yang dikenal (name/on/permissions/concurrency/env/defaults/jobs/run-name), `on` + `jobs` wajib, tiap job punya runs-on (atau uses untuk reusable) + steps, tiap step punya name/uses/run.
- **`npm run check`** kini diakhiri `node scripts/check-yaml.mjs` — CI tiap push/PR otomatis memvalidasi.
- **Test** (`tests/check-yaml.test.mjs`, +9 → **331/331**): ci.yml & release.yml asli lolos; diskriminator — rekonstruksi versi rusak v1.0.47 tertangkap persis ("key root tidak dikenal: Artifact"), TAB di indentasi, konten block scalar di indentasi key-nya, `${{ }}` tidak seimbang, key root asing, job tanpa runs-on, step tanpa name/uses/run — tiap kelas merah saat diuji. Temuan saat penulisan: `${{ }}` di dalam template literal JS ikut ter-interpolasi jadi `[object Object]` — dipakai konstanta `EXPR_TAG` untuk pesan error.

### Release notes otomatis dari CHANGELOG — `scripts/changelog-notes.mjs` (P3)
- **`scripts/changelog-notes.mjs`** (baru, zero-dependensi — pola zip.mjs): ekstrak entri `## [<versi>]` dari CHANGELOG.md (terima `1.0.47` maupun `v1.0.47`), isi = header + semua baris sampai header `## ` berikutnya (batas antar-versi aman). Output ke file (untuk `--notes-file`) atau stdout; entri tidak ditemukan → exit 1 + pesan jelas — release TIDAK dibuat tanpa entri CHANGELOG.
- **release.yml**: langkah baru **"Ekstrak Release notes dari CHANGELOG"** (`node scripts/changelog-notes.mjs "$VERSION" "$RUNNER_TEMP/notes.md"`) sebelum `gh release create`; `--notes "..."` statis diganti `--notes-file "$RUNNER_TEMP/notes.md"` — isi Release notes kini = entri CHANGELOG versi yang dirilis. `scripts/changelog-notes.mjs` masuk daftar `npm run check`.
- **Test** (`tests/changelog-notes.test.mjs`, +4 → **335/335**): ekstrak 1.0.47 dari CHANGELOG asli (mulai dari header, berisi "Release tooling", TIDAK bocor isi [Unreleased] maupun [1.0.46]); ekstrak 1.0.46 (batas bawah benar, tidak berisi konten 1.0.47); `v1.0.47` dinormalisasi → bagian identik dengan `1.0.47`; versi tanpa entri (99.99.99) → error "tidak ditemukan".

## [1.0.47] — 2026-08-17

### Release tooling — `npm run zip` sekali perintah, build fix Windows, CI otomatis (P3)
- **Fix build: `mkdir -p` rusak di cmd.exe Windows** — npm menjalankan script via cmd.exe yang memakai builtin `mkdir`, sehingga `-p` diperlakukan sebagai NAMA folder, bukan flag → tiap build "sukses" diam-diam membuat ulang folder sampah `-p`, lalu build berikutnya error *"A subdirectory or file -p already exists"*. Kini `mkdir dist` (tanpa `-p`, aman karena `rm -rf dist` jalan dulunya); folder sampah `-p` dibersihkan.
- **`cp -r fonts dist/` dihapus** — referensi terakhir ke folder `fonts/` yang sudah dibuang sejak konversi glyph font → sprite SVG (v1.0.46); build tidak lagi berhenti/gagal di langkah ini.
- **Script release baru `npm run zip`** (`scripts/zip.mjs`, zero-dependency — tanpa tool `zip`/PowerShell/Python): build + zip `reso-ekstention-<version>.zip` (versi otomatis dari package.json). Zip writer memakai `zlib` bawaan Node (deflate level 9) + CRC32 manual; entry ber-nama forward-slash + flag UTF-8 (aman diekstrak di Windows/macOS/Linux). `scripts/zip.mjs` ikut masuk daftar `npm run check`.
- **Verifikasi referensi SEBELUM zip ditulis** — seluruh referensi file wajib ada di dalam zip: manifest.json (ikon, popup, options page, service worker, content scripts js/css = 13) + referensi sekunder (aset href/src di popup.html & options.html, import module background/popup/options → shared-module.js → shared.js termasuk bare `import "./shared.js"`, dan nama file executeScript `inject-*.js`/`content-*.js/css`) — kalau ada yang hilang: error per file + sumber rujukan, exit 1, zip TIDAK ditulis. Setelah ditulis, zip di-inflate ulang & CRC tiap entry dicek (23/23).
- **CI GitHub Actions** (`.github/workflows/ci.yml`): `npm run check` + `npm test` di tiap push & PR (ubuntu-latest, Node 20, tanpa `npm install` — proyek zero-dependensi; concurrency cancel-in-progress).
- **Release otomatis via tag** (`.github/workflows/release.yml`): push tag `vX.Y.Z` → guard versi (tag wajib cocok persis dengan `version` di package.json, kalau tidak gagal di awal) → `npm run zip` (build + verifikasi referensi + integritas CRC — release rusak tidak pernah ter-upload) → `gh release create` (CLI bawaan runner, tanpa action pihak ketiga) meng-upload `reso-ekstention-<version>.zip` sebagai artifact GitHub Release, dengan nama file persis dari versi (bukan glob). Permission `contents: write` minimal untuk membuat release; concurrency cancel-in-progress per tag.
- **Uji**: `npm run check` Syntax OK, `npm test` tetap **322/322**; verifikasi zip independen (Python zipfile: `testzip()` bersih, manifest identik, path forward-slash); jalur gagal diuji nyata (file content-ig.css dihapus dari dist → error referensi + exit 1, zip tidak ditulis).

## [1.0.46] — 2026-08-16

### Test chip fnk-inline — utuh saat SPA navigation FB (post berganti, chip dibuat ulang) (P3)
- **Harness realChip +`navigate()`**: `chipConnected`/`currentChip` meniru DOM sungguhan — `document.getElementById("fnk-inline")` hanya mengembalikan chip yang "terhubung"; `navigate()` membuang chip lama (connected=false) lalu menjalankan `ensureActionIcon` ASLI yang idempotent (getElementById null → `createElement` membuat **elemen baru**) — persis alur observer React FB yang memanggil `placeInlineBar` saat post di-render ulang. Hosting DOM (findBestPost/appendChild) di-stub; kontrak yang diuji = re-creation + integritas ikon + sinkronisasi state.
- **Test baru `RENDER facebook (exec): chip fnk-inline — utuh saat SPA navigation`**: chip A (running, 1 nama) → `navigate()` → chip B **elemen berbeda** (`chipB !== chipA`), markup sprite `<use>` segar & polos (tanpa kelas state) → renderUi menyinkronkan state (running + badge `1` + title proses) → transisi done+2 nama tetap normal di chip B → **chip A yang terlepas tetap utuh** (ikon sprite + state lamanya, tidak disentuh render baru).
- **Diskriminator terbukti**: `<use>` diregresi ke `<path>` hardcoded → KETIGA test chip merah (multi-state, SATU lifecycle, SPA navigation), lalu di-revert. `npm test` naik 321 → **322**, Syntax OK.

### Test chip fnk-inline — SATU lifecycle: render berulang pada instance yang sama (P3)
- **Harness `makePanelRenderer` +`setState`**: objek hasil kini memuat `setState(patch)` yang mem-patch variabel closure render (status/names/hint/query/includeReplies/sortAz/hasTemplate) — **satu instance bisa di-render berulang dengan state berbeda**, persis perilaku panel di halaman (SPA navigation / state engine mere-render elemen yang sama), bukan instance-per-state seperti test sebelumnya.
- **Test baru `RENDER facebook (exec): chip fnk-inline — SATU lifecycle (idle→running→done→stopped→running)`**: satu chip NYATA (dari `ensureActionIcon` asli) dirender 5× berturut-turut — tiap state memverifikasi ikon tetap `<use href="#rs-i-forum"/>` (nol `<path>`, nol span glyph), kelas state bertransisi dengan benar (running→done→running: kelas lama dibersihkan via `toggle` false), badge mengikuti (`…`/`2`/`1`), dan **`innerHTML` chip identik dari snapshot awal di setiap render** — renderUi tidak pernah menulis ulang/merusak markup ikon. Helper `assertChipIconSprite` di-hoist ke module scope (dipakai kedua test chip).
- **Diskriminator terbukti**: `<use>` diregresi ke `<path>` hardcoded → KEDUA test chip merah (multi-instance + SATU lifecycle), lalu di-revert. `npm test` naik 320 → **321**, Syntax OK.

### Test eksekusi chip fnk-inline — ikon <use> ke sprite, bukan path hardcoded (P3)
- **Harness `makePanelRenderer` +mode `realChip`** (tests/ui-consistency.test.mjs): `ensureActionIcon()` ASLI diekstrak & dieksekusi dalam vm dengan DOM stub minimal (`createElement`/`documentElement.appendChild`, `chipCreated` meniru DOM sungguhan) — chip dibuat dengan markup persis yang di-inject ke halaman FB, lalu `renderUi` memakai chip yang sama (blok chip tidak lagi memakai stub kosong).
- **Test baru `RENDER facebook (exec): chip fnk-inline — ikon <use> ke sprite (bukan path hardcoded) di semua state`**: menggerakkan renderUi asli di 4 state (idle / running / done / stopped) — tiap state memverifikasi markup ikon chip: `<use href="#rs-i-forum"/>` hadir, **nol `<path>` hardcoded**, nol span glyph `rs-ic`, `aria-hidden` + class `fnk-action-svg`; plus state attrs ikut berubah (kelas running/done, badge `…`/jumlah). Bukti eksekusi fungsi sungguhan: komentar sumber template ikut tersalin di `innerHTML`.
- **Diskriminator terbukti**: `<use>` chip diregresi ke `<path>` hardcoded → HANYA test baru ini merah (pesan persis *"idle: chip tanpa <use href=…>"*), lalu di-revert. `npm test` naik 319 → **320**, Syntax OK.

### Test ukuran DOM sprite vs baseline path inline — sprite tidak pernah lebih besar (P3)
- **Test baru `UKURAN DOM sprite vs baseline path inline`** (tests/ui-consistency.test.mjs) mengukur byte RIIL (diukur dari `svgIcon`/`iconSprite` asli — bukan angka ajaib) dengan baseline = representasi lama (pra-sprite: svg dengan path di-inline per elemen, kelas ikut dihitung agar fair):
  - **Per ikon**: `svgIcon(name)` (ref `<use>`) SELALU lebih kecil dari bentuk inline-nya — 28/28 ikon (ref ~115–130B vs inline ~300–640B).
  - **Set penuh**: `iconSprite()` (15.536B) < Σ inline untuk 28 ikon sekali pakai (16.886B) — menyimpan path SEKALI + ref mungil tidak pernah lebih besar dari menempelkan path per elemen untuk pemakaian setara.
  - **Per panel**: payload ikon yang DI-RENDER `createUi` (12 ref, ~1.35KB) jauh lebih kecil dari baseline 12 svg inline (FB 5.4KB / TT 5.1KB / IG 6.9KB); dan biaya sprite sekali-per-dokumen **LUNAS** setelah R render panel — R dihitung dari byte riil (crossover = ceil(sprite / (inline−refs))): FB 4, TT 5, IG 3 — di-assert ≤ 10.
  - **Churn render**: string ikon yang dihasilkan `render()` per state change (badge Siap + swap Proses) — baru 383B vs lama 1.379B (< ⅓).
- **Diskriminator terbukti**: symbol sprite digandakan (simulasi "path tidak lagi sekali") → test `UKURAN` merah (sprite 17.6KB ≥ set-inline 16.9KB) BERSAMA test sprite SNAPSHOT (56 ≠ 28), lalu di-revert — sprite kembali 15.536B / 28 symbol, `npm test` tetap **319/319**, Syntax OK.

### Popup & Options — ikon glyph font dikonversi ke sprite sheet SVG yang sama (P2)
- **Satu sumber ikon untuk SELURUH extension**: popup & options adalah permukaan terakhir yang masih memakai glyph font Material Symbols (`<span class="rs-ic">ligature</span>` + `@font-face` bundle). Kini semuanya ikut **sprite sheet SVG `iconSprite()` yang sama dengan panel** — `ICON_PATHS` di shared.js bertambah 12 ikon (settings, public, save, restore, monitor, light_mode, dark_mode, radio_button_unchecked, autorenew, task_alt, warning, stop_circle) → total 28 symbol; `svgIcon()`/`injectIconSprite()` di-import popup.js & options.js dari shared-module (halaman extension bisa pakai module — bukan content script), sprite di-injeksi saat init. **Bundle font dihapus total**: `@font-face` + font-family dibuang dari popup.css/options.css, `fonts/material-symbols-rounded.woff2` (~369KB) dihapus, dan `web_accessible_resources` font dikeluarkan dari manifest — tidak ada permukaan glyph tersisa (jaminan anti-Google-Fonts berubah dari "di-bundle lokal" menjadi "bebas font total").
- **Markup & JS**: popup.html/options.html — 15 + 7 span glyph → `<svg class="rs-ic" data-ic="…" aria-hidden="true" width="20" height="20"><use href="#rs-i-…"/></svg>`; ikon statis apiBadge/search/sort/forum/tools/actions/theme/platform rows; ikon yang di-swap JS (platformIcon, statIcon, badge Siap/Belum, swap tombol Proses) → `innerHTML = svgIcon(...)` (pola panel `processIc`). CSS: `font-size` per konteks → `width/height` per konteks (19 icon-btn/act, 17 plat/stat, 16 search/seg/btn, 15 api-badge, 20 dasar); `font-variation-settings: "FILL" 1` dibuang (inert di SVG); aturan warna `color:` tetap (path sprite `fill: currentColor`).
- **Test** (`tests/ui-consistency.test.mjs`): `FONT` test dibalik total — SEMUA permukaan (popup/options/panel, JS/CSS/HTML) **wajib bebas font** (`@font-face` rule / nama font / URL `fonts/` / `ensureIconFont`), popup.html & options.html wajib **nol span glyph `rs-ic`**; `SNAPSHOT sprite sheet` diperluas 16 → **28 symbol** dan set "dipakai UI" kini dibangun dinamis dari data-ic popup.html/options.html + map setStatusIcon + platformIcon (facebook/music_note/instagram/public) + badge/swap — ikon baru apa pun yang dipakai wajib ada di sprite. `IKON` test tetap hijau via `canonIcons` (svg → span untuk pembanding). Diskriminator terbukti: satu ikon popup di-revert ke span glyph → test FONT merah; satu ikon dihapus dari `ICON_PATHS` → test sprite merah (27 ≠ 28) — lalu di-revert. `npm test` tetap **318/318** (popup-render exec tetap jalan dengan badge/statIcon/swap SVG), Syntax OK.

### Ikon panel — sprite sheet SVG inline tunggal di shared.js, duplikasi path 3× dihapus (P2)
- **Kurangi ukuran & hapus duplikasi path terakhir**: badge `Siap`/`Belum` masih menyematkan path penuh `check_circle`/`error` secara hardcoded di KETIGA content script (duplikasi 3×), dan chip FB `fnk-action-svg` menyematkan path `forum` 24-koordinat sendiri (berbeda dari FAB 960). Kini **satu sprite sheet inline tunggal** di shared.js: `iconSprite()` menghasilkan `<svg id="rs-icon-sprite">` tersembunyi berisi 16 `<symbol>` (13 Material Symbols + brand facebook/instagram/music_note, tiap symbol membawa viewBox sendiri: brand 24 / Material 960); `svgIcon(name, cls)` menjadi **wrapper `<use>` mungil** — `<svg class="rs-ic" data-ic="…" aria-hidden="true" width="20" height="20"><use href="#rs-i-…"/></svg>` (~110 char vs ~700 char path per elemen); `injectIconSprite()` menyuntik sprite sekali per dokumen (idempotent, dipanggil saat boot content script SEBELUM `createUi`). Badge ketiga platform → `svgIcon("check_circle") + "Siap"` / `svgIcon("error") + "Belum"`; chip FB → `<use href="#rs-i-forum"/>` (kini identik persis dengan FAB — komentar desain "ikon sama dengan FAB" benar-benar terpenuhi).
- **Kebal CSP & konsisten**: sprite adalah SVG inline (tanpa fetch eksternal — kelas masalah font diblokir tidak berlaku); disembunyikan via `#rs-icon-sprite { display:none }` di tiap content CSS (id selector menang atas aturan `svg{}` halaman; bukan inline `style=` — pola CSP yang sama dengan markup lain). `ICON_PATHS` tetap satu sumber di shared.js — **menambah ikon = edit sekali** (symbol sprite otomatis ikut); `svgIcon`/`iconSprite`/`injectIconSprite` didaftarkan di `RS_SHARED` + re-export `shared-module.js` (popup/options tidak terpengaruh — tetap glyph font di halaman extension yang aman).
- **Test** (`tests/ui-consistency.test.mjs`): `svgBlocks` kini mengekstrak href `<use>` (path pindah ke sprite); test `SNAPSHOT panel & FAB` meng-assert tiap ikon = `<use href="#rs-i-{data-ic}"/>`; test baru `SNAPSHOT sprite sheet` — 16 symbol, viewBox brand 24/960, path non-kosong, `svgIcon` merujuk sprite, semua ikon yang dipakai panel/badge/swap/chip ada di sprite, dan tiap content CSS memuat `#rs-icon-sprite{display:none}`; `assertSvgIconString` badge/swap → asersi ref sprite; `SHARED classic` +`iconSprite`/`injectIconSprite`. Diskriminator terbukti: svgIcon diregresi ke `<path>` → 3 test SNAPSHOT merah; satu ikon dihapus dari `ICON_PATHS` → test sprite merah (persis pesan jumlah symbol), lalu di-revert. Verifikasi vm: `iconSprite()` 16 symbol, `svgIcon('forum')` + badge compose benar. `npm test` tetap **318/318**, Syntax OK.

### FB — ikon panel/FAB SVG inline (Material Symbols): rusak di halaman facebook.com (P2)
- **Ikon panel & FAB FB tampil sebagai teks di halaman facebook.com** — chip inline `fnk-inline` tidak rusak (SVG), panel/FAB rusak (glyph font). Penyebab: `@font-face` `chrome-extension://` yang di-inject content script **diblokir CSP `font-src` halaman FB** — fetch font oleh halaman eksternal tidak diizinkan (klasik; popup/options tidak terpengaruh karena halaman extension). Solusi: **ikon panel/FAB FB dikonversi ke SVG inline Material Symbols** (pola chip) — tidak bergantung font/CSP sama sekali.
- **`content-fb.js`**: helper baru `svgIcon(name, cls)` memuat path Material Symbols rounded (13 ikon: close, search, sort, play_arrow, stop, content_copy, download, restart_alt, merge_type, check_circle, error, progress_activity, forum + logo brand `facebook` Simple Icons viewBox 24) → `<svg class="rs-ic" data-ic="…" aria-hidden="true">`. Template panel & FAB memakai `${svgIcon(...)}`; badge render memakai SVG inline (data-ic `check_circle`/`error`); swap ikon tombol Proses kini `processIc.innerHTML = svgIcon(running ? "progress_activity" : "play_arrow")`. CSS: aturan `svg.rs-ic` (ukuran 20px dasar, 18 min/btn, 14 badge, 22 fab). Font tetap di-bundle & `ensureIconFont` dipertahankan (idempotent; paritas struktur TT/IG yang memang masih glyph).
- **Test** (`tests/ui-consistency.test.mjs`): helper `canonIcons` menormalkan representasi ikon FB (token `${svgIcon(...)}` & SVG badge `data-ic`) → span ligature, diterapkan di iconTexts/nonLogoIcons/peta aksi→ikon/fingerprint FULL/guard badge (regex kini toleran urutan atribut; span ber-id yang diisi JS dikecualikan). Regex swap Proses FB dibedakan (`innerHTML = svgIcon(...)`); `RENDER_HARNESS` FB +`svgIcon` di extraFns (render asli jalan di semua test eksekusi). Diskriminator terbukti: FAB `forum` → `chat` → 2 test merah (peta ikon & fingerprint FULL), lalu revert. `npm test` tetap **317/317**, Syntax OK.

### Snapshot visual ikon SVG — bukti ikon tidak pernah tampil sebagai teks (P3)
- **Test visual render ikon SVG ketiga platform** (`tests/ui-consistency.test.mjs` +2, pola `makePanelRenderer`):
  - **`SNAPSHOT visual ikon SVG: panel & FAB`** — token `${svgIcon(...)}` template di-interpolasi dengan `svgIcon` ASLI (RS_SHARED) → HTML persis seperti yang dirender `createUi` di browser; satu-satunya test yang memeriksa OUTPUT ikon sebenarnya (test lain menormalkan token jadi span abstrak). Asersi: **nol span glyph `rs-ic`** (bug lama: ligature font diblokir CSP → ikon tampil sebagai teks), tepat 12 `<svg>` per platform, tiap svg punya `data-ic` valid + `aria-hidden="true"` (dekoratif) + viewBox + ukuran + path non-kosong; set ikon tepat (logo + 11 non-logo, `forum` 2×); viewBox brand 24 (facebook/instagram) vs Material 960 (termasuk music_note); aksesibilitas — tiap tombol ikon punya title + aria-label (nama aksesibel dari teks, bukan ikon), tanpa tabindex/role manual; set ikon non-logo identik lintas platform.
  - **`SNAPSHOT visual ikon SVG: badge & swap Proses (render asli)`** — render() asli tiap platform: badge **Siap** (`check_circle`+`Siap`; FB via URL permalink → `fbGraphqlReady()`, TT/IG via opsi harness `ready` → `hasTemplate`) dan **Belum** (`error`+`Belum`) keduanya SVG lengkap, serta swap tombol Proses idle `play_arrow` / running `progress_activity` — semua diverifikasi bukan glyph teks (`assertSvgIconString`: data-ic benar, path terisi, aria-hidden, tanpa span `rs-ic`).
  - **Diskriminator terbukti**: ikon min FB diganti span glyph → test merah pesan persis *"masih ada span glyph rs-ic di panel (ikon tampil sebagai teks)"*; badge TT diganti glyph → test badge merah (hanya itu) — lalu keduanya di-revert. `npm test` 315 → **317**, Syntax OK.

### shared.js dual-mode — helper satu sumber TANPA salinan inline di content script (P2)
- **Map path 15 ikon (dan helper panel lain) kini benar-benar satu sumber**: `shared.js` di-refactor menjadi **dual-mode** — tanpa statement import/export sama sekali, sehingga valid sebagai CLASSIC script (dimuat `manifest.json` content_scripts **sebelum** content-fb/tt/ig.js, mengisi `globalThis.RS_SHARED`) sekaligus MODULE (di-import side-effect oleh **`shared-module.js`** baru yang re-export bernama untuk popup/options/background/tests). **Duplikasi dihapus dari content scripts**: `svgIcon` (+map 15 path), `fbTargetLabel`, `igTargetLabel`, `resolveTheme` — salinan inline dibuang; content script cukup `const { svgIcon, … } = globalThis.RS_SHARED;` di puncak IIFE (template `${svgIcon(...)}` & render tidak berubah sama sekali). Menambah ikon = **edit sekali di shared.js** — tidak ada lagi salinan untuk di-sync. (Dynamic import module ditolak: CSP halaman bisa memblokir — kelas masalah yang sama dengan font; classic via manifest adalah jalur sinkron & kebal CSP.)
- **`shared-module.js`** (baru): `import "./shared.js"` + destructure `globalThis.RS_SHARED` (52 nama: seluruh fungsi + konstanta storage/prefs) + `export { … }` — konsumen module (background/popup/options + 3 test file) cukup ganti path import ke `./shared-module.js`. Registry `PARITY_REGISTRY` membersihkan 4 entri (fbTargetLabel/igTargetLabel/resolveTheme/svgIcon — tidak lagi terduplikasi); audit duplikasi tidak menemukan salinan baru.
- **Test**: 4 test parity dedicated (fbTargetLabel/igTargetLabel/resolveTheme/svgIcon) diganti 1 test `SHARED classic` — shared.js bebas import/export, keempat helper terdaftar di RS_SHARED & re-export shared-module.js, content script TIDAK boleh mendefinisikan ulang (`function svgIcon(`), wajib destructure `globalThis.RS_SHARED`, manifest wajib memuat `shared.js` sebelum tiap content script. `RENDER_HARNESS` dipecah `extraFns` (diekstrak dari source: extractFbFeedbackIds/fbGraphqlReady/extractShortcode) vs `sharedFns` (dari `globalThis.RS_SHARED`) — semua test eksekusi render asli tetap hijau. `npm test` 318 → **315** (4→1 konsolidasi), Syntax OK; verifikasi tambahan: simulasi load classic via `vm` → RS_SHARED 52 nama lengkap & svgIcon menghasilkan SVG benar; cross-check registry ↔ destructure ↔ export shared-module konsisten 100%.

### svgIcon — satu sumber di shared.js (registry path Material Symbols) (P3)
- **Tiga salinan `svgIcon` di-refactor ke satu sumber bersama**: `svgIcon` (map 15 path Material Symbols rounded + logo brand) kini diekspor dari **shared.js**, dan ketiga content script memegang salinan inline yang wajib identik — pola yang sama dengan `fbTargetLabel`/`igTargetLabel`/`resolveTheme` (content script tak bisa import module). **Menambah ikon cukup diedit sekali di shared.js** — drift salinan langsung terdeteksi test (bukan lagi diedit 3× tanpa pengawasan).
- **Registry & test**: `PARITY_REGISTRY.svgIcon` jadi `["shared.js", content-fb, content-tiktok, content-ig]` (PARITY helper plumbing memaksa salinan identik); test dedicated baru `PARITY svgIcon` (ekspor ada + 3 salinan identik + map berisi ikon inti & brand ketiga). Doc comment content script menunjuk shared.js sebagai sumber. Verifikasi: keempat body minified **byte-identik** (6833 char), diskriminator terbukti — satu path di shared.js diubah → `PARITY svgIcon` & `PARITY helper plumbing` merah, lalu revert. `npm test` naik 317 → **318**, Syntax OK.

### TikTok & Instagram — panel/FAB ikon SVG inline Material Symbols (parity FB, kebal CSP) (P2)
- **Konversi lengkap TT/IG ke pola `svgIcon` FB** — panel & FAB TikTok (`tnk-`) dan Instagram (`ing-`) tidak lagi memakai glyph font Material Symbols: `ensureIconFont()` (call + fungsi) **dihapus dari keduanya**, template dikonversi ke `${svgIcon(...)}` (logo `music_note` TT / `instagram` IG), badge render jadi SVG inline (`data-ic="check_circle"/"error"`), swap tombol Proses → `processIc.innerHTML = svgIcon(running ? "progress_activity" : "play_arrow")`. Ketiga platform kini seragam: ikon panel/FAB/badge bebas font — CSP halaman (FB/TT/IG) tidak bisa lagi memecah ikon menjadi teks.
- **`svgIcon` jadi helper registry parity** — map path kini berisi 15 ikon IDENTIK di ketiga file (13 Material Symbols + logo brand `facebook`/`instagram` Simple Icons 24 + `music_note` Material 960; viewBox disatukan `name === "facebook" || name === "instagram" ? 24 : 960`), didaftarkan di `PARITY_REGISTRY` (`svgIcon: 3 file`) — salinan wajib identik, di-awasi test PARITY helper plumbing. `ensureIconFont` keluar dari registry (tidak ada lagi di file mana pun). CSS TT/IG mengikuti FB: blok glyph-font dihapus, aturan `svg.X-logo-ic`/`svg.rs-ic` per konteks (18 logo/min/btn, 16 check/search, 14 badge, 22 fab); `input:checked + svg.rs-ic` mewarnai ceklis; FB juga diberi `svg.fnk-logo-ic` 18px (logo sebelumnya melayang ke 20px setelah konversi FB).
- **Test**: `RENDER_HARNESS` TT +`svgIcon`, IG +`svgIcon` di extraFns (render asli jalan); regex swap Proses diseragamkan ke `innerHTML = svgIcon(...)` (branch FB dihapus); test exec swap IG diperbarui ke asersi `data-ic="play_arrow"`/`data-ic="progress_activity"`; `FONT` test kini **semua platform wajib ABSEN** font (`ensureIconFont`/`material-symbols-rounded`/`font-family` di JS & CSS). Diskriminator terbukti: FAB TT `forum` → `chat` → 2 test merah (peta ikon & fingerprint FULL), lalu di-revert. `npm test` tetap **317/317**, Syntax OK.

### FB — audit ikon halaman facebook.com: bebas glyph font total (P2)
- **Audit seluruh elemen ikon yang disuntikkan ke halaman facebook.com** (hasil tugas konversi SVG): panel `fnk-panel`, FAB `fnk-fab`, chip bar Like `fnk-inline` (`fnk-action-svg`), badge render (`check_circle`/`error`), swap ikon tombol Proses (`progress_activity`/`play_arrow`) — **semuanya SVG inline, nol dependensi font**. `inject-fb.js` adalah engine ekstraksi murni (tidak menyuntik UI/ikon sama sekali).
- **Dead code dibuang — `ensureIconFont()` dihapus dari content-fb.js** (call + fungsi): satu-satunya jalur yang masih mencoba memuat font Material Symbols di halaman FB, padahal tidak ada konsumennya lagi (fetch-nya juga pasti diblokir CSP `font-src` FB). `content-fb.css` dirapikan: blok `.rs-ic` glyph-font dihapus (font-family/liga/font-size), aturan disasar ke `svg.rs-ic` saja — `font-size` inert di SVG dibuang, yang fungsional (color → `fill: currentColor`, width/height, flex) dipertahankan/merger; `.fnk-check input:checked + svg.rs-ic` tetap mewarnai ikon ceklis. TT/IG **tidak disentuh** — masih glyph font dan berfungsi di halamannya (registry duplikasi: `ensureIconFont` kini pair 2-file).
- **Test**: `FONT` test dipecah — TT/IG tetap wajib punya `ensureIconFont` + URL woff2 + font-family CSS (jaminan bundling), sedangkan FB kini **wajib ABSEN**: `content-fb.js` tanpa `ensureIconFont`/`material-symbols-rounded`, `content-fb.css` tanpa `font-family: "Material Symbols Rounded"` — kalau referensi font muncul lagi di permukaan FB, itu elemen yang bakal tampil sebagai teks (bug ikon rusak). Diskriminator terbukti: referensi `ensureIconFont` disuntikkan sementara ke content-fb.js → test FONT merah, lalu di-revert. `npm test` tetap **317/317**, Syntax OK.

### Popup — guard hint parity dengan panel: hint kosong saat running tanpa target (P3)
- **Fallback popup selama run berjalan dikosongkan** — sebelumnya saat `running` tanpa target bermakna, popup menampilkan placeholder netral `"Target: post di tab aktif"` / `"Target: post/reel di tab aktif"` / `"Target: tab TikTok aktif"` (fallback sengaja beda dari panel karena bukan panduan aksi — CHANGELOG v1.0.42/45). Kini guard `status === "running"` ditambahkan di ketiga cabang platform (parity penuh dengan panel content-*.js: `target ? Target : terminal || running ? "" : placeholder`) — run berjalan tanpa target bermakna → baris hint kosong; idle tanpa target → placeholder tetap tampil (perilaku idle tidak berubah). `running` kini dideklarasi sekali di blok hint (dipakai juga tombol proses/stop).
- **Test**: `tests/popup-render.test.mjs` +1 `popup guard hint (exec)` — module popup.js asli di-load per platform (IG/FB/TT), render() di-drive via jalur asli `chrome.storage.session.onChanged`: running tanpa target (`postHint: "media 123"` IG, `"capture"` FB, `videoHint: ""` TT) → hint `""`, idle tanpa target → placeholder berprefix `Target:` tetap muncul (guard tidak over-empty), dan keempat state terminal (`partial`/`stopped`/`error`/`done`) → hint `""` BAHKAN saat target bermakna ada (terminal menang atas tampilan target) — diskriminator terbukti: cabang terminal diubah menampilkan target → test merah. Asersi lama yang mengharapkan fallback saat running diperbarui ke `""` (IG & FB). `tests/ui-consistency.test.mjs` +1 `PARITY guard hint popup` (struktur): terminal const popup identik dengan panel (`state.status` dinormalisasi ke `status`), cabang terminal mengosongkan hint, tiga cabang platform wajib identik setelah target var & placeholder dinormalisasi (`TARGET ? Target : GUARD ? "" : FALLBACK`), dan ternary popup dibandingkan langsung dengan pola panel content-fb.js (guard `terminal || status === "running"` ↔ `running` → GUARD) — terkunci teks, bukan hanya perilaku. Diskriminator terbukti: hilangkan guard `running` di cabang FB → test merah (`2 !== 3` cabang). `npm test` naik 315 → **317**, Syntax OK.

## [1.0.45] — 2026-08-15

### Sesi UI layer — tombol Proses platform-aware, regex fbTargetLabel lengkap, dead ref, test popup permanen, & verifikasi lifecycle FB/TT

#### Tombol Proses popup platform-aware (P2)
- **Label tombol Proses popup kini ikut `wordFor(p)`** (pola platform-aware v1.0.17 yang diterapkan ke count/copy/CSV): `processLabel = running ? "Memproses…" : \`Mulai ambil ${wordFor(p)}\`` dipasang di **title dan aria-label**. Di halaman Instagram popup kini bilang "Mulai ambil **username**" (parity panel content-ig.js:615/777 — sebelumnya hardcoded "Mulai ambil nama" untuk semua platform); FB/TT tetap "Mulai ambil nama" (tidak berubah). Terverifikasi dengan memuat **module popup.js asli** (stub DOM/chrome): title & aria IG = "Mulai ambil username", FB/TT = "Mulai ambil nama".

#### Regex `fbTargetLabel` lengkap (P3, parity strip-list background)
- **Token mode engine `idle|graphql|hybrid` kini dikosongkan** — regex strip di shared.js **dan** salinan inline content-fb.js diperluas, jadi strip-list `fbTargetLabel` sama persis dengan background `NAMES_DONE` (`^(?:idle|graphql|hybrid|dom)`). Mode engine FB dikirim sebagai `postHint: \`${engineMode}${tip}\`` (inject-fb.js:2202) — saat ini hanya muncul di DONE (terminal, hint tersembunyi), tapi kalau mode dikirim lewat PROGRESS di masa depan, label tidak lagi bocor. Doc comment disinkronkan; PARITY salinan inline tetap dijaga test. `tests/normalize.test.mjs` +2 asersi (`idle`/`graphql`/`hybrid` → `""`), diverifikasi lewat ekspor asli.

#### Dead ref `platformBadge` (P4)
- **`const platformBadge = $(\"platformBadge\")` dihapus dari popup.js** — di-query sekali, tak pernah dipakai. Elemen HTML & CSS `.platform-badge` tidak disentuh, jadi tampilan tetap.

#### Satu sumber resolusi tema — `resolveTheme` (P3 audit UI layer, parity 5 permukaan)
- **Logika `light/dark/system` + matchMedia diduplikasi 5× tanpa pengawasan** (popup.js, options.js, dan ketiga content-*.js) — kelas drift yang sama seperti `fbTargetLabel` sebelum di-parity-kan. Kini satu sumber: **`resolveTheme(theme)` diekspor dari shared.js** (pilihan eksplisit light/dark menang, selain itu `window.matchMedia("(prefers-color-scheme: dark)")`), dipakai popup.js & options.js via import, dan **salinan inline identik di content-fb/tt/ig.js** (content script tak bisa import module) — dipakai di `applySettings` tiap panel (`root.setAttribute("data-rs-theme", resolveTheme(prefs.theme))`).
- **Parity test baru** (`tests/ui-consistency.test.mjs` +2): PARITY resolveTheme — 3 salinan content wajib identik (whitespace-normalized) dengan shared + ekspor tetap ada, diskriminator terbukti (mutasi 1 token di salinan langsung terdeteksi); behavior test — light/dark eksplisit menang, `system`/`undefined`/`""`/`null` mengikuti stub matchMedia (true → dark, false → light). `npm test` naik 221 → **223**, Syntax OK.

#### Temuan lintas platform tersisa (P3) — parity hint run TikTok + hasMore IG strict
- **Hint panel TikTok saat run tanpa target kini dikosongkan** (parity FB v1.0.42) — sebelumnya `running` tanpa `videoHint` menampilkan panduan "Buka URL /@user/video/..." yang membingungkan di tengah run; kini baris hint kosong saat `running` tanpa target bermakna (struktur ternary sama persis dengan panel FB: `target ? Target : terminal || running ? "" : panduan`). Idle tanpa hint tetap menampilkan panduan; popup tidak berubah (fallback netral "Target: tab TikTok aktif" bukan panduan aksi). Diverifikasi dengan **`render()` asli content-tiktok.js** (stub DOM, 5 skenario: idle panduan, running kosong, running+awemeId Target, done/error kosong — semua PASS).
- **hasMore Instagram diselaraskan ke `=== true || === 1`** — `isMoreFlag` di `parsePage` tidak lagi menerima string `"1"` (sebelumnya satu-satunya outlier; FB/TT sudah strict tanpa `"1"`). Berlaku seragam: top-level `has_more` dan balasan (`has_more_tail_child_comments`/`has_more_child_comments`); `has_more_comments` sudah strict sebelumnya. String `"1"` dari respons aneh tidak lagi membuka halaman "palsu" berikutnya — pagination strict kini identik di ketiga platform.
- **Test** (`tests/ig-engine-logic.test.mjs`): asersi diperbarui — `has_more: "1"` → false dan `has_more_tail_child_comments: "1"` → false (top-level & reply, plus ditambahkan ke test negatif); `1`/`true` tetap dikenali. `npm test` tetap **223**, Syntax OK.

#### Registry parity helper plumbing (P3) + selarasan `sleepWhile` Instagram
- **Audit seluruh repo (ekstraktor brace-balanced yang benar — lewati default `= {}`)** menemukan helper yang diduplikasi antar file TANPA blok marker: plumbing engine (`post`/`snapshot`/`stopExtract`/`sleepWhile` 3×, `setTemplate` tt+ig) dan plumbing content (`sendBg`/`engineCmd`/`visible`/`makeRunId`/`ensureIconFont`/`isCurrentRun`/`waitEngineReady` 3×, `acceptFromInject`/`toggleSort`/`mergeAll` tt+ig). Yang sudah di-awasi: marker NORMALIZE/DONEMSG/PARSERS/PANELTOOLS/FBURLS + parity `fbTargetLabel`/`igTargetLabel`/`resolveTheme`.
- **Test registry baru** (`tests/ui-consistency.test.mjs` +1): `PARITY helper plumbing` — REGISTRY nama fungsi → file (15 entri), tiap salinan wajib identik (whitespace-normalized) via `extractFnBalanced` (versi extractFn yang menangani default ber-brace). Diskriminator terbukti: drift 1 token logika (`===` → `==` di `isCurrentRun`) langsung terdeteksi.
- **Temuan + fix: `sleepWhile` Instagram menyimpang dari fb/tt** — versi IG tidak mengembalikan apa pun, padahal 3 call site memakai kontrak `if (!(await sleepWhile(...))) break;` → **selalu break**: retry buka komentar (3×), poll template (24×), dan mode scroll tidak pernah benar-benar mengulang. Diselaraskan ke versi fb/tt (return `false` saat Stop ditekan, sleep adaptif 20–200 ms); kini ketiga platform identik. Verifikasi eksekusi: stop → `false` dalam 0 ms, normal → `true` setelah tidur penuh.
- **Investigasi pair FB yang tersisa** — `waitEngineReady` FB (`readyWaiter(true)` vs tanpa arg) ternyata **bukan drift fungsional maupun perbedaan sengaja: `readyWaiter` adalah dead code** (hanya `let readyWaiter = null`, tidak pernah di-assign di ketiga content script → semua pemanggilan `if (readyWaiter) readyWaiter(...)` mati). Dead code dihapus dari ketiga file (deklarasi + 2 call site per file = 9 baris); `waitEngineReady` kini identik 3 platform dan **dipromosikan ke registry 3×**. `acceptFromInject` FB berbeda memang disengaja — diverifikasi: `inject-fb.js` tidak pernah `post("NEED_TEMPLATE")` (template sintetik dari URL, alur berbeda dari tt/ig yang butuh template capture) → allow-list tanpa NEED_TEMPLATE benar; dicatat di komentar registry.
- **Pair yang sengaja tidak diseragamkan** (alur platform memang berbeda — dicatat di registry): `setTemplate` (FB bangun template sintetik dari URL), `acceptFromInject`/`toggleSort`/`mergeAll` versi FB (render bernama `renderUi`, tanpa NEED_TEMPLATE). `npm test` naik 223 → **224**, Syntax OK.

#### Chain IG permanen — `buildUrl` → `tryParseResponse` penuh (`tests/ig-engine-logic.test.mjs` +8)
- **Verifikasi lifecycle intercept Instagram (dulu skrip temp) kini test permanen** dengan pola `makeEngineChain` TikTok: `buildUrl` asli (rewrite segmen `media_id` di path, strip param volatil, set `max_id` dari `nextMaxId`) → URL hasilnya diteruskan ke `tryParseResponse` asli (guard endpoint balasan + `payloadMatchesMedia`) → ingest via `parseIgComments` — urutan persis loop fetch engine. Dedupe dimodelkan lewat Set (= nameMap engine).
- **8 test**: ① top-level ON diingest + URL diverifikasi (path `media/111/comments/`, `max_id=CUR1`, param volatil dibuang); ② reply `inline_child_comments` ON diingest; ③ reply `child_comments` (endpoint fallback) ON diingest; ④ OFF → kedua endpoint balasan ditolak (URL memang dibangun, guard endpoint menolak payload); ⑤ top-level OFF tetap diingest; ⑥ post lain (mediaId 222) ditolak untuk top-level DAN reply kedua endpoint — guard media terbukti berjalan setelah guard endpoint; ⑦ pengulangan URL sama di-dedupe tanpa crash; ⑧ template tak valid → null. `npm test` naik 224 → **232**, Syntax OK.

#### Audit duplikasi permanen — `tests/duplication-audit.test.mjs` + registry bersama
- **`tests/duplication-registry.mjs` baru — SATU SUMBER registry parity** (PARITY_REGISTRY + PARITY_EXCLUSIONS + extractor `extractFnBalanced` + `findMarkerSpans`), dipakai bersama oleh test PARITY helper plumbing (ui-consistency) dan audit baru. `fbTargetLabel`/`igTargetLabel`/`resolveTheme` kini masuk registry (sebelumnya hanya test dedicated) agar audit menganggapnya tercakup.
- **`tests/duplication-audit.test.mjs` (1 test) — audit otomatis yang GAGAL kalau ada duplikasi baru yang belum diawasi**: memindai 10 file sumber, mengelompokkan fungsi dengan body identik (whitespace-normalized), dan memastikan tiap kelompok tercakup — (1) di dalam blok marker (deteksi span BEGIN/END-RESO-*, sudah di-awasi marker test), (2) di PARITY_REGISTRY (semua file tercakup daftar), atau (3) di PARITY_EXCLUSIONS (duplikat identik yang sengaja dibiarkan, dengan alasan). Diskriminator diverifikasi: file nyata bersih (0 temuan); `post` yang disuntikkan ke background.js (nama sama) terdeteksi; entri registry yang dihapus → post terdeteksi. Pesan kegagalan memandu pengembang ke opsi pendaftaran.
- **ui-consistency.test.mjs**: registry inline diganti import dari modul bersama (+assert eksplisit fungsi ditemukan — `extractFnBalanced` kini return null bila absen, dipakai audit untuk melewati file tanpa fungsi itu). `npm test` naik 232 → **233**, Syntax OK.

#### Mode scroll DOM permanen — `scrapeDomNicknames`/`scrapeDomUsernames` (fixture DOM nyata)
- **`tests/dom-fixture.mjs` baru — fixture DOM minimal (subset CSS, zero deps)**: matcher mendukung grammar yang dipakai scraper — tag (`main`), `[attr]`, `[attr="v"]`, `[attr*="sub"]`, descendant (spasi, mis. `[data-e2e="comment-item"] a[href*="/@"]`), dan grup koma (`closest("nav, header")`). Scraper asli dijalankan dengan document fixture — yang di-assert adalah nama yang **benar-benar masuk nameMap** (normalize → addName/addUsername asli), bukan salinan logika.
- **`tests/tt-engine-logic.test.mjs` +4** — `scrapeDomNicknames`: `comment-username-1/-2` di-harvest (aria-label diutamakan atas teks, teks kosong & label UI "Lihat semua komentar" dilewati normalize), anchor di dalam `[data-e2e=comment-item]` (di luar tidak kena), `div[class*="Comment"]` (substring — `ReplySection` tidak kena; fixture awal saya pakai `NotComment` yang ternyata mengandung "Comment" — koreksi di fixture, matcher benar), dedupe case-insensitive lintas selector, tanpa elemen cocok → 0.
- **`tests/ig-engine-logic.test.mjs` +5** — `scrapeDomUsernames`: scope `main` + `[role=dialog]` di-harvest, `nav`/`header` dilewati (closest), dedupe lintas scope (set `seen`), batas `profileRe` (titik/garis-bawah ≤30 sah; 31 karakter, multi-segmen, URL absolut, `/` kosong ditolak), tanpa scope → 0, href kosong/absent dilewati. `npm test` naik 233 → **242**, Syntax OK.

#### Audit variabel mati (pola readyWaiter) — 0 tersisa + gap grace period `lastNewAt` FB
- **Skrip audit (lookbehind untuk assignment bare, hindari properti `obj.X =`)** memindai 10 file: **pola readyWaiter (deklarasi `null`, tidak pernah di-assign ulang) = NOL tersisa** — pembersihan turn lalu (readyWaiter di ketiga content script) menuntaskan pola ini. Terverifikasi: 152 deklarasi `let X = <init>` semuanya di-assign ulang, tidak ada deklarasi multi-var `let a = null, b = …`, tidak ada variabel write-only.
- **Satu temuan pola KEBALIKAN (di-assign tapi tak pernah dibaca)**: `lastNewAt` di inject-fb.js — ditulis di `addName` & `runExtract` tapi tidak pernah dibaca, karena **loop pagination GraphQL FB kehilangan baris grace period yang ada di TT (:761) & IG (:963)**: `if (Date.now() - lastNewAt < 2500) idle = Math.max(0, idle - 1);`. Ini bukan dead code — **fitur yang hilang**: tanpa baris itu, FB bisa menyatakan "idle" (`idle >= 4`) padahal nama masih mengalir dari halaman demi halaman. Baris ditambahkan di loop GraphQL FB (parity TT/IG); loop DOM/scroll ketiga platform tetap tanpa grace (konsisten satu sama lain). `lastNewAt` FB kini terbaca → audit bersih, `idle` tidak lagi menumpuk saat nama baru datang.
- **Harness `makePaginator`** (tests/fb-engine-logic.test.mjs) diperbarui: deklarasi `let lastNewAt = 0;` ditambahkan (referensi baru di paginateGraphql — 4 test e2e sempat ReferenceError, kini hijau). `npm test` tetap **242**, Syntax OK.

#### Audit duplikasi — deteksi file baru otomatis (glob root)
- **`FILES` di duplication-audit.test.mjs tidak lagi hardcoded** — kini glob otomatis: `readdirSync(ROOT)` difilter `*.js` + `isFile()` + diurutkan. File sumber baru di root (mis. content script/platform baru) **otomatis ikut dipindai** — tidak bisa lolos tanpa didaftarkan di PARITY_REGISTRY/EXCLUSIONS atau berada di dalam blok marker. Subdirektori (tests/, dist/, fonts/, icons/) tidak ikut.
- **Sanity glob di dalam test**: file inti (shared.js, background.js, inject-fb.js, content-ig.js) wajib ada di hasil glob — kalau filter berubah sehingga salah satunya lolos, audit kehilangan cakupan dan test merah.
- **Verifikasi end-to-end**: file baru `tmp-newfile.js` di root berisi salinan `post` (body identik) → audit GAGAL dengan temuan `tmp-newfile.js:post`; setelah file dihapus → hijau kembali. `npm test` tetap **242**, Syntax OK.

#### Mode scroll DOM Facebook — `scrapeDomNames` (fixture DOM nyata, parity 3 platform)
- **`tests/dom-fixture.mjs` diperluas (aditif, tidak mengubah scraper TT/IG)**: `href` (getter dari attrs), `parentElement`, `querySelector`, `getBoundingClientRect` (terlihat secara default) — API yang dipakai scraper FB (`scrapeDomNames` membaca `a.href`, walk-up `btn.parentElement`, `art.querySelector('[role=button]')`, `isVisible` lewat `getBoundingClientRect` + `getComputedStyle`).
- **`tests/fb-engine-logic.test.mjs` +7** — `scrapeDomNames` asli (normalizeCommentName → addName → nameMap; `qsa`/`isVisible`/`isProfileHref` asli), tiga lintasan diuji dengan struktur halaman nyata: ① pola aria-label (`Comment by X`, `Balasan oleh X`, `X commented`; label non-pola & <3 karakter dilewati; separator 2+ spasi / titik-tengah dipotong); ② `role=article` komentar (indikator Like+Reply → link profil di-harvest; post itu sendiri `Post by…` & artikel tanpa indikator komentar dilewati); ③ tombol Balas → walk-up ke baris → link penulis; **post grup** — link `/groups/<gid>/user/<uid>` di-harvest (fix isProfileHref v1.0.42) sementara `/groups/<gid>/posts/…` tetap ditolak; dedupe lintas lintasan; scope `postRoot` membatasi harvest. `npm test` naik 242 → **249**, Syntax OK.

#### Test permanen popup — `tests/popup-render.test.mjs` (4 test)
- **Verifikasi popup yang dulu skrip temp kini test permanen** — bukan regex source: **module `popup.js` asli di-load** per test (cache-bust `?t=` untuk isolasi import) dengan stub DOM/chrome, `init()` sungguhan dijalankan (tabs.query → setPlatformUI → applyTheme → GET_STATE → render), lalu re-render di-drive lewat **jalur asli `chrome.storage.session.onChanged`** (satu-sumber-render). Test: ① IG — `postHint: media 123…` saat running → `Target: post/reel di tab aktif` (id mentah difilter), applyTheme jalan, badge Siap, stop tampil, count `0`/`username`, label Proses `Memproses…`, via storage shortcode → `Target: B7xYzAbCdEf` + names → count `2` + copy aktif + preview, done → hint kosong + stop hidden + label `Mulai ambil username`; ② FB — `templates:3 buffer:12` difilter → fallback, checkbox includeReplies sinkron, friendlyName ditampilkan, done → label `Mulai ambil nama`; ③ TT — `videoHint` awemeId tetap tampil mentah (perilaku lama, sengaja), badge API Belum saat `hasTemplate:false`, idle → `Target: tab TikTok aktif`; ④ tab tak didukung — `state: null` → pesan "Buka tab Facebook, TikTok, atau Instagram…", Proses/copy nonaktif, stop hidden. `npm test` naik 209 → **213**, Syntax OK.

#### Verifikasi lifecycle FB/TT (headless, kode asli dieksekusi)
- **TikTok (15 asersi)** — intercept buildUrl asli → tryParseResponse asli → parsePage/parseTikTokComments: replay top-level & reply diingest saat includeReplies ON, `/list/reply` **ditolak** saat OFF (fix v1.0.43), video lain (top & reply) ditolak, param signature dibuang, `{data:{has_more:true}}` → true dan string `"1"` → false (strict TT by design), celah substring `12345` vs `aweme_id=123456789` ditolak (param dibandingkan persis), pengulangan URL di-dedupe tanpa crash.
- **Facebook (19 asersi)** — `findPageInfo` asli pada payload Relay dengan koneksi top-level (`has_next_page:true, end_cursor:"TOP3"`) **dan** balasan tertanam (decoy ber-cursor `DECOY1`) → tetap memilih **top-level**; loop mini paginateGraphql 2 halaman (cursor `TOP3` → `hasNext:false` → berhenti); fallback page_info telanjang / null → null; rantai `feedbackIdFromTemplateVars` → `normalizeFeedbackId` (prioritas feedbackID → feedback_id → id, base64 ternormalisasi ke mentah); `isTargetCommentResponse` anti-kontaminasi (cocok, asing ditolak, fallback `activeFeedbackId` dari template.id di feed).
- **Kedua lifecycle kini test permanen di tests/** — `tests/fb-engine-logic.test.mjs` +1 e2e "decoy balasan `has_next_page:true` BER-cursor": harness `makePaginator` kini mencatat cursor tiap panggilan top-level (`topCursors`), jadi diskriminatornya eksplisit `[null, null, "TOP1"]` (probe + halaman 1 + halaman 2) — kalau `findPageInfo` keliru memakai page_info balasan, panggilan halaman 2 memakai `DECOY1` dan test merah. `tests/tt-engine-logic.test.mjs` +7 rantai **buildUrl→tryParseResponse penuh** (urutan fetch engine asli): ON/OFF × top/reply, video lain ditolak untuk top-level DAN reply, pengulangan URL di-dedupe (Set = model nameMap), template tak valid → null tanpa crash. `npm test` naik 213 → **221**, Syntax OK.
- Tidak ada defect ditemukan; skrip temp dibersihkan, tidak ada perubahan kode produksi.

#### Audit variabel mati permanen — `tests/dead-var-audit.test.mjs` (pola readyWaiter + write-only)
- **Audit variabel mati kini test permanen**: memindai root via glob (pola duplication-audit, file baru otomatis ikut) dan mendeteksi dua pola — (A) `let X = null|0|false|""|''|undefined;` yang **tidak pernah di-assign ulang** (pola `readyWaiter`, dead code atau harus `const`), (B) variabel yang **di-assign tapi tidak pernah dibaca** (write-only). Analisis statis pada source mentah tanpa strip string (regex literal berisi apostrof membuat strip memakan chunk kode → false positive; baseline terverifikasi bersih tanpa strip). Tiap temuan dipandu pesan: hapus kalau dead code, tambahkan pembacaan kalau fitur yang hilang (kasus `lastNewAt` FB), atau daftarkan di `DEAD_VAR_EXCLUSIONS` dengan alasan.
- **Koreksi rumus selama penulisan**: hitungan awal undercount pembacaan 1 — `=` pada baris deklarasi `let X = ...` ikut terhitung sebagai write oleh `countWrites`, padahal referensi deklarasi sudah di-subtract (`-1`). Semua 37 temuan awal ternyata false positive dari bug ini (`color` background.js dibaca di `setBadgeBackgroundColor`, `repliesDirty` popup.js dibaca di :237, `requestBudget`/`rounds`/`tip`/`bestPost`/`bestH`/`lastHref`/`chipTimer`/`inStr`/`esc` dkk semua punya pembacaan nyata). Perbaikan: `writesExclDecl = writes - (hasDecl ? 1 : 0)`, `reads = refs - 1 - writesExclDecl` → baseline bersih tanpa pengecualian.
- **Diskriminator diverifikasi end-to-end (disk nyata)**: `tmp-deadvar-probe.js` dengan `let probeWriteOnly = 0; probeWriteOnly = 42;` (B) dan `let probeNeverAssigned = null;` (A) → audit GAGAL mendeteksi keduanya; setelah dihapus → hijau. `npm test` naik 249 → **250**, Syntax OK.

#### Audit buffer respons TT/IG — TIDAK ada gqlBuffer, wiring hook kini diuji (+12)
- **Temuan audit: TikTok & Instagram TIDAK punya buffer respons seperti gqlBuffer Facebook** — hook fetch/XHR memproses respons SEGERA lewat `tryParseResponse` (guard `running` + matcher URL + anti-bocor balasan + payloadMatches*), tanpa akumulasi-drain. Alasannya arsitektur: FB mem-paginate dengan REPLAY template tersimpan (intercept adalah jalur capture utama → butuh buffer async), sedangkan TT/IG mem-paginate dengan direct fetch di loop dan intercept hanya komplementer → proses langsung cukup. Jadi tidak ada yang perlu di-parity-kan; yang relevan adalah matcher URL + WIRING hook (celah nyata yang baru terlihat):
- **Celah 1 — `looksLikeCommentApi` TT tanpa test langsung** (IG punya 3): +2 test — URL list & reply → true (case-insensitive), non-komentar / domain lain / null → false. Parity IG tercapai.
- **Celah 2 — wiring blok intercept ASLI (fetch + XHR) tidak pernah diuji** di kedua platform: blok `if (!window.__TNK_NET__)`/`__ING_NET__` diekstrak verbatim (brace-matched) dan dieksekusi dengan stub `window.fetch`/`XMLHttpRequest` (FakeXhr + `fireLoad` yang mem-bind `this` ke instance — browser mem-bind listener, stub wajib meniru supaya `this.__tnk_url`/`this.responseText` terbaca). Rantai asli dijalankan penuh: hook → `tryParseResponse` → `parsePage` → ingest. **10 test baru** (5 TT + 5 IG): ① hook fetch → payload komentar nyata diingest; ② URL non-komentar & `running=false` → tidak diingest; ③ argumen Request object `{url}` → url diekstrak dari `.url`; ④ hook XHR — `open` mencatat URL, event `load` → `tryParseResponse(responseText)`; ⑤ **includeReplies OFF → respons endpoint balasan (`/list/reply` TT, `inline_child_comments`/`child_comments` IG) ditolak DI JALUR HOOK** (parity anti-bocor v1.0.42).
- **Satu koreksi selama menulis**: `fireLoad` awal memanggil listener tanpa bind → `this` di dalam callback jadi globalThis (bukan instance XHR) → `this.__tnk_url` undefined → guard menolak. Diperbaiki `cb.call(x)`. `npm test` naik 281 → **293**, Syntax OK.

#### Intercept fetch GraphQL FB — capture + anti-kontaminasi (`tests/fb-engine-logic.test.mjs` +5)
- **Jalur interceptor asli (window.fetch hook) kini terkunci**: `isGraphqlUrl` → `parseBodyToParams` → `captureGraphqlRequest` (guard friendly-name komentar, parse `variables`, simpan template + `persistGqlTemplate` ke localStorage, klasifikasi top-level vs reply) — dan gate respons `feedbackIdsFromReqBody` → `isTargetCommentResponse` (anti kontaminasi lintas post). Fungsi **ASLI** seluruh rantai (`extractFbFeedbackIds`/`fbIdB64`/`fbIdsMatch`/`isPaginationLike`/`loadStoredTemplates` dll) dieksekusi; `location.href` (untuk `feedbackIdsFromUrl` ASLI) dan `localStorage` (untuk persist) di-stub per pemanggilan — bukan diganti stub feedbackIdsFromUrl seperti test lama.
- **5 test**: ① `isGraphqlUrl` — `/api/graphql/`, substring `graphql`, case-insensitive → true; home.php/""/null → false; ② `captureGraphqlRequest` — template tersimpan (key=friendly name, URL tanpa query, variabel ter-parse), `persistGqlTemplate` menulis localStorage (doc_id + pagination-like), klasifikasi reply (`...RepliesFragment...` → `lastReplyKey`) vs top-level (`lastTopLevelKey` tak berubah); ③ guard friendly non-komentar — tanpa doc_id/variables ditolak, dengan doc_id+variables comment-ish disimpan, URL non-graphql diabaikan; ④ `feedbackIdsFromReqBody` — hanya `feedbackID`/`feedback_id`, variabel `id` sengaja TIDAK dibaca (query balasan menaruh id komentar di situ), bentuk body form-urlencoded & JSON string langsung, null/"" → []; ⑤ `isTargetCommentResponse` — permalink nyata (`fbid` + `set=pcb.<story>`): id URL mentah & base64 Relay & id story diizinkan, id postingan lain DITOLAK, campuran cocok-tidak → izinkan, tanpa id → tetap diproses (kontrak lama); fallback `activeFeedbackId` di feed tanpa id URL (fix v1.0.44).
- **Satu koreksi selama menulis**: body JSON-string langsung awalnya over-escape (`\"` di file → nilai string berisi `"` polos → JSON tidak valid) — diperbaiki ke `\\"` sehingga nilai string benar-benar berisi `\"`. `npm test` naik 276 → **281**, Syntax OK.

#### `drainGqlBuffer` FB — buffer respons GraphQL (`tests/fb-engine-logic.test.mjs` +6)
- **Rantai buffer XHR/fetch GraphQL kini terkunci**: `pushGqlBuffer(text)` (guard: panjang ≥ 60 + teks memuat `"name":` ATAU `author|Comment`; cap `GQL_BUFFER_MAX=50` FIFO via shift) → `drainGqlBuffer()` mengosongkan buffer (splice) dan memanggil `extractNamesFromText` per item — regex `extractGraphqlNames` (filter balasan saat includeReplies off, fix v1.0.42) + `walkJson`/`splitJsonChunks` (JSON Relay, prefix `for(;;);`, chunk JSON berurutan). Harness memakai fungsi **ASLI** seluruh rantai (`normalizeCommentName`→`addName`→`nameMap`; `extractGraphqlNames`/`isCommentLike`/`isReplyComment`/`walkJson`/`splitJsonChunks`/`extractNamesFromText`/`pushGqlBuffer`/`drainGqlBuffer`); yang di-assert adalah nama yang BENAR-BENAR masuk nameMap + semantik buffer.
- **6 test**: ① payload Relay top-level (2 komentar) → 2 nama masuk, buffer kosong setelah drain, drain kedua 0; ② balasan (`comment_parent`/`depth`) masuk saat includeReplies ON, **DITOLAK saat OFF di jalur buffer** (parity anti-bocor); ③ guard pushGqlBuffer — teks < 60 char dan teks tanpa penanda nama ditolak; ④ cap FIFO 50 — push 55 → bufferLen 50, drain 50 nama, "Orang 1" hilang, "Orang 55" ada; ⑤ prefix `for(;;);` + dua chunk JSON berurutan dipisah dan diproses; ⑥ dedupe lintas item — nama sama di dua payload masuk sekali (addName dedupe), hitungan drain = net baru.
- **Koreksi ekstraktor selama menulis**: `extract` lokal (brace-counting naif) rusak oleh regex ber-brace (`/\[\\s\\S\]{0,1500}?/` di `extractGraphqlNames` → SyntaxError "Illegal return statement"). Diupgrade jadi **string-aware**: brace di dalam string (`""`/`''`), komentar (`//`, `/* */`), dan regex literal tidak dihitung — dengan heuristik regex-vs-pembagian (`/` setelah identifier/penutup `) ] }` = pembagian). Semua ekstraksi lama (qsa, tryOpenComments, paginateGraphql, scrapeDomNames) tetap lolos — diverifikasi suite penuh. `npm test` naik 270 → **276**, Syntax OK.

#### `tryOpenComments` FB end-to-end — buka panel komentar (`tests/fb-engine-logic.test.mjs` +7)
- **Call site ekspansi nyata kini terkunci**: sebelum mode scroll/GraphQL, engine membuka panel komentar saat post BELUM terbuka — scan elemen berlabel jumlah komentar ("12 komentar"/"1,2rb komentar"/"123 comments") atau ajakan lihat komentar ("Lihat semua komentar"/"View all comments"/"Lihat 3 komentar lainnya"), lalu `scrollIntoView` + `click` + `sleepWhile(700)`, dan berhenti `true` bila `gqlTemplates` terisi. Fungsi **asli** (`qsa`/`isVisible`/`tryOpenComments`) dieksekusi; `sleepWhile` di-stub (test bisa menyuntik template ke `gqlTemplates` saat sleep via `setSleep`); `click`/`scrollIntoView` dicatat di fixture (`el._clickCount`/`el._scrolled`).
- **7 test**: ① scope sudah terbuka (>1 `role=article`) → `true` TANPA klik; ② COMMENT_COUNT memicu klik (3 varian), template kosong → lanjut & `false` + `scrollIntoView` sebelum klik; ③ VIEW_COMMENTS via `a[role=link]` dan `span[dir=auto]`; ④ teks non-pola ("Kirim komentar", "Total 12 komentar" — COMMENT_COUNT butuh `^\d`), tersembunyi, dan ≥120 char → tidak diklik; ⑤ template ter-capture saat sleep → `true`, elemen berikutnya TIDAK diklik; ⑥ error klik ditoleransi (try/catch) — elemen berikutnya tetap diproses; ⑦ tanpa scope → `document` + aria-label dihitung sebagai label.
- **Dua koreksi fixture selama menulis**: (1) `getComputedStyle` stub di `runOpen` awalnya mengabaikan `el.__style` (beda dari `runExpand`) sehingga elemen `visibility:hidden` ikut diklik — diselaraskan; (2) **bug nyata di `dom-fixture.mjs` qsa**: elemen yang cocok dengan beberapa grup selector (mis. `[role="button"]` + `[aria-label]`) dikembalikan BERKALI-KALI (sekali per grup), padahal `querySelectorAll` asli mendedupe — `break` setelah match pertama; tidak mengubah hasil test lain (tidak ada selector multi-grup yang tumpang tindih sebelumnya), diverifikasi suite penuh. `npm test` naik 263 → **270**, Syntax OK.

#### `findExpandButtons` FB — ekspansi komentar mode scroll (`tests/fb-engine-logic.test.mjs` +7)
- **Deteksi tombol ekspansi "Lihat komentar lain"/"Lihat balasan"/"View more comments" dkk** (call site `runExtract` :1998 dan tunggu template GraphQL :2118) kini terkunci dengan fixture DOM — fungsi **asli** (`qsa`/`isVisible`/`findExpandButtons`) dieksekusi dengan stub `document` + `getComputedStyle` (default terlihat, per-elemen via `el.__style`). Catatan alur yang diuji: `findExpandButtons` TIDAK melakukan walk-up (walk-up ada di `scrapeDomNames` lintasan 3, sudah diuji) — deteksi persis: qsa `[role="button"], div[tabindex="0"]` → `isVisible` → gabungan innerText+aria-label (whitespace dinormalisasi) → regex soft case-insensitive → batas panjang 120.
- **7 test**: ① pola soft terdeteksi urutan dokumen, teks biasa ("Kirim") dilewati; ② aria-label fallback saat innerText kosong + gabungan keduanya; ③ `div[tabindex=0]` ikut dipilih, elemen tanpa role/tabindex (span/a/div polos) tidak — walau teksnya cocok; ④ isVisible menggating — rect kecil (width 0), visibility hidden, display none, opacity 0 semuanya dilewati, hanya tombol terlihat yang keluar; ⑤ teks ≥120 karakter atau kosong dilewati walau mengandung pola; ⑥ scope `postRoot` — tombol di luar scope tidak terdeteksi; ⑦ whitespace dinormalisasi (`\n` → spasi, multi-spasi) sebelum regex. `npm test` naik 256 → **263**, Syntax OK.

#### Parity & perilaku grace period idle — `tests/idle-grace.test.mjs` (6 test)
- **Audit konsistensi grace period lintas platform**: ketiga loop pagination (GraphQL FB :1656, list TT :761, list IG :963) memakai baris `lastNewAt` yang SAMA persis (`Date.now() - lastNewAt < 2500` → `idle = Math.max(0, idle - 1)`) — verifikasi manual konteks ketiga loop: `before` diambil di awal loop, blok increment setelah pemrosesan halaman (termasuk balasan), grace line tepat setelahnya, guard `idle >= 4` di akhir. FB memproses `replyQueue` SETELAH loop utama (bukan antara `before` dan cek idle) → semantik `before`/idle terjaga.
- **PARITY STATIS (1 test)**: baris grace + threshold `idle >= 4` wajib identik (whitespace-normalized) 3 platform dan **tepat 1× per file** — HANYA di loop pagination; loop DOM/scroll ketiga sengaja tanpa grace (FB pakai `idle >= 18`/`>= 10`, TT/IG `>= 10` — by design, tanpa baris lastNewAt). Blok increment muncul 2× per file (pagination + scroll) → parity memakai `lastIndexOf` untuk mengambil yang **mendahului** baris grace; antara blok increment dan grace hanya boleh komentar/baris kosong (FB punya doc comment 2 baris, TT/IG tanpa).
- **PERILAKU (5 test)**: blok increment + baris grace DIEKSTRAK dari inject-fb.js nyata dan dieksekusi dalam simulasi loop pagination (clock terkontrol, `Date.now()` di-stub via argumen Function — `lastNewAt` di-update saat nama masuk, persis `addName` engine). ① nama mengalir tiap halaman → idle tak pernah menumpuk; ② nama berhenti dengan `lastNewAt` segar (≤2,5 dtk) → grace MENAHAN idle 2 halaman (berhenti di halaman 9 vs **7 tanpa grace** — perbandingan A/B langsung dari baris nyata membuktikan grace mengubah perilaku); ③ `lastNewAt` basi → idle 1/halaman, berhenti setelah 4 halaman kosong; ④ nama mengalir lagi setelah jeda → idle di-reset; ⑤ tanpa nama sama sekali (`lastNewAt = -Infinity`) → grace tak pernah aktif, berhenti di halaman 4.
- **Diskriminator diverifikasi (mutasi in-memory)**: konstanta 2500→3000 di satu file, baris grace dihapus, dan `Math.max`→`Math.min` — ketiganya terdeteksi (regex tak cocok → count ≠ 1 atau parity beda). `npm test` naik 250 → **256**, Syntax OK.

#### Siklus template FB penuh — capture → persist → reuse lintas sesi (`tests/fb-engine-logic.test.mjs` +6)
- **Rantai reuse template pagination diuji end-to-end dengan fungsi ASLI**: `captureGraphqlRequest` (sesi 1, template ter-capture dari request nyata) → `persistGqlTemplate` (localStorage) → `bestStoredPaginationTemplate` (sesi 2, baca localStorage) → `buildSyntheticPaginationTemplates` (doc_id tersimpan diprioritaskan + dedupe vs `PAGINATION_DOC_IDS`) → `orderedCandidates` (urutan kandidat probe). "Sesi baru" = harness baru dengan Map `gqlTemplates` segar tapi localStorage SAMA — persist lintas sesi terbukti nyata, bukan stub fungsi. `withNetStubs` lama dipakai ulang; `PAGINATION_DOC_IDS` diekstrak dari source (bukan hardcode) agar tak drift.
- **6 test**: ① siklus penuh — sesi 1 capture menyimpan doc_id/variables ke localStorage, sesi 2 `bestStoredPaginationTemplate` membacanya dan `buildSyntheticPaginationTemplates` menaruh doc_id tersimpan di kandidat pertama (plus assert mode Semua Komentar di semua kandidat); ② `bestStoredPaginationTemplate` — localStorage kosong/JSON rusak/bukan array/entri tanpa doc_id/entri non-pagination-like semuanya dilewati (null), variabel bentuk STRING (persist lama) tetap dikenali; ③ `persistGqlTemplate` — guard (tanpa doc_id / non-pagination-like tidak menulis), cap 3 FIFO (tertua dibuang), dedupe nama (pindah ke depan), **early-return tanpa write ulang untuk entry identik di depan** (dihitung via wrapper setItem), bentuk tersimpan bersih (hanya `friendlyName/url/doc_id/variables/capturedAt`, tanpa params mentah); ④ `orderedCandidates` — URL-matched #1 walau paling tua, pagination-like dengan id LAIN tidak menang walau lebih baru (anti salah post), template balasan dieksklusi total, non-pagination hanya fallback terakhir (clock `Date.now()` distub); ⑤ reuse lintas sesi — seed localStorage 2 template lama, sesi baru capture doc_id baru menang di sesi berikutnya (cap 3 terjaga); ⑥ dedupe doc_id — stored = fallback #0 tidak di-push ulang ke daftar docIds (kandidat ketiga memakai fallback berikutnya; duplikat doc_id antar kandidat per-id URL itu by design, di-assert eksplisit).
- **Satu koreksi selama menulis**: assert awal "tidak ada doc_id duplikat antar kandidat" salah desain — dua kandidat pertama sengaja memakai doc_id tersimpan yang sama (satu per id URL); yang benar di-assert adalah daftar `docIds` tidak menduplikasi stored (fallback tidak di-push ulang). Temuan konteks: `extractFbFeedbackIds(REAL_URL)` mengembalikan `[story, fbid]` — id story di-probe lebih dulu. `npm test` naik 293 → **299**, Syntax OK.

#### Katalog perbedaan arsitektur sah lintas platform (audit komparatif penuh)
- **Latar**: sesi-sesi sebelumnya mencatat buffer `gqlBuffer` FB vs direct-parse TT/IG, `setTemplate` (FB sintetik vs tt/ig NEED_TEMPLATE), `acceptFromInject` tanpa NEED_TEMPLATE, dan `toggleSort`/`mergeAll` FB. Audit kali ini memindai SELURUH injektor (inventaris fungsi 3 file + jalur eksekusi) untuk menemukan beda arsitektur lain yang sengaja — semuanya diverifikasi di source, bukan asumsi.
- **Gate anti-kontaminasi: request-body (FB) vs response-shape (TT/IG)** — FB mem-gate di INTERCEPT: `feedbackIdsFromReqBody` (variabel `feedbackID`/`feedback_id` request) → `isTargetCommentResponse` (cocok dengan id URL/base64 Relay), karena satu halaman feed FB mengalirkan GraphQL BANYAK post sekaligus → kontaminasi dicegat di request. TT/IG mem-gate di RESPONSE: `payloadMatchesVideo`/`payloadMatchesMedia` (id item di URL request vs `activeAwemeId`/`activeMediaId`), karena pagination mereka direct-fetch → hanya respons endpoint sendiri yang masuk, tapi isi payload bisa milik item lain. Dua titik gate berbeda, dua ancaman berbeda — keduanya sah.
- **Strategi sesi/anti-bot per platform** — FB: POST form-urlencoded + anti-forgery token dari DOM (`getDtsg`/`getLsd` scan `<script>` terbatas + `require` memory, cache 5 menit) + `userId` dari cookie `c_user`/`CurrentUserInitialData`, deteksi login via redirect + sniff HTML login. IG: header kaya — `X-IG-App-ID`, `X-IG-WWW-Claim`, `X-CSRFToken` (dari cookie), `Referer`, `X-Requested-With`; 302/401 = login, 403 = diagnosis anti-bot, `parseRetryAfter` (Retry-After header, cap 30 dtk). TT: minimal — `credentials: include` + Accept JSON; 401 + sniff HTML login. Tiap platform menuntut strategi berbeda (CSRF token vs app-id claim vs sesi cookie) — disengaja, bukan drift.
- **Budget run berbeda** — FB `REQUEST_BUDGET = 350`, TT hardcoded `350` (tanpa konstanta bernama — inkonsistensi kosmetik, nilai sama), IG `BUDGET = 150` (lebih rendah karena IG rate-limit lebih agresif — komentar source: "protect the user's IG account"). `REPLY_BUDGET = 40` identik ketiga platform.
- **Arsitektur balasan: dua fase (FB) vs inline per halaman (TT/IG)** — FB mengumpulkan `replyIds` selama pagination top-level → `replyQueue`, lalu memproses SETELAH loop utama (batch unik 25, `REPLY_BUDGET` 40) — karena balasan FB butuh query template TERPISAH (`lastReplyKey`) yang harus ter-capture dulu. TT/IG fetch balasan INLINE dalam loop: tiap halaman membawa `replyTargets`, di-fetch langsung (TT: `rGuard` 8 + budget; IG: endpoint fallback `inline_child_comments` → `child_comments`, `slice(0,20)` per halaman) — karena balasan TT/IG adalah child comments inline yang bisa langsung diambil dari endpoint yang sama. Konsekuensi: semantik idle FB tidak terkontaminasi antrean (sudah dikunci test idle-grace).
- **Buka panel komentar** — FB: `tryOpenComments` pola TEKS `COMMENT_COUNT`/`VIEW_COMMENTS` + hitung `role=article` (panel FB tidak punya selector stabil). TT: `commentPanelOpen` selector `[data-e2e="comment-list"]` dst. IG: `commentDialogOpen` `[role="dialog"]` + `scrollCommentContainer`. Tiga mekanisme berbeda karena struktur halaman tiga situs berbeda — sah.
- **Kedalaman DOM fallback** — FB paling dalam: 3 lintasan `scrapeDomNames` (aria-label, `role=article`, walk-up tombol Balas) + loop EKSPANSI (`expandDomLoop`/`findExpandButtons`/`findScrollContainer`) karena komentar FB lazy-load inline dan butuh ekspansi tombol "Lihat komentar lain". TT (`scrapeDomNicknames` 4 selector) & IG (`scrapeDomUsernames` + `profileRe` + scope) TANPA loop ekspansi — daftar mereka sudah lengkap setelah scroll. Perbedaan ini disengaja (sudah diuji per-platform, tapi baru kini dicatat sebagai beda arsitektur komparatif).
- **Penamaan field hint** — TT mengirim `videoHint` (awemeId), FB/IG mengirim `postHint` (friendlyName/mediaId/shortcode) — semantik "video" vs "post" per platform, disengaja; label panel tetap seragam via `fbTargetLabel`/`igTargetLabel`/parity hint.
- **Ringkasan katalog**: semua beda di atas DISENGAJA dan terverifikasi; yang SUDAH diseragamkan (bukan perbedaan): `sleepWhile`, `waitEngineReady`, `post`/`snapshot`/`stopExtract`, grace period idle, strict hasMore, `resolveTheme`, strip regex — semuanya sudah identik 3 platform dan di-awasi test. Tidak ada temuan drift baru; hanya dua inkonsistensi kosmetik yang dicatat: TT hardcode `350` tanpa konstanta bernama, dan `postHint`/`videoHint` tidak seragam namanya (disengaja).

#### Audit konsistensi & keseragaman penuh — 2 temuan P3 diperbaiki, sisanya terverifikasi seragam
- **Metode**: inventaris protokol pesan (background vs 3 content script), struktur `render()`/`renderUi()`, wiring tombol panel, boot/restore GET_STATE, onNavigation, storage.onChanged, pesan error login, dan fungsi aksi (copy/csv/reset/merge) — dibandingkan lintas platform, dugaan diverifikasi dengan eksekusi (bukan asumsi).
- **P3 #1 — hint panel IG kurang guard `status === "running"` (parity FB/TT)**: saat run berjalan tanpa target bermakna, panel IG menampilkan panduan "Buka URL /p/... atau /reel/..." — padahal FB (:1054) dan TT (:720) mengosongkannya (`target ? Target : terminal || status === "running" ? "" : panduan`). IG hanya `terminal ? "" : ...` tanpa guard running — inkonsistensi nyata: panduan aksi muncul di tengah run. Diperbaiki: struktur ternary identik FB/TT (`target` dikosongkan saat terminal, guard `status === "running"`). Test `RENDER instagram (exec)` diperbarui: running tanpa target → `""` (bukan panduan); ditambah skenario idle tanpa shortcode → panduan tetap muncul (perilaku idle tidak berubah).
- **P3 #2 — dead handler `GET_PAGE_STATE` di ketiga content script**: grep seluruh repo (js/html/mjs) menemukan hanya DEFINISI (content-fb:1322, content-tiktok:936, content-ig:960) — tidak ada pemanggil di background, popup, maupun tests. Handler balasan `{status, names, message, postHint/videoHint, hasTemplate}` mati di ketiga platform (masing-masing juga dengan set field yang berbeda — tanda tak pernah dipakai). Dihapus dari ketiga file (9 baris total).
- **Terverifikasi seragam (bukan temuan)**: struktur `render()`/`renderUi()` identik 3 platform (status/hint/count/badge/process/stop/copy/csv/merge/sort/list/fab/replies); onNavigation reset ada di ketiga; change listener includeReplies → SET_STATE seketika identik; boot restore GET_STATE konsisten (FB via setLocalState→renderUi, TT/IG via setLocal→render + refreshTemplateFlag — beda alur karena FB tak punya hasTemplate, sudah dicatat di katalog); storage.onChanged hanya rsx_prefs (pembersihan sesi lalu terbukti tuntas); pesan error login (DONEMSG) identik; copy/csv/reset/merge identik (csvContent dengan flag `isIg` benar per platform: FB/TT false, IG true).
- **Catatan kosmetik (diselesaikan sesi ini)**: FB memakai nama `mapDoneStatus` vs `mapDone` TT/IG — body berbeda karena stop reason platform memang beda (FB punya complete/idle eksplisit, IG punya blocked/checkpoint, TT punya no_video); hasil akhir sama (`count ? done : error`), bukan drift fungsional. Kini penamaan diselaraskan ke `mapDone` + dikunci naming parity — lihat seksi "Penamaan `mapDone` diseragamkan" di bawah.

#### Penamaan `mapDone` diseragamkan (FB `mapDoneStatus` → `mapDone`) + naming parity registry
- **`mapDoneStatus` FB di-rename ke `mapDone`** — nama helper pemetaan stopReason → status kini seragam di ketiga content script. Body per platform TIDAK diubah: FB tetap memetakan `complete`/`idle` eksplisit, IG `blocked`/`checkpoint`, TT `no_video` — stop reason platform memang beda, hasil akhir sama (`count ? done : error`). Hanya 2 baris berubah di content-fb.js (definisi + call site DONE).
- **`tests/duplication-registry.mjs` + `PARITY_NAMES`** — registry naming parity baru: fungsi dengan nama DAN tanda tangan yang sama wajib ada di semua file, tapi body sengaja berbeda per platform. Berbeda dari `PARITY_REGISTRY` (salinan wajib identik) — di sini hanya penamaan yang dikunci; body per platform bebas.
- **Test baru** (`tests/ui-consistency.test.mjs` +1): `PARITY naming` — `function mapDone(` wajib ada di content-fb/tt/ig.js dengan tanda tangan `(stopReason, count)` identik. Diskriminator diverifikasi: rename probe di content-tiktok.js → test merah ("function mapDone tidak ditemukan di content-tiktok.js"), restore → hijau. `npm test` 299 → **300**, Syntax OK.

#### Audit aliran state background vs popup — `tests/state-flow.test.mjs` (+4)
- **Invariant**: popup hanya membaca field yang dijamin `defined` di state yang dikembalikan SEMUA jalur pengirim (GET_STATE / NAMES_PROGRESS / NAMES_DONE / NAMES_ERROR / SET_STATE / START_* / RESET / tab-ditutup). Karena setiap jalur melewati `getState`/`setState` (yang me-merge `defaultStateFor` platform), jaminannya struktural — dikunci 4 lapis:
  1. **Popup reads vs defaults** — 8 field yang dibaca popup (`status/message/names/count/includeReplies` universal, `videoHint` hanya TT, `postHint` FB/IG, `hasTemplate` TT/IG) wajib ada di default state platform tempat field itu dibaca; read baru yang belum diklasifikasi di `FIELD_PLATFORMS` langsung merah.
  2. **Tidak ada state raw** — semua `state:` return di background.js hanya `null` / `prev` / hasil `getState`/`setState`/`restoreSavedIfIdle`; literal `state: { ... }` (yang melewati merge defaults) langsung merah.
  3. **Patch tanpa field hantu** — semua key yang ditulis patch (23 situs `setState`, literal `patchObj`/`patch`/`resetPatch` termasuk ternary 2 cabang, assignment dinamis `patchObj.videoHint`/`postHint`/`patch.tabId`, whitelist SET_STATE) wajib ada di defaults platform-nya — `phantomKey` langsung merah.
  4. **Eksekusi** — `applyStatePatch` asli dari shared.js dengan tiap patch dummy mempertahankan semua field popup `defined` (melindungi perubahan `applyStatePatch` di masa depan).
- **Diskriminator diverifikasi (mutasi di disk nyata)**: read baru `probeField` di popup, `state: { status: "idle" }` mentah di background, dan `phantomKey` di patch FB — ketiganya membuat test merah dengan pesan terarah; restore → hijau. `npm test` 300 → **304**, Syntax OK.

#### PARITY struktur render() lintas platform — urutan data-x + guard hint (`tests/ui-consistency.test.mjs` +2)
- **Latar**: parity hint (P3 #1 sesi audit konsistensi — IG kurang guard `status === "running"`) diperbaiki dan diuji perilakunya, tapi struktur *guard* itu sendiri belum dikunci — drift guard di platform mana pun tidak akan terdeteksi sampai perilaku diuji lagi. Kini struktur render() dibandingkan lintas platform secara otomatis.
- **Test 1 — urutan elemen data-x identik 3 platform**: ekstraksi template panel (`createUi` `root.innerHTML`) tiap platform, urutan `data-fnk/tnk/ing` dibandingkan — kanonik 16 elemen (`min, status, hint, count, badge, replies, search, sort, list, process, stop, copy, csv, reset, merge, fab`) wajib identik. Yang dibandingkan adalah urutan DOM template, **bukan** urutan `querySelector` di render (yang sah berbeda per platform tanpa mengubah DOM — FB query `replies` lebih awal, TT/IG query `fab` lebih awal).
- **Test 2 — guard hint identik 3 platform**: statement `const terminal = ["done", "partial", "stopped", "error"].includes(status)` wajib identik (minified), guard target `const target = terminal ? "" : <expr>` wajib ada (expression per platform sah berbeda: `fbTargetLabel`/`videoHint`/`igTargetLabel||extractShortcode`), dan ternary hint `target ? \`Target: ${target}\` : terminal || status === "running" ? "" : <fallback>` wajib identik setelah fallback string (panduan situs per platform) dinormalisasi — jadi guard running yang mengosongkan hint di tengah run terkunci teks, bukan hanya perilaku.
- **Diskriminator diverifikasi (mutasi disk nyata)**: tukar urutan `status`/`hint` di template IG → merah ("urutan elemen data-ing template drift"), hapus `|| status === "running"` dari hint TT → merah ("guard hint TT drift dari FB"); restore → hijau. `npm test` 304 → **306**, Syntax OK.

### Audit total bagian Instagram — bocor balasan saat includeReplies off + kontaminasi lintas post (P1/P2 dibuktikan dengan eksekusi) + sisa P3

#### Instagram — bocor nama balasan saat "Sertakan balasan" off (P1)
- **`tryParseResponse` melewati respons endpoint balasan saat includeReplies off** — `looksLikeCommentsApi` mencocokkan substring `instagram.com/api/v1/media/` **dan** `/comments/`; endpoint balasan `/comments/{id}/inline_child_comments/` (dan `/child_comments/`) juga kena, dan array respons reply-page berisi balasan → nama penulis balasan bocor lewat jalur array parser saat toggle off dan user membuka "Lihat balasan" selama run. Kini guard `/(?:inline_child_comments|child_comments)/i` dilewati saat includeReplies off (parity fix FB v1.0.42 / TikTok v1.0.43). Aman: replay balasan engine hanya berjalan saat includeReplies on, jadi tidak ada jalur sah yang kehilangan data. (WebRequest capture background sudah mengecualikan endpoint ini — gap hanya di intercept engine.)

#### Instagram — kontaminasi lintas post (P2)
- **Helper baru `payloadMatchesMedia` — URL yang eksplisit membawa media id post LAIN ditolak** — intercept sebelumnya tidak punya filter media sama sekali (respons komentar API apa pun selama run diingest). Media id ada di path URL (`/api/v1/media/<id>/comments/`), dibandingkan **persis** dengan `activeMediaId` (bukan substring — id 12345 vs 123456789 tidak lagi salah cocok). Tanpa media id di path (atau `activeMediaId null`), perilaku lama tetap (body `includes` + fallback shape) — body sering tidak membawa media id. Parity filter feedback id FB / aweme_id TikTok.

#### Instagram — leak postHint `media <id>` di baris Target (P3)
- **Helper baru `igTargetLabel` (shared.js + salinan inline content-ig.js)** — engine IG mengirim postHint sebagai kanal status: shortcode (bermakna) ATAU media id mentah (`media 123456789…`, dari heartbeat & DONE). Token `media <digits>` kini dikosongkan di panel **dan** popup; shortcode & hint lain tetap tampil. Panel: `igTarget` kosong → fallback shortcode dari URL halaman → "Buka URL /p/... atau /reel/..." (target bermakna tidak pernah hilang). Parity copy `igTargetLabel` di-awasi test (pola `fbTargetLabel`).

#### Instagram — hasMore mode reply diselaraskan (P3)
- **`parsePage` mode reply kini memakai semantik STRICT yang sama dengan top-level** (`=== true/1/"1"`, bukan truthy) — respons aneh seperti `has_more_tail_child_comments: "false"` (string) atau `0` sebelumnya membuka halaman balasan "palsu" berikutnya; kini `"false"`/`0`/`2`/absent → `false`. `1`/`"1"`/`true` (bentuk sah dari IG) tetap dikenali.

#### Test
- **`tests/ig-engine-logic.test.mjs` baru — 34 test**: `payloadMatchesMedia` (anti kontaminasi lintas post + celah substring + `activeMediaId null → selalu true`), `tryParseResponse` (bocor `inline_child_comments`/`child_comments` off/on, lintas post, tidak running), `parsePage` (has_more top-level `true/1/"1"`, `next_max_id` string/numerik/null, mode reply `has_more_tail_child_comments` + `next_max_child_cursor`/`next_max_child_id`, replyTargets `comment_id/pk/id`, strict parity, ingest username nyata), `looksLikeCommentsApi`, `buildUrl` (rewrite `media_id`, endpoint reply default & `child_comments`, strip param volatil, `max_id`, template tak valid → null). Harness: `extract()` melewati destructuring parameter, stub closure `activeMediaId`/`includeReplies`/`running` persis scope nyata. `tests/normalize.test.mjs` +3 (igTargetLabel), `tests/ui-consistency.test.mjs` +1 (PARITY igTargetLabel, diskriminator drift terbukti), `tests/ig-engine-logic.test.mjs` +2 (strict parity reply). `tests/ui-consistency.test.mjs` +3 **eksekusi render() panel IG** (harness stub DOM: hint via igTargetLabel — media id mentah tidak tampil + fallback shortcode + panduan netral + terminal kosong; FAB data-count/kelas running-done/title-aria; stop hidden saat tidak running + swap ikon process). `npm test` naik 166 → **209**, Syntax OK.

#### Audit regresi keamanan pasca-perubahan
- Sanitasi START (`sanitizeEngineOptions`: mediaId digit-only ≤32, clamp maxMs, runId ≤80, templateUrl allowlist + tolak `/inline_child_comments`), data-plane validation (ENGINE_CMD allowlist + START wajib runId + satu-run-aktif, SET_STATE whitelist + tabId stamped, NAMES_* isStaleRun + kepemilikan tab), runId correlation (`isCurrentRun` di semua handler content-ig termasuk NEED_TEMPLATE), dan fixture parity (SOURCE PARITY 6+4+9+4+3, BEHAVIOR 37+38+27, PANEL PARITY, blok marker) diverifikasi utuh — kedua fix hanya mempersempit nama yang diingest, tidak melonggarkan batas kepercayaan apa pun.

## [1.0.43] — 2026-08-15

### Audit total bagian TikTok — bocor balasan saat includeReplies off + kontaminasi lintas video (P1/P2 dibuktikan dengan eksekusi) + sisa P3

#### TikTok — bocor nama balasan saat "Sertakan balasan" off (P1)
- **`tryParseResponse` melewati respons `/list/reply` saat includeReplies off** — `looksLikeCommentApi` mencocokkan substring `tiktok.com/api/comment/list` yang juga kena `/list/reply`; intercept meneruskan respons reply-list ke `parsePage`, dan array-nya berisi balasan → nama penulis balasan bocor saat toggle off dan user membuka "Lihat balasan" selama run. Parity fix FB v1.0.42. Aman: replay balasan engine hanya berjalan saat includeReplies on, jadi tidak ada jalur sah yang kehilangan data.

#### TikTok — kontaminasi lintas video (P2)
- **`payloadMatchesVideo` menolak URL yang eksplisit membawa `aweme_id`/`item_id` video LAIN** — fallback shape-only (`"comments"`/`has_more`) sebelumnya menerima respons video lain selama run; param URL kini dibandingkan **persis** (bukan substring — id 12345 vs 123456789 tidak lagi salah cocok). Tanpa param, perilaku lama tetap (body `includes` + fallback shape) karena body sering tidak membawa awemeId.

#### TikTok — `parsePage` memilih array komentar non-kosong (P3 #3)
- **`data?.comments || data?.data?.comments || []` lama**: `[]` itu truthy, jadi `data.comments=[]` selalu menang walau `data.data.comments` berisi → `batchSize: 0` (halaman "palsu kosong" → idle/error prematur di pagination) dan `replyTargets` kosong (balasan tidak di-antrekan). Kini preferensi top dipertahankan saat keduanya berisi, top non-array jatuh ke nested; nama tetap diingest oleh `parseTikTokComments` (membaca kedua bentuk, tidak berubah).

#### Korelasi runId NEED_TEMPLATE (P3, parity data-plane)
- **content-tiktok.js & content-ig.js**: handler `NEED_TEMPLATE` kini memakai `isCurrentRun(data.runId)` persis seperti PROGRESS/DONE/ERROR — NEED_TEMPLATE stale/spoof (runId tak cocok) tidak lagi memicu GET_TEMPLATE+SET_TEMPLATE. Engine sudah mengirim runId via `post()` (auto-attach) di kedua inject. Facebook tidak punya handler NEED_TEMPLATE (alur template berbeda) — tidak ada yang diubah.

#### Test
- **`tests/tt-engine-logic.test.mjs` baru — 34 test**: `parsePage` (has_more `1`/`true`/`{data:{has_more:true}}`/`0`/string `"1"`, cursor, replyTargets, anti-bocor `reply_comment` tertanam, fix P3 #3), `buildUrl` (mode reply, `item_id`/`aweme_id`, strip param signature, `count` default 20, template tak valid → null), `payloadMatchesVideo` (anti kontaminasi lintas video + celah substring), `tryParseResponse` (bocor `/list/reply` off/on, lintas video, tidak running). Harness: `extract()` kini melewati destructuring parameter (brace pertama bisa milik `{ cursor, … }`, bukan badan fungsi), dan `new Function` butuh `return` eksplisit untuk ekstraksi berdiri sendiri. `npm test` naik 132 → **166**, Syntax OK.

## [1.0.42] — 2026-08-15

### Audit total bagian FB — pagination top-level vs balasan tertanam + kebersihan pesan & UI

#### Facebook — pagination inti (P1, dibuktikan dengan eksekusi)
- **`findPageInfo` tidak lagi memilih `page_info` koneksi balasan tertanam** — DFS lama mengembalikan `page_info` PERTAMA yang ditemukan; karena objek koneksi Relay menyimpan `edges` sebelum `page_info`, koneksi balasan (`replies_connection`, dll.) yang tertanam di dalam edges selalu ditemukan lebih dulu → loop utama memakai cursor/has_next_page milik koneksi BALASAN untuk query top-level → pagination berhenti "complete" di halaman 1 (atau memakai cursor balasan yang salah). Kini semua kandidat `page_info` dikumpulkan dengan konteks, traversal tidak turun ke `edges` koneksi (balasan tertanam tak pernah jadi kandidat), dan ranking memilih yang bukan sub-pohon balasan → edges terbanyak (koneksi komentar utama) → paling dangkal. Bentuk publik tetap `{ hasNext, endCursor }`.
- **Test end-to-end `paginateGraphql`** (tests/fb-engine-logic.test.mjs): harness mengeksekusi `paginateGraphql` + `findPageInfo` ASLI dengan stub backoff cursor-aware, payload Relay dua halaman dengan decoy balasan tertanam (`has_next_page:false` dan varian `has_next_page:true` tanpa cursor). Kontrol terbukti: `findPageInfo` versi bug lama menghasilkan `pages:1` (berhenti prematur), fix menghasilkan `pages:2`. `extract()` di test kini mempertahankan modifier `async` (tanpa itu ekstraksi `paginateGraphql` jadi fungsi sinkron tak valid).

#### Facebook — kebersihan pesan & UI
- **Pesan rate-limit tidak lagi duplikat / bocor prefix mode** — di background `NAMES_DONE`, `extra` untuk platform facebook dipotong prefix mode engine (`idle|graphql|hybrid|dom`), dan dikosongkan saat `stopReason === "rate_limit"` (reasonToMessage sudah memuat pesan 429 lengkap). Jalur `timeout`+diagnosis 429 tetap membawa tip tanpa token `graphql` mentah.
- **Baris `Target:` tidak lagi menampilkan detail internal** — helper `fbTargetLabel` (shared.js + salinan inline content-fb.js; content script tak bisa import module) menyaring token status/mode engine (`templates:N buffer:N`, `capture`, `dom`, `replies`, `rate_limit`, `error`); friendlyName query GraphQL tetap tampil. Berlaku di panel (baris hint dikosongkan saat run berjalan tanpa target bermakna — bukan panduan "lalu Proses" yang membingungkan) dan popup (fallback "Target: post di tab aktif").
- **Fallback `activeFeedbackId` ke `id` template** — `feedbackIdFromTemplateVars` (feedbackID → feedback_id → id bentuk lama): di halaman feed (URL tanpa id) dengan template id-only, filter anti-kontaminasi `isTargetCommentResponse` tidak lagi menolak SEMUA respons halaman sendiri (nama dari request GraphQL asli terbuang di jalur always-on). Aman: hanya template top-level (friendlyName non-reply), `feedbackIdsFromReqBody` (klasifikasi request) tetap tidak membaca `id` (query balasan menaruh id komentar di situ).
- **DOM fallback post grup** — `isProfileHref` kini menerima struktur profil anggota grup `/groups/<gid>/user/<uid numeric>` (diizinkan sebelum pengecualian `/groups/`; uid non-numerik ditolak — tanpa risiko profil palsu). Halaman grup lain (beranda/posting/permalink/events) tetap ditolak.

#### Test
- `tests/fb-engine-logic.test.mjs`: +20 test (findPageInfo 7, feedbackIdFromTemplateVars + isTargetCommentResponse 7, paginateGraphql end-to-end 2 + fase balasan 1, isProfileHref 4). `tests/ui-consistency.test.mjs`: +1 parity copy `fbTargetLabel`. `npm test` naik 107 → **132**, Syntax OK.

## [1.0.41] — 2026-08-15

### Audit sesi lengkap — konsistensi lintas permukaan, bocor balasan FB di regex, & perkakas cek UI permanen

#### Konsistensi lintas permukaan (temuan P2 + ikon status)
- **Panel IG: prefix hint seragam `Target:`** — fallback shortcode kini `Target: ${sc}` (sebelumnya `Post:`), menutup sisa ketidakseragaman yang tersisa setelah TikTok di-fix di v1.0.34; satu-satunya `Post:` yang tersisa di repo kini hanya aturan di CONSISTENCY.md.
- **Badge toolbar `stopped` → accent (`#6366f1`)** — tabel status CONSISTENCY.md 1.4 kini dipatuhi juga di badge toolbar (sebelumnya amber seperti partial); `done` tetap hijau `#42b72a`, `partial` tetap amber `#f7b928`.
- **Ikon status popup `stop_circle` ikut accent saat stopped** — aturan warna `.stat-ic` untuk status `stopped` ditambahkan (sebelumnya ikon jatuh ke abu-abu `--muted` di samping dot yang accent).
- **Badge toolbar menampilkan glyph stop saat stopped tanpa hasil** — badge Chrome hanya teks (ligature Material tidak bisa dirender), jadi dipakai `■` (BLACK SQUARE — padanan visual glyph `stop`) warna accent saat run dihentikan tanpa hasil; dengan hasil, count accent tetap dipertahankan.

#### Facebook — bocor nama balasan di jalur regex (temuan P1)
- **`extractGraphqlNames(text, includeReplies)`** (blok PARSERS, 4 salinan identik): saat toggle "Sertakan balasan" off, match nama dari komentar balasan disaring lewat `isReplyAt` — cermin `isReplyComment` di walkJson (parent field truthy / `depth > 0` / `is_reply:true`), dengan batas objek komentar dihitung satu-pass string-aware agar komentar top-level (`comment_parent:null`, sub-pohon balasan tertanam) tetap lolos. Sebelumnya filter hanya ada di jalur `walkJson` — nama balasan bocor via jalur regex.
- 6 fixture test baru (parent / depth / is_reply / null / campuran bersebelahan / sub-pohon tertanam).

#### TikTok — pagination `has_more: true` (temuan P1)
- `parsePage` kini mengenali `{data:{has_more:true}}` (sebelumnya hanya `=== 1`) — replay payload berbentuk itu tidak lagi berhenti prematur padahal masih ada halaman berikutnya.

#### Pembersihan P3
- **Dead code `storage.session.onChanged`** di content-tiktok.js & content-ig.js dihapus (area session tidak mengirim event ke content scripts); listener kini hanya `rsx_prefs` (local), seragam dengan content-fb.js. `refreshTemplateFlag` tetap akurat dari boot/GET_STATE/START/SET_TEMPLATE/navigasi.
- **Seed cursor ganda** di inject-fb.js dihapus (blok seed yang nilainya langsung ditimpa `cursor = null`).
- **Cache injeksi engine** di background.js — `injectedEngines` + `ensureInjected()`: engine tidak lagi di-inject ulang tiap perintah (guard `__X_ENGINE__` tetap), retry `no_engine` sekali untuk cache basi, cache di-reset di `tabs.onUpdated`/`tabs.onRemoved`.

#### Audit keamanan pasca-perubahan
- Sanitasi START (`sanitizeEngineOptions`), data-plane validation (ENGINE_CMD/NAMES_PROGRESS/NAMES_DONE/SET_STATE), dan runId correlation (`isStaleRun`) diverifikasi utuh setelah semua perubahan — tidak ada regresi model keamanan.

#### Perkakas cek UI permanen (tests/)
- **`tests/ui-consistency.test.mjs`** — audit UI yang dulu manual kini otomatis (24 test): handler tombol panel (template ↔ click delegation tanpa cabang yatim, aksesibilitas title+aria-label, Esc menutup), ikon terisi & valid di semua permukaan (termasuk font di-bundle, bukan Google Fonts), fixture parity (blok marker byte-identik + peta aksi→ikon identik 3 panel + prefix `Target:` tanpa `Post:`), dan struktur render() (pengisian elemen display status/hint/count/badge/list, tombol stop tersembunyi saat tidak running, FAB `data-count` mengikuti state). `npm test` naik 83 → **107**.
- **Audit mutasi test** — 24 skenario perubahan kecil (11 refactor sah harus lolos, 13 regresi harus gagal) memastikan test tidak rapuh: daftar aksi inti jadi subset (boleh bertambah), pengecualian ikon logo berbasis elemen (`*-logo-ic`) bukan glyph, status inti jadi subset dengan aturan warna CSS diturunkan dari map setStatusIcon, dan pengecekan glyph `■` menyasar assignment (bukan komentar yang memuatnya).

## [1.0.40] — 2026-08-13

### Mesin FB — masih harus buka komentar manual — FIX: doc_id + feedbackID base64 + persistensi template

- **Akar masalah (riset 3 scraper independen 2024–2026)**: template pagination
  sintetik dikirim TANPA `doc_id` — endpoint Relay FB `/api/graphql/` wajib
  `doc_id` untuk memilih query, tanpa itu probe selalu gagal → jatuh ke mode
  DOM → user harus buka komentar manual agar template asli ter-capture.
  Kedua, `feedbackID` dikirim sebagai id mentah, padahal FB menerima bentuk
  base64 Relay `btoa("feedback:<id>")` (dikonfirmasi di ketiga scraper).
- **Fix 1 — doc_id**: template sintetik kini membawa `doc_id`. Prioritas:
  template tersimpan di localStorage → daftar fallback `PAGINATION_DOC_IDS`
  (`25399415259725176` 2026 · `5676025945801633` 2025 · `4712008195539492`
  2024). Probe memvalidasi tiap kandidat — doc_id basi hanya dilewati.
- **Fix 2 — feedbackID base64**: variabel `feedbackID` + `id` di-encode
  `feedback:<id>` base64; variabel diperkaya (includeNestedComments,
  isPaginating, commentsIntentToken `RANKED_UNFILTERED_...` dll) agar cocok
  dengan bentuk capture FB terkini.
- **Fix 3 — persistensi**: template pagination ber-doc_id disimpan ke
  localStorage (`fnk_fb_gql_tpl_v1`, maks 3, per friendlyName) saat capture;
  dimuat saat boot. Sekali berhasil di postingan mana pun, semua postingan
  berikutnya langsung paginate GraphQL tanpa buka komentar.
- **Fix 4 — pencocokan id raw/b64**: `matchesFeedback`, `isTargetCommentResponse`,
  dan `activeFeedbackId` kini mengenali kedua bentuk (mentah vs base64 Relay) —
  sekaligus memulihkan jalur harvest respons halaman yang sempat ter-filter
  salah di v1.0.36 (request asli FB membawa id base64, filter lama membandingkan
  dengan id mentah → respons halaman dibuang).

## [1.0.39] — 2026-08-13

### Ikon jadi teks di FB/IG — FIX: font ikon di-bundle ke extension

- **Akar masalah**: ikon panel/FAB memakai Material Symbols via Google Fonts
  (`fonts.googleapis.com`) — bisa gagal dimuat (CSP halaman, adblock, blip
  jaringan). Diverifikasi di Chrome headless: Facebook publik OK, tapi
  Instagram memblokir CSS font (ikon tampil sebagai teks literal seperti
  "play_arrow").
- **Fix**: font `fonts/material-symbols-rounded.woff2` (361 KB, statis)
  di-bundle ke extension; @font-face di-inject dari `chrome.runtime.getURL`
  (content scripts) / URL relatif (popup & options). Tidak bergantung CSP
  halaman atau jaringan sama sekali.
- **Terbukti lolos CSP paling ketat** (`font-src 'none'`): uji e2e memuat
  dist/ sebagai extension sungguhan di halaman palsu facebook.com dengan CSP
  ketat — semua ikon panel & FAB ter-render sebagai glyph (bukan teks),
  tanpa error konsol.
- `web_accessible_resources` mengekspos font ke halaman FB/TikTok/IG;
  `npm run build` ikut menyalin `fonts/` ke dist/.
- Catatan: font statis tidak mendukung sumbu FILL — ikon state aktif
  (sort aktif, checkbox tercentang) tampil versi outline; bentuk ikon tetap
  sama.

## [1.0.38] — 2026-08-13

### Verifikasi visual chip di browser + fallback baris komposer

- **Chip diverifikasi di Chrome headless (puppeteer)** dengan fixture halaman
  yang meniru DOM Facebook: baris aksi berlabel, ikon-only (layout baru),
  title-only, React re-render (chip dilepas & terpasang lagi), dan klik chip
  membuka panel — semua lolos, tanpa error konsol.
- **Fallback baris komposer** — saat bar Like/Comment/Share tak terdeteksi
  (mis. label berubah total), chip tidak lagi menempel di ujung bawah post
  (tampak "pecah") melainkan ter-dock ke baris "Tulis komentar…" — posisi
  aksi pada layout FB terbaru.

## [1.0.37] — 2026-08-13

### Chip di bar Like/Comment Facebook diperbaiki (audit UI pecah)

- **Icon chip diseragamkan ke `forum`** — ikon yang sama dengan FAB (satu entry
  point, design system CONSISTENCY.md 1.1), menggantikan SVG `person` lama.
- **`findActionRow` toleran DOM Facebook baru (2025–2026)** — tombol aksi kini
  bisa ikon-only / tak berlabel di samping kotak komentar; anchor boleh salah
  satu dari Like/Comment/Share (tidak wajib Like pertama), baris cukup memuat
  2+ aksi, dan label dibaca dari teks + `aria-label` + `title`.
- **Chip tidak lagi hilang saat React me-render ulang post** — coalescing
  watcher (tidak di-reset tiap mutasi, tanpa polling) memastikan chip selalu
  terpasang kembali walau halaman bermutasi terus-menerus (buka komentar,
  scroll, like).
- **Chip tidak lagi menggeser/memecah baris aksi** — `order: 99` di flex row
  (selalu paling kanan), dimensi button dikunci (min/max 36px), `box-sizing`
  & `overflow: visible` eksplisit.

## [1.0.36] — 2026-08-11

### Audit hasil v1.0.35 — tutup celah kontaminasi lintas post yang tersisa

- **Temuan audit**: hook fetch/XHR (always-on) mengekstrak nama dari SEMUA
  respons GraphQL selama run berjalan — tanpa filter feedback id. Di feed
  (atau saat user scroll manual), komentar postingan lain yang kebetulan
  dimuat halaman ikut masuk hasil.
- **Perbaikan**: respons halaman hanya diproses bila request-nya membawa
  `feedbackID`/`feedback_id` postingan target — yaitu id dari URL permalink
  atau id template yang sedang di-paginate (`activeFeedbackId`, dikunci saat
  probe memilih template, di-reset tiap run). Request tanpa feedback id
  (balasan, bentuk tak dikenal) tetap diproses — tidak ada regresi ekstraksi.
- Efek: rekap FB kini konsisten anti-kontaminasi di DOM (v1.0.35), buffer
  GraphQL, dan hook jaringan (v1.0.36).

## [1.0.35] — 2026-08-11

### Facebook: mode "Semua Komentar" otomatis + anti scroll ke postingan lain

- **Mode sortir tidak lagi menentukan hasil rekap.** Riset: variabel internal
  `sortKey` query `CometUFICommentsProviderPaginationQuery` memakai enum
  `RANKED_THREADED` (Paling Relevan — default, hanya sebagian komentar),
  `RANKED_UNFILTERED` (Semua Komentar — kronologis, unfiltered),
  `RECENT_ACTIVITY` (Terbaru). Tanpa `sortKey`, FB default ke Paling Relevan
  → itulah kenapa dulu kamu harus pindah ke "Semua Komentar" manual.
- **Synthetic template (dibangun dari URL) kini memuat
  `sortKey: "RANKED_UNFILTERED"`** — langsung paginate semua komentar tanpa
  perlu ganti mode di halaman.
- **Replay template capture di-probe dengan varian "Semua Komentar" dulu**
  (fallback ke mode asli user bila FB menolak) — hasil tidak bergantung pada
  pilihan sortir yang tampil di halaman.
- **Hapus penyebab scroll ke postingan lain di akhir run:**
  `window.scrollBy` di DOM fallback dihapus (scroll hanya kontainer komentar
  dalam post), klik "lihat komentar lain" & panen nama di-scope ke post aktif
  (bukan seluruh dokumen), dan posisi scroll halaman disimpan di awal run lalu
  dikembalikan di akhir (postingan yang kamu proses tetap di tempat).

## [1.0.34] — 2026-08-11

### Audit lintas permukaan — menutup sisa ketidakseragaman

- **Toggle "Balasan" di panel kini menyimpan pref seketika** (SET_STATE) —
  parity dengan popup; sebelumnya pref baru tersimpan saat run dimulai.
- **Prefix hint diseragamkan ke `Target:`** di semua panel & popup (TikTok
  sebelumnya "Video:").
- **Pesan reset/idle disamakan** antara panel dan background (FB: "…1 postingan
  Facebook…"; IG: "…pastikan sudah login, lalu klik Proses.").
- **Dot status "stopped" di popup → accent** (sebelumnya amber seperti partial;
  kini konsisten dengan count panel & FAB hijau).
- **Pembersihan kecil**: attr `checked` mati di checkbox Balasan FB; title tombol
  Gabung popup disamakan dengan panel.
- **RESEARCH.md seksi 16**: temuan ketidakseragaman + daftar perbedaan yang
  sengaja dibiarkan (default includeReplies, backup popup-only, chip FB, dll).

## [1.0.33] — 2026-08-11

### Pacing TikTok disamakan dengan Instagram (keamanan ekstra)

- Jeda antar-halaman komentar TikTok naik dari 0,7–1,6 dtk → **1,8–3,2 dtk**
  (nilai persis Instagram).
- Balasan: 0,4–0,8 dtk → **1,4–2,4 dtk**; jeda antar-thread balasan
  0,3–0,7 dtk → **1,1–2,0 dtk**; retry halaman kosong → **2,5 dtk** (semua
  identik dengan inject-ig.js).
- Percepatan pagination adalah pemicu rate limit — pacing seragam ini
  menurunkan risiko 429/checkpoint di TikTok.
- Catatan: `maxMs` run TikTok tetap 120 dtk (IG 150 dtk) → tiap run lebih
  sedikit halaman; naikkan ke 150 dtk bila ingin coverage setara.

## [1.0.32] — 2026-08-11

### Audit TikTok — konsistensi tuntas di 3 platform

- **Deteksi halaman login HTML di engine TikTok** — sesi berakhir yang
  me-redirect ke halaman login (HTML 200) kini memberi pesan bersih "Sesi
  TikTok tidak aktif (login)" alih-alih dump "Respons bukan JSON:
  <!DOCTYPE html..." (parity IG v1.0.30 / FB redirect+HTML).
- **Sanitasi pesan error non-OK**: `API <status>: …` tidak lagi membocorkan
  HTML mentah — diganti "halaman HTML (kemungkinan login/error)".
- Audit TikTok menyimpulkan platform ini sudah paling selaras dengan
  CONSISTENCY.md (badge awemeId akurat, pre-check, cooldown, backoff, budget,
  stopReason lengkap) — **status konsistensi FB/TT/IG kini penuh** di semua
  area checklist.
- **RESEARCH.md seksi 15**: audit TikTok + rekomendasi terbuka (chip panel,
  pacing).

## [1.0.31] — 2026-08-11

### Audit Facebook — konsistensi dengan standar IG/TK (CONSISTENCY.md)

- **Pre-check login Facebook** (`CHECK_FB_LOGIN`, cookie `c_user`) — pola gagal
  cepat identik dengan IG/TT: logout → pesan no_login sebelum run, bukan
  menunggu probe di tengah run.
- **Cooldown antar-run di Facebook & TikTok** — 15 dtk setelah run apa pun,
  60 dtk setelah rate limit (nilai & pesan identik dengan IG); run beruntun
  tidak lagi jadi pemicu 429.
- **Bug CSS seragam**: `--rs-text-dim` dipakai tapi tak pernah didefinisikan
  di ketiga stylesheet (warna daftar preview jatuh ke warna inherit) →
  `var(--rs-muted)`.
- **`mapDoneStatus` FB**: `no_template` kini dipetakan eksplisit ke error
  (parity pola mapDone IG/TT).
- **Hint panel FB tidak lagi basi**: "Tombol N (pojok kanan)…" (sisa FAB huruf
  pra-v1.0.29) → "Buka permalink post, buka komentar, lalu Proses."; elemen
  count awal `0 nama` (parity struktur TT/IG).
- **RESEARCH.md seksi 14**: audit FB konsistensi + status; CONSISTENCY.md
  diperbarui (pre-check login & cooldown kini ✅ di 3 platform).

## [1.0.30] — 2026-08-11

### Audit pertama Instagram + standar konsistensi tampilan & respon

- **Dokumen baru `CONSISTENCY.md`** — aturan konsistensi tampilan & respon yang
  menjadi standar audit/perbaikan lintas platform (token CSS, struktur panel,
  ikon, warna status, gerak, pesan akhir via DONEMSG, stopReason/status,
  badge akurat, pre-check, ketahanan engine, checklist audit).
- **Header panel FB & TikTok kini flat** — gradien brand yang tersisa dari
  pra-v1.0.29 (`#1877f2`/`#fe2c55`) dihapus; ketiga panel memakai bahasa visual
  yang sama (IG sudah flat).
- **Kode mati dibersihkan**: `userCollapsed` (content-fb.js, tidak pernah dibaca),
  ternary redundan `stopExtract` TikTok, komentar boot basi TT/IG
  ("expanded saat ada hasil" — panel tidak pernah auto-buka sejak v1.0.29).
- **Pesan copy FB dikoreksi**: fallback menyebut `names.length` padahal yang
  disalin `vis.length` (salah saat filter aktif) — kini konsisten dengan TT/IG.
- **Engine IG: deteksi halaman login HTML** — sesi berakhir kini memberi pesan
  bersih "Login Instagram diperlukan (sesi berakhir)" alih-alih dump
  "Respons bukan JSON: <!DOCTYPE html..." (cabang `res.status === 302` selama
  ini dead code karena fetch mengikuti redirect).
- **RESEARCH.md seksi 13**: audit pertama Instagram (temuan diperbaiki, yang
  sudah kuat, yang masih terbuka + verifikasi lapangan yang wajib user).

## [1.0.29] — 2026-08-11

### Desain Flat Minimal — ikon Material (Google), widget default tertutup

- **Ikon Material Symbols (Google)** di semua permukaan — popup, options, dan
  panel FB/TikTok/IG. Tombol aksi jadi ikon (play/stop/copy/download/merge/
  reset/sort/close), indikator status & badge API jadi ikon + kata pendek
  (`check_circle` Siap / `error` Belum), bukan kalimat panjang.
- **Popup minimalis** — header flat, platform + status pakai ikon, count angka
  besar + kata kecil terpisah, grid aksi 4 kolom ikon, search dengan ikon.
- **Panel & FAB flat** — header tanpa gradien (kartu + garis bawah), tombol
  ikon 3 kolom, FAB bulat solid dengan ikon `forum`, checkbox "Balasan"
  ikon `forum` + kata pendek.
- **Widget default TERTUTUP** — panel FB/TikTok/IG tidak lagi mengambang
  terbuka saat halaman dimuat, saat hasil tersimpan dipulihkan, maupun saat
  run selesai. Hasil tetap terlihat di badge jumlah FAB; panel hanya dibuka
  oleh user (klik FAB / ikon bar Like). Sebelumnya: panel TT/IG terbuka sejak
  awal, panel FB otomatis melebar saat ada hasil.
- **Options flat** — header tanpa gradien, ikon platform & tema, tombol
  "Pulihkan default" dengan ikon.

## [1.0.28] — 2026-08-11

### Permalink Facebook lengkap — album/gambar kolektif, watch, video.php, slug-posts

- **Satu sumber deteksi URL permalink (blok `FBURLS`)** — `extractFbFeedbackIds` /
  `extractFbFeedbackId` / `isFacebookPostPage` di `shared.js`, disalin
  byte-identik ke `inject-fb.js` & `content-fb.js`, dijamin fixture test
  (layout + parity 3 salinan + behavior 22 kasus URL). Sebelumnya deteksi URL
  diduplikasi di 3 tempat dengan gap yang sama — badge, synthetic template, dan
  pre-check kini selalu sinkron.
- **Bentuk URL baru yang didukung** (sebelumnya MISS → synthetic GraphQL tidak
  terbentuk): `posts/<slug>/<id>` (post gaya baru), `watch?v=`/`watch/?v=`/
  `watch/live/?v=` (video), `video.php?v=`, `media/set/?set=a.<album>.<user>.<story>`
  (album/gambar kolektif — story id = komponen terakhir), `photos/a.<uid>.<fbid>`
  (album foto), `posts/<pfbid>` (post dengan id alfanumerik), nilai `story_fbid`/`fbid`
  alfanumerik (pfbid).
- **`set=pcb.<story>` (postingan multi-foto) — terverifikasi lapangan**: klik gambar 1
  di post multi-foto menghasilkan URL `facebook.com/photo?fbid=<id foto>&set=pcb.<story id>`.
  Story id dari `pcb.` kini diekstrak dengan prioritas **di atas** `fbid` (yang di URL
  itu id foto, bukan story) — synthetic langsung menyasar komentar postingannya, sama
  seperti foto/video tunggal.
- **False positive dihapus**: path numerik polos (`facebook.com/<8+ digit user id>`
  = halaman profil) tidak lagi dilaporkan sebagai post permalink.
- **Synthetic template multi-kandidat** — engine mem-probe tiap kandidat id dari
  URL (urutan = prioritas) dan memakai yang benar menghasilkan `page_info`;
  robust terhadap bentuk URL yang id-nya ambigu (foto album vs story).
- **Filter feedbackId di `orderedCandidates`** (setara `mediaId filter` IG
  v1.0.15) — template ter-capture yang id feedback-nya cocok dengan URL
  diutamakan, mencegah pagination komentar postingan lain dari sidebar/iklan.
- **Deteksi `errors` GraphQL** — feedback id salah / post tidak publik kini
  berhenti dini dan probe kandidat berikutnya, bukan diam-diam jatuh ke DOM.
- Perbaikan langsung mengatasi laporan lapangan: klik gambar 1 di postingan
  foto kolektif (album) kini langsung mendapat synthetic permalink, sama seperti
  foto/video tunggal.

## [1.0.27] — 2026-08-11

### Badge "API komentar" TikTok selalu akurat (simetris dengan IG & popup)

- **`storage.onChanged` panel TT/IG tidak lagi memakai nilai mentah** — saat
  template API berubah (capture atau kadaluarsa), panel mere-validasi via
  `GET_TEMPLATE` (TTL + shape) alih-alih `!!newValue` yang bisa menampilkan
  badge hijau "siap" padahal template sudah melewati TTL.
- **Boot restore menerapkan `hasTemplate` tanpa syarat** — pola popup
  (`GET_STATE` merekomputasi TTL+shape): badge panel TT/IG kini akurat meski
  tanpa hasil tersimpan dan saat service worker baru bangun.

## [1.0.26] — 2026-08-11

### Parity fitur panel: search + sort + CSV + Gabung di 3 panel

- **Panel FB/TikTok/IG kini setara popup** — tiap panel punya pencarian (filter
  live), tombol Urutkan A–Z, preview daftar hasil (maks 40 + indikator sisa),
  tombol **CSV** (nama file & header platform-aware: `reso-nama-*`/Nama untuk
  FB/TT, `reso-username-*`/Username untuk IG), dan tombol **Gabung** (merge
  FB+TT+IG unik). Copy & CSV kini menghormati filter aktif ("X dari N" di
  count saat filter menyala).
- **Restore hasil saat boot untuk TT/IG** — pola Facebook (v1.0.23): panel
  memanggil `GET_STATE` saat load dan memulihkan hasil tersimpan lintas
  reload beserta status/message/videoHint/postHint/hasTemplate.
- **Parser payload komentar jadi satu sumber kebenaran** — blok `PARSERS`
  (parseTikTokComments/parseIgComments/extractGraphqlNames) di shared.js,
  disalin byte-identik ke ketiga engine inject-*.js dan diuji fixture
  (layout + parity + behavior). Engine sebelumnya punya logika parse lokal
  yang tak teruji otomatis.
- **Perkakas UI daftar jadi satu sumber** — blok `PANELTOOLS`
  (filterNames/sortNamesAz/csvContent/downloadTextFile/mergeAcrossPlatforms)
  di shared.js, disalin byte-identik ke ketiga panel; popup memakainya via
  export. Fixture test menjamin 4 salinan identik.
- **Gabung lintas platform dipindah ke background** (`MERGE_ALL`) — content
  scripts hanya membawa normalizer platform-nya sendiri, jadi merge
  FB+TT+IG yang butuh ketiga aturan normalisasi harus jalan di background
  (shared.js), bukan di halaman. Panel memanggil `MERGE_ALL` dan menampilkan
  hasilnya.

### Ketahanan & internal

- `npm test` naik **65 → 72** (fixture PARSERS + PANELTOOLS + behavior).

## [1.0.25] — 2026-08-11

### Chore & dokumentasi
- **Hapus `icons/logo.svg`** — duplikat byte-identik dari `logo.svg` di root (satu-satunya yang direferensikan popup/options).
- **Hapus `id="logoIcon"`** yang tidak dipakai di popup.html.
- **README diperbarui** — struktur proyek (blok marker `NORMALIZE`/`DONEMSG`, fixture parity, `doneMessage` satu sumber pesan).

### Eksekusi audit detail UI/UX (bug CSV, merge lintas platform, jargon, keyboard)
- **🐛 Fix "Ekspor CSV" ReferenceError** — `wordFor(p)` dengan `p` tidak terdefinisi di handler `btnCsv` (popup.js) → toast konfirmasi gagal + unhandled rejection di setiap klik. Kini `wordFor(res?.platform || currentPlatform)`.
- **🐛 Fix "Gabung Semua" kehilangan data** — helper baru **`mergeAcrossPlatforms`** di shared.js: tiap nama dinormalisasi dengan aturan **platform-nya sendiri** (sebelumnya `mergeNames(..., null)` menerapkan aturan FB ke TT/IG → `@user123` & emoji TikTok ter-drop; pemanggilan bertahap pun menormalkan ulang hasil lama → nama FB "Andi Pratama" hilang). Terverifikasi runtime: 6 nama → kini 6; + 3 unit test.
- **Jargon disembunyikan saat run selesai** — hint "Target: graphql", "Target: templates:2 buffer:5", "Video: 7290…", "Target: 1234…" (media id) kini **kosong di status done/partial/stopped/error** (popup + 3 panel); baris status sudah menjelaskan hasil. Detail teknis tetap tampil saat running (transien, berguna untuk debug).
- **Esc menutup panel** — ketiga panel (FB/TikTok/IG) kini punya jalur keyboard: Esc = setara tombol min (FB juga menghormati flag userCollapsed).
- **Popup: satu sumber render** — poll cadangan 1,2 dtk dihapus; `storage.session.onChanged` sudah memicu pada setiap `setState` background (diverifikasi: semua state lewat `chrome.storage.session.set`).
- **Count "X dari N" saat filter aktif** — popup menampilkan "0 dari 1500 nama" (mis. filter tanpa match) agar tombol Copy yang nonaktif tidak ambigu.
- **FAB title/aria dinamis** — FAB ketiga platform kini update title/aria mengikuti state ("Proses berjalan — buka panel untuk Stop", "Buka panel — N nama/username terkumpul"), seragam dengan chip bar Like FB.

## [1.0.24] — 2026-08-11

### Satu sumber pesan akhir run — `doneMessage` (dari audit D1)
- **`doneMessage(reason, count, platform, { extra, tip })` di shared.js** menjadi **single source of truth** untuk semua pesan akhir run: `reasonToMessage` (popup/background) kini **delegasi** ke helper yang sama, dan ketiga panel (`content-fb/tiktok/ig.js`) memakai salinan byte-identik di dalam marker `BEGIN-RESO-DONEMSG` — dijamin **fixture test parity** (4 salinan) agar tidak pernah drift lagi.
- **Drift yang tertutup**: ① FB panel menyisipkan suffix `[graphql]`/`[dom]` (TT/IG tidak) → dihapus, mode tetap terlihat di baris "Target:"; ② IG panel checkpoint **tanpa jumlah** → kini menyertakan count; ③ TT/IG timeout tanpa "Klik Copy" → seragam; ④ IG panel rate-limit memakai wording sendiri → kini helper tunggal ("Rate limit Instagram (429)…" konsisten dengan popup).
- **`wordFor(platform)`** diekspor dari shared (username untuk IG, nama lainnya) — popup memakainya, salinan lokal dihapus.
- Jalur stop-finalize (content menghentikan run saat inject tak menjawab) ikut diarahkan ke `doneMessage("stopped", …)`.
- Tes: fixture DONEMSG (layout 4+1+2, parity 6+4, kontrak wording platform-aware) + unit test delegasi `reasonToMessage` ≡ `doneMessage` di semua reason/platform.

## [1.0.23] — 2026-08-11

### Default visibility panel FB — expanded saat ada hasil (sama dengan TikTok/Instagram)
- **Boot**: panel Facebook kini memanggil `GET_STATE`; jika ada hasil tersimpan lintas reload, nama dipulihkan ke panel dan panel **langsung terbuka** (sebelumnya selalu collapsed).
- **Run selesai dengan hasil** (termasuk dari popup/shortcut/context-menu): panel otomatis terbuka menampilkan hasil — konsisten dengan TT/IG yang selalu expanded.
- **Toggle manual tetap dihormati**: user yang menutup panel (`min`) tidak akan dipaksa terbuka saat run selesai; FAB/ikon bar Like membuka dan me-reset preferensi.
- **Tanpa hasil**: panel tetap collapsed di feed (tidak mengganggu), FAB adalah pintu seragam.

## [1.0.22] — 2026-08-11

### Soft motion — audit & sistem gerak seragam
- **Token motion di 5 stylesheet** — `--rs-ease`, `--rs-ease-soft`, `--rs-dur-fast/-base/-slow`, `--rs-motion: cubic-bezier(.22,.61,.36,1)`; semua transisi memakai easing konsisten (bukan `ease` generik dengan durasi acak 0.08–0.3s).
- **Semua permukaan kini bergerak lembut**: popup, options, dan panel FB/TikTok/IG — icon button, badge platform/API, status chip, count, tombol, preview, steps, cards, switch, toast, collapse panel, FAB badge pop.
- **Collapse panel kini visibility-based + transisi** — buka/tutup panel FB tidak lagi abrupt (fade+slight rise 0.3s, `visibility` di-delay agar tombol tidak mengganggu klik).
- **Count/badge/status kini bertransisi** — angka naik lembut (0.15s), badge muncul dengan pop ringan, status berubah warna smooth.
- **`prefers-reduced-motion` dipertahankan** dari v1.0.20 — semua gerak baru ikut dimatikan untuk user yang memilih reduced motion (di halaman host tetap di-scope ke `#xxx-root`).
- Audit motion lengkap tersimpan di `RESEARCH.md` seksi 9 (inventaris + inkonsistensi sebelum fix).

## [1.0.21] — 2026-08-11

### Badge API Instagram selalu akurat
- **`GET_STATE` kini merekomputasi `hasTemplate` untuk Instagram** — simetris dengan TikTok: badge "API komentar: siap" di popup dihitung ulang dari session template (TTL 30 mnt + validasi shape) setiap kali state diambil, bukan hanya mengandalkan nilai session yang terakhir di-`setState`. Menutup kondisi edge saat service worker baru bangun / state belum di-refresh.

## [1.0.20] — 2026-08-11

### Konsistensi UI/UX — quick wins (kritik audit)
- **Satu model interaksi entry point** — ikon N di bar Like/Comment/Share Facebook kini **membuka panel** (menandai post tempat ikon berada agar engine menyasar post yang benar), bukan langsung proses/copy — seragam dengan FAB di ketiga platform. Tombol FAB tetap pintu utama; status visual chip (badge jumlah, pulse, warna done) dipertahankan.
- **Kopi segar** — hint FB menyebut FAB; steps popup FB menyebut badge "API siap"; pesan gagal copy kini "Coba lagi dari panel atau popup" (bukan "ikon extension" yang basi).
- **Aksesibilitas: `prefers-reduced-motion`** — semua animasi (shimmer/breathe/blink/pulse/rise) dihormati di 5 stylesheet; di halaman host, scope dibatasi ke panel agar tidak mengganggu animasi Facebook/TikTok/Instagram.
- **Terminologi seragam** — checkbox FB kini "Sertakan balasan (reply)"; sub-header popup "copy ke Excel" untuk semua platform; placeholder & aria search "Cari username…" untuk IG; nama file CSV `reso-username-*.csv` untuk IG; warna badge FAB IG disamakan (#161823).

## [1.0.19] — 2026-08-11

### Badge "API komentar" di panel & popup Facebook
- **Badge API di panel Facebook** — konsisten dengan TikTok & Instagram: di halaman post permalink badge hijau "API komentar: siap" (engine FB selalu bisa paginate via synthetic GraphQL template dari `feedbackId` di URL); di home feed/URL lain badge kuning "belum — buka permalink post".
- **Badge API di popup Facebook** — sama seperti panel (konsisten lintas permukaan).
- Helper baru `isFacebookPostPage` (shared, ter-uji) — cermin logika `feedbackIdFromUrl` engine.

## [1.0.18] — 2026-08-11

### Audit P2 — getDtsg ringan, pre-check login TikTok, satu model interaksi panel
- **`getDtsg`/`getLsd` ringan** — token anti-forgery FB kini diambil dari `require("DTSGInitialData")`/modul memory dulu, lalu scan `<script>` tag terbatas (lewati payload raksasa >400 KB), lalu input form; `document.documentElement.innerHTML` (serialisasi DOM megabyte) hanya jadi fallback terakhir dan tetap di-cache 5 menit.
- **Pre-check login TikTok** — pola IG (`CHECK_TT_LOGIN`): tanpa cookie `sessionid` di tiktok.com, Proses gagal cepat dengan pesan "Sesi TikTok tidak aktif — login di tiktok.com lalu Proses lagi", di jalur panel maupun popup/shortcut/context-menu — tidak lagi membuang run & request saat logout.
- **FAB di Facebook** — model interaksi panel kini seragam di ketiga platform: ikon FAB pojok kanan-bawah (buka panel), badge jumlah, pulse saat running, warna done saat ada hasil. Chip inline di bar Like/Comment/Share tetap dipertahankan sebagai integrasi native FB (klik = proses, klik lagi = copy). Glyph tombol tutup diseragamkan (`–`).

## [1.0.17] — 2026-08-11

### Audit menyeluruh — daya tahan & konsistensi UI/UX (fix terverifikasi)
- **Guard template IG mid-run** — webRequest capture Instagram kini tidak lagi menimpa template media yang sedang diproses saat run aktif (pola guard TikTok): scroll ke post/reel lain tidak mengganggu pagination, dan template untuk run berikutnya tetap menyasar post yang benar.
- **Total request budget di Facebook** — engine FB kini punya `requestBudget` 350/run (sebelumnya hanya guard halaman 120 + budget balasan): konsisten dengan TikTok (350) dan Instagram (150); README "batas request per run" kini benar untuk semua platform.
- **Label popup platform-aware** — popup kini memakai "username" untuk Instagram (count, tombol Copy, toast, header CSV) — sebelumnya selalu "nama" meski panel IG dan menu sudah bilang username.
- **Hint popup menyebut Instagram** — "Buka tab Facebook, TikTok, atau Instagram…" (sebelumnya lupa menyebut Instagram).
- **Wording rate-limit konsisten** — pesan `rate_limit` non-FB kini "X nama" (TikTok) / "X username" (Instagram), bukan kata generik "data".
- **Konstanta storage di popup** — listener `storage.onChanged` memakai `STORAGE_KEY_*` dari shared (bukan string hardcode `fnk_state`/`tnk_state`/`ing_state`).

> ℹ️ Koreksi audit: temuan "TT XHR tidak difilter video" ternyata **false positive** — kedua jalur (fetch & XHR) sama-sama melalui `tryParseResponse` yang memanggil `payloadMatchesVideo`; tidak ada perbaikan yang diperlukan.

## [1.0.16] — 2026-08-11

### Perbaikan audit IG (P2)
- **Pesan 403 akurat** — HTTP 403 tidak lagi diklaim sebagai "login diperlukan"; kini diklasifikasikan sebagai blok anti-bot/App-ID ditolak (`stopReason: "blocked"`): run berhenti aman, status *partial* (jika ada hasil) / *error* (jika kosong), dengan diagnosis eksplisit di panel & popup. HTTP 302/401 tetap = login.
- **Fallback endpoint balasan `child_comments/`** — bila endpoint `inline_child_comments/` menjawab 404 / "not found" (versi klien IG berbeda-beda), engine otomatis mencoba `child_comments/` sekali per thread sebelum menyerah.
- **Pre-check `no_media`** — di halaman profil/feed (tanpa shortcode `/p/` atau `/reel/`), Proses kini gagal cepat dengan pesan "Buka halaman post/reel dulu" (pola `no_video` TikTok), di panel maupun jalur popup/shortcut — tidak lagi membuang 45 dtk dalam mode scroll.
- **Header `X-IG-WWW-Claim: 0`** — dikirim pada request replay (sama seperti web IG asli) untuk menstabilkan 403 sesekali akibat App-ID/claim tidak cocok.
- **Cooldown antar-run** — Proses diblokir sementara setelah run selesai (15 dtk; 60 dtk setelah rate limit) dengan pesan hitung mundur, mencegah run beruntun yang menjadi pemicu rate-limit/checkpoint (riset IG 2026).

## [1.0.15] — 2026-08-11

### Perbaikan audit IG (P1)
- **Replay tidak lagi menyasar post yang salah** — `buildUrl` kini menulis ulang segmen `media_id` di path API sesuai post yang sedang dibuka (pola `aweme_id` TikTok), dan `activeMediaId` diprioritaskan dari halaman (bukan dari template lama). Sebelumnya, template dari post lain (masih valid dalam TTL 30 mnt) membuat engine mengambil komentar post yang salah bila user tidak membuka komentar dulu.
- **Budget balasan benar-benar per-run** — counter `replyRequests` dipindah ke luar loop halaman: maksimal 40 request balasan per run (sebelumnya 40 per halaman, di-reset tiap halaman; cap nyata hanya budget global 150).
- **`rate_limit` jadi `stopReason` resmi** (konsisten dengan FB/TT) — engine mengirim `stopReason: "rate_limit"` alih-alih `timeout`+postHint; panel kini menampilkan status *partial* (jika ada hasil) / *error* (jika kosong) dan pesan "Rate limit Instagram (429)" spesifik (sebelumnya dengan hasil bisa salah jadi hijau "done").
- **`PleaseWaitFewMinutes` / `FeedbackRequired` diklasifikasikan** — `status:"fail"` dengan pesan "please wait a few minutes" / "feedback_required" kini diperlakukan sebagai rate limit/akun dibatasi: run berhenti aman dengan diagnosis jelas (bukan error generik), tanpa retry loop yang membahayakan akun.
- **Sleep interruptible di fase awal** — buka komentar (`tryOpenComments`), retry buka komentar, menunggu template, dan mode scroll kini memakai `sleepWhile` (cek Stop tiap 200 ms); FB/TT dan sisa IG sudah konsisten.

## [1.0.14] — 2026-08-11

### Ketahanan TikTok diperkuat
- **Backoff adaptif saat HTTP 429** — replay API komentar tidak langsung menyerah: menunggu sesuai header `Retry-After` (atau eskalasi 8s → 16s), maksimal 2 retry, dan hanya jika sisa waktu run masih cukup. Heartbeat progress tetap terkirim selama menunggu, jadi panel tidak terlihat beku.
- **Deteksi sesi tidak aktif** — respons HTTP 401 dari API komentar TikTok kini dianggap sesi kadaluarsa: run berhenti aman dengan pesan "Sesi TikTok tidak aktif…" di panel & popup (sebelumnya error generik).
- **Error jaringan ditangani** — blip jaringan (fetch gagal, tab di-throttle) di-retry sekali cepat, tidak langsung mengakhiri run.
- **Retry halaman kosong** — halaman kosong di tengah pagination (sementara `has_more` masih true) tidak lagi dinyatakan "complete": engine mencoba ulang cursor yang sama (2×) sebelum berhenti aman.
- **Budget balasan terpisah** — replay balasan dibatasi **40 request/run** (sebelumnya 30 thread × 15 halaman tanpa batas = hingga ratusan request), dan error 429/sesi tidak aktif di balasan kini menghentikan seluruh run (sebelumnya di-swallow diam-diam — berisiko untuk akun).
- **Sleep interruptible** — semua jeda (pagination, balasan, buka komentar, menunggu template, mode scroll) memeriksa tombol Stop tiap 200 ms, penghentian selalu responsif.
- **Diagnosis dibawa ke UI** — `rate_limit`/`no_login` kini menjadi `stopReason` resmi di panel & popup: status *partial* (jika ada hasil) / *error* (jika kosong), pesan TikTok-specific via `reasonToMessage` (sebelumnya `no_login` selalu menampilkan pesan Instagram).

### Pengujian
- Unit test `reasonToMessage` untuk `rate_limit` dan `no_login` TikTok (platform-aware TT vs FB vs IG) ditambahkan.

## [1.0.13] — 2026-08-10

### Ketahanan Facebook diperkuat
- **Backoff adaptif saat HTTP 429** — replay GraphQL tidak langsung menyerah: menunggu sesuai header `Retry-After` (atau eskalasi 8s → 16s), maksimal 2 retry, dan hanya jika sisa waktu run masih cukup. Heartbeat progress tetap terkirim selama menunggu, jadi panel tidak terlihat beku.
- **Deteksi sesi tidak aktif** — jika Facebook redirect ke halaman login (sesi kadaluarsa / token kedaluwarsa) atau mengembalikan HTML login, run berhenti aman dengan pesan "Sesi Facebook tidak aktif…" alih-alih mengumpulkan sampah atau terus mencoba.
- **Error jaringan ditangani** — blip jaringan (fetch gagal, tab di-throttle) di-retry sekali cepat, tidak langsung mengakhiri run.
- **Retry halaman kosong** — respons kosong / JSON gagal diparse di tengah pagination tidak lagi dianggap "complete": engine mencoba ulang cursor yang sama (2×) sebelum menyatakan berhenti, dan halaman `has_next_page` tanpa cursor dihentikan dengan aman (anti loop tak berujung).
- **Budget balasan terpisah** — replay balasan dibatasi 40 request/run (tidak lagi 25 thread × 8 halaman tanpa batas), dan error 429/sesi kadaluarsa di balasan kini menghentikan seluruh run (sebelumnya di-swallow diam-diam — berisiko untuk akun).
- **Sleep interruptible** — semua jeda (pagination, balasan, DOM fallback, menunggu template) memeriksa tombol Stop tiap 200 ms, penghentian selalu responsif.
- **Diagnosis dibawa ke UI** — `rate_limit`/`no_login` kini menjadi `stopReason` resmi: status *partial* (jika ada hasil) / *error* (jika kosong) di panel & popup, dengan pesan spesifik platform.

### Pengujian
- Unit test `reasonToMessage` untuk `rate_limit` (FB-specific + generic) dan `no_login` platform-aware (FB vs IG) ditambahkan.

## [1.0.12] — 2026-08-10

### Ketahanan Instagram diperkuat
- **Backoff adaptif saat HTTP 429** — engine tidak langsung menyerah: menunggu sesuai header `Retry-After` (atau 8s → 16s), maksimal 2 retry, dan hanya jika sisa waktu run masih cukup. Heartbeat progress tetap terkirim selama menunggu, jadi panel tidak terlihat beku.
- **Deteksi checkpoint & login gate** — `checkpoint_required`/`challenge_required` kini dibedakan dari sekadar login: run berhenti aman dengan status *partial* (jika ada hasil) dan pesan eksplisit "Instagram minta verifikasi (checkpoint)…" di panel & popup. Sebelumnya error ini salah diklasifikasikan sebagai "login"/"timeout" generik.
- **Error jaringan ditangani** — blip jaringan (fetch gagal, tab di-throttle) di-retry sekali cepat, tidak langsung mengakhiri run.
- **Retry halaman kosong** — IG kadang mengembalikan halaman kosong di tengah pagination sementara `has_more_comments` masih true; engine mencoba ulang cursor yang sama (2×) sebelum menyatakan selesai, dan berhenti aman bila `has_more` true tanpa cursor (menghindari loop tak berujung).
- **Cursor `next_max_id` lebih toleran** — menerima angka/string; balasan memakai fallback `next_max_child_id`.
- **Budget balasan terpisah** — replay balasan dibatasi 40 request/run (tidak lagi memakai jatah utama tanpa batas), dan error 429/login/checkpoint di balasan kini menghentikan run (sebelumnya di-swallow diam-diam — berisiko untuk akun).
- **Buka komentar lebih andal** — selektor baru (`View all comments`, `Lihat semua komentar`, `aria-label*="view all"`) + fallback berbasis teks, sehingga template API lebih sering ter-capture tanpa klik manual.
- **`maxMs` IG diseragamkan** — panel memakai 150 dtk (default shared), memberi ruang untuk backoff.
- **Header `Referer`** ditambahkan ke replay API, menyamai perilaku web IG.
- **Sleep interruptible** — semua jeda/backoff memeriksa tombol Stop (tiap 200 ms), penghentian selalu responsif.

### Pengujian
- Unit test `reasonToMessage("checkpoint", …)` + pemetaan status partial/error ditambahkan.

## [1.0.11] — 2026-08-10

### Diperbaiki (hasil audit dalam)
- **Normalisasi nama single-source** — 7 salinan logika normalisasi (shared + engine FB/TikTok/IG + content FB/TikTok/IG) disatukan ke satu referensi (blok `BEGIN/END-RESO-NORMALIZE`) dan dijaga **fixture test paritas** (`npm test`): setiap salinan diverifikasi byte-identik + perilaku identik terhadap korpus fixture. Drift daftar kata terblokir TikTok (engine/content membiarkan "View", "See", "Write", "Log in" lolos padahal shared memblokirnya) sudah disamakan.
- **`:has()` di halaman Options** — diganti kelas `.selected` yang di-set JS; sebelumnya manifest mengklaim dukungan Chrome 102 tapi tombol tema tidak menampilkan state terpilih di Chrome 102–104.
- **Pesan error platform-aware** — `reasonToMessage("no_template")` kini memakai kata-kata sesuai platform (FB: permalink + GraphQL; IG: post/reel + wajib login), bukan lagi pesan TikTok untuk semua platform. Pesan hasil tersimpan juga memakai "username" untuk IG.
- **Diagnosis rate limit (429) sampai ke user** — hint "Rate limit Instagram (429)…" dari engine tidak lagi dibuang: panel IG dan popup menampilkan pesan 429 spesifik (+ status parsial), bukan sekadar "Waktu habis".
- **Pre-check login Instagram** — sebelum mulai, extension memeriksa cookie `sessionid` via `chrome.cookies` (izin `cookies` ditambahkan) dan langsung menampilkan "Butuh login Instagram" tanpa membuang waktu 45 detik di mode scroll. Berlaku di popup, panel, shortcut, dan menu klik kanan.
- **Dead branch di engine Facebook** — `if ("id" in vars) vars.id = fbId; else vars.id = fbId;` diperbaiki menjadi `id` / `feedbackID` / `feedback_id` sesuai nama field yang dipakai template reply.
- **Cache token anti-forgery Facebook** — `getDtsg()`/`getLsd()` tidak lagi serialisasi seluruh DOM Facebook (`document.documentElement.innerHTML`, megabyte) per halaman pagination; di-cache dengan TTL 5 menit.

### Pengujian
- `sanitizeEngineOptions` dipindah ke `shared.js` (pure, teruji) — test mencakup SET_TEMPLATE FB/TT/IG, clamping `maxMs`, sanitasi `awemeId`/`mediaId`, dan `includeReplies` per platform.
- Total unit test naik menjadi **49** (`npm test`).

## [1.0.10] — 2026-08-10

### Ditambahkan
- **Halaman Pengaturan (Options)** — `chrome://extensions` → Details → Extension options (atau tombol ⚙ di popup):
  - **Default "Sertakan balasan" per platform** (Facebook / TikTok / Instagram) — dipakai sebagai nilai awal di popup, panel halaman, shortcut keyboard, dan menu klik kanan.
  - **Tema** — Sistem / Terang / Gelap, diterapkan langsung ke popup, panel Facebook, panel TikTok, panel Instagram, dan halaman Options itu sendiri (dengan preview live).
  - Auto-save setiap perubahan + tombol "Pulihkan default".

## [1.0.9] — 2026-08-10

### Ditambahkan
- **Platform baru: Instagram — username komentator** (post & reel). Output berupa **username IG** (`user123`, tanpa `@`, huruf kecil), bukan nama tampilan.
  - Replay endpoint private `api/v1/media/{media_id}/comments/` dengan cursor `max_id`/`next_max_id` (template di-capture via `webRequest`, TTL 30 menit).
  - Auto-open komentar + intercept `fetch`/XHR + fallback DOM (dialog komentar).
  - Proteksi akun: budget 150 request/run, delay acak besar, berhenti dini saat `429` atau `401/403` (login wajib → pesan jelas).
  - UI peringatan "butuh login" di popup & panel; aksen gradien Instagram (pink→ungu) di popup, panel, dan FAB.
- **Gabung Semua** (popup) — gabungkan nama unik Facebook + TikTok + Instagram.
- Unit test Instagram: normalisasi username (lowercase, tanpa @, charset, whitespace), validasi template, deteksi platform, default state — total **33 test**.

## [1.0.8] — 2026-08-10

### Ditambahkan
- **Badge jumlah nama di ikon ekstensi** — jumlah hasil terlihat langsung di toolbar (hijau saat selesai, kuning saat parsial, animasi saat berjalan), ikut platform tab aktif.
- **Shortcut keyboard** — `Ctrl+Shift+E` untuk Proses/ambil nama, `Alt+Shift+C` untuk salin ke clipboard (bisa diubah di `chrome://extensions/shortcuts`).
- **Menu klik kanan** — "Ambil nama komentator halaman ini" (di halaman FB/TikTok) dan "Buka & ambil nama dari tautan ini" (di link FB/TikTok): tab dibuka lalu ekstraksi berjalan otomatis.
- **Backup & Pulihkan JSON** — simpan hasil + preferensi ke file, pulihkan kapan saja (tombol di popup).
- **Filter & sortir nama di popup** — kotak cari nama + toggle urutkan A-Z; memengaruhi preview, Copy, dan Ekspor CSV.
- **Auto-open komentar TikTok lebih andal** — selector lebih luas (`comment-icon`, `comment-count`, tombol berlabel), klik ulang dengan retry sampai panel komentar benar-benar terbuka, sehingga template API ter-capture tanpa perlu klik manual.

### Diubah
- **Deteksi navigasi SPA tanpa polling** — ganti `setInterval` 1,6 detik dengan `MutationObserver` + hook `history.pushState/replaceState` + `popstate/hashchange` (debounce 300 ms): lebih responsif dan lebih hemat CPU di halaman yang sibuk.

## [1.0.7] — 2026-08-10

### Diperbaiki
- **Gabung FB+TT kini selalu lengkap** — `GET_ALL_STATE` memulihkan hasil tersimpan (`storage.local`) untuk kedua platform sebelum digabung, sehingga nama platform lain tidak hilang dari tombol "Gabung FB+TT" setelah browser restart.

### Disempurnakan
- **Desain lebih modern & hidup** — header gradien per platform, micro-interaction tombol (brightness saat hover, press saat klik), efek shimmer pada tombol Proses saat berjalan, denyut halus pada penghitung nama, indikator titik berkedip pada status *running*, dan animasi masuk panel di halaman Facebook/TikTok. Konsisten di popup, panel FB, dan panel TikTok (mode terang & gelap).

## [1.0.6] — 2026-08-10

### Ditambahkan
- **Hasil tersimpan lintas sesi** — hasil terakhir per platform dan preferensi "sertakan balasan" disimpan di `chrome.storage.local`; tidak hilang saat browser ditutup. Reset menghapus hasil tersimpan.
- **Ekspor CSV** — simpan hasil ke file `.csv` dengan BOM UTF-8 (siap dibuka Excel).
- **Gabung Facebook + TikTok** — gabungkan nama unik dari kedua platform sekali klik, langsung tersalin ke clipboard.
- **Unit test** — 24 test untuk `shared.js` (`npm test`, zero dependency).
- `CHANGELOG.md`, `README.md`, `package.json` (script `build`/`check`/`test`), `.gitignore`.

### Diperbaiki
- **Facebook: tanpa perlu buka/scroll semua komentar** — replay GraphQL pagination otomatis: template pagination dipilih dengan verifikasi (`page_info`) dan, bila belum ada capture, query dibangun langsung dari ID postingan di URL; scroll fallback menyasar kontainer komentar, bukan seluruh halaman.
- **UI/UX terpadu** — popup, panel Facebook, dan panel TikTok kini memakai satu design system (token `--rs-*`): komponen, radius, font, tombol, warna status, dan dark mode identik; panel halaman mendapat tombol Reset, `aria-live`, tooltip, dan warna status (done/partial/error) yang konsisten dengan popup.
- Run tidak lagi menggantung saat tab yang sedang memproses ditutup (`tabs.onRemoved` → status di-finalisasi otomatis).
- Berhenti dini saat Facebook membalas `HTTP 429` (rate limit) dan batas jumlah halaman/request per run (FB 120 halaman, TikTok 350 request) untuk melindungi akun.
- Deteksi `feedback_id` untuk ekspansi balasan (kondisi regex sebelumnya selalu salah).
- Logika normalisasi nama disinkronkan antar `shared.js`, `content-fb.js`, dan `inject-fb.js` (filter unicode + daftar kata terblokir identik).
- Aksesibilitas: FAB TikTok kini punya `aria-label`/`title`.
- Dead branch `fb_dtsg` di replay GraphQL dirapikan.

## [1.0.5] — Sebelumnya
Rilis awal: ekstraksi nama komentator Facebook (GraphQL + DOM) & TikTok (replay API + DOM), copy ke clipboard, deduplikasi, filter timestamp/UI.
