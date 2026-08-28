/** Local calendar date as YYYY-MM-DD (WIB). */
export function getLocalISODate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/** Parse YYYY-MM-DD as WIB midnight (avoids UTC shift). */
export function parseLocalISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return new Date(NaN);
  const dt = new Date(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+07:00`);
  if (isNaN(dt.getTime())) return new Date(NaN);
  if (dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) !== iso) return new Date(NaN);
  return dt;
}

/** Previous calendar day as YYYY-MM-DD (WIB). */
export function addLocalDays(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const newUtc = utc + deltaDays * 86400000;
  return new Date(newUtc).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}
