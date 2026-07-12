# constitution.md — Aturan yang Tidak Boleh Dilanggar

> **Apa bedanya dengan `specify.md`?**  
> - `specify.md` = **APA** aplikasi ini & **MENGAPA** (tujuan produk).  
> - `constitution.md` = **ATURAN MAIN** saat develop — yang boleh / tidak boleh, dari produk sampai deploy.  
>
> AI agent dan manusia **wajib** patuh keduanya. Kalau bentrok: **constitution** melindungi cara kerja yang aman; **specify** melindungi tujuan produk. Keduanya tidak boleh dilanggar diam-diam.

**Status:** v1.1.0 — audit + validasi produk + **Vercel free (`*.vercel.app`)** + filosofi **penyempurnaan (bukan rombak / fitur baru)**.  
**Stack ringkas:** React (Vite) + Firebase (Auth/Firestore) · Deploy: **Vercel Hobby/free only**.

---

## 0. Keputusan operasional terkunci (pemilik proyek)

| # | Keputusan | Implikasi untuk AI |
|---|-----------|-------------------|
| 1 | **Recalculate jarang dipakai** | Bukan fitur kritis harian. **Implementasi production = client-side** (Firestore batch) agar jalan di Vercel free; matching = modul bersama `src/lib/matching.ts` |
| 2 | **Deploy = Vercel free (`*.vercel.app`), full gratis** | Tidak ada budget hosting berbayar. Jangan usul Railway/Render berbayar, custom domain berbayar, atau layanan berbayar sebagai **syarat** app jalan |
| 3 | **Fitur & cara kerja saat ini sudah ideal untuk kerja operator** | **Jangan rombak workflow.** Jangan “redesign produk”. Sentuh kode boleh — **perilaku alur kerja tetap** |
| 4 | **Arah ke depan = penyempurnaan** (audit bug, fix, polish, akurasi, stabilitas) | **Bukan** penambahan fitur besar. **Bukan** ganti cara rekap. Default mode agent: *improve what exists* |

**Satu kalimat hukum emas:**  
> Boleh perbaiki apa saja di kode, asalkan app **tetap terasa sama dan lebih andal** untuk kerja rekap harian — bukan app baru dengan filosofi beda.

---

## 0.1 Bahasa awam dulu (buat yang bukan dev pro)

Bayangkan ReSo seperti **kantor kecil**:

| Bagian | Analogi | Di ReSo |
|--------|---------|---------|
| **UI / Frontend** | Meja front office + formulir | React di browser (tombol, kalender, laporan) |
| **Database** | Lemari arsip | **Firestore** (pegawai, rekap harian, settings) |
| **Auth** | Satpam pintu masuk | **Firebase Auth** (login Google + allowlist) |
| **API / Backend** | Ruang kerja belakang (opsional) | Endpoint seperti recalculate — di Vercel biasanya **function**, bukan “server nyala 24 jam” |
| **Hosting** | Gedung tempat app dipasang | **Vercel gratis** menyajikan file web + function singkat |
| **PWA** | App yang bisa “dipasang” di HP | Icon di home screen, notifikasi pengingat |

**Alur kerja harian yang dilindungi:**

```
Operator login → pilih tanggal → paste / tarik data → matching ke pegawai → simpan rekap → lihat laporan → export
```

Segala perubahan kode **tidak boleh memutus** alur itu, atau mengubah arti “engagement”, tanpa update `specify.md` + kesepakatan manusia.

---

## 1. Hierarki hukum proyek

Urutan prioritas saat ragu:

1. **Hukum produk** di `specify.md` (tujuan, skor, window 15:00, Diskominfo, operator-only)
2. **Hukum constitution ini** (aman, data, deploy, cara kerja agent)
3. **Kode & UI yang sudah jalan** (jangan rusak yang sudah dipakai operator)
4. **Preferensi teknis AI / “biar keren”** — prioritas paling rendah

Jika agent ingin “rewrite total karena best practice” tapi merusak rekap harian → **ditolak**.

---

## 2. Hukum produk (tidak boleh dilanggar)

Turunan langsung dari keputusan terkunci di `specify.md` §0:

| # | Hukum | Artinya praktis |
|---|--------|-----------------|
| P1 | **ReSo = rekap engagement pegawai ke sosmed lembaga** | Jangan ubah jadi analytics marketing / scheduler / HRIS |
| P2 | **Operator/admin only** | Jangan buka self-service seluruh pegawai tanpa update specify |
| P3 | **Skor biner per platform per hari** (max 3/hari) | Jangan diam-diam ganti jadi hitung jumlah like/komen |
| P4 | **IG + FB + TikTok** | Jangan hapus TikTok; manual TikTok wajib tetap ada |
| P5 | **Window 14:45 / 15:00 WIB resmi** | Jangan digeser “supaya rapi” tanpa kesepakatan |
| P6 | **Arah dev = penyempurnaan** (akurasi, stabilitas, otomasi yang sudah ada) | **Bukan** ekspansi fitur / rombak cara kerja tanpa minta eksplisit |
| P7 | **Raw text rekap harus tetap disimpan** | Tanpa raw text → audit trail & opsi hitung ulang mati |
| P8 | **Data historis sakral** | Jangan migrasi/hapus `dailyEngagement` tanpa rencana & backup |
| P9 | **Alur kerja operator saat ini = baseline ideal** | Login → rekap → laporan → export: **jangan diganti modelnya** |

---

## 2.1 Hukum mode pengembangan: **penyempurnaan, bukan ekspansi**

Disepakati pemilik: belum ada rencana fitur baru atau rombak cara kerja.

| Mode | Kapan | Contoh |
|------|--------|--------|
| **DEFAULT — Improve** | Hampir selalu | Fix bug matching, perbaiki rules, rapikan error, performa, build Vercel, UX kecil tanpa ubah alur |
| **Audit & harden** | Saat diminta audit | Temukan masalah → perbaiki yang kurang ideal, prioritas yang mengganggu kerja |
| **Expand / redesign** | **Hanya jika manusia minta eksplisit** | Fitur baru, ganti flow rekap, ganti skor, self-service pegawai |

**Dilarang dalam mode default:**

- “Sekalian saya tambah modul X biar lengkap”
- “Saya ganti alur biar modern”
- “Recalculate saya bangun jadi sistem batch enterprise”
- Rewrite UI total tanpa bug/tujuan perbaikan yang jelas

**Diizinkan:**

- Sentuh **file mana pun** (tidak ada zona “larang sentuh file”)  
- Refactor **jika** mengurangi bug / mempermudah maintenance **dan** perilaku user-facing tetap  
- Perbaiki Meta fetch, matching, export, PWA, auth edge-case  
- Sederhanakan recalculate (karena jarang dipakai) tanpa merusak save rekap harian  

---

## 3. Hukum ekosistem & deploy (Vercel free / full gratis)

### 3.1 Realita yang harus dipahami

| Layanan | Peran | Catatan gratis / batasan |
|---------|--------|---------------------------|
| **Vercel (Hobby)** | Hosting frontend + serverless function | Bukan VPS: **tidak** ada Express “nyala terus di port 3000” seperti laptop |
| **Firebase Auth** | Login Google | Kuota free tier; tetap jaga allowlist |
| **Firestore** | Database utama | Baca/tulis dihitung; jangan query gila-gilaan tanpa filter |
| **Meta Graph API** | Tarik post/komen IG (dll.) | Token & limit API Meta; jangan spam request |
| **Browser user** | Menjalankan UI, matching, export PDF | Export & matching berat = beban di HP/PC operator |

### 3.2 Aturan deploy Vercel free (wajib) — full gratis

**Target production resmi:** Vercel Hobby · URL **`*.vercel.app`** · **tanpa layanan berbayar wajib**.

1. **Frontend harus bisa di-build sebagai static SPA**  
   - `vite build` → folder `dist` → di-serve Vercel.  
   - Routing: SPA fallback ke `index.html` (refresh halaman tidak 404).

2. **Jangan mengasumsikan server Express panjang umur di production Vercel**  
   - `server.ts` + `app.listen(3000)` cocok untuk **local**, **bukan** model default Vercel free.  
   - **Recalculate jarang dipakai** → jangan diprioritaskan sebagai “backend wajib enterprise”.  
   - Preferensi production: app **tetap berguna full** meski API backend tidak ada (save rekap + matching di **client** sudah jadi jalur utama).  
   - Kalau API tetap ada: bentuknya serverless ringan, atau sederhanakan ke client — **bukan** hosting berbayar.

3. **Full gratis — dilarang menjadikan berbayar sebagai syarat**  
   - Jangan usul: Vercel Pro, DB berbayar, Redis, queue worker, domain berbayar, SMS gateway, dsb. **sebagai keharusan**.  
   - Firebase free tier + Vercel free + Meta API (token user) = batasan desain.  
   - Jangan tarik “semua history seumur hidup” ke browser — **filter by date range** (pola `oldestRequiredDate`).

4. **Secret & env**  
   - Jangan commit secret baru ke git.  
   - Config Firebase client (apiKey publik) beda dengan **service account / admin key** — **admin key jangan pernah ke frontend**.  
   - Meta token: sensitif; perbaikan security boleh, tapi jangan pecah alur operator.

5. **Satu sumber deploy truth**  
   - Production = **Vercel free (`*.vercel.app`)**.  
   - Jangan menambah stack hosting lain tanpa diminta.  
   - Local dev boleh beda (`npm run dev` / Express) asal **perilaku domain** sama.

6. **Build harus hijau sebelum deploy**  
   - Minimal: `npm run build` (dan idealnya `npm run lint`) lulus.  
   - Jangan merge/deploy yang sengaja di-skip typecheck “supaya cepet”.

### 3.3 Yang sering bikin app “jelek di Vercel free” — dilarang

- Menambah dependency berat tanpa perlu (bundle membengkak → PWA/HP lemot).
- Server-side session custom yang bentrok Firebase Auth tanpa desain.
- Menyimpan file besar (logo base64 raksasa, dump Excel) tanpa batas ukuran.
- Endpoint yang body-nya mengirim **seluruh** history engagement + employees tanpa batas (timeout/payload).
- Mengandalkan filesystem lokal di server (di serverless **tidak persisten**).

---

## 4. Hukum arsitektur & data

### 4.1 Stack resmi (jangan diganti diam-diam)

| Lapisan | Teknologi resmi | Larangan |
|---------|-----------------|----------|
| UI | React + TypeScript + Vite + Tailwind | Jangan rewrite ke Next/Angular/Vue “karena tren” tanpa kesepakatan |
| Auth + DB | Firebase Auth + Firestore | Jangan ganti ke Supabase/Postgres total tanpa rencana migrasi data |
| State data kritis | Firestore real-time / snapshot | Jangan pindah “semua ke localStorage” sebagai source of truth |
| Laporan export | Client-side (PDF/image) | Boleh diperbaiki; jangan wajibkan server export berat di free tier |

Ganti stack besar = **keputusan produk + migrasi**, bukan refactor harian agent.

### 4.2 Koleksi Firestore yang dilindungi

| Collection | ID / pola | Melindungi |
|------------|-----------|------------|
| `employees` | auto id | Master matching |
| `dailyEngagement` | **`YYYY-MM-DD`** | Rekap harian — **kontrak ID = tanggal** |
| `settings` | `meta_api`, `appLogo`, … | Konfigurasi |
| `admins` | `uid` | Akses dinamis |
| `users` | `uid` | Profil login |

**Hukum data:**

- D1. Document ID rekap harian = tanggal lokal `YYYY-MM-DD`. Jangan diubah format tanpa migrasi.
- D2. Field engaged = array ID pegawai (`igEngagedEmployeeIds`, `fb…`, `tiktok…`). Jangan ganti ke struktur lain tanpa migrasi + update laporan.
- D3. Raw text (`igRawText`, `fbRawText`, `tiktokRawText`) **wajib dipertahankan** untuk audit & recalculate.
- D4. Dual account (`*2`) adalah fitur domain — jangan dihapus.
- D5. Query harus **berbatas waktu** bila memungkinkan (hemat kuota + performa HP).
- D6. Tulis data pakai merge yang aman: jangan `set` yang menimpa field platform lain tanpa sengaja (pola partial update saat save rekap sudah ada — jaga).

### 4.3 Matching engine = jantung

- M1. Matching boleh diperbaiki (akurasi = prioritas), **wajib diuji** edge case: spasi, `@`, huruf besar/kecil, nama mirip, multi-akun.
- M2. Jika ada dua jalur (client save vs API recalculate), **hasil harus semantik setara**. Melenceng = bug serius.
- M3. Jangan “optimasi” matching dengan mengorbankan true positive (pegawai yang seharusnya ketemu jadi tidak ketemu) tanpa pengukuran.

---

## 5. Hukum keamanan & akses

| # | Hukum |
|---|--------|
| S1 | Default: **yang tidak login / tidak authorized = tidak bisa baca-tulis data rekap & pegawai** |
| S2 | Allowlist email + `admins/{uid}` + email verified — jangan dilonggarkan jadi “siapa saja Google boleh masuk” |
| S3 | Firestore rules adalah **pagar terakhir** — perubahan rules harus selaras model field aktual (termasuk TikTok & akun ke-2) |
| S4 | Jangan commit service account JSON / private key |
| S5 | Jangan log token Meta / ID token user ke console production |
| S6 | Fitur baru yang “bypass auth biar gampang test” dilarang masuk production |
| S7 | Data pegawai (NIP, nama, akun sosmed) = data internal — jangan kirim ke layanan pihak ketiga random tanpa alasan kuat |

---

## 6. Hukum kode & cara AI agent bekerja

### 6.1 Prinsip umum

1. **Surgical changes** — ubah yang perlu, jangan rewrite file 2000 baris “supaya rapi”.
2. **Jangan rusak alur operator** demi abstraksi elegan — alur saat ini **sudah ideal** bagi pemilik.
3. **Mode default = fix & polish**, bukan fitur baru / rombak workflow.
4. **Semua file boleh disentuh** — tidak ada “jangan sentuh file X”; yang dilindungi adalah **perilaku & data**, bukan nama file.
5. **Bahasa UI = Indonesia** (copy tombol, toast, error).
6. **Timezone domain = Asia/Jakarta** untuk reminder & window rekap.
7. **Dependency baru** hanya untuk perbaikan nyata (bug, keamanan, build Vercel, akurasi) — bukan iseng.
8. **Hapus file/script** hanya jika yakin sampah — tanya dulu jika ragu.
9. **Jangan commit** `.env`, secret, `node_modules`, artefak build sembarangan.
10. **Recalculate = prioritas rendah** (jarang dipakai) — perbaiki jika rusak; jangan over-engineer.

### 6.2 File berdampak tinggi (boleh disentuh, uji lebih ketat)

| File / area | Risiko jika salah |
|-------------|-------------------|
| `src/components/EngagementDashboard.tsx` | Otak UI + matching + laporan — monolit; pecah boleh, **perilaku harus sama** |
| `server.ts` / API recalculate | Jarang dipakai; jangan bikin production **bergantung** padanya |
| `firestore.rules` | Bisa mengunci semua user atau bocor data |
| `src/types.ts` | Kontrak data |
| `src/lib/firebase.ts` + `FirebaseProvider.tsx` | Auth & akses |
| `specify.md` / `constitution.md` | Hanya diubah sadar oleh manusia / dengan persetujuan |

### 6.3 Definition of Done (sebelum bilang “selesai”)

- [ ] Tidak melanggar `specify.md` §0 & hukum produk di atas  
- [ ] **Tidak mengubah cara kerja operator** (kecuali diminta eksplisit)  
- [ ] Alur: login → input rekap → simpan → laporan → export **tetap sama maknanya**  
- [ ] Matching IG/FB/TikTok + dual account tidak regressed  
- [ ] `npm run build` lulus (wajib untuk Vercel free)  
- [ ] Tidak menambah secret di client tanpa sadar  
- [ ] Production tetap **full gratis** (Vercel free + Firebase)  
- [ ] Tidak memaksa Express long-running / hosting berbayar  
- [ ] Perubahan data historis: ada rencana atau tidak menyentuh  
- [ ] Bukan “fitur baru menyelundup” dalam PR perbaikan  

### 6.4 Gaya PR / commit (kalau dipakai)

- Satu tujuan jelas per perubahan besar (**fix/polish**, bukan campur fitur baru).
- Jelaskan **mengapa** (bug/akurasi/stabilitas), bukan hanya “update code”.
- Jangan campur “ganti warna tombol” + “migrasi database” dalam satu PR monster.

---

## 7. Hukum UX & operasional

| # | Hukum |
|---|--------|
| U1 | Optimalkan untuk **operator rekap harian**, bukan demo investor |
| U2 | Mobile/PWA penting (operator sering di HP) — jangan hancurkan layout mobile demi desktop-only |
| U3 | Notifikasi 14:45 & 15:00: jangan dihapus tanpa kesepakatan |
| U4 | Error harus **bisa dibaca manusia** (Bahasa Indonesia), bukan stack trace mentah ke user |
| U5 | Export laporan = fitur kerja, bukan hiasan — jangan dibiarkan rusak setelah refactor CSS |
| U6 | Loading state: jangan biarkan user klik dobel simpan sampai data dobel/aneh |

---

## 8. Daftar merah — **DILARANG** (cheat sheet)

1. Mengubah arti skor engagement diam-diam.  
2. Membuka akses publik / menghapus auth “sementara”.  
3. Menghapus penyimpanan raw text.  
4. Menghapus TikTok atau mematikan input manual TikTok.  
5. Mengganti ID dokumen harian dari `YYYY-MM-DD`.  
6. Rewrite framework/stack total tanpa persetujuan.  
7. Rombak **cara kerja / workflow** operator tanpa diminta.  
8. Menyelundupkan **fitur besar baru** saat diminta “perbaiki bug / audit”.  
9. Deploy mengandalkan Node `listen()` abadi di Vercel free **tanpa** jalur client yang cukup.  
10. Menjadikan layanan **berbayar** sebagai syarat production.  
11. Over-engineer **recalculate** (jarang dipakai) sampai mengorbankan kesederhanaan.  
12. Query / muat seluruh database ke client tanpa filter.  
13. Commit private key / service account.  
14. Menambah modul asing (chat, ecommerce, CMS, dsb.).  
15. “Perbaiki” matching tanpa peduli false negative massal.  
16. Menghapus data production / hard reset Firestore iseng.  
17. Skip build error dengan `@ts-ignore` massal.  
18. Mengubah window 15:00 WIB diam-diam.  
19. Self-service pegawai tanpa update `specify.md`.

---

## 9. Daftar hijau — **DIANJURKAN** (penyempurnaan)

1. **Audit → fix**: bug, edge case, inkonsistensi, copy error.  
2. Perbaiki **akurasi matching** (jalur save harian = prioritas; recalculate sekunder).  
3. Meta fetch lebih andal (window 15:00 tetap).  
4. Hardening Firestore rules (TikTok / akun ke-2).  
5. Pastikan **static deploy Vercel free** bersih & build selalu lulus.  
6. Kurangi ketergantungan production pada Express long-running.  
7. Modularisasi monolit **tanpa** ubah perilaku (opsional, saat bantu fix).  
8. Performa/bundle/PWA polish.  
9. README yang benar menjelaskan ReSo.  
10. Raw text + master pegawai tetap bisa jadi sumber truth.

---

## 10. Konflik & eskalasi

| Situasi | Tindakan |
|---------|----------|
| Agent tidak yakin fitur melanggar tujuan | **Stop** → tanya manusia → cek `specify.md` |
| Perlu ubah skor / window / auth model | Update `specify.md` dulu + konfirmasi |
| Perlu ubah cara deploy / backend | Update constitution §3 + uji di Vercel preview |
| Bug production vs fitur baru | **Bug & data integrity menang** |
| “Best practice internet” vs alur operator Diskominfo | **Alur operator menang** |

---

## 11. Ringkasan satu paragraf (untuk agent)

ReSo adalah tool **internal Diskominfo** di **Vercel free (`*.vercel.app`)** + **Firebase**, full gratis, dipakai **operator**. Fitur & **cara kerja saat ini sudah ideal** — mode default agent adalah **penyempurnaan** (audit, bugfix, akurasi, stabilitas), **bukan** fitur baru atau rombak workflow. Semua file boleh disentuh; yang sakral adalah **perilaku rekap harian**, data historis, skor biner, window 15:00, dan raw text. **Recalculate jarang dipakai** — jangan over-engineer. Jika ragu: **lebih andal, sama cara kerjanya, tetap gratis**.

---

## 12. Status & perubahan constitution

| Field | Value |
|--------|--------|
| Versi | `1.1.0` |
| Deploy target | **Vercel free/Hobby · `*.vercel.app` · full gratis** |
| Mode dev default | **Penyempurnaan (bukan ekspansi / rombak)** |
| Recalculate | **Prioritas rendah** (jarang dipakai) |
| Wajib dibaca bersama | `specify.md` |
| Siapa boleh ubah aturan inti | Pemilik proyek (manusia), sadar & tercatat |

**Cara mengubah constitution:** diskusikan → tulis perubahan di file ini → baru ubah kode yang bergantung pada aturan baru.
