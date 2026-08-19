import type { User } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

type ResoConnectPayload = {
  type: "RESO_CONNECT";
  url: string;
  idToken: string;
  refreshToken: string;
  uid: string;
  email: string | null;
};

// ID ekstensi ReSo (diisi saat publikasi). Kosong → push dilewati.
const EXTENSION_ID = (firebaseConfig as { extensionId?: string }).extensionId;

/**
 * Dorong token sesi ke ekstensi ReSo (model "app push") saat user login.
 * Ekstensi mempelajari domain ReSo dari `url` (window.location.origin) sendiri,
 * sehingga domain TIDAK di-hardcode — tiap deploy Vercel pakai domainnya sendiri.
 *
 * PENTING (keamanan sesi): ekstensi HANYA menerima idToken (masa ~1 jam),
 * BUKAN refresh token. Firebase memutar & MENCABUT refresh token sumber tiap
 * kali di-mint via securetoken — jadi memberi ekstensi refresh token (asli
 * maupun hasil rotasi) akan membatalkan sesi app ReSo SENDIRI → user logout.
 * Refresh ekstensi ditangani ulang lewat push on-focus & handoff saat tab
 * ReSo terbuka (lihat src/lib/token-handoff.ts). Bila extensionId kosong /
 * tidak terpasang / salah, `chrome.runtime.lastError` diabaikan — ekstensi
 * cukup tidak kehubung (handoff manual tetap ada).
 */
export async function pushTokenToExtension(user: User): Promise<void> {
  const ext = (globalThis as { chrome?: any }).chrome;
  if (!EXTENSION_ID || !ext?.runtime?.sendMessage) {
    return;
  }
  const origin = window.location.origin;
  // idToken segar (force refresh) — ini satu-satunya kredensial yang dikirim.
  const idToken = await user.getIdToken(true);
  const payload: ResoConnectPayload = {
    type: "RESO_CONNECT",
    url: origin,
    idToken,
    refreshToken: "",
    uid: user.uid,
    email: user.email ?? null,
  };
  ext.runtime.sendMessage(EXTENSION_ID, payload, () => {
    void ext.runtime.lastError; // ekstensi belum terpasang / ID tak cocok
  });
}
