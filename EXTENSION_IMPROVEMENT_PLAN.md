# Extension Improvement Plan — Auto-Load Komentar Lengkap

**Tanggal:** 2026-08-25
**Pemicu:** "harus membuka semua komentar, mengeload semua komentar agar bisa kerekap"
**Sumber riset:** `inject-fb.js` (1.739 baris), `inject-tiktok.js` (1.229), `inject-ig.js` (1.600+), `content-*.js`, `background.js`, `shared.js`, `RESEARCH.md` v1.0.58, `CONSISTENCY.md`

---

## 1. Riset — Kondisi Saat Ini

### Cara kerja sekarang (sudah ada, bukan manual sepenuhnya)

| Platform | Jalur utama (otomatis) | Fallback | Template capture |
|----------|------------------------|----------|------------------|
| **FB** | GraphQL `CometUFICommentsProviderPaginationQuery` replay — `bumpPageSizes()[25..50]` + `graphqlReplayWithBackoff` (429→8s/16s, 2 retry) + `requestBudget 350` | Buffer 50 respons + DOM walk (`walkJson` depth 50) | `gqlTemplates` per `friendlyName` dari `fetch/XHR` + `localStorage` 3 template doc_id; `pcb./a.` story id; `posts/<slug>/<id>`, `watch?v=` sudah ditangani |
| **TikTok** | `/api/comment/list/?aweme_id=&count=&cursor=` synthetic **tanpa scroll** (`buildSyntheticListUrl`) → `paginateList` (budget 350, pacing 1.8–3.2s) | Scroll DOM `[data-e2e="comment-list"]` + klik `comment-icon` | `webRequest` capture `tiktok.com/api/comment/list` → TTL 45 mnt |
| **IG** | `/api/v1/media/{id}/comments/?can_support_threading=true` synthetic dari `extractMediaIdFromPage` (sadar korsel, `pickMediaIdNearShortcode`) → `paginateList` budget 150 | `tryOpenComments` + `expandLoadMore` + DOM `a[href^="/"]` | `webRequest` capture `instagram.com/api/v1/media/*/comments/` → TTL 30 mnt |

**Otomatisasi yang SUDAH jalan (v1.0.58):**
- TT `tryOpenComments` auto-buka panel (3 kali percobaan), `scrapeDomNicknames` scoped ke `[data-e2e="comment-list"]` (bukan seluruh document).
- IG `tryOpenComments` + `expandLoadMore` yang klik "Load more / Lihat selengkapnya" (6 tombol, multibahasa).
- FB `bumpPageSizes`, `idle` 4→6, reply budget 50/100, varian `PERMALINK`.

**Kesenjangan yang bikin user tetap merasa manual:**
1. **Starter pack belum cukup:** TT/IG butuh 1 klik "buka komentar" agar template ter-capture; jika user langsung `Proses` di feed/home tanpa buka post, template null → jatuh ke scroll murni (lambat, butuh scroll manual).
2. **DOM fallback masih pasif:** FB `extractNamesFromText` + `walkJson` hanya jalan saat ada traffic GraphQL; jika API diblokir/rate-limit, deep-DOM `<25 nama` → tidak dianggap cukup (v1.0.58 naik dari 8), tapi scroll container `role="dialog"` vs `main` belum tentu ketemu di layout baru FB.
3. **Balasan tidak otomatis terlihat:** tanpa `includeReplies` + klik `view more replies` / `child_comments`, balasan hilang dari rekap.

### Kenapa tidak bisa 100% tanpa batas
- **Spam filter FB** menyembunyikan komentar — hitungan badge FB ≠ jumlah terekap (didok di README).
- **Cap server** TT ±1–1.5k, IG batch 20, FB 25–50/page → post viral = `partial` (kuning), bukan bug.
- **Rate-limit / checkpoint IG** (paling rapuh): pacing 1.8–3.2s + budget 150 sudah kompromi; agresif = akun terkunci.

---

## 2. Tujuan

**User tidak perlu buka manual semua komentar.** Cukup: buka **1 permalink post** → klik **Proses** → ekstensi otomatis: buka panel → capture template → paginasi API sampai `has_next_page:false` → klik `load-more` bila pagination macet → fallback scroll — dengan progress jujur `N/±M`.

---

## 3. Plan Penyempurnaan (3 fase, 1 commit per fase)

### FASE A — Auto-Open yang Benar-Benar Otomatis (cepat, risiko rendah)

**FB (`inject-fb.js` + `content-fb.js`):**
- [ ] `tryOpenComments` FB saat ini menganggap `gqlTemplates.size>0` = "sudah terbuka" → bisa salah (template lama post lain). Ganti guard jadi `postRoot && postRoot.contains(findLoadMoreButtons()[0])` atau cek `findPostRoot()` spesifik post aktif (sudah ada `data-pagelet Permalink` → `CometSinglePost`).
- [ ] Tambah auto-klik `View more comments` di `tryOpenComments` (seperti IG `expandLoadMore`), max 6, sebelum nyatakan "terbuka".
- [ ] Pastikan `FBURLS` sudah 29 kasus — **jangan ubah** (sudah fix `pcb./a.`, `watch?v=`), hanya verifikasi lapangan album `set=a.X.Y.Z` (risiko tinggi bila salah).

**TT (`inject-tiktok.js`):**
- [ ] `tryOpenComments` sudah 3× + scroll `list.scrollTop = scrollHeight` — pertahankan. Tambah 1× klik fallback `span[dir="auto"]` berisi "View more" jika panel tetap kosong setelah 4 detik (TT kadang butuh klik, bukan scroll).

**IG (`inject-ig.js`):**
- [ ] Sudah ada `tryOpenComments` + `expandLoadMore` — pertahankan. Tambah **deteksi dialog** `role="dialog"` lebih agresif: jika `commentDialogOpen()` false setelah 3 klik, scroll `window.scrollBy(0,600)` + coba lagi (IG feed butuh scroll halaman dulu).

**Verifikasi:** manual di 3 permalink nyata (teks / foto-korsel / reel). Tidak ubah marker `FBURLS`/`DONEMSG`.

### FASE B — Pagination Tangguh (inti kecepatan)

**Semua platform — sudah ada, tinggal pertajam:**
- [ ] **TT:** `buildSyntheticListUrl` sudah clamp [30..50] — pertahankan. `paginateList` idle 6 + emptyPages 2× retry sudah benar. Tidak perlu ubah.
- [ ] **IG:** `bumpPageSizes` [30..50] + `idle 6` + `replyBudget 40/run` sudah benar. Tambah **alt-template sekali** (`getAltTemplate`) saat `batchSize===0 && hasMore` — sudah ada. Pertahankan.
- [ ] **FB:** `bumpPageSizes` [25..50] sudah ada. Tambah **probe varian** `feedLocation: PERMALINK` untuk foto/album (sudah ada di v1.0.58: `UNFILTERED+NEWSFEED → asli → UNFILTERED+PERMALINK`). Tidak perlu ubah; hanya pastikan `requestBudget 350` cek di loop balasan juga (sudah).

**Baru untuk auto-load:**
- [ ] Pada `paginateList` ketiga engine, **sisipkan** `expandLoadMore` / `scrapeDom` tiap 2 halaman sebagai heartbeat DOM (TT sudah `scrapeDomNicknames` tiap halaman; FB hanya `extractNamesFromText`; IG sudah `scrapeDomUsernames`). Untuk FB, tambah 1× `expandLoadMore(document)` tiap 3 halaman sebagai penyeimbang bila GraphQL pagination macet di post kecil tanpa cursor.

### FASE C — Feedback Jujur & Kontrol

- [ ] Panel `progres` sudah `N/±M` + `totalEstimate` (FB `findTotalCount` max, TT `findTotalCountTT`, IG `estimateCommentCount`). Pertahankan.
- [ ] Saat `reason === "incomplete"` tampilkan tombol **"Proses lagi"** (sudah) + hint "hasil bisa kurang — filter spam/graph API". Tambahkan **tooltip** singkat di badge jumlah: "Jumlah terekap = nama unik, bukan hitungan komentar FB".
- [ ] Popup **jangan** menambah auto-start — tetap manual klik `Proses` (keputusan keamanan akun; auto-start tiap buka post = hammering).

---

## 4. Yang TIDAK Diubah (keputusan produk tetap)

- TikTok like / FB like skala 10rb+ / IG like → **skip** (riset RESEARCH §1.2/3.2: cap/truncate).
- Output IG tetap `username` lowercase tanpa `@` (sesuai keputusan produk 2026-08-10).
- Budget & pacing (FB 120 hal/350 req, TT 350, IG 150) + jitter 1.8–3.2s → **jangan dipercepat** (risiko checkpoint IG).
- Like/comment count vs nama unik → dokumentasikan, bukan "diperbaiki" (spam filter tak terkirim ke browser).

## 5. Risiko & Mitigasi

| Risiko | Mitigasi di plan |
|--------|------------------|
| Rate-limit 429 FB/IG/TT | `Retry-After` + eskalasi 8→16s, max 2 retry, cek sisa waktu deadline (sudah) |
| Checkpoint IG | Stop aman, pesan `checkpoint` + count, tidak retry loop |
| Template salah post (capture post B saat proses post A) | Guard mid-run (BG line 489–511 & 566+): jangan timpa template media/video yang sedang diproses |
| User_id false positive FB | Sudah hapus bare numeric pathname di FBURLS |

## 6. Verifikasi Lapangan Wajib (tidak bisa dari kode)

- [ ] FB: `kominfojember/posts/pfbid…` teks, `media/set/?set=a.X.Y.Z` album, `/watch?v=` video, `/reel/` reel — tiap bentuk 1 permalink nyata, login, klik Proses, cek badge hijau & `partial` di post viral.
- [ ] TT: `/@user/video/<id>` video, `/@user/photo/<id>` foto-korsel, `/embed/v/<id>` (harus error jelas "buka video biasa"), `/@user/live` (harus `live` error).
- [ ] IG: `/p/<sc>/` tunggal, `/p/<sc>/` korsel (klik slide tidak ganti shortcode), `/reel/<sc>/`, `/share/p/<token>` — cek `mediaId` kontainer (bukan slide anak).

## 7. Estimasi

- Fase A: 45 mnt
- Fase B: 30 mnt (hanya sisipan 1 baris + cek)
- Fase C: 15 mnt
- Total ~1.5 jam, 3 commit terpisah, build hijau + `node --test` + verifikasi lapangan.

Mau eksekusi Fase A dulu?
