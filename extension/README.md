# ReSo Ekstention

Ekstensi Chrome (Manifest V3) untuk **mengambil nama komentator dari Facebook, TikTok & Instagram**, lalu menyalinnya ke clipboard — siap di-paste ke Excel (1 nama per baris).

Tanpa dependensi, tanpa backend, tanpa API key. Semua berjalan di browser Anda.

## Fitur

- 🎛️ **Toggle mode** — popup hanya saklar ON/OFF; saat ON, FAB + panel muncul di halaman Facebook/TikTok/Instagram, saat OFF disembunyikan.
- 📘 **Facebook** — ekstrak nama komentator dari postingan (permalink), termasuk balasan (reply) bila diaktifkan.
- 🎵 **TikTok** — ekstrak nickname komentator dari video, termasuk balasan bila diaktifkan.
- 📸 **Instagram** — ekstrak **username** komentator (mis. `user123`, tanpa `@`) dari post & reel. **Wajib login IG** di browser (paling rapuh dari ketiga platform — gunakan dengan hati-hati).
- 🔄 **Deduplikasi otomatis** — nama yang sama (besar/kecil huruf) hanya dihitung sekali.
- 🧹 **Filter pintar** — buang label UI ("Like", "Komentar", "Follow"), timestamp ("2 jam yang lalu", "5h"), URL, dan noise lain.
- 🎛️ **Panel 6 aksi** — Rekap (ambil nama), Copas (salin ke clipboard), **Rekap + Kirim ke ReSo** (kirim langsung ke database ReSo via API), Hentikan, Bersihkan hasil, dan checkbox Balasan.
- 📅 **Deteksi tanggal & jam posting** — saat Rekap+Kirim, ekstensi memindai DOM post (FB: `data-utime`/"9 Agu pukul 07.30", IG: `<time datetime>` ISO, TikTok: `createTime` dari rehydration JSON) dan mengirim `date` + `postedAt` ke ReSo; satu hari bisa menampung banyak post.
- ⚡ **Facebook tanpa scroll** — replay GraphQL pagination otomatis; query dibangun langsung dari ID postingan bila belum ada capture, jadi tidak perlu buka/scroll semua komentar dulu.
- 🛡️ **Proteksi rate-limit, sesi & checkpoint (FB + IG)** — backoff adaptif saat HTTP 429 (mengikuti `Retry-After`), deteksi sesi tidak aktif (FB redirect login) & checkpoint (IG) dengan pesan jelas, batas request per run (top-level + balasan), retry halaman kosong, dan penghentian aman saat akun butuh verifikasi.
- 🌗 Mendukung mode gelap; antarmuka bahasa Indonesia.

## Jembatan ReSo (Rekap + Kirim)

Tombol **Rekap + Kirim** di panel mengirim nama hasil ekstraksi langsung ke
database ReSo via `POST /api/engagement` — tanpa membuka tab ReSo.

- **Sesi**: token Firebase diambil sekali dari tab ReSo yang sudah login,
  lalu di-refresh otomatis tanpa tab (mint via Firebase REST). Saat handoff
  dipicu dari content script, query `chrome.tabs` didelegasikan ke background
  (`chrome.tabs` tidak tersedia di content script).
- **Domain ReSo TIDAK di-hardcode** (publikasi ramah-fork): tiap deploy Vercel
  punya domain sendiri (mis. `reso.sekretariat.fun`). Ekstensi mempelajari
  domain dari web app ReSo lewat **app push** — saat app terbuka & login, ia
  mendorong `{url, idToken, uid, email}` ke ekstensi (`RESO_CONNECT`), lalu
  API/health/handoff otomatis menarget domain itu. Domain juga bisa **di-pin
  manual** di **Options** (tombol ⚙ di popup → Halaman opsi) sebagai jangkar
  keamanan & fallback bila app belum mengirim. Tanpa keduanya, default
  `https://reso.sekretariat.fun`.
- **App push (web → ekstensi)**: `src/lib/extension-bridge.ts` memanggil
  `chrome.runtime.sendMessage(EXTENSION_ID, { type: "RESO_CONNECT", … })` saat
  login & tiap halaman fokus. Butuh `extensionId` di `firebase-applet-config.json`
  (diisi otomatis oleh GitHub Actions; saat ini `bilnegbhoaabgfchklhhfljcfgaheccp`).
  Ekstensi hanya menerima push bila origin pengirim = `url` yang diklaim (situs
  lain tak bisa menyaru); bila URL di-pin di Options, push domain lain ditolak.
  **Keamanan sesi**: ekstensi HANYA menerima `idToken` (~1 jam), BUKAN refresh
  token (mencegah logout diam-diam pengguna app).
- **Data tidak pernah hilang**: jika kiriman gagal karena masalah sementara
  (jaringan, server 5xx/429, token basi), nama **masuk antrian** `resoPending`
  di `chrome.storage.local` lalu dikirim ulang otomatis oleh background —
  alarm berkala 2 menit, saat antrian berubah, saat tab ReSo selesai dimuat,
  atau lewat tombol **"Kirim ulang antrian"** di popup. Error permanen
  (400/403) tidak di-antri.
- **Status koneksi di popup**: indikator *"ReSo: Terhubung / Belum tersambung /
  N kiriman antri"* (probe `GET /api/health` ke domain yang dipelajari + validitas
  sesi, hasil di-cache), menampilkan domain terhubung; plus tombol **"Buka ReSo"**
  (buka tab domain itu), **"Kirim ulang antrian"** saat ada antrian, dan
  **"Putuskan"** (lupakan koneksi).
- **Idempoten**: kirim ulang hanya meng-update rekap (dedupe nama
  case-insensitive + hitung ulang pegawai terlibat di sisi server).

## Cara Pasang (Load Unpacked — disarankan)

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode** (pojok kanan atas).
3. Klik **Load unpacked** → pilih folder `extension/dist/` hasil build (atau hasil ekstrak dari `.zip` release).
4. Ekstensi **ReSo Ekstention** siap dipakai di toolbar.

> **Distribusi**: file rilis (`reso-extension.zip` / `reso-extension.crx`) dibuat otomatis
> oleh **GitHub Actions** dan diunggah ke **GitHub Releases**. Download stabil:
> `https://github.com/ngodingsendiri/ReSo/releases/latest/download/reso-extension.zip`.
> Ekstrak `.zip` → **Load unpacked** (bila drag `.crx` muncul
> `CRX_REQUIRED_PROOF_MISSING`, pakai jalur `.zip`). Extension ID stabil sehingga
> push/handoff tetap berfungsi.

## Cara Pakai

### Facebook
1. Buka **1 postingan** (permalink), bukan home feed.
2. Pastikan komentar terlihat, lalu buka panel (FAB ikon di pojok kanan-bawah atau ikon di bar Like/Comment/Share) dan klik **Proses**. Badge API (ikon ✓ Siap / ! Belum) di panel/popup muncul saat berada di halaman post permalink.

> 💡 **Widget panel default tertutup** — FAB kecil di pojok kanan-bawah tidak menutupi halaman saat scrolling; jumlah hasil terlihat di badge FAB. Panel hanya terbuka saat kamu klik FAB.
3. Tunggu hingga selesai / partial, lalu **Copy nama**.
4. Paste di Excel — 1 nama per baris.

> ⚙️ Saat FB membatasi request (HTTP 429), engine menunggu sejenak lalu lanjut (backoff).
> Jika sesi tidak aktif, run berhenti aman dengan pesan "Sesi Facebook tidak aktif…" —
> login di facebook.com lalu Proses lagi.

### TikTok
1. Buka **1 video** (URL berisi `/video/...`), bukan feed For You saja.
2. Klik ikon **komentar** sampai daftar komentar muncul (badge *"API komentar: siap"*).
3. Klik **Proses**, tunggu selesai, lalu **Copy nama**.

> ⚙️ Saat TikTok membatasi request (HTTP 429), engine menunggu sejenak lalu lanjut (backoff).
> Jika sesi tidak aktif (401), run berhenti aman dengan pesan "Sesi TikTok tidak aktif…" —
> login di tiktok.com lalu Proses lagi. Balasan dibatasi 40 request/run agar akun aman.
> Sejak v1.0.18 ada **pre-check login**: tanpa sesi tiktok.com, Proses gagal cepat dengan pesan tersebut (pola Instagram).

### Instagram
1. **Login Instagram** di browser ini (wajib — tanpa sesi, komentar tidak bisa dimuat).
2. Buka **1 post/reel** (URL `/p/...` atau `/reel/...`), klik ikon **komentar** sampai list muncul.
3. Klik **Proses**, tunggu selesai, lalu **Copy username** — hasil adalah username IG tanpa `@`.
4. ⚠️ Instagram paling rentan rate-limit/checkpoint — ekstensi menunggu (backoff) saat 429, berhenti aman saat akun butuh verifikasi ("checkpoint"), saat IG meminta jeda ("Please wait…") atau membatasi akun ("FeedbackRequired"), dan saat permintaan diblokir anti-bot (HTTP 403 — diagnosis akurat, bukan keliru bilang "login"). Replay selalu menyasar post yang sedang dibuka (media_id ditulis ulang dari halaman); endpoint balasan punya fallback `child_comments/`; request menyertakan header `X-IG-WWW-Claim` seperti web IG asli. Ada **cooldown antar-run** (15 dtk, 60 dtk setelah rate limit) agar Proses beruntun tidak memicu checkpoint. Template komentar tidak lagi tertimpa post lain saat run aktif (guard mid-run), dan popup kini konsisten memakai kata "username".

## Pengaturan (Options)

Buka lewat **tombol ⚙ di popup**, atau `chrome://extensions` → **Details** → **Extension options**.

- **Default "Sertakan balasan"** — set nilai awal checkbox reply untuk Facebook, TikTok, dan Instagram (dipakai popup, panel halaman, shortcut, dan menu klik kanan).
- **Tema** — Sistem (ikut perangkat), Terang, atau Gelap; berlaku langsung di popup & panel tanpa reload.

## Struktur Proyek

```
manifest.json          Definisi ekstensi MV3 (izin, host, content scripts)
background.js          Service worker: router pesan, state, injeksi engine
shared.js              Helper murni (normalisasi nama, deteksi platform, state, pesan doneMessage)
content-fb.js / .css   UI + jembatan di halaman Facebook
content-tiktok.js/.css UI + jembatan di halaman TikTok
content-ig.js / .css  UI + jembatan di halaman Instagram
inject-fb.js           Mesin ekstraksi FB (MAIN world) — pagination GraphQL + fallback DOM
inject-tiktok.js       Mesin ekstraksi TikTok (MAIN world) — replay API komentar + fallback DOM
inject-ig.js           Mesin ekstraksi Instagram (MAIN world) — replay API komentar + fallback DOM
popup.html / popup.js / popup.css   Popup toolbar
options.html / .css / .js   Halaman pengaturan (default balasan + tema)
icons/                 Ikon ekstensi (16/48/128)
tests/                 Unit test + fixture parity (zero dependency, Node bawaan)
```

Arsitektur 3 lapisan per platform: **background** (kontrol/state) → **content script** (UI + jembatan) → **engine MAIN world** (ekstraksi). Kontrol dipisahkan dari data: perintah lewat `chrome.scripting.executeScript`, hasil lewat `postMessage` yang divalidasi.

Hasil akhir & preferensi disimpan di `chrome.storage.local` (tahan browser restart); state berjalan sementara di `chrome.storage.session`.

Lihat [`CHANGELOG.md`](./CHANGELOG.md) untuk riwayat versi, dan [`RESEARCH.md`](./RESEARCH.md) untuk riset platform (Facebook, TikTok, Instagram) — batas komentar/like, kebutuan login, dan peta implementasi.

## Pengembangan

```bash
npm test    # jalankan unit test (node --test, tanpa dependensi)
npm run check   # validasi sintaks semua file JS
npm run build   # rakit bundle loadable ke dist/
```

> Catatan: `npm install` tidak diperlukan — proyek tanpa dependensi runtime maupun dev.
> Logika yang dibagi antar-world dipusatkan di `shared.js` dalam blok marker
> `BEGIN/END-RESO-*`: normalisasi nama (`NORMALIZE`), pesan akhir run (`DONEMSG`),
> parsing payload komentar (`PARSERS`), perkakas UI daftar (`PANELTOOLS`), dan
> deteksi permalink Facebook (`FBURLS`).
> **Fixture test** (`tests/normalization-fixture.test.mjs`) memastikan semua salinan di
> engine (MAIN world) dan content scripts tetap byte-identik — melanggar aturan ini
> membuat `npm test` gagal.
> Pesan yang sama untuk popup & panel dihasilkan oleh satu helper `doneMessage`
> (`reasonToMessage` di background hanya mendelegasikannya), jadi tidak ada drift
> kata/kalimat antar permukaan.
> Fitur panel (search, Urutkan A–Z, Gabung) setara popup; Gabung lintas
> platform dijalankan di background (`MERGE_ALL`) karena content script hanya
> membawa normalizer platform-nya sendiri.
>
> 🎨 **Desain flat minimal (v1.0.29)** — ikon Material Symbols (Google) di popup,
> options, dan panel FB/TikTok/IG; tombol aksi ikon-only (tooltip `title`),
> indikator status & badge API ikon + kata pendek; header panel tanpa gradien.
> **Widget panel default tertutup**: FAB kecil yang tidak menutupi halaman saat
> scrolling — hasil terlihat di badge jumlah FAB, panel dibuka via klik FAB.

## Paket untuk Chrome Web Store

```bash
npm run build
cd dist && zip -r ../reso-ekstention.zip .   # lalu unggah zip ke Web Store
```

## Disclaimer

Ekstraksi data komentar publik berjalan langsung di halaman dan bergantung pada struktur DOM/API Facebook, TikTok & Instagram yang dapat berubah sewaktu-waktu. Instagram wajib login dan paling rentan terhadap rate-limit/checkpoint akun — gunakan dengan bijak untuk data yang Anda berhak akses, dan patuhi ketentuan layanan platform serta kebijakan Chrome Web Store.
