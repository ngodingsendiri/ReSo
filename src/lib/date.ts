/** Tanggal hari ini dalam WIB (Asia/Jakarta) sebagai YYYY-MM-DD. */
export function getWibTodayISO(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/** Local calendar date as YYYY-MM-DD (WIB). Gunakan getWibTodayISO untuk "hari ini". */
export function getLocalISODate(date: Date = new Date()): string {
  // Jika dipanggil tanpa argumen (hari ini), gunakan WIB; bila ada argumen,
  // hormati tanggal lokal device (dipakai parse/add yang sudah WIB-normalized).
  if (arguments.length === 0) return getWibTodayISO(date);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD as local midnight (avoids UTC shift from `new Date('YYYY-MM-DD')`). */
export function parseLocalISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return new Date(NaN);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return new Date(NaN);
  return dt;
}

/** Previous calendar day as YYYY-MM-DD. */
export function addLocalDays(iso: string, deltaDays: number): string {
  const d = parseLocalISODate(iso);
  d.setDate(d.getDate() + deltaDays);
  return getLocalISODate(d);
}
