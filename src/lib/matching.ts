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

    if (!isMatch) {
      for (const line of inputLines) {
        if (textMatches(nameMatch, line)) {
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
