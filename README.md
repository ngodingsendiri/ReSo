# ReSo — Rekap Engagement Sosmed

Aplikasi internal **Diskominfo** untuk merekap engagement pegawai ke media sosial lembaga (Instagram, Facebook, TikTok).

Dokumen acuan:

- [`specify.md`](./specify.md) — tujuan & domain produk  
- [`constitution.md`](./constitution.md) — aturan pengembangan & deploy  

## Stack

- React 19 + TypeScript + Vite + Tailwind  
- Firebase Auth (Google) + Firestore  
- PWA (installable)  
- Deploy target: **Vercel free** (`*.vercel.app`)

## Menjalankan lokal

**Prasyarat:** Node.js 20+

```bash
npm install
npm run dev
```

App: http://localhost:3000

## Script

| Command | Fungsi |
|---------|--------|
| `npm run dev` | Dev server (Express + Vite) |
| `npm run build` | Build production ke `dist/` |
| `npm run preview` | Preview build static |
| `npm run lint` | Typecheck (`tsc --noEmit`) |
| `npm run test:matching` | Regresi matching nama/username |

## Deploy Vercel (gratis)

1. Hubungkan repo ke Vercel  
2. Framework: Vite · Output: `dist` (lihat `vercel.json`)  
3. Deploy — SPA rewrite sudah dikonfigurasi  

Production **tidak** membutuhkan Express. Recalculate berjalan di **client** (Firestore).

## PWA

- Installable (Chrome/Edge prompt; iOS: Bagikan → Tambah ke Layar Utama)
- Service worker + auto-update (toast “Muat ulang” saat ada build baru)
- App shell di-cache; **data rekap tetap butuh internet** (Firebase)
- Notifikasi jam 14:45 / 15:00 hanya saat app terbuka (bukan push server)
- Regenerasi ikon dari SVG: `npm run icons`

## Fitur utama

- Login Google (allowlist / admins)  
- Master data pegawai + dual akun IG/FB/TikTok  
- Input rekap harian (paste + Meta API helper)  
- Laporan harian / mingguan / bulanan + export PDF/gambar  
- Reminder 14:45 & 15:00 WIB  
- Kalkulasi ulang matching (client-side)

## Catatan

- Mode pengembangan default: **penyempurnaan**, bukan rombak workflow (lihat constitution).  
- Deploy rules Firestore terpisah (`firestore.rules`) ke Firebase Console jika diubah.
