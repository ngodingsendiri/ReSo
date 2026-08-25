# UI/UX Audit – ReSo

**Tanggal:** 2026-08-24  
**Lingkup:** Seluruh aplikasi (Web App + Ekstensi)  
**Tujuan:** Memastikan konsistensi desain minimalis, flat, profesional, dan rapi sesuai arahan.

---

## 1. Ringkasan Eksekutif

Secara umum, aplikasi sudah mengikuti gaya minimalis dengan warna netral (slate) dan tipografi Geist. Namun ditemukan **13 inkonsistensi utama** yang memengaruhi keseragaman visual dan pengalaman pengguna. Mayoritas berkaitan dengan ukuran tombol, input, shadow, dan penggunaan border pada ikon. Direkomendasikan standardisasi komponen UI dan pembuatan komponen bersama untuk laporan.

---

## 2. Temuan & Inkonkonsistensi

### 2.1. Desain Sistem (Token & Variabel)
- **Shadow:** Tidak semua komponen menggunakan token shadow yang telah didefinisikan di `index.css` (`--shadow-sm`, `--shadow`, `--shadow-md`). Beberapa menggunakan `shadow-sm` secara inline, lainnya tanpa shadow.
- **Radius:** Sebagian besar menggunakan `rounded-xl` (12px) sudah konsisten, namun beberapa elemen kecil (badge, tombol kecil) masih menggunakan `rounded-lg` atau `rounded-full` – perlu diputuskan standar.
- **Spasi:** Padding dan gap bervariasi: `p-4`, `p-5`, `p-6`; `gap-3`, `gap-4` – belum ada skala yang baku.

### 2.2. Komponen UI Dasar

#### `Button` (`src/components/ui/button.tsx`)
- **Ukuran:** `size="default"` → `h-10`, `size="sm"` → `h-7`, `size="lg"` → `h-9`. Terlalu banyak variasi; seharusnya `default: h-10`, `sm: h-8`, `lg: h-12`.
- **Penggunaan:** Di banyak tempat, tombol menggunakan `h-8`, `h-9`, `h-11` secara langsung (override), tidak mengikuti varian.
- **Contoh:** Dashboard "Input rekap hari ini" memakai `h-11`, Settings "Simpan Token" memakai `h-9`, sedangkan default `h-10`.

#### `Input` (`src/components/ui/input.tsx`)
- **Ukuran:** `h-10` (sudah baik), namun di beberapa tempat (Settings, EmployeeManager) digunakan `h-8` atau `h-9` secara override – tidak konsisten.

#### `Badge` (`src/components/ui/badge.tsx`)
- **Radius:** `rounded-full` (pill) – seharusnya konsisten dengan komponen lain, namun sebagian badge di Aktivitas Terakhir memakai `rounded-full`, yang lain `rounded-lg`. Sebaiknya semua badge menggunakan `rounded-full` untuk konsistensi.

#### `Card` (`src/components/ui/card.tsx`)
- **Shadow:** Tidak ada shadow default. Sebagian card diberi `shadow-sm` inline, sebagian tidak. Sebaiknya card memiliki shadow bawaan ringan (`shadow-sm`) agar terlihat mengangkat.

### 2.3. Halaman & Fitur

#### Dashboard (`src/components/tabs/DashboardTab.tsx`)
- **Stat Card:** Ikon menggunakan `border` pada wrapper (`p-2 rounded-xl border`). Sebaiknya tanpa border (cukup background warna) agar flat.
- **Aktivitas Terakhir:** Ikon kalender menggunakan `bg-slate-50` tanpa border – sudah baik, tetapi tinggi/lebar ikon (10x10) lebih kecil dari stat card (p-2). Perlu diseragamkan ukuran ikon.
- **Tombol "Input rekap hari ini":** Di desktop memakai `h-11`, di mobile `h-11` – seharusnya `h-10`.

#### Settings (`src/components/tabs/SettingsTab.tsx`)
- **SettingItem:** Sudah rapi dengan struktur ikon bulat, border bottom pemisah. Namun **lebar kontrol** tidak seragam – ada yang `max-w-[340px]`, ada yang `w-full`. Sebaiknya semua kontrol memiliki lebar maksimum yang sama.
- **Tombol:** Campuran `h-8` dan `h-9` – perlu diseragamkan (misal `h-8` untuk aksi kecil, `h-9` untuk utama).
- **Sosial Media:** Toggle "Tambah Link" – sudah baik, tapi setelah expand, input berada di bawah tombol; sebaiknya input tampil di samping (desktop) untuk memanfaatkan ruang.

#### Laporan (`src/components/reports/*.tsx`)
- **Duplikasi Kode:** Navigasi (tombol prev/next, badge, export) diulang di 3 file (`DailyReportView`, `WeeklyReportView`, `MonthlyReportView`). Sebaiknya difaktorkan menjadi komponen `ReportControls`.
- **Ukuran Tombol Export:** Semua `h-10`, konsisten.
- **Tabel:** Menggunakan `border` dan `sticky` – sudah baik, namun pada mobile card view, padding dan gap tidak konsisten dengan desktop.

#### EmployeeManager (`src/components/EmployeeManager.tsx`)
- **Tombol Aksi:** "Tambah" memakai `h-11`, sedangkan tombol lainnya `h-10` – tidak konsisten.
- **Input:** Di form, menggunakan `h-10` (sesuai), tapi di bagian upload file menggunakan `h-11` (override).
- **Tabel:** Header sticky, warna latar belakang `bg-slate-50/50` – konsisten.

#### LoginScreen (`src/components/LoginScreen.tsx`)
- **Shadow:** `shadow-sm` pada container – sebaiknya `shadow-md` untuk lebih menonjol.
- **Tombol:** `h-12` – konsisten dengan ukuran besar.

#### ErrorBoundary (`src/components/ErrorBoundary.tsx`)
- **Tombol:** `rounded-lg` dan `active:scale-[0.98]` – sebaiknya menggunakan `rounded-xl` agar konsisten.

#### EngagementChart (`src/components/EngagementChart.tsx`)
- **Tooltip:** Menggunakan `shadow` inline dan border – sudah baik.
- **Legend:** Menggunakan `iconType="circle"` – konsisten.

### 2.4. Responsivitas
- Secara umum, layout sudah responsif dengan `flex-col` dan `grid`. Namun di beberapa tempat (Settings, EmployeeManager) lebar kontrol tidak menyesuaikan dengan baik di layar sedang (misal tablet). Perlu penambahan breakpoint `md` atau `lg` untuk memastikan tata letak horizontal pada layar yang cukup lebar.

### 2.5. Aksesibilitas
- Sudah ada `aria-label` pada beberapa tombol, tapi tidak semua (misal tombol "Simpan" di Settings tidak memiliki label). Disarankan menambahkan `aria-label` pada semua tombol aksi.

### 2.6. Ekstensi (CSS)
- `extension/popup.css` dan `extension/options.css` menggunakan desain yang terpisah dari aplikasi utama. Warna dan radius tidak sinkron (misal `border-radius: 12px` vs `rounded-xl` di web). Sebaiknya ekstensi mengadopsi desain sistem yang sama (atau minimal token warna dan radius).

---

## 3. Rekomendasi Perbaikan

### 3.1. Standardisasi Ukuran Komponen
- **Tombol:**  
  - `default`: `h-10`, `px-4`, `rounded-xl`  
  - `sm`: `h-8`, `px-3`, `rounded-lg`  
  - `lg`: `h-12`, `px-6`, `rounded-xl`  
  - Hapus override ukuran di semua halaman, gunakan prop `size`.
- **Input:** Selalu `h-10` (kecuali untuk kebutuhan khusus, misal token di Settings yang bisa `h-8`).  
- **Badge:** Semua `rounded-full` dan `h-5` (sudah).

### 3.2. Konsistensi Shadow
- Tambahkan `shadow-sm` ke semua `Card` secara default (di komponen `Card`).
- Untuk elemen lain, gunakan token `shadow`, `shadow-md` sesuai kebutuhan, jangan hardcode.

### 3.3. Ikon Stat Card
- Hapus `border` pada wrapper ikon, cukup gunakan background warna.

### 3.4. Faktor Ulang Laporan
- Buat komponen `ReportControls` yang menerima props: `title`, `date`, `isCurrent`, `onPrev`, `onNext`, `sortOptions`, `exportHandlers`, `canExportImage`. Gunakan di 3 laporan.

### 3.5. Seragamkan Lebar Kontrol Settings
- Setiap kontrol di kanan (input, tombol) dibatasi `max-w-[340px] w-full` – terapkan secara konsisten di `SettingItem`.

### 3.6. Responsivitas
- Pada layar `lg` atau lebih, pastikan kontrol di Settings dan EmployeeManager menggunakan layout horizontal penuh.

### 3.7. Aksesibilitas
- Tambahkan `aria-label` pada tombol yang hanya ikon (misal tombol "Hapus token", "Tampilkan/sembunyikan token").

### 3.8. Ekstensi
- Sinkronkan warna dan radius dengan web app. Gunakan CSS custom properties atau salin variabel dari `index.css` ke `extension/popup.css` dan `options.css`.

### 3.9. Kode Duplikasi
- Faktor ulang logika navigasi bulan/minggu/hari ke hook `useNavigation` jika memungkinkan.

---

## 4. Deep Audit: DashboardTab, StatCard, EngagementChart, Card (Aktivitas Terakhir)

### 4.1. Komponen & Struktur
- **StatCard** didefinisikan dua kali: di tingkat modul (baris 44–71) dan di dalam `DashboardTab` (baris 101–135). Duplikasi ini membuat kode sulit dipelihara dan berpotensi menyebabkan inkonsistensi jika salah satu diubah.
- `colorMap` juga didefinisikan dua kali (baris 37–42 dan 114–119). Sebaiknya diekspor dari konstanta terpusat.
- `EngagementChart` di-lazy load dengan `React.lazy` – sudah tepat untuk optimasi bundle.

### 4.2. Ukuran & Spasi
- Tombol "Input rekap hari ini" pada desktop (baris 169) dan mobile (baris 153) menggunakan `h-11`, tidak konsisten dengan ukuran default tombol (`h-10`). Sebaiknya gunakan `size="default"` agar seragam.
- `Card` pada Tren 7 Hari dan Aktivitas Terakhir tidak memiliki `shadow` bawaan, sedangkan komponen `Card` lain mungkin menggunakannya. Sebaiknya tambahkan `shadow-sm` ke semua `Card` secara default (di komponen `Card`).
- Padding di `CardHeader` (baris 187, 207) menggunakan `p-5`, sedangkan `CardContent` (baris 193) menggunakan `p-4 sm:p-5` – cukup konsisten, namun `CardContent` pada Aktivitas Terakhir (baris 221) menggunakan `p-0` untuk memberi ruang pada `ScrollArea`. Ini baik, tapi perlu dipastikan konsistensi dengan komponen lain.

### 4.3. Ikon & Warna
- Pada `StatCard`, ikon dibungkus dengan `div` yang memiliki `border` (baris 62, 126). Gaya flat sebaiknya tidak menggunakan border; cukup background warna. Hapus `border` untuk tampilan yang lebih bersih.
- Warna ikon menggunakan `colorMap` yang terdefinisi dua kali. Sebaiknya gunakan satu sumber.

### 4.4. Aktivitas Terakhir (Card & Item)
- Setiap item (baris 230–257) menggunakan `px-4 py-3` dan flex layout dengan ikon `w-10 h-10`. Ikon memiliki `bg-slate-50` tanpa border – sudah sesuai dengan gaya flat.
- Badge status menggunakan `rounded-full` dan varian `outline` – konsisten.
- Teks tanggal dan platform menggunakan ukuran `text-sm` dan `text-xs` – baik.
- `ScrollArea` memiliki tinggi tetap `h-[280px]` – mungkin perlu disesuaikan secara responsif, namun untuk dashboard ini cukup.

### 4.5. EngagementChart
- Menggunakan `ResponsiveContainer` dengan `minWidth={0}` – responsif.
- Tooltip memiliki `boxShadow` dan `borderRadius` inline – sebaiknya menggunakan token shadow dari `index.css` agar konsisten.
- Legend menggunakan `iconType="circle"` – sudah baik.
- Empty state menggunakan backdrop-blur dan overlay – baik secara visual, namun bisa menambah kompleksitas. Pertimbangkan untuk menggunakan kondisi rendering langsung tanpa overlay.

### 4.6. Responsivitas
- Grid stat card menggunakan `grid-cols-2 lg:grid-cols-4` – baik.
- Tren 7 Hari dan Aktivitas Terakhir menggunakan `lg:grid-cols-3` dengan `lg:col-span-2` untuk chart – layout yang baik.
- Pada layar kecil, tombol "Input rekap hari ini" muncul di atas (baris 148) – baik.

### 4.7. Rekomendasi Perbaikan
1. Hapus duplikasi `StatCard` dan `colorMap`; ekspor dari satu file konstanta atau buat komponen terpisah.
2. Ubah ukuran tombol "Input rekap hari ini" menjadi `h-10` dengan menggunakan `size="default"`.
3. Hapus `border` pada wrapper ikon `StatCard`.
4. Tambahkan `shadow-sm` ke semua `Card` secara default di komponen `Card`.
5. Seragamkan penggunaan shadow di Tooltip `EngagementChart` dengan token CSS.

---

### 4.8. SettingsTab, SectionHeader, SettingItem

- **Struktur:** SettingsTab menggunakan `Card` dengan `SectionHeader` dan `SettingItem`. `SettingItem` adalah komponen lokal yang menerima `icon`, `iconBg`, `title`, `desc`, dan `children` – memisahkan logika layout dengan baik.
- **Konsistensi Ukuran:** Tombol aksi di SettingsTab bervariasi: `h-8` (Siapkan, Simpan, Jalankan) dan `h-9` (Hapus). Sebaiknya semua tombol utama (Simpan Token, Jalankan, Simpan Link) menggunakan `h-9` dan tombol sekunder (Hapus, Siapkan) menggunakan `h-8` untuk konsistensi.
- **Input:** Semua input menggunakan `h-8` – konsisten.
- **Layout:** `SettingItem` menggunakan `flex-col lg:flex-row` dengan `max-w-[340px]` untuk kontrol – responsif dan rapi.
- **Warna:** `iconBg` menggunakan warna lembut sesuai kategori (rose, sky, orange, indigo) – konsisten dengan tema.
- **Sosial Media:** Toggle "Tambah Link" dengan expand area – UX baik, namun pada layar desktop, input sebaiknya ditampilkan horizontal (satu baris) untuk menghemat ruang.
- **SectionHeader:** Hanya header dengan teks kecil dan garis pemisah – sudah baik.
- **Duplikasi:** Tidak ada duplikasi signifikan.

**Rekomendasi:**
1. Standarisasi ukuran tombol: utama `h-9`, sekunder `h-8`.
2. Pada desktop, buat input sosial media dalam satu baris horizontal (misal IG, FB, TT dengan label di samping) untuk memanfaatkan lebar.

### 4.9. EmployeeManager

- **Tombol:** Ukuran bervariasi: `h-11` (Template, Export, Impor, Tambah), `h-10` (Batal, Simpan), `h-8` (ikon edit/hapus, pagination), `h-11` (delete modal). Sebaiknya semua tombol utama (Template, Export, Impor, Tambah, Simpan, Batal) menggunakan `size="default"` (`h-10`), tombol aksi kecil (edit/hapus) `size="icon"` (`h-8`), dan tombol pagination `size="sm"` (`h-8`).
- **Input:** Search menggunakan `h-11` (override), sebaiknya `h-10` sesuai komponen Input. Input form menggunakan `h-10` – konsisten.
- **Card:** Container utama dan tabel tidak memiliki `shadow`, sebaiknya tambahkan `shadow-sm` secara default di komponen Card.
- **Tabel Header:** Menggunakan `backdrop-blur-sm` dan `bg-slate-50/90` – untuk gaya flat, cukup `bg-slate-50` tanpa blur.
- **Delete Modal:** Menggunakan `rounded-2xl` dan `shadow-xl` – tidak konsisten dengan modal lain (`rounded-xl`, `shadow-lg`). Sebaiknya seragamkan.
- **Ikon Aksi:** Tombol edit/hapus di tabel menggunakan `border` (edit: `bg-white border border-slate-200`). Sebaiknya tanpa border (cukup background) untuk flat.
- **Pagination:** Tombol menggunakan `h-8` dan `rounded-xl` – sudah baik, tapi pastikan menggunakan `size="sm"` agar konsisten.
- **Responsivitas:** Sudah baik dengan `md:hidden` / `md:block`.

### 4.10. LoginScreen

- **Shadow:** Container menggunakan `shadow-sm` – sebaiknya `shadow-md` agar lebih menonjol.
- **Tombol:** `h-12` – baik untuk aksi utama.
- **Ikon:** Tidak ada ikon yang tidak perlu.

### 4.11. ErrorBoundary

- **Tombol:** `rounded-lg` – sebaiknya `rounded-xl` untuk konsistensi.

### 4.12. EngagementChart

- **Tooltip:** Menggunakan `shadow` inline dan `borderRadius` – sebaiknya menggunakan token CSS `--shadow` dan `--radius` dari `index.css`.

### 4.13. Extension CSS (`popup.css`, `options.css`)

- **Warna & Radius:** Menggunakan nilai hardcoded (`#e2e8f0`, `12px`) – sebaiknya disinkronkan dengan token CSS aplikasi utama (misal `--border`, `--radius`).
- **Font:** `-apple-system` – sebaiknya menggunakan `Geist Variable` untuk konsistensi branding.

---

## 5. Prioritas

| Prioritas | Tindakan | Dampak |
|-----------|----------|--------|
| Tinggi | Standardisasi tombol & input | Konsistensi visual terbesar |
| Tinggi | Hapus border ikon stat card | Flat, minimalis |
| Sedang | Faktor ulang laporan | Maintainability |
| Sedang | Seragamkan shadow | Depth visual |
| Rendah | Sinkronisasi ekstensi | Branding lintas platform |

---

## 5. Lampiran: Daftar File yang Perlu Diperiksa

- `src/index.css` – definisi token
- `src/components/ui/button.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/badge.tsx`
- `src/components/tabs/DashboardTab.tsx`
- `src/components/tabs/SettingsTab.tsx`
- `src/components/EmployeeManager.tsx`
- `src/components/LoginScreen.tsx`
- `src/components/ErrorBoundary.tsx`
- `src/components/reports/DailyReportView.tsx`
- `src/components/reports/WeeklyReportView.tsx`
- `src/components/reports/MonthlyReportView.tsx`
- `src/components/EngagementChart.tsx`
- `extension/popup.css`
- `extension/options.css`

---

**Kesimpulan:** Dengan melakukan perbaikan di atas, aplikasi akan mencapai keseragaman desain yang diinginkan: minimalis, flat, profesional, dan konsisten.

---

## 6. Status Eksekusi (EXECUTION_PLAN.md) — ✅ Selesai

| Fase | Isi | Status |
|------|-----|--------|
| 1 | Button skala (`sm` h-8, `lg` h-12, radius seragam), Card `shadow-sm` default | ✅ |
| 2 | DashboardTab: duplikasi StatCard/colorMap dihapus, ikon flat tanpa border, CTA h-10 | ✅ |
| 3 | SettingsTab: tombol pakai varian murni, sosmed grid 3 kolom desktop, aria-label lengkap | ✅ |
| 4 | EmployeeManager: toolbar/form/modal h-10, search h-10, modal rounded-xl+shadow-lg, header tabel flat, badge pill | ✅ |
| 5 | Laporan: komponen bersama `ReportControls.tsx`, ikon platform seragam 14px, duplikasi ~165 baris hilang | ✅ |
| 6 | Login shadow-md, Loading rounded-xl, ErrorBoundary rounded-xl, Chart tooltip pakai token CSS | ✅ |
| 7 | Ekstensi popup.css & options.css: token `--primary/--border/--radius`, font Geist fallback | ✅ |
| 8 | QA: grep sisa + test 519/519 + build hijau | ✅ |

### Pengecualian Terdokumentasi (disengaja)
- **`rounded-t-2xl sm:rounded-xl`** pada Input Modal (EngagementDashboard) — pola *bottom-sheet* mobile yang slide dari bawah.
- **`h-11` textarea** (modal review unmatched) — tinggi tetap untuk input multiline, di luar skala tombol/input.
- **`h-11` nav item mobile** — target sentuh ≥44px demi kenyamanan jempol.
- **Ikon metadata akun size={10}** pada header tabel laporan — indikator kecil, bukan engagement mark.

### Verifikasi Akhir
- `npm test` → **519/519 pass**
- `npm run build` → **sukses** (index bundle turun ±5KB berkat dedup ReportControls)

---