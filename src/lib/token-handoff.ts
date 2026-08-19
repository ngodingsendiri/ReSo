/**
 * Handoff token ReSo → ReSoEx:
 *  - Guard sekali-pakai per requestId: satu permintaan dibalas paling banyak
 *    sekali (dispatcher ulang oleh skrip lain diabaikan).
 *  - Cek origin: hanya permintaan yang mengaku berasal dari halaman ini yang
 *    dilayani.
 *  - Saluran balikan unik per permintaan (`respondTo`) disediakan oleh
 *    content script ekstensi.
 *
 * PENTING (keamanan sesi app): ekstensi HANYA diberi idToken (masa ~1 jam),
 * BUKAN refresh token. Firebase `securetoken` MEMUTAR & MENCABUT refresh token
 * sumber setiap kali di-mint — jadi memberi ekstensi refresh token (asli
 * maupun hasil `rotateRefreshToken`) akan membatalkan sesi dashboard ReSo
 * sendiri → operator logout. Oleh karena itu `provideTokens` di App.tsx hanya
 * mengembalikan idToken; refresh ekstensi ditangani ulang via push on-focus /
 * handoff ulang saat tab ReSo terbuka. Fungsi `rotateRefreshToken` tetap ada
 * untuk keperluan lain tapi TIDAK boleh dipakai untuk memprovisioning ekstensi.
 */

import firebaseConfig from '../../firebase-applet-config.json';

export interface HandoffTokens {
  idToken: string;
  refreshToken: string;
  uid: string;
  email: string | null;
}

export interface HandoffRequest {
  requestId?: unknown;
  origin?: unknown;
  respondTo?: unknown;
}

/**
 * Mint pasangan token segar dari refresh token sesi (Firebase REST).
 * Mengembalikan null jika refresh token kosong / gagal / bentuk tak valid.
 * Saat respons tidak membawa refresh_token baru, token lama dipertahankan.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  apiKey = firebaseConfig.apiKey,
  fetchImpl: typeof fetch = fetch,
): Promise<{ idToken: string; refreshToken: string } | null> {
  if (!refreshToken) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  let r: Response;
  try {
    r = await fetchImpl(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );
  } catch {
    return null;
  }
  const data = (await r.json().catch(() => ({}))) as {
    id_token?: unknown;
    refresh_token?: unknown;
  };
  if (!r.ok || typeof data.id_token !== 'string' || !data.id_token) return null;
  return {
    idToken: data.id_token,
    refreshToken:
      typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : refreshToken,
  };
}

export type HandoffTokenProvider = () => Promise<HandoffTokens | null>;

/**
 * Buat listener `reso:get-token`. Murni & teruji: `dispatch` di-inject
 * (default ke window) supaya tidak butuh DOM saat test.
 */
export function createTokenHandoffHandler(
  provideTokens: HandoffTokenProvider,
  origin: string,
  dispatch: (event: CustomEvent) => void = (ev) => window.dispatchEvent(ev),
): (e: Event) => void {
  const answered = new Set<string>();
  return (e: Event) => {
    const detail = ((e as CustomEvent<HandoffRequest>).detail || {}) as HandoffRequest;
    const requestId = detail.requestId;
    if (typeof requestId !== 'string' || !requestId) return;
    // Cek origin event: hanya layani permintaan dari halaman ini.
    if (detail.origin !== origin) return;
    // Guard sekali-pakai: satu requestId dibalas paling banyak sekali.
    if (answered.has(requestId)) return;
    answered.add(requestId);
    if (answered.size > 200) {
      // Cegah pertumbuhan tak terbatas pada halaman yang lama terbuka.
      answered.clear();
      answered.add(requestId);
    }
    const channel =
      typeof detail.respondTo === 'string' && detail.respondTo.trim()
        ? detail.respondTo.trim().slice(0, 120)
        : 'reso:token-response';
    const respond = (payload: Record<string, unknown>) =>
      dispatch(
        new CustomEvent(channel, { detail: { requestId, origin, ...payload } }),
      );
    provideTokens().then(
      (tokens) => {
        if (tokens) {
          respond({
            idToken: tokens.idToken,
            refreshToken: tokens.refreshToken,
            uid: tokens.uid,
            email: tokens.email,
          });
        } else {
          respond({ error: 'no-user' });
        }
      },
      (err: unknown) =>
        respond({ error: err instanceof Error ? err.message : String(err) }),
    );
  };
}
