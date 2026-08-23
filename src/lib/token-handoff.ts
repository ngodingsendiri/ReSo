/**
 * Handoff token ReSo → ReSoEx:
 *  - Guard sekali-pakai per requestId: satu permintaan dibalas paling banyak
 *    sekali (dispatcher ulang oleh skrip lain diabaikan).
 *  - Cek origin: hanya permintaan yang mengaku berasal dari halaman ini yang
 *    dilayani.
 *  - Saluran balikan unik per permintaan (`respondTo`) disediakan oleh
 *    content script ekstensi.
 *
 * KEAMANAN SESI: ekstensi HANYA diberi idToken (~1 jam), BUKAN refresh token.
 * Firebase `securetoken` MEMUTAR & MENCABUT refresh token sumber setiap kali
 * di-mint — memberi ekstensi refresh token akan membatalkan sesi dashboard
 * sendiri → logout. `provideTokens` di App.tsx hanya mengembalikan idToken;
 * refresh ekstensi via push on-focus / handoff ulang saat tab ReSo terbuka.
 */

export interface HandoffTokens {
  idToken: string;
  uid: string;
  email: string | null;
}

export interface HandoffRequest {
  requestId?: unknown;
  origin?: unknown;
  respondTo?: unknown;
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
