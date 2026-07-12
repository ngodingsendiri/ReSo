/** Local calendar date as YYYY-MM-DD (not UTC). */
export function getLocalISODate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD as local midnight (avoids UTC shift from `new Date('YYYY-MM-DD')`). */
export function parseLocalISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

/** Previous calendar day as YYYY-MM-DD. */
export function addLocalDays(iso: string, deltaDays: number): string {
  const d = parseLocalISODate(iso);
  d.setDate(d.getDate() + deltaDays);
  return getLocalISODate(d);
}
