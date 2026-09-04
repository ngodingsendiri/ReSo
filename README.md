# ReSo — Rekap Engagement Sosmed

Aplikasi rekap engagement pegawai ke media sosial lembaga (Instagram, Facebook, TikTok), dirancang untuk berbagai instansi/organisasi, lengkap dengan ekstensi Chrome **ReSoEx** yang menarik nama komentator secara otomatis.

Dokumen acuan:

- [`specify.md`](./specify.md) — tujuan & domain produk
- [`constitution.md`](./constitution.md) — aturan pengembangan & deploy
- [`WEB_AUDIT.md`](./WEB_AUDIT.md) — audit ketangguhan web (anti-hang, race, scroll)
- [`EXTENSION_AUDIT.md`](./EXTENSION_AUDIT.md) — audit ekstensi ReSoEx
- [`EFFICIENCY_AUDIT.md`](./EFFICIENCY_AUDIT.md) — audit efisiensi (bundle, render, Firestore)

## Stack

- React 19 + TypeScript + Vite + Tailwind
- Firebase Auth (Google) + Firestore
- Ekstensi Chrome MV3 (di `extension/`)
- Deploy target: **Vercel free** (`rekapsosmed.vercel.app`)

## Multi-tenant (1 proyek, 1 DB, subtree per dinas)

- Proyek Firebase: **`reso-id`** — satu database `(default)` (Spark/gratis, tanpa billing).
- Tiap akun Google terverifikasi yang login = 1 dinas = 1 subtree `dinas/{uid}`.
- **Open registration**: siapa pun dengan akun Google bisa login; `/api/provision` memverifikasi token + menulis marker `dinas/{uid}/admins/{uid}`.
- **Isolasi data**: `firestore.rules` membatasi akses hanya ke `dinas/{request.auth.uid}` (atau super-admin) — data tidak pernah bercampur antar dinas.
- Ekstensi menulis via API → masuk ke `dinas/{uid}/...` dinas yang login.
- Routing diambil dari **uid token yang diverifikasi** (bukan input client).

## Menjalankan lokal

**Prasyarat:** Node.js 22+, Python 3.12 (untuk hitung extension ID).

```bash
npm install
npm run dev
```

App: http://localhost:3000 (Vite dev server)

## Script

| Command | Fungsi |
|---------|--------|
| `npm run dev` | Vite dev server |
| `npm run build` | Build production ke `dist/` |
| `npm run preview` | Preview build static |
| `npm run lint` | Typecheck (`tsc --noEmit`) |
| `npm test` | Semua test (matching, API, handoff, extension) |
| `python scripts/compute_ext_id.py <key.pem>` | Hitung extension ID Chrome (a-p alphabet) |
| `cd extension && npm run build` | Build ekstensi ke `extension/dist/` |
| `cd extension && npm run zip` | Buat zip ekstensi |

## Deploy Vercel (gratis)

1. Hubungkan repo ke Vercel
2. Framework: Vite · Output: `dist` (lihat `vercel.json`)
3. Deploy — SPA rewrite + API Functions sudah dikonfigurasi

> Tidak ada server Node/Express — semua API pakai Vercel Functions + Firestore REST.

## Ekstensi Chrome (ReSoEx)

- Menarik nama komentator dari **Facebook** (GraphQL + auto "Semua Komentar"), **TikTok**, **Instagram**.
- Rekap+Kirim otomatis ke `/api/engagement` → masuk ke rekap dinas yang login.
- Tidak butuh login sendiri: **reuse sesi web app** via push (`RESO_CONNECT`) & handoff (`reso:get-token`).
- Token yang diterima ekstensi **hanya idToken** (~1 jam) — refresh token TIDAK pernah diberikan (mencegah logout diam-diam).

### Distribusi

- **Github Actions** (`extension-release.yml`) mem-pack otomatis setiap ada perubahan di `extension/`:
  build → CRX + ZIP → hitung extension ID → GitHub Release → sync config.
- **Download URL stabil**: `https://github.com/ngodingsendiri/ReSo/releases/latest/download/reso-extension.zip`
- **Cara install (disarankan):** download `.zip` → ekstrak → `chrome://extensions` → **Developer mode** → **Load unpacked** → pilih folder. Extension ID stabil (`bilnegbhoaabgfchklhhfljcfgaheccp`) sehingga push/handoff berfungsi.
- Opsi `.crx` drag-drop tetap ada, tapi sebagian versi Chrome menolak dengan `CRX_REQUIRED_PROOF_MISSING` → gunakan `.zip`.

### Secret GitHub yang dibutuhkan

| Secret | Isi |
|--------|-----|
| `EXTENSION_PRIVATE_KEY` | Isi `extension/dist-crx/reso-extension-key.pem` (RSA signing key — JANGAN di-commit) |

## Alur Data

```
Extension ReSoEx (Chrome MV3)
  │
  │ 1. Ekstrak nama komentator (FB/TikTok/IG)
  │ 2. POST /api/engagement  (Bearer idToken)
  ▼
/api/engagement (Vercel Function)
  │
  │ 3. Verifikasi idToken → uid
  │ 4. getFsBase(uid) → dinas/{uid}/dailyEngagement/{date}
  │ 5. mergeUniqueLines + dedupe case-insensitive
  │ 6. Hitung ulang engagedEmployeeIds
  ▼
Firestore → dinas/{uid}/dailyEngagement/{date}
  │
  │ 7. Dashboard baca via onSnapshot
  ▼
Dashboard (React + Firebase SDK)
  │
  │ 8. Tampilkan rekap, laporan harian/mingguan/bulanan
  │ 9. Matching nama dengan master pegawai
  ▼
Export PDF (A4 multi-page) / Gambar (maks 60 pegawai, satu lembar) / Excel (per-hari)

--- Token Flow ---
Web App login → push RESO_CONNECT (idToken) → extension
  🡑 focus                      🡓 handoff bila expired
  └─────────────── tab ReSo terbuka ──────────┘
```

## API (Vercel Functions)

| Endpoint | Fungsi |
|----------|--------|
| `POST /api/engagement` | Jalur tulis otomatis dari ekstensi — verifikasi token Firebase, merge nama ke `dinas/{uid}/dailyEngagement/{date}` (dedupe + hitung ulang `engagedEmployeeIds`). Idempoten. |
| `POST /api/provision` | Bootstrap dinas — verifikasi token + tulis marker `dinas/{uid}/admins/{uid}` (open registration, tanpa service account). |
| `GET /api/health` | Probe konektivitas untuk indikator "Terhubung" di ekstensi. |

> **Tidak butuh env `GOOGLE_SERVICE_ACCOUNT`** — semua operasi memakai token operator (user yang terverifikasi), aturan Firestore yang menjamin isolasi per dinas.

## Firestore

- Satu sumber aturan: **`firestore.rules`** — scope `dinas/{uid}` (pemilik uid atau super-admin) + `users/{userId}` top-level.
- Deploy rules ke `reso-id`:
  ```bash
  firebase login
  firebase use reso-id
  firebase deploy --only firestore:rules
  ```

## Model Data

- **Per hari, bukan per postingan**: `dailyEngagement/{date}` menggabungkan SEMUA komentar dari semua post tanggal itu.
- **Dedupe case-insensitive**: nama yang sama dari post berbeda tidak dobel.
- **Idempoten**: kirim ulang = update (merge), bukan duplikat.
- **Export gambar**: maksimal 60 pegawai (satu lembar). Untuk > 60 pegawai, tombol Gambar otomatis nonaktif, gunakan export PDF (A4 multi-page) atau Excel.
- **Export Excel**: format per-hari (daily: Nama/NIP/Bidang/IG/FB/TT; mingguan/bulanan: kolom per tanggal + Total + %ENG).
- **Notifikasi jam engagement dihapus** — tidak ada push reminder.

## Catatan

- Mode pengembangan default: **penyempurnaan**, bukan rombak workflow (lihat constitution).
- Logo di-hardcode sebagai SVG (`public/logo.svg`) — tidak ada fitur upload logo.
- **Versi aplikasi** tampil di sidebar kiri ("ReSo vX.X.X") dan halaman Pengaturan. Versi dibaca dari `package.json` saat build — naikkan manual tiap rilis.
- **Versi ekstensi** tampil di popup ("ReSo Ekstensi vX.X.X"). Versi dibaca dari `extension/manifest.json` (disinkron lewat `stamp-version.mjs` saat `npm run build`). Naikkan di `extension/package.json` **dan** `extension/manifest.json` bersamaan (test anti-drift menolak bila beda); GitHub Actions mem-pack dan merilis otomatis.

### Rilis v1.0.58 — ringkasan besar

- **Ketiga mesin (FB/IG/TT) berarsitektur 4 lapis**: synthetic-from-page → capture
  replay → live ingest → DOM fallback; pagination penuh tanpa scroll manual.
- **Akurasi thread besar**: ukuran halaman dinaikkan, guard idle lebih sabar,
  budget balasan naik — rekap tidak lagi berhenti di 9–12 nama.
- **Kejujuran hasil**: stopReason `incomplete` (partial) bila ujung thread tak
  pernah terlihat + estimasi ±total komentar; pre-seed membuat "Proses lagi"
  bersifat akumulatif.
- **Personalisasi struktur**: FB multi-foto/reels/share; IG korsel satu-kontainer
  + embed; TT video/foto/embed/share/live.
- **Aksesibilitas & UX**: dialog semantik + focus trap di modal & panel ekstensi,
  viewport zoom dibebaskan, popup/panel dirapikan flat-minimalis.

### Rilis v1.0.59 — tuning & polish (2026-08-25)

- **Performa**: window riwayat 92→120 hari (±4 bulan), Meta fetch concurrency 5→7, debounce matchPreview, cache logo, InputModal terpisah (−430 baris, render 2× lebih ringan).
- **Build**: react-vendor 223KB terpisah — app chunk 411KB→205KB, caching stabil.
- **Ekstensi**: auto-open dual sinyal FB, heartbeat DOM tiap 3 halaman, tooltip FAB “nama unik, bukan hitungan komentar”.
- **UI**: Settings simetris tombol +, Dashboard Aktivitas Terakhir & Laporan pakai ReportControls bersama, flat minimalis konsisten.
