/**
 * Umur post (saran tanggal untuk Rekap+Kirim Opsi C) + sinkronisasi domain
 * ReSo dengan manifest.json (satu-sumber-domain). Test perilaku NYATA
 * shared.js:
 *  - parser umur post (parsePostAgeText) + scanner DOM (scanPageForPostDate),
 *  - domain ReSo (RESO_MATCH_PATTERNS) selaras dengan manifest.json.
 *
 * Catatan: jembatan isi textarea Opsi A (sendNamesToReso + FILL_RESO_TEXTAREA)
 * sudah dihapus bersama tombol "Kirim ke ReSo" — alur ekstraksi kini selalu
 * Rekap+Kirim via API (Opsi C).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parsePostAgeText,
  scanPageForPostDate,
  createTimeFromRehydration,
  RESO_MATCH_PATTERNS,
} from "../shared-module.js";

/** Waktu tetap untuk parser: 12 Agustus 2026 pukul 10:00 (lokal). */
const NOW = new Date(2026, 7, 12, 10, 0, 0);

test("parsePostAgeText: relatif Indonesia & Inggris → tanggal benar (now = 2026-08-12)", () => {
  const cases = [
    ["Kemarin", "2026-08-11"],
    ["Kemarin pukul 14.00", "2026-08-11"],
    ["Yesterday", "2026-08-11"],
    ["Hari ini", "2026-08-12"],
    ["Baru saja", "2026-08-12"],
    ["Just now", "2026-08-12"],
    ["2 hari yang lalu", "2026-08-10"],
    ["2 hari", "2026-08-10"],
    ["5d", "2026-08-07"],
    ["1 minggu yang lalu", "2026-08-05"],
    ["3w", "2026-07-22"],
    ["sehari", "2026-08-11"],
    ["seminggu yang lalu", "2026-08-05"],
    ["3 bulan yang lalu", "2026-05-12"],
    ["1 tahun yang lalu", "2025-08-12"],
    ["1 bln", "2026-07-12"], // singkatan FB Indonesia untuk bulan
    ["1 bln yang lalu", "2026-07-12"],
    ["3 bln", "2026-05-12"],
    ["1 thn", "2025-08-12"], // singkatan FB Indonesia untuk tahun
    ["1 thn yang lalu", "2025-08-12"],
    ["2 thn", "2024-08-12"],
    ["2 hr", "2026-08-12"], // 2 jam lalu jam 10 → masih hari yang sama
  ];
  for (const [text, expect] of cases) {
    const r = parsePostAgeText(text, NOW);
    assert.ok(r, `harus dikenali: "${text}"`);
    assert.equal(r.date, expect, `"${text}" → ${expect}, dapat ${r.date}`);
  }
});

test("parsePostAgeText: lintas tengah malam — 3 jam lalu jam 02:00 → kemarin", () => {
  // "3 jam" dari 02:00 (12 Agu) = 23:00 (11 Agu)
  const r = parsePostAgeText("3 jam", new Date(2026, 7, 12, 2, 0, 0));
  assert.equal(r.date, "2026-08-11");
});

test("parsePostAgeText: clamp akhir bulan (31 Mar − 1 bulan → 28 Feb; 29 Feb − 1 tahun → 28 Feb)", () => {
  const endMar = new Date(2026, 2, 31, 10, 0, 0);
  assert.equal(parsePostAgeText("1 bulan yang lalu", endMar).date, "2026-02-28");
  const leap = new Date(2028, 1, 29, 10, 0, 0);
  assert.equal(parsePostAgeText("1 tahun yang lalu", leap).date, "2027-02-28");
  const startMar = new Date(2026, 2, 1, 10, 0, 0);
  assert.equal(parsePostAgeText("1 bulan yang lalu", startMar).date, "2026-02-01");
  // Singkatan FB ikut clamp yang sama
  assert.equal(parsePostAgeText("1 bln yang lalu", endMar).date, "2026-02-28");
  assert.equal(parsePostAgeText("1 thn yang lalu", leap).date, "2027-02-28");
});

test("parsePostAgeText: absolut → tanggal; tanpa tahun & masa depan → tahun sebelumnya", () => {
  assert.equal(parsePostAgeText("10 Agustus 2025", NOW).date, "2025-08-10");
  assert.equal(parsePostAgeText("10 Agu 2025", NOW).date, "2025-08-10");
  assert.equal(parsePostAgeText("10 August 2025", NOW).date, "2025-08-10");
  assert.equal(parsePostAgeText("10 Agustus", NOW).date, "2026-08-10");
  // 10 Desember (masa depan dari 12 Agu) → tahun sebelumnya
  assert.equal(parsePostAgeText("10 Desember", NOW).date, "2025-12-10");
  assert.equal(parsePostAgeText("2025-08-10", NOW).date, "2025-08-10");
});

test("parsePostAgeText: teks bukan umur post → null", () => {
  for (const text of ["Andi", "2 komentar", "10", "", "   ", "a".repeat(70), "https://x.com/abc", "Selamat pagi"]) {
    assert.equal(parsePostAgeText(text, NOW), null, `harus null: "${text}"`);
  }
});

const pad2 = (n) => String(n).padStart(2, "0");
const localOf = (utcMs) => {
  const d = new Date(utcMs);
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
};

test("scanPageForPostDate: time[datetime] menang lebih dulu; fallback teks relatif", () => {
  const rootTime = {
    querySelectorAll(sel) {
      if (sel === "[data-utime]") return [];
      if (sel === "time[datetime]") {
        return [{ getAttribute: () => "2026-08-10T07:30:00Z", textContent: "10 Agu" }];
      }
      return [{ textContent: "Kemarin" }, { textContent: "2 komentar" }];
    },
  };
  const r = scanPageForPostDate(rootTime, NOW);
  const exp = localOf(Date.UTC(2026, 7, 10, 7, 30, 0)); // Z → waktu lokal
  assert.equal(r.suggestedDate, exp.date);
  assert.equal(r.suggestedTime, exp.time);
  assert.equal(r.label, "10 Agu");

  const rootText = {
    querySelectorAll(sel) {
      if (sel === "[data-utime]") return [];
      if (sel === "time[datetime]") return [];
      return [{ textContent: "Lihat komentar" }, { textContent: "Kemarin" }, { textContent: "2 komentar" }];
    },
  };
  const r2 = scanPageForPostDate(rootText, NOW);
  assert.equal(r2.suggestedDate, "2026-08-11");
  assert.equal(r2.label, "Kemarin");

  const rootEmpty = { querySelectorAll: () => [] };
  assert.equal(scanPageForPostDate(rootEmpty, NOW), null);
  assert.equal(scanPageForPostDate(null, NOW), null);
});

test("parsePostAgeText: absolut + 'pukul HH.MM' → tanggal+jam (FB/IG Indonesia)", () => {
  assert.deepEqual(parsePostAgeText("8 Agu pukul 07.30", NOW), {
    date: "2026-08-08",
    time: "07:30",
    iso: "2026-08-08T07:30",
    label: "8 Agu pukul 07.30",
  });
  assert.deepEqual(parsePostAgeText("18 Agustus 2026 pukul 07.30", NOW), {
    date: "2026-08-18",
    time: "07:30",
    iso: "2026-08-18T07:30",
    label: "18 Agustus 2026 pukul 07.30",
  });
  assert.equal(parsePostAgeText("8 Agu pukul 7.30", NOW).time, "07:30");
  assert.equal(parsePostAgeText("8 Agu pukul 14:05", NOW).time, "14:05");
  // jam invalid → tanggal tetap, jam dibuang
  assert.equal(parsePostAgeText("8 Agu pukul 25.00", NOW).time, null);
  assert.equal(parsePostAgeText("8 Agu pukul 25.00", NOW).date, "2026-08-08");
  // tanpa tahun & hasil masa depan (18 Agu dari 12 Agu) → tahun sebelumnya
  assert.equal(parsePostAgeText("18 Agu pukul 07.30", NOW).date, "2025-08-18");
});

test("parsePostAgeText: waktu pada relatif sub-hari & hari ini/kemarin", () => {
  const r1 = parsePostAgeText("3 jam", new Date(2026, 7, 12, 2, 0, 0));
  assert.equal(r1.date, "2026-08-11");
  assert.equal(r1.time, "23:00");
  assert.equal(r1.iso, "2026-08-11T23:00");
  assert.equal(parsePostAgeText("Kemarin pukul 14.00", NOW).time, "14:00");
  assert.equal(parsePostAgeText("Kemarin pukul 14.00", NOW).date, "2026-08-11");
  assert.equal(parsePostAgeText("Hari ini pukul 09.15", NOW).time, "09:15");
  assert.equal(parsePostAgeText("Baru saja", NOW).time, "10:00"); // NOW = 10:00
  assert.equal(parsePostAgeText("2 hari", NOW).time, null); // hari penuh: tanpa jam
  assert.equal(parsePostAgeText("1 bln", NOW).time, null);
});

test("parsePostAgeText: ISO datetime Z → dikonversi ke waktu lokal", () => {
  const exp = localOf(Date.UTC(2026, 7, 10, 7, 30, 0));
  const r = parsePostAgeText("2026-08-10T07:30:00Z", NOW);
  assert.equal(r.date, exp.date);
  assert.equal(r.time, exp.time);
  assert.equal(r.iso, `${exp.date}T${exp.time}`);
  assert.equal(parsePostAgeText("2025-08-10", NOW).time, null); // tanpa jam
  assert.equal(parsePostAgeText("2025-08-10T25:30:00Z", NOW), null); // jam invalid
});

test("scanPageForPostDate: data-utime FB (unix detik) → tanggal+jam lokal", () => {
  const unix = 1754710200; // 2025-08-09T07:30:00Z
  const exp = localOf(unix * 1000);
  const root = {
    querySelectorAll(sel) {
      if (sel === "[data-utime]") return [{ getAttribute: () => String(unix), textContent: "9 Agu" }];
      if (sel === "time[datetime]") return [];
      return [];
    },
  };
  const r = scanPageForPostDate(root, NOW);
  assert.ok(r, "harus terdeteksi dari data-utime");
  assert.equal(r.suggestedDate, exp.date);
  assert.equal(r.suggestedTime, exp.time);
  assert.equal(r.label, "9 Agu");
});

test("scanPageForPostDate: fallback baca aria-label '18 Agustus pukul 07.30'", () => {
  const root = {
    querySelectorAll(sel) {
      if (sel === "[data-utime]") return [];
      if (sel === "time[datetime]") return [];
      return [
        {
          getAttribute: (a) => (a === "aria-label" ? "8 Agustus pukul 07.30" : null),
          textContent: "8 Agu",
        },
      ];
    },
  };
  const r = scanPageForPostDate(root, NOW);
  assert.ok(r);
  assert.equal(r.suggestedDate, "2026-08-08");
  assert.equal(r.suggestedTime, "07:30");
});

test("createTimeFromRehydration: TikTok __DEFAULT_SCOPE__ → {date,time,iso}", () => {
  const unix = 1754710200;
  const exp = localOf(unix * 1000);
  const data = {
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": { itemInfo: { itemStruct: { createTime: unix } } },
    },
  };
  const r = createTimeFromRehydration(data);
  assert.equal(r.date, exp.date);
  assert.equal(r.time, exp.time);
  assert.equal(r.iso, `${exp.date}T${exp.time}`);
  // createTime sebagai string ikut diterima
  const s = JSON.parse(JSON.stringify(data));
  s.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.createTime = String(unix);
  assert.equal(createTimeFromRehydration(s).date, exp.date);
  // struktur lain & data rusak → null
  assert.equal(createTimeFromRehydration(null), null);
  assert.equal(createTimeFromRehydration({}), null);
  assert.equal(createTimeFromRehydration({ __DEFAULT_SCOPE__: {} }), null);
  assert.equal(createTimeFromRehydration({ __DEFAULT_SCOPE__: { "webapp.video-detail": {} } }), null);
  assert.equal(
    createTimeFromRehydration({
      __DEFAULT_SCOPE__: {
        "webapp.video-detail": { itemInfo: { itemStruct: { createTime: 0 } } },
      },
    }),
    null
  );
});

test("manifest.json: entry content_reso memuat semua RESO_MATCH_PATTERNS (satu-sumber-domain)", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../manifest.json", import.meta.url), "utf8")
  );
  const entry = manifest.content_scripts.find((c) =>
    (c.js || []).includes("content-reso.js")
  );
  assert.ok(entry, "content-reso.js harus terdaftar di content_scripts manifest");
  for (const pattern of RESO_MATCH_PATTERNS) {
    assert.ok(
      entry.matches.includes(pattern),
      `manifest harus memuat pola ${pattern} (sama dengan RESO_MATCH_PATTERNS)`
    );
  }
  assert.ok(entry.matches.includes("https://reso.sekretariat.fun/*"), "domain produksi ReSo harus ada");
});
