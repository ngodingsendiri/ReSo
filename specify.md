# specify.md — ReSo (Rekap Engagement Sosmed)

> **Tujuan dokumen ini:** Menjadi sumber kebenaran (source of truth) untuk tujuan, ruang lingkup, dan batasan proyek ReSo. Setiap pengembangan lanjutan — termasuk oleh AI agent — **wajib** selaras dengan dokumen ini. Jika fitur baru bertentangan dengan tujuan di sini, **tujuan di sini yang menang**.

**Status:** Tervalidasi pemilik proyek (keputusan produk dikunci — lihat §0).

---

## 0. Keputusan produk yang dikunci

Disepakati pemilik proyek. AI agent **tidak boleh** menginterpretasi ulang poin-poin ini:

| # | Keputusan | Status |
|---|-----------|--------|
| 1 | **Pengguna utama = operator/admin**, bukan setiap pegawai login untuk cek skor sendiri | Terkunci |
| 2 | **Engagement = kehadiran di daftar interaksi** (biner per platform/hari). App untuk merekap pegawai yang melakukan engagement ke **sosmed lembaga** | Terkunci |
| 3 | **Konteks organisasi = Diskominfo** | Terkunci |
| 4 | **TikTok tetap platform inti** meski input masih manual (otomasi TikTok sulit / belum andal) | Terkunci |
| 5 | **Window & reminder 15:00 / 14:45 WIB** adalah aturan operasional resmi, bukan temporary hack | Terkunci |
| 6 | **Arah dev: penyempurnaan** (akurasi, stabilitas, otomasi yang sudah ada) — **bukan** fitur besar baru / rombak cara kerja | Terkunci |
| 7 | **Fitur & workflow saat ini sudah ideal** untuk kerja operator — pertahankan perilaku; boleh perbaiki kualitas di baliknya | Terkunci |
| 8 | **Deploy: Vercel free (`*.vercel.app`), full gratis** | Terkunci |
| 9 | **Recalculate jarang dipakai** — prioritas rendah; jalur utama = save rekap harian + matching client | Terkunci |

---

## 1. Ringkasan satu kalimat

**ReSo** adalah aplikasi web internal Diskominfo untuk **merekap, memverifikasi, dan melaporkan** apakah pegawai telah melakukan **engagement** (interaksi) pada konten media sosial **lembaga** (Instagram, Facebook, TikTok) pada hari kerja tertentu — dioperasikan oleh **admin/operator**, bukan self-service pegawai.

---

## 2. Apa ini — dan apa yang bukan

### 2.1 Ini aplikasi apa

| Aspek | Penjelasan |
|--------|------------|
| **Nama** | ReSo — *Rekap Engagement Sosmed* |
| **Jenis** | Internal ops tool / dashboard rekapitulasi (bukan produk publik) |
| **Konteks organisasi** | **Diskominfo** (disepakati) |
| **Masalah yang diselesaikan** | Sulitnya rekap manual “siapa pegawai sudah engage di postingan resmi lembaga hari ini” untuk banyak pegawai & multi-platform |
| **Pengguna utama** | **Admin/operator internal** yang berwenang (bukan end-user seluruh pegawai) |
| **Objek yang direkap** | Pegawai yang melakukan engagement ke **sosmed lembaga** |
| **Output utama** | Data rekap harian + laporan harian / mingguan / bulanan (tampilan + export PDF/gambar) |

### 2.2 Bukan ini

ReSo **bukan**:

- Analytics marketing umum (reach, impressions, growth follower, ads, competitor analysis)
- Social media management / scheduler posting
- Aplikasi public-facing / self-service di mana setiap pegawai login cek poin sendiri (**sengaja di luar scope** sampai specify diubah)
- CRM, HRIS, absensi, atau portal kepegawaian umum
- Chatbot / asisten AI generik (otomasi **boleh**, tapi harus memperkuat rekap — bukan mengganti tujuan produk)
- Marketplace, e-commerce, atau konten publik

Jika ada usulan fitur yang menggeser ReSo ke arah di atas **tanpa** memperkuat alur rekap engagement pegawai → **di luar scope** kecuali `specify.md` diubah secara sadar.

---

## 3. Tujuan dasar (product purpose)

### 3.1 Tujuan utama

1. **Mencatat** daftar orang yang berinteraksi di IG / FB / TikTok (via paste manual dan/atau tarik data API).
2. **Mencocokkan** daftar tersebut ke master data pegawai (nama + handle/username per platform).
3. **Menyimpan** hasil rekap per tanggal (`YYYY-MM-DD`).
4. **Melaporkan** partisipasi engagement per pegawai, per bidang, per rentang waktu (harian / mingguan / bulanan).
5. **Mengekspor** laporan untuk keperluan dokumentasi/arsip (PDF / image).

### 3.2 Nilai bisnis yang dijaga

- Transparansi & akuntabilitas partisipasi engagement media sosial internal.
- Penghematan waktu vs rekap manual spreadsheet.
- Satu sumber data rekap yang konsisten untuk laporan berkala.
- Reminder operasional (notifikasi jam engagement & jam rekap).

### 3.3 Metrik “sukses” aplikasi (domain)

Bukan vanity metrics (DAU publik), melainkan:

- Operator bisa menyelesaikan **rekap harian** dengan cepat dan akurat.
- Laporan mingguan/bulanan mencerminkan data rekap yang tersimpan.
- Matching nama/username ke pegawai **dapat diandalkan** (dengan dukungan akun ke-2 per platform).
- Akses tetap **terbatas** ke pihak berwenang.

---

## 4. Domain model & aturan bisnis inti

### 4.1 Entitas utama

| Entitas | Fungsi |
|---------|--------|
| **Employee** | Master pegawai yang dimonitor: `name`, `nip`, `bidang`, handle IG/FB/TikTok (masing-masing bisa 2 akun) |
| **DailyEngagement** | Rekap per tanggal: raw text per platform, daftar employee ID yang match, link postingan |
| **Admin** | UID yang diizinkan akses (dinamis), di samping allowlist email hardcode |
| **SystemSetting** | Konfigurasi global (logo app, Meta API token, dll.) |

### 4.2 Definisi “engagement” di ReSo

**Disepakati:** app merekap pegawai yang melakukan engagement ke **sosmed lembaga** (bukan analytics konten publik umum).

- Engagement dihitung **biner per platform per hari**: pegawai **ikut** atau **tidak** di IG / FB / TikTok pada tanggal tersebut.
- **Bukan** menghitung jumlah like/komentar berulang sebagai skor terpisah dalam satu hari per platform (hadir di daftar engaged = 1 untuk platform itu).
- **Skor harian maksimum teoritis per pegawai = 3** (IG + FB + TikTok).
- Skor mingguan/bulanan = jumlah kehadiran platform di hari-hari yang sudah lewat dalam rentang tersebut.
- **Engagement rate** = proporsi skor aktual vs skor maksimum yang mungkin (mis. `daysPassed × 3`).

### 4.3 Jendela operasional (timezone Asia/Jakarta) — resmi

Ritme kerja **operasional resmi** Diskominfo yang tertanam di app (bukan temporary):

| Waktu | Arti |
|--------|------|
| **14:45 WIB** | Reminder: waktunya melakukan engagement sosmed lembaga |
| **15:00 WIB** | Batas engagement / waktunya rekap |
| **Window post Meta API** | Postingan dianggap relevan rekap tanggal D: **15:00 H−1 s/d 15:00 D** (WIB) |

Perubahan jendela waktu ini **bukan** refactor kosmetik — itu mengubah aturan operasional organisasi. Harus update specify + disepakati dulu.

### 4.4 Alur input rekap (inti produk)

```
Master Pegawai (nama + handle)
        │
        ▼
Pilih tanggal → Input raw text (IG / FB / TikTok)
   ± tarik Meta API (IG comments + links; FB links)
        │
        ▼
Matching engine: raw text ↔ pegawai
        │
        ▼
Simpan DailyEngagement (raw + engaged IDs + links)
        │
        ▼
Dashboard / Laporan Harian / Mingguan / Bulanan → Export
```

### 4.5 Matching engine (kontrak perilaku)

- Input: teks mentah (paste list username/nama, multi-baris / separator).
- Matching: case-insensitive; cocokkan **nama lengkap** dan handle platform yang relevan.
- Mendukung **2 identitas per platform** (`igUsername`/`igUsername2`, dst.).
- Hasil: array `*EngagedEmployeeIds` per platform.
- **Recalculate**: jika master pegawai berubah (nama/handle), data historis bisa dikalkulasi ulang dari raw text (mode 1 hari / 1 minggu terakhir) tanpa mengulang paste.

**Jangan diubah secara diam-diam:** logika matching adalah jantung akurasi rekap. Perbaikan boleh, tapi harus diuji regresi terhadap kasus nama mirip, spasi, `@`, dan multi-akun.

---

## 5. Fitur yang sudah ada (baseline implementatif)

Gunakan daftar ini sebagai **peta fitur resmi saat ini**. Fitur baru idealnya memperluas salah satu jalur di bawah, bukan membuat “produk baru di dalam produk”.

### 5.1 Autentikasi & otorisasi

- Login **Google** (Firebase Auth).
- Akses hanya jika:
  - email masuk allowlist hardcode, **atau**
  - dokumen `admins/{uid}` ada di Firestore.
- Email harus **verified** (aturan security Firestore).
- Copy UI: *Internal Use Only*.

### 5.2 Navigasi / modul UI

| Tab / modul | Fungsi |
|-------------|--------|
| **Dashboard (Beranda)** | KPI ringkas: total pegawai, rekap hari ini, total interaksi, engagement rate; tren 7 hari; aktivitas terakhir |
| **Input Rekap (overview)** | Kalender harian → modal input raw IG/FB/TikTok + links; simpan rekap; tarik Meta API |
| **Laporan Harian** | Matriks pegawai × status platform hari itu; export PDF/image |
| **Laporan Mingguan** | Skor per pegawai dalam seminggu; rate per bidang; top/bottom; sort nama/bidang; export |
| **Laporan Bulanan** | Skor bulanan + breakdown % per platform; sort rank/bidang/nama; export |
| **Data Pegawai** | CRUD pegawai; search/sort; import Excel/CSV; export; template Excel |
| **Pengaturan** | Install PWA, cek update, upload logo, recalculate data |

### 5.3 Integrasi Meta (Facebook Graph API)

- Token disimpan di Firestore `settings/meta_api`.
- Menarik post FB + IG dalam window 15:00 H−1 → 15:00 D.
- IG: tarik **komentar (username)** ke raw text + link post.
- FB: karena batasan privasi API, fokusnya **link post** (bukan full list commenter setara IG).
- TikTok: **belum** ada tarik API otomatis — **input manual tetap didukung penuh** (disepakati: TikTok platform inti; otomasi sulit, alur manual jangan dihilangkan).

### 5.4 PWA & notifikasi

- Installable PWA (vite-plugin-pwa).
- Notifikasi lokal pada 14:45 & 15:00 WIB (jika permission granted).
- Logo app dapat diganti (disimpan di Firestore / cache localStorage untuk favicon).

### 5.5 Backend

- Express server (`server.ts`) + Vite dev middleware.
- Endpoint utama domain: `POST /api/recalculate` (matching ulang + commit Firestore via REST + Bearer token user).
- Health: `GET /api/health`.

### 5.6 Stack teknis (faktual)

- React 19 + TypeScript + Vite
- Tailwind CSS + komponen UI (shadcn/base-ui style)
- Firebase Auth + Firestore
- Express + tsx
- Recharts, xlsx, papaparse, jspdf, modern-screenshot, motion
- PWA (service worker)

---

## 6. Batasan & non-goals (untuk AI agent)

### 6.1 Harus dijaga

1. **Fokus rekap engagement pegawai multi-platform** — setiap PR/fitur harus menjawab: *“ini membantu rekap/monitor/laporkan engagement sosmed pegawai?”*
2. **Model data harian per tanggal** sebagai unit rekap utama.
3. **Akses internal terbatas** — jangan buka publik tanpa auth yang setara atau lebih ketat.
4. **Timezone operasional Asia/Jakarta** untuk reminder & window rekap.
5. **Raw text tetap disimpan** agar audit trail + recalculate dimungkinkan.
6. **Export laporan** tetap relevan untuk arsip/dokumentasi.

### 6.2 Jangan lakukan tanpa update explicit ke specify.md

- Mengubah definisi skor engagement (mis. jadi weighted score like×comment) tanpa kesepakatan.
- Menghapus platform IG/FB/TikTok atau mengganti jadi platform lain tanpa migrasi data plan.
- Membuka app ke multi-tenant / SaaS umum tanpa desain akses baru.
- Menambah role kompleks (pegawai self-service, atasan, dll.) tanpa spesifikasi role.
- Mengganti Firebase/auth stack total hanya karena preferensi agent.
- Menambahkan AI chat / generative UI yang **menggantikan** alur rekap manual tanpa opsi fallback.
- Menyimpan secret API di client tanpa pertimbangan security (token Meta saat ini ada di client/Firestore — perbaikan security boleh, tapi jangan pecah alur operator).

### 6.3 Debt / celah yang diketahui (bukan “fitur hilang”)

Ini boleh diperbaiki, tapi jangan disalahartikan sebagai scope baru:

| Item | Catatan |
|------|---------|
| Firestore rules vs model app | Rules masih kurang ketat/lengkap utk field TikTok & akun ke-2 vs `types.ts` app |
| Matching terpusat | `src/lib/matching.ts` dipakai save + recalculate client (dan API local-dev) — jaga satu sumber kebenaran |
| Meta token di client | Token disimpan & dipakai dari browser; risiko keamanan |
| Allowlist email di client + rules | Duplikasi; hardcode email di source |
| README masih template AI Studio | Belum menggambarkan produk ReSo |
| `GEMINI_API_KEY` di vite config | Sisa scaffold; bukan fitur inti ReSo saat ini |
| Admin UI dinamis | Collection `admins` ada di rules; UI kelola admin belum menonjol di modul utama |

---

## 7. Prinsip pengembangan ke depan

### 7.0 Roadmap arah (disepakati): **penyempurnaan** (bukan ekspansi)

**Konteks:** Pemilik belum punya rencana penambahan fitur atau rombak cara kerja.  
**Mode default:** audit → perbaiki masalah / yang kurang ideal → polish. Workflow operator **tetap**.

| Prioritas | Tema | Contoh (perbaikan, bukan fitur baru) |
|-----------|------|--------------------------------------|
| **P0** | **Akurasi matching** (jalur save harian) | False +/- , normalisasi nama/handle, edge case dual-account |
| **P0** | **Stabilitas production gratis** | Build Vercel free, SPA static andal, tidak bergantung Express abadi |
| **P1** | **Otomasi yang sudah ada (Meta)** | Fetch lebih andal, error handling, window 15:00 konsisten |
| **P1** | **Security & rules** | Firestore rules selaras model, auth edge case |
| **P2** | **Maintainability** | Pecah monolit **tanpa** ubah perilaku; kurangi debt |
| **P2** | **Recalculate** | Prioritas **rendah** (jarang dipakai); cukup jangan rusak / boleh disederhanakan |
| **P3** | **Polish UX/export/PWA** | Perbaikan kecil yang tidak mengubah cara kerja |

**Di luar scope default:** fitur besar baru, redesign alur, self-service pegawai, multi-tenant, analytics marketing, hosting berbayar.

### 7.1 Hierarki keputusan

1. **Tujuan di `specify.md`** (+ keputusan §0)
2. **Aturan bisnis domain** (skor biner, tanggal, matching, window 15:00 resmi)
3. **Konsistensi data Firestore**
4. **UX operator** (cepat input rekap, jelas laporan)
5. **Preferensi teknis agent** (terendah)

### 7.2 Saat menambah fitur, tanyakan

1. Apakah ini memperkuat **akurasi matching** atau **otomasi input rekap** (atau laporan/export/reminder/master pegawai yang menopang itu)?
2. Apakah mengubah **arti skor** atau **siapa yang boleh akses**? → butuh update specify + konfirmasi manusia.
3. Apakah memecah data historis (`dailyEngagement` lama)? → butuh migrasi.
4. Apakah AI agent hanya “refactor indah” tanpa nilai domain? → hindari churn besar di monolit tanpa alasan.
5. Untuk TikTok: apakah alur **manual** tetap utuh jika otomasi gagal/tidak ada?

### 7.3 Area aman untuk pengembangan (selaras tujuan)

- **Akurasi:** matching, dual-account, edge case nama mirip, parity client/server recalculate, tests.
- **Otomasi:** Meta API yang lebih andal, window 15:00 yang konsisten, helper paste, less friction operator.
- TikTok automation *jika* memungkinkan — **tanpa** menghapus/mengabaikan input manual.
- UX input rekap & kalender (tetap operator-centric).
- Dashboard analitik **turunan dari data rekap** (bukan marketing analytics eksternal).
- Hardening security (rules, token handling, admin management UI).
- Modularisasi kode monolit **tanpa** mengubah perilaku bisnis.
- Export tambahan (Excel rekap) yang setara makna laporan yang ada.

### 7.4 Area berbahaya (mudah “meleset”)

- Rebuild total UI/framework “karena modern”.
- Ganti model data ke event-stream like/comment individual tanpa kompatibilitas laporan existing.
- Menambah self-service pegawai / role kompleks tanpa update specify.
- Menambah banyak modul samping (newsfeed, chat, task management) yang mengaburkan ReSo.
- Menghapus raw text “supaya hemat storage” → mematikan recalculate & audit.
- Menghapus TikTok atau meremehkan input manual TikTok karena “susah diotomasi”.
- Mengubah window 14:45/15:00 WIB diam-diam.

---

## 8. Arsitektur logis (ringkas)

```
┌─────────────────────────────────────────────────────────┐
│  Client (React PWA)                                     │
│  Login → Dashboard / Input / Reports / Employees / Settings │
└───────────────┬───────────────────────────┬─────────────┘
                │                           │
                ▼                           ▼
        Firebase Auth+Firestore      Meta Graph API (browser)
                │
                ▼
        Express (/api/recalculate, static/vite)
                │
                ▼
        Firestore commit (recalculate path)
```

**Koleksi Firestore (inti):**

- `employees/{id}`
- `dailyEngagement/{YYYY-MM-DD}`
- `settings/{settingId}` (`meta_api`, `appLogo`, …)
- `admins/{uid}`
- `users/{uid}` (profil login)

---

## 9. Bahasa & konteks UI

- UI dan copy utama: **Bahasa Indonesia**.
- Istilah domain yang dipertahankan: *rekap, engagement, pegawai, bidang, laporan harian/mingguan/bulanan*.
- Branding app: **ReSo** / *Rekap Engagement Sosmed*.

---

## 10. Checklist review untuk AI agent (wajib sebelum merge)

- [ ] Fitur masih tentang **rekap engagement pegawai ke sosmed lembaga** (Diskominfo)?
- [ ] Tetap **operator-centric** (bukan self-service pegawai diam-diam)?
- [ ] Tidak mengubah definisi skor (1 platform/hari, biner) tanpa update specify + persetujuan?
- [ ] Data `dailyEngagement` & raw text tetap valid / ter-migrate?
- [ ] Auth tetap restricted (bukan public open)?
- [ ] Matching IG/FB/TikTok + dual-account tetap bekerja? (TikTok manual tetap utuh)
- [ ] Laporan harian/mingguan/bulanan + export tidak rusak?
- [ ] Window/reminder 14:45–15:00 WIB tidak diubah diam-diam?
- [ ] Perubahan mengarah ke **akurasi** dan/atau **otomasi** (bukan fitur di luar domain)?
- [ ] Perubahan security rules selaras field model aktual (termasuk TikTok & *2)?

---

## 11. Status dokumen

| Field | Value |
|--------|--------|
| Versi | `1.2.0` |
| Basis | Audit + validasi produk (termasuk Vercel free, mode penyempurnaan, recalculate jarang) |
| Bahasa | Indonesia |
| Pemilik produk | Tim / maintainer ReSo (manusia) |
| Peran AI agent | Implementer yang **patuh** pada dokumen ini |
| Arah product | **Penyempurnaan** (bukan ekspansi); operator-centric; Diskominfo; Vercel free |
| Deploy | **Vercel free · `*.vercel.app` · full gratis** |

### Cara mengubah specify

1. Diskusikan perubahan tujuan dengan pemilik proyek.
2. Update bagian yang relevan di file ini **lebih dulu** (termasuk §0 jika keputusan dikunci berubah).
3. Baru implement kode yang mengikuti perubahan.

---

## 12. Pernyataan penutup (untuk agent)

> ReSo adalah **alat internal Diskominfo untuk merekap engagement pegawai ke sosmed lembaga** (IG, FB, TikTok).  
> Dioperasikan **admin/operator**. Skor **biner per platform/hari**. Window **15:00 WIB** resmi.  
> Deploy **Vercel free**. Workflow saat ini **sudah ideal** — kembangkan lewat **penyempurnaan** (bukan rombak / fitur besar).  
> **Bukan** self-service pegawai, **bukan** analytics marketing, **bukan** produk generik di luar rekap.

Jika ragu: **lebih andal, cara kerja sama, data historis aman, tetap gratis.**
