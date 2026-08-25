# ⚡ Audit Efisiensi – ReSo

**Tanggal:** 2026-08-25
**Lingkup:** Bundle size, runtime React, Firestore/jaringan, algoritma
**Metode:** Inspeksi kode + output build produksi

---

## 1. Ringkasan Eksekutif

Kabar baik: pola *code-splitting* sudah solid (recharts, xlsx, jspdf, papaparse, modern-screenshot semua *dynamic import*; EmployeeManager & EngagementChart *lazy*; NavItem/StatCard/EmployeeRow sudah `memo`).

Namun ditemukan **3 masalah berdampak nyata**: (1) *god component* 2.679 baris yang me-render ulang seluruh app saat mengetik, (2) **listener Firestore ganda** untuk koleksi yang sama, dan (3) query riwayat rekap **tanpa batas** yang memburuk seiring waktu + memicu re-download saat navigasi bulan.

---

## 2. Temuan

### A. Bundle (ukuran & loading)

| Item | Status | Catatan |
|------|--------|---------|
| recharts (371KB) | ✅ Lazy | Hanya termuat saat chart dirender |
| xlsx (429KB), jspdf (422KB), modern-screenshot, papaparse | ✅ Dynamic import | Hanya saat export/upload |
| EmployeeManager, EngagementChart | ✅ React.lazy | |
| firebase/firestore+auth (461KB) | ⚠️ Statis | Wajar — auth dibutuhkan saat startup |
| Initial JS ≈ 1MB raw (~350KB gzip) | ⚠️ | Tanpa vendor splitting → cache invalidation penuh tiap deploy |

**Rekomendasi (rendah):**
- `build.rollupOptions.output.manualChunks`: pisahkan `react-vendor` dan `firebase` → perubahan kode app tidak lagi mem-bust cache vendor besar.

### B. Runtime React

#### B1. 🔴 God Component — `EngagementDashboard.tsx` (2.679 baris, ±30 useState)
Setiap ketikan di modal input (`igRawInput`, `fbRawInput`, `tiktokRawInput`) memicu render ulang **seluruh** tree: sidebar, kalender 42 sel, ringkasan bulan, semua karena state input hidup di komponen root.

**Fix (prioritas tertinggi):**
- Ekstrak modal input menjadi `<InputModal>` dengan state teks/link **lokal**; naikkan ke parent hanya saat simpan.
- Bungkus konten tab aktif dengan `React.memo`.

#### B2. 🟠 `matchPreview` — matching per keystroke
`useMemo` bergantung pada `igRawInput/fbRawInput/tiktokRawInput` menjalankan `matchEmployeesToEngagement` ×3 platform pada **setiap keystroke**, kompleksitas O(pegawai × baris input).

**Fix:** debounce 250–300ms, atau hitung di dalam modal saja (otomatis terselesaikan oleh B1).

#### B3. 🟡 Prop identity `dailyEngagements`
Snapshot baru → array baru → `DashboardTab` re-render meski isi identik. Minor; terselesaikan sebagian oleh memo + B1.

### C. Firestore & Jaringan

#### C1. 🔴 Listener ganda koleksi `employees`
- `EngagementDashboard.tsx:185` — `onSnapshot(employees)`
- `EmployeeManager.tsx:242` — `onSnapshot(employees)` **lagi**

Dua koneksi real-time, payload ganda tiap perubahan, dan dua sumber state yang berpotensi desinkron.

**Fix:** satu listener di shared hook/context; EmployeeManager menerima props.

#### C2. 🔴 Query riwayat tanpa batas + blob teks
```
query(dailyEngagement, where('date','>=',oldestRequiredDate), orderBy('date','desc'))
```
- Tanpa `limit` — tumbuh selamanya (±365 dokumen/tahun).
- Tiap dokumen membawa `igRawText/fbRawText/tiktokRawText` (teks mentah panjang), `*Links[]`, `unmatchedNames[]`.
- **Terparah:** `oldestRequiredDate` turun ke tanggal-1 bulan yang dinavigasi → **unsubscribe + re-download semuanya** hanya karena user melihat laporan bulan lampau.

**Fix:**
1. Cap window tetap (mis. 90 hari) sekali subscribe; filter bulan di client.
2. Jangka menengah: pindahkan raw text ke dokumen terpisah (`dailyEngagement/{date}/raw`) agar listing harian ringan.

#### C3. 🟡 `fetchLogoDataUrl()` — fetch + konversi SVG→canvas **setiap** export PDF
**Fix:** cache hasil `Promise<string|null>` di module level.

### D. Algoritma

#### D1. 🟠 N+1 request di `handleFetchRecentMeta`
`for (const post of igPosts)` → fetch komentar **sekuensial per post** (hingga 50 request berurutan; 60 detik timeout mudah tercapai).

**Fix:** `Promise.all` dengan concurrency cap (mis. 5) → 10× lebih cepat.

#### D2. 🟢 Minor (OK)
- `JSON.stringify` dirty-check pada links per snapshot — murah, biarkan.
- `weeklyStats/monthlyStats` O(pegawai×31) — trivial.
- `buildReportData` per-export — on-demand saja.

---

## 3. Matriks Prioritas

| # | Temuan | Dampak | Effort | Prioritas |
|---|--------|--------|--------|-----------|
| 1 | C2 — Query tanpa batas + re-download antar bulan | Kuota/biaya Firestore, UX loading | Sedang | 🔴 Tinggi |
| 2 | C1 — Duplikat listener employees | Payload ganda, risiko desinkron | Rendah | 🔴 Tinggi |
| 3 | B1 — Ekstrak InputModal dari god component | Kecepatan ketik/render | Besar | 🔴 Tinggi |
| 4 | D1 — Parallelisasi fetch komentar Meta | Kecepatan tarik data API | Rendah | 🟠 Sedang |
| 5 | B2 — Debounce matchPreview | CPU saat mengetik | Rendah | 🟠 Sedang |
| 6 | C3 — Cache logo PNG | Latensi export PDF | Trivial | 🟢 Rendah |
| 7 | A — manualChunks vendor splitting | Caching antar-deploy | Rendah | 🟢 Rendah |

---

## 4. Urutan Eksekusi Disarankan

1. **Quick win batch** (#2, #4, #5, #6) — sore ini, risiko rendah.
2. **C2** — ubah window + cap; uji lintas bulan.
3. **B1** — refactor modal (fase tersendiri, butuh regresi menyeluruh alur simpan).
4. **A** — manualChunks saat maintenance berikutnya.

---

**Catatan:** Tidak ada temuan yang bersifat *blocking*; aplikasi sehat untuk skala saat ini. #1–#3 menjadi krusial saat jumlah dinas/pengguna bertambah.
