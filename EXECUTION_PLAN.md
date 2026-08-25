# 🚀 Plan Eksekusi Perbaikan UI/UX ReSo

Berdasarkan temuan `UIUX_AUDIT.md`. Dieksekusi bertahap per fase, dengan verifikasi build setiap fase.

---

## FASE 1 — Fondasi: Design Token & Komponen Dasar ⭐ (Prioritas Tertinggi)

**Tujuan:** Satu sumber kebenaran untuk ukuran, shadow, dan radius.

### Task 1.1 — Standardisasi Button (`src/components/ui/button.tsx`)
- [ ] Rapikan skala size:
  - `default`: `h-10 px-4`
  - `sm`: `h-8 px-3`
  - `lg`: `h-12 px-6`
  - `icon`: `size-8` (sudah), pastikan semua pakai varian, bukan override className.
- [ ] Hapus kebiasaan override `h-11`, `h-9` di pemanggil (dilakukan per-fase di bawah).

### Task 1.2 — Card default shadow (`src/components/ui/card.tsx`)
- [ ] Tambahkan `shadow-sm` ke base class Card.
- [ ] Verifikasi semua halaman tidak double-shadow.

### Task 1.3 — Input konsisten (`src/components/ui/input.tsx`)
- [ ] Tetap `h-10` sebagai default; hapus semua override `h-8/h-9/h-11` di pemanggil (Settings, EmployeeManager search).

**Verifikasi:** `npm run build` sukses + cek visual dev server.

---

## FASE 2 — DashboardTab & StatCard

### Task 2.1 — Hapus duplikasi StatCard & colorMap (`DashboardTab.tsx`)
- [ ] Hapus definisi StatCard **di dalam** komponen DashboardTab (baris ~101–135); pertahankan yang di level modul.
- [ ] Ekstrak `colorMap` ke satu konstanta level modul (hapus duplikat di dalam).
- [ ] Opsional: pindahkan StatCard ke `src/components/ui/stat-card.tsx`.

### Task 2.2 — Ikon flat tanpa border
- [ ] Wrapper ikon StatCard: hapus class `border-*` dari colorMap → hanya `bg-{color}-50 text-{color}-600`.

### Task 2.3 — Ukuran tombol CTA
- [ ] "Input rekap hari ini": `h-11` → gunakan `size="default"` (`h-10`).

**Verifikasi:** build + visual dashboard desktop & mobile.

---

## FASE 3 — SettingsTab

### Task 3.1 — Standarisasi tombol
- [ ] Tombol utama (Simpan Token, Jalankan, Simpan Link): `h-8` → `size="sm"` (`h-8`) atau naik ke `h-9` konsisten — putuskan: **utama `h-9`, sekunder/ikon `h-8`**.
- [ ] Tombol Siapkan Database: samakan dengan tombol utama lain.

### Task 3.2 — Sosial media horizontal di desktop
- [ ] Saat expand: baris IG/FB/TT jadi `grid grid-cols-1 lg:grid-cols-3 gap-2` agar memanfaatkan lebar.

### Task 3.3 — Aksesibilitas
- [ ] Tambah `aria-label` pada: toggle eye token, tombol hapus token, toggle sosial media.

---

## FASE 4 — EmployeeManager

### Task 4.1 — Seragamkan tombol
- [ ] Template / Export / Impor / Tambah: `h-11` → `size="default"`.
- [ ] Batal/Simpan form: sudah `h-10`, rapikan className (buang override manual, pakai prop size).
- [ ] Pagination: tetap `size="sm"`.

### Task 4.2 — Search input
- [ ] `h-11` → default `h-10`; background `bg-slate-50 border-transparent focus:bg-white` boleh dipertahankan (pattern intentional) tapi catat di design system.

### Task 4.3 — Delete modal
- [ ] `rounded-2xl` → `rounded-xl`.
- [ ] `shadow-xl` → `shadow-lg`.
- [ ] Ikon wrapper: `rounded-xl border border-rose-100` → flat `bg-rose-50` saja (tanpa border).

### Task 4.4 — Table header
- [ ] `backdrop-blur-sm` + `bg-slate-50/90` → cukup `bg-slate-50` (flat).

### Task 4.5 — Badge bidang
- [ ] `rounded` (4px) pada badge NIP/bidang → `rounded-full` untuk pill konsisten dengan Badge global.

---

## FASE 5 — Laporan (Daily/Weekly/Monthly)

### Task 5.1 — Ekstrak komponen bersama `ReportControls`
Buat `src/components/reports/ReportControls.tsx` menerima props:
```
title, subtitle, onPrev, onNext, isCurrentLabel?, sortOptions[], activeSort, onSortChange,
exportHandlers { pdf, excel, image }, canExportImage, isLoading
```
- [ ] Refactor ketiga view memakai komponen ini.
- [ ] Ukuran ikon platform diseragamkan: daily `14`, weekly `12` → seragam `14`.

### Task 5.2 — Mobile card parity
- [ ] Daily: badge IG/FB/TT kotak; Weekly/Monthly: persen — biarkan berbeda konteksnya, tapi seragamkan padding (`p-3`) dan radius (`rounded-xl`) antar view. ✅ sudah hampir sama, tinggal cek gap.

---

## FASE 6 — Login, ErrorBoundary, Chart

### Task 6.1 — LoginScreen
- [ ] `shadow-sm` card → `shadow-md` (biar menonjol di atas bg blur).
- [ ] Loading screen di `App.tsx`: `rounded-2xl` → `rounded-xl`.

### Task 6.2 — ErrorBoundary
- [ ] Tombol `rounded-lg` → `rounded-xl`.

### Task 6.3 — EngagementChart
- [ ] Tooltip inline style → pakai token: `borderRadius: 'var(--radius)'`, boxShadow dari `--shadow-lg`.

---

## FASE 7 — Ekstensi (branding sync)

### Task 7.1 — popup.css & options.css
- [ ] Definisikan CSS custom properties sama dengan app:
```css
:root {
  --border: #e2e8f0;
  --primary: #0f172a;
  --radius: 12px;
}
```
- [ ] Ganti hardcoded `#e2e8f0`, `12px`, `10px` → `var(--border)`, `var(--radius)`.
- [ ] Font-family tambahkan `"Geist Variable"` fallback sebelum system stack.

---

## FASE 8 — Finalisasi

- [ ] Global grep: `rounded-2xl`, `shadow-xl`, `h-11` → pastikan nol sisa (atau ter-dokumentasi sebagai pengecualian).
- [ ] Update `UIUX_AUDIT.md` tandai item ✅.
- [ ] `npm test` + `npm run build` + deploy preview Vercel.
- [ ] Screenshot before/after untuk dokumentasi (opsional).

---

## Urutan Eksekusi & Estimasi

| Fase | Isi | Risiko | Estimasi |
|------|-----|--------|----------|
| 1 | Token & UI dasar | Sedang (efek luas) | 30 mnt |
| 2 | Dashboard | Rendah | 20 mnt |
| 3 | Settings | Rendah | 20 mnt |
| 4 | EmployeeManager | Sedang | 30 mnt |
| 5 | Laporan refactor | **Tinggi** (banyak file) | 60 mnt |
| 6 | Login/Error/Chart | Rendah | 15 mnt |
| 7 | Ekstensi | Rendah | 15 mnt |
| 8 | Final QA | — | 20 mnt |

**Aturan main:**
1. Satu fase = satu commit (mudah di-revert).
2. Jangan push sampai user review (sesuai permintaan sebelumnya).
3. Build harus hijau sebelum lanjut fase berikutnya.

Mulai dari Fase 1? 🚦
