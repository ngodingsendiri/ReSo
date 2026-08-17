/** Firestore timestamp-ish values (Timestamp | Date | serverTimestamp sentinel). */
export type FirestoreTime = unknown;

/** Nama di rekap yang belum cocok dengan pegawai mana pun (antrian review). */
export interface UnmatchedName {
  name: string;
  platform: 'ig' | 'fb' | 'tiktok';
}

export interface Employee {
  id: string;
  name: string;
  nip: string;
  bidang?: string;
  igUsername?: string;
  igUsername2?: string;
  fbName?: string;
  fbName2?: string;
  tiktokName?: string;
  tiktokName2?: string;
  /** Nama panggilan/varian hasil pemetaan admin (antrian belum terpetakan). */
  aliases?: string[];
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface DailyEngagement {
  id: string; // YYYY-MM-DD
  date: string;
  igRawText?: string;
  fbRawText?: string;
  tiktokRawText?: string;
  igEngagedEmployeeIds?: string[];
  fbEngagedEmployeeIds?: string[];
  tiktokEngagedEmployeeIds?: string[];
  igLinks?: string[];
  fbLinks?: string[];
  tiktokLinks?: string[];
  updatedAt?: FirestoreTime;
  // Penanda dokumen diisi otomatis oleh ekstensi ReSoEx (via /api/engagement).
  autoFilledAt?: FirestoreTime;
  autoFilledCount?: number;
  // Operator sudah memeriksa rekap otomatis (via Simpan Rekap / Terima semua).
  // Auto-filled tanpa verifiedAt = masih perlu review; data tetap lengkap di DB.
  verifiedAt?: FirestoreTime;
  // Nama yang tidak cocok dengan pegawai mana pun (antrian "belum terpetakan").
  unmatchedNames?: UnmatchedName[];
  // Waktu posting post yang direkap otomatis dari ReSoEx (ISO lokal
  // "YYYY-MM-DDTHH:MM", satu entry per kiriman; satu hari bisa banyak post).
  postedAt?: string[];
}
