# ⚡ Plan Eksekusi Efisiensi – ReSo

Berdasarkan temuan `EFFICIENCY_AUDIT.md`. 4 fase, satu fase = satu commit, build hijau sebelum lanjut.

---

## FASE 1 — Quick Wins ⭐ (risiko rendah, dampak langsung)

### Task 1.1 — Satukan listener `employees` 🔴
**File:** `EmployeeManager.tsx`, `EngagementDashboard.tsx`

Masalah: dua `onSnapshot` untuk koleksi sama (`EngagementDashboard:185`, `EmployeeManager:242`).

Solusi termudah: **pass props** — EmployeeManager sudah dirender di dalam EngagementDashboard.
```
<EmployeeManager employees={employees} isLoading={isLoadingEmployees} />
```
- [ ] Hapus `useState employees` + `useEffect` onSnapshot di EmployeeManager.
- [ ] Terima `employees` dari props; sesuaikan tipe & guard (`if (!db) return null` tetap).
- [ ] Bersihkan import tak terpakai (`onSnapshot`, `query`, `orderBy` bila tidak dipakai lagi).
- [ ] Verifikasi: tambah/edit/hapus pegawai tetap real-time terupdate di kedua tempat.

### Task 1.2 — Paralelkan fetch komentar Meta 🟠
**File:** `EngagementDashboard.tsx` → `handleFetchRecentMeta` (loop `for (const post of igPosts)` line ~576)

- [ ] Ganti loop sekuensial → batch concurrency 5:
```ts
const CONCURRENCY = 5;
const commenters: {...}[] = [];
for (let i = 0; i < igPosts.length; i += CONCURRENCY) {
  const batchPosts = igPosts.slice(i, i + CONCURRENCY);
  const responses = await Promise.all(
    batchPosts.map(post =>
      fetch(`https://graph.facebook.com/v19.0/${post.id}/comments?fields=id,text,username,timestamp&access_token=${pageToken}&limit=100`, { signal: controller.signal })
        .then(r => r.json())
    )
  );
  responses.forEach(cd => (cd.data || []).forEach(c => commenters.push({...})));
}
```
- [ ] Verifikasi: tarik data dengan >5 post IG → durasi turun drastis; error handling per-batch tetap aman (satu gagal ≠ semua gagal → gunakan `.catch(() => ({ data: [] }))` per request).

### Task 1.3 — Gate + debounce `matchPreview` 🟠
**File:** `EngagementDashboard.tsx` (line ~1089)

Saat ini matching O(pegawai × baris) jalan di **setiap keystroke**, bahkan saat modal tertutup.

- [ ] Gate: return nol ketika `!isInputModalOpen`.
- [ ] Debounce input 250ms via hook kecil `useDebouncedValue(value, ms)` (buat di `src/hooks/useDebouncedValue.ts`).
- [ ] Verifikasi: ketik cepat di modal → preview tetap akurat setelah berhenti; CPU tenang saat mengetik.

### Task 1.4 — Cache logo PNG 🟢
**File:** `EngagementDashboard.tsx` → `fetchLogoDataUrl` (line ~1015)

- [ ] Module-level cache:
```ts
let logoDataUrlCache: Promise<string | null> | null = null;
async function fetchLogoDataUrl() {
  logoDataUrlCache ??= (async () => { /* isi lama */ })();
  return logoDataUrlCache;
}
```
- [ ] Verifikasi: export PDF 2× berturut-turut → fetch kedua instan.

**Verifikasi fase:** build + test + smoke (tarik Meta, export PDF/Excel, CRUD pegawai).

---

## FASE 2 — Window Firestore Statis 🔴

**File:** `EngagementDashboard.tsx` (line 200–237)

Masalah: `oldestRequiredDate` dinamis mengikuti navigasi bulan → unsubscribe/re-download semua tiap ganti bulan; tanpa `limit`.

### Task 2.1 — Subscribe sekali dengan window tetap
- [ ] Window konstan: `LOOKBACK_DAYS = 92` (±3 bulan) dari hari ini, dihitung **sekali per login** (useRef / memo deps `[]` + user).
- [ ] Effect snapshot: hapus `oldestRequiredDate` dari deps → `[user, loading, db]` saja.
- [ ] Hapus `oldestRequiredDate` memo; ganti pemakaian lainnya.

### Task 2.2 — Guard navigasi bulan
- [ ] `changeMonth`: blok mundur melewati batas window (toast info "Riwayat tersedia ±3 bulan").
- [ ] Laporan bulanan lebih lama dari window → tampil kosong + pesan, bukan crash/silent.

### Task 2.2b (opsional, fase terpisah bila perlu)
- Pisahkan `igRawText/fbRawText/tiktokRawText` ke dokumen anak — tunda sampai benar-benar dibutuhkan (breaking change skema + ekstensi/API ikut menulis).

**Verifikasi:** navigasi bulan maju/mundur → network panel: TIDAK ada re-subscribe/re-download; data bulan berjalan & 2 bulan lalu tetap muncul.

---

## FASE 3 — Ekstrak InputModal dari God Component 🔴 (paling berat)

**File baru:** `src/components/InputModal.tsx`
**File ubah:** `EngagementDashboard.tsx` (-400~600 baris)

### Task 3.1 — Pindahkan state & logika ke modal
Pindahkan secara utuh:
- State: `igRawInput/fbRawInput/tiktokRawInput`, `igLinks/fbLinks/tiktokLinks`, `activeLinkTab`, initial-* (dirty-check), `initialIgRawInput` dkk.
- Logika: efek load-from-doc + dirty-check (line ~421–470), `handleSaveEngagement` (line ~1106–1216), popstate/history (line ~386–408), body-scroll lock (bagian modal saja).
- Props masuk: `open`, `date`, `existing` (doc harian), `employees`, `metaToken`, `onClose`, `onSaved(result)`.
- Fetch Meta (`handleFetchRecentMeta`) pindah ke modal juga (butuh `metaToken` prop).

### Task 3.2 — Rapikan parent
- Parent tinggal simpan `selectedDate`, `isInputModalOpen`, dan callback `onSaved` (untuk toast unmatched + refresh).
- `matchPreview` otomatis mati di parent (sudah pindah).

### Task 3.3 — Regresi wajib
- [ ] Simpan rekap baru / edit existing → Firestore benar.
- [ ] Dirty-guard: tarik Meta → tarik ekstensi tanpa simpan → data API tidak hilang (regresi bug lama!).
- [ ] Esc/back-button menutup modal + history bersih.
- [ ] Auto-filled verify path ("Tidak ada perubahan" → tandai verified).
- [ ] Unmatched review modal TIDAK tersentuh (komponen terpisah).

**Catatan:** jangan gabung dengan fase lain — commit tersendiri agar mudah di-revert.

---

## FASE 4 — Vendor Splitting 🟢

**File:** `vite.config.ts`

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'react-vendor': ['react', 'react-dom'],
        'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
      },
    },
  },
},
```
- [ ] Bandingkan ukuran chunk sebelum/sesudah.
- [ ] Pastikan tidak muncul warning *circular chunk*.
- [ ] Manfaat: deploy berikutnya yang hanya mengubah kode app → user tidak download ulang vendor (~600KB).

---

## Matriks Ringkas

| Fase | Isi | Effort | Risiko | Dampak |
|------|-----|--------|--------|--------|
| 1 | Listener tunggal, Meta paralel, debounce, cache logo | 45 mnt | Rendah | Langsung terasa |
| 2 | Window statis 92 hari | 30 mnt | Sedang | Kuota + UX stabil |
| 3 | Ekstrak InputModal | 2–3 jam | **Tinggi** | Render tenang saat mengetik |
| 4 | manualChunks | 15 mnt | Rendah | Caching antar-deploy |

## Aturan Main
1. Satu fase = satu commit (pesan: `perf: fase N — <ringkasan>`).
2. Build + `npm test` hijau sebelum commit.
3. Belum push sampai review (sesuai kesepakatan).
4. Fase 3 wajib regresi alur simpan + dirty-guard manual sebelum lanjut.

Mulai Fase 1? 🚦
