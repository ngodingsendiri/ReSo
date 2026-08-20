# ReSo — Rekap Engagement Sosmed

Aplikasi internal **Diskominfo** untuk merekap engagement pegawai ke media sosial lembaga (Instagram, Facebook, TikTok), lengkap dengan ekstensi Chrome **ReSoEx** yang menarik nama komentator secara otomatis.

Dokumen acuan:

- [`specify.md`](./specify.md) — tujuan & domain produk
- [`constitution.md`](./constitution.md) — aturan pengembangan & deploy

## Stack

- React 19 + TypeScript + Vite + Tailwind
- Firebase Auth (Google) + Firestore
- PWA (service worker + offline shell)
- Ekstensi Chrome MV3 (di `extension/`)
- Deploy target: **Vercel free** (`rekapsosmed.vercel.app`)

## Multi-tenant (1 proyek, DB per dinas)

- Proyek Firebase: **`reso-id`**
- Tiap akun Google terverifikasi yang login = 1 dinas = 1 database Firestore `db-<uid>`.
- **Open registration**: siapa pun dengan akun Google bisa login; `/api/provision` otomatis membuat `db-<uid>` + `admins/{uid}` (user = admin database-nya sendiri).
- Data tidak pernah bercampur antar dinas: routing database diambil dari **uid token yang diverifikasi** (bukan input client).
- Ekstensi menulis via API → masuk ke database dinas yang login.

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
| `node scripts/sync-rules.mjs` | Generate `api/provision-rules.ts` dari `firestore.rules` |
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

## API (Vercel Functions)

| Endpoint | Fungsi |
|----------|--------|
| `POST /api/engagement` | Jalur tulis otomatis dari ekstensi — verifikasi token Firebase, cek admin, merge nama ke `dailyEngagement/{date}` di `db-<uid>` (dedupe + hitung ulang `engagedEmployeeIds`). Idempoten. |
| `POST /api/provision` | Bootstrap multi-tenant — buat `db-<uid>` + `admins/{uid}` + deploy rules (butuh env `GOOGLE_SERVICE_ACCOUNT`). |
| `GET /api/health` | Probe konektivitas untuk indikator "Terhubung" di ekstensi. |

### Env Vercel

| Env | Fungsi |
|-----|--------|
| `GOOGLE_SERVICE_ACCOUNT` | JSON service account untuk auto-provision database per dinas |

## Firestore

- Satu sumber aturan: **`firestore.rules`** (di-sync ke `api/provision-rules.ts` via `scripts/sync-rules.mjs`).
- Deploy rules ke `reso-id`:
  ```bash
  firebase login
  firebase use reso-id
  firebase deploy --only firestore:rules
  ```

## Catatan

- Mode pengembangan default: **penyempurnaan**, bukan rombak workflow (lihat constitution).
- Logo di-hardcode sebagai SVG (`public/logo.svg`) — tidak ada fitur upload logo.
- PWA: installable + service worker + offline shell; setting instal/update PWA dihapus dari menu Pengaturan.
