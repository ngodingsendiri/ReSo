/** Firestore timestamp-ish values (Timestamp | Date | serverTimestamp sentinel). */
export type FirestoreTime = unknown;

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
}
