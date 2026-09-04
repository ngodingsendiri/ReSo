/**
 * fetchWithTimeout — fetch dengan batas waktu wajib (anti-hang).
 *
 * Masalah yang dicegah: `await fetch(...)` tanpa AbortController tidak pernah
 * settle saat koneksi macet (TCP stall, offline di tengah, server lambat) —
 * run/request menggantung tanpa batas dan tombol batal pun tidak bisa apa-apa.
 * Di browser: user menunggu selamanya; di serverless Vercel: koneksi itu
 * menghabiskan budget durasi fungsi lalu dibunuh platform diam-diam.
 *
 * Pola: AbortController + setTimeout. Timer SELALU dibersihkan di `finally`
 * (tak ada timer menggantung). Abort karena timeout dilempar sebagai
 * FetchTimeoutError (nama jelas, bisa dibedakan dari AbortError lain);
 * sinyal luar (init.signal) tetap dihormati dan dibedakan dari timeout.
 *
 * Kontrak:
 * - timeoutMs > 0, wajib.
 * - Boleh dipakai client (browser) maupun serverless (Node 18+): AbortController
 *   dan fetch signal tersedia di keduanya.
 */
export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Permintaan jaringan melebihi batas waktu ${timeoutMs} ms.`);
    this.name = 'FetchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;

  // Hormati sinyal pembatal dari pemanggil (mis. komponen dibongkar): abort
  // controller kita juga, tapi tetap membedakan penyebabnya di bawah.
  const onOuterAbort = () => controller.abort();
  init?.signal?.addEventListener('abort', onOuterAbort);

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      if (timedOut) throw new FetchTimeoutError(timeoutMs);
      // Abort dari pemanggil — teruskan error asli (bukan salah kita).
      throw err;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener('abort', onOuterAbort);
  }
}