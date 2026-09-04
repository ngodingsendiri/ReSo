# 🔒 Audit Ketangguhan Web ReSo — anti-hang, race, pola scroll

**Tanggal:** 2026-09-04
**Lingkup:** `src/` (React 19 + Vite) + `api/` (Vercel serverless) — logika, jaringan, race
**Metode:** Inspeksi kode + riset web (Vercel function limits, Firestore transaction limits)
**Paralel:** audit menyeluruh ekstensi ReSoEx (v1.0.85/86) — pola yang sama diterapkan di sini

---

## 1. Ringkasan Eksekutif

Temuan utama: **fetch tanpa batas waktu di `FirebaseProvider.runProvision` bisa mengunci layar loading selamanya** — persis pola "fetch anti-hang" yang diperbaiki di ketiga engine ekstensi minggu ini, ternyata juga ada di sisi web dan lebih parah (memblokir login). Diperbaiki dengan helper `fetchWithTimeout` (AbortController + timeout) yang dipakai konsisten di client dan kedua serverless function. Plus perbaikan pendukung: provision benar-benar non-blocking + anti-double-run, tarikan Meta API dibatalkan saat modal ditutup, dan verifikasi massal rekap otomatis di-chunk per 500 (batas Firestore).

Pola scroll web **sudah sehat** — body scroll lock dengan restore, `scrollIntoView` hanya pada aksi user — tidak ada yang perlu diubah (kontras dengan ekstensi yang baru dibereskan).

## 2. Temuan & Perbaikan

| # | Temuan | Dampak | Status |
|---|--------|--------|--------|
| **W1** | `runProvision` fetch `/api/provision` tanpa timeout, dan di-`await` **sebelum** `setUser`/`setLoading(false)` — koneksi macet = layar loading selamanya (komentar di kode bilang "NON-BLOCKING", padahal blocking) | 🔴 Kunci login | ✅ Diperbaiki |
| **W2** | Provision bisa berjalan ganda (auto-login + tombol "Siapkan") tanpa guard | 🟠 Race ringan | ✅ Diperbaiki |
| **W3** | Serverless `api/provision.ts` & `api/engagement.ts`: semua `fetch` ke Google/Firestore tanpa timeout — koneksi macet menghabiskan budget Vercel lalu dibunuh diam-diam | 🟠 Hang/error buram | ✅ Diperbaiki |
| **W4** | `handleVerifyAllAutoFilled` satu transaksi untuk semua tanggal — >500 tanggal = gagal total (limit transaksi) | 🟠 Gagal massal | ✅ Diperbaiki |
| **W5** | Tarikan Meta API di `InputModal` tidak dibatalkan saat modal ditutup | 🟡 Beban sia-sia | ✅ Diperbaiki |
| **W6** | Race NIP duplikat di `EmployeeManager` — `getDocs` di luar snapshot transaksi (TOCTOU); komentar kode menyesatkan | 🟡 Duplikat NIP (jarang) | 📝 Terdokumentasi |
| W7 | Scroll web (body-overflow lock + restore, `scrollIntoView` aksi user) | — | ✓ Sehat, dipertahankan |

## 3. Detail Perbaikan

### W1 + W2 — provision anti-hang, non-blocking, anti-double-run (`FirebaseProvider.tsx`)
- `fetch('/api/provision')` → `fetchWithTimeout(..., 10000)` (10 dtk, sinkron limit default Vercel Hobby).
- Urutan `onAuthStateChanged` diubah: `setUser` + `setLoading(false)` jalan **dulu**, hasil provision datang belakangan via `setProvisionError` — login tidak pernah tertahan fetch.
- `provisionInFlightRef` menahan satu promise yang sedang berjalan: panggilan kedua (mis. tombol "Siapkan") ikut menunggu hasil yang sama, bukan menembak request baru.

### W3 — serverless anti-hang (`api/provision.ts`, `api/engagement.ts`)
Semua `fetch` (identitytoolkit `accounts:lookup`, Firestore REST: marker admins, employees pagination, dailyEngagement read/write) memakai `fetchWithTimeout`:
- identitytoolkit: **8 dtk** — verifikasi token wajib cepat; kalau lambat, fungsi balas 500 cepat alih-alih menunggu.
- Firestore REST: **10 dtk** per panggilan.

### W4 — verifikasi massal di-chunk (`EngagementDashboard.tsx`)
`runTransaction` (tanpa read) diganti `writeBatch` per 500 tanggal — setara hasil, tapi ratusan tanggal tidak lagi gagal total karena satu transaksi raksasa.

### W5 — abort tarikan Meta saat modal ditutup (`InputModal.tsx`)
Controller + timer disimpan di `metaFetchRef`; saat `open` → `false`, fetch yang jalan di-`abort` + timer di-clear. Abort karena tutup modal dibedakan dari abort karena timeout (pesan salah tidak muncul).

### W6 — kejujuran soal race NIP (`EmployeeManager.tsx`)
SDK web Firebase tidak mendukung query dalam snapshot transaksi — `getDocs` di dalam callback tx adalah read biasa. Komentar dikoreksi; rekomendasi hardening dicatat di bawah.

## 4. Riset Web (pendukung)

- **Vercel Functions limit (2026):** Hobby default ~10 dtk, maks dapat dikonfigurasi hingga 60 dtk. Artinya koneksi yang macet ke Google/Firestore memang **pasti** dibunuh platform — tapi hanya setelah menghabiskan budget seluruh request, tanpa pesan yang jelas ke klien. Timeout eksplisit (8–10 dtk) membuat kegagalan lebih cepat & terbaca.
- **Firestore: transaksi & batch dibatasi 500 tulis.** Transaksi dengan >500 `set` gagal total → chunking wajib untuk operasi massal.
- **Pola industrial:** `AbortController` + `setTimeout` + clear di `finally` adalah pola standar anti-hang (sudah diterapkan di ekstensi v1.0.86 dan `shared.js` F2). `fetchWithTimeout` ini adalah versi web-nya.

## 5. Tes (semua hijau)

- **Baru** `src/lib/fetch-with-timeout.test.ts` (5): passthrough cepat, hang → `FetchTimeoutError`, lambat-tapi-selesai → sukses, abort pemanggil → `AbortError` asli, timer bersih setelah resolve. Terdaftar di `npm test` (`test:net`).
- Regresi: `test:matching`, `test:api` (handler test men-stub `globalThis.fetch` — tetap lolos walau fetch kini membawa `signal`), `test:handoff` + ekstensi 532/532. `npm run lint` (tsc --noEmit) bersih.

## 6. Verifikasi Lapangan (wajib)

1. Login Google → dashboard masuk langsung; matikan internet sebelum login → dashboard tetap masuk (provision gagal di latar, muncul error + tombol "Siapkan"), bukan layar loading menggantung.
2. Tekan "Siapkan database" dua kali cepat → satu request saja (lihat Network tab).
3. Di modal Input Rekap, klik "Tarik post" lalu tutup modal → request Meta ikut berhenti (Network tab, tidak ada request menggantung).
4. (Opsional) `/api/engagement` dengan matikan internet: klien ekstensi mendapat error dalam ≤~12 dtk, bukan menunggu tanpa batas.

## 7. Hardening Lanjutan (tidak dikerjakan di fase ini)

- **W6 tegas:** documentId deterministik dari NIP (mis. `employees/{nip}`) → uniqueness NIP dijamin Firestore sendiri; butuh penyesuaian create/update dan tidak menutup duplikat terhadap dokumen lama ber-id acak (migrasi bertahap).
- Timeout per-request serverless bisa dijadikan konstanta bersama + dinaikkan bila dataset pegawai tumbuh (pagination > 10 halaman).
- `verifyIdToken` di `provision.ts` & `engagement.ts` duplikat — bisa dipindah ke modul bersama (DRY) pada refactor berikutnya.