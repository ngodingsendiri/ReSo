/**
 * Shared engagement matching — single source of truth for client save & recalculate.
 * Matches raw paste text (names/usernames) to employees per platform.
 */

export type EngagementPlatform = 'ig' | 'fb' | 'tiktok';

export interface MatchableEmployee {
  id: string;
  name: string;
  igUsername?: string;
  igUsername2?: string;
  fbName?: string;
  fbName2?: string;
  tiktokName?: string;
  tiktokName2?: string;
  /** Nama panggilan/varian hasil pemetaan admin (antrian belum terpetakan). */
  aliases?: string[];
}

/** Normalize for comparison: lowercase, collapse whitespace. */
export function normalizeMatchText(str: string): string {
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

function stripAt(handle: string): string {
  return handle.replace(/^@+/, '');
}

/**
 * Match needle in haystack.
 * - exact equality always matches
 * - short tokens (< 3 chars): only whole-token / equality (kurangi false positive)
 * - longer tokens: substring includes (paste dari sosmed sering “kotor”)
 */
function textMatches(needle: string, haystack: string): boolean {
  if (!needle || !haystack) return false;
  if (haystack === needle) return true;
  if (needle.length < 3) {
    return haystack.split(/[\s,;|/@]+/).filter(Boolean).includes(needle);
  }
  return haystack.includes(needle);
}

/**
 * Match raw engagement text against employee master data for one platform.
 * Returns unique employee IDs that appear to have engaged.
 */
export function matchEmployeesToEngagement(
  input: string,
  employees: MatchableEmployee[],
  platform: EngagementPlatform
): string[] {
  if (!input?.trim() || !employees?.length) return [];

  const lowerInput = normalizeMatchText(input);
  const inputLines = input
    .toLowerCase()
    .split(/[\n,;]+/)
    .map((line) => normalizeMatchText(line))
    .filter((line) => line.length > 0);

  const matchedIds = new Set<string>();

  for (const emp of employees) {
    const nameMatch = normalizeMatchText(emp.name || '');
    const igMatch = emp.igUsername ? normalizeMatchText(stripAt(emp.igUsername)) : '';
    const igMatch2 = emp.igUsername2 ? normalizeMatchText(stripAt(emp.igUsername2)) : '';
    const fbMatch = emp.fbName ? normalizeMatchText(emp.fbName) : '';
    const fbMatch2 = emp.fbName2 ? normalizeMatchText(emp.fbName2) : '';
    const tiktokMatch = emp.tiktokName ? normalizeMatchText(stripAt(emp.tiktokName)) : '';
    const tiktokMatch2 = emp.tiktokName2 ? normalizeMatchText(stripAt(emp.tiktokName2)) : '';

    let isMatch = false;

    if (nameMatch && textMatches(nameMatch, lowerInput)) isMatch = true;

    if (!isMatch && platform === 'ig') {
      if (igMatch && textMatches(igMatch, lowerInput)) isMatch = true;
      if (igMatch2 && textMatches(igMatch2, lowerInput)) isMatch = true;
    } else if (!isMatch && platform === 'fb') {
      if (fbMatch && textMatches(fbMatch, lowerInput)) isMatch = true;
      if (fbMatch2 && textMatches(fbMatch2, lowerInput)) isMatch = true;
    } else if (!isMatch && platform === 'tiktok') {
      if (tiktokMatch && textMatches(tiktokMatch, lowerInput)) isMatch = true;
      if (tiktokMatch2 && textMatches(tiktokMatch2, lowerInput)) isMatch = true;
    }

    // Alias hasil pemetaan admin (antrian belum terpetakan) — lintas platform.
    if (!isMatch && (emp.aliases || []).some((a) => textMatches(normalizeMatchText(a), lowerInput))) {
      isMatch = true;
    }

    if (!isMatch) {
      for (const line of inputLines) {
        if (textMatches(nameMatch, line)) {
          isMatch = true;
          break;
        }
        // Alias juga dicocokkan per-baris (nama yang sudah dipetakan otomatis
        // match pada kiriman berikutnya).
        if (!isMatch && (emp.aliases || []).some((a) => textMatches(normalizeMatchText(a), line))) {
          isMatch = true;
          break;
        }
        if (platform === 'ig') {
          if (igMatch && textMatches(igMatch, line)) {
            isMatch = true;
            break;
          }
          if (igMatch2 && textMatches(igMatch2, line)) {
            isMatch = true;
            break;
          }
        } else if (platform === 'fb') {
          if (fbMatch && textMatches(fbMatch, line)) {
            isMatch = true;
            break;
          }
          if (fbMatch2 && textMatches(fbMatch2, line)) {
            isMatch = true;
            break;
          }
        } else if (platform === 'tiktok') {
          if (tiktokMatch && textMatches(tiktokMatch, line)) {
            isMatch = true;
            break;
          }
          if (tiktokMatch2 && textMatches(tiktokMatch2, line)) {
            isMatch = true;
            break;
          }
        }
      }
    }

    if (isMatch) matchedIds.add(emp.id);
  }

  return Array.from(matchedIds);
}

/**
 * Bidang pegawai yang dicocokkan ke satu baris: nama (berlaku lintas
 * platform), handle/username khusus platform (pola sama dengan loop per-baris
 * di matchEmployeesToEngagement), plus alias hasil pemetaan admin.
 * Dikembalikan ternormalisasi (lowercase, whitespace dikolaps).
 */
function platformFields(emp: MatchableEmployee, platform: EngagementPlatform): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (s) out.push(s);
  };
  push(normalizeMatchText(emp.name || ''));
  if (platform === 'ig') {
    push(normalizeMatchText(stripAt(emp.igUsername || '')));
    push(normalizeMatchText(stripAt(emp.igUsername2 || '')));
  } else if (platform === 'fb') {
    push(normalizeMatchText(emp.fbName || ''));
    push(normalizeMatchText(emp.fbName2 || ''));
  } else if (platform === 'tiktok') {
    push(normalizeMatchText(stripAt(emp.tiktokName || '')));
    push(normalizeMatchText(stripAt(emp.tiktokName2 || '')));
  }
  for (const a of emp.aliases || []) push(normalizeMatchText(a));
  return out;
}

/**
 * Matching detail per baris: daftar id pegawai yang cocok + baris yang tidak
 * cocok dengan pegawai mana pun (sumber antrian "nama belum terpetakan").
 * Baris dikembalikan dalam bentuk aslinya (trim, tanpa lowercase) supaya
 * tetap terbaca manusia di UI review.
 */
export function matchEngagementDetail(
  input: string,
  employees: MatchableEmployee[],
  platform: EngagementPlatform
): { matchedIds: string[]; unmatched: string[] } {
  if (!input?.trim() || !employees?.length) return { matchedIds: [], unmatched: [] };

  const lines = input
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const matchedIds = new Set<string>();
  const unmatched: string[] = [];

  for (const line of lines) {
    const norm = normalizeMatchText(line);
    let lineMatched = false;
    for (const emp of employees) {
      if (platformFields(emp, platform).some((f) => textMatches(f, norm))) {
        matchedIds.add(emp.id);
        lineMatched = true;
      }
    }
    if (!lineMatched) unmatched.push(line);
  }

  return { matchedIds: Array.from(matchedIds), unmatched };
}

/** Stable compare for engaged ID arrays (order-independent). */
export function engagedIdsEqual(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((id, i) => id === sb[i]);
}

/** Merge raw lines without duplicates (case-insensitive). */
export function mergeUniqueLines(existing: string, additions: string[]): string {
  const lines = existing
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const seen = new Set(lines.map((l) => l.toLowerCase()));
  for (const add of additions) {
    const t = add.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(t);
    }
  }
  return lines.join('\n');
}
