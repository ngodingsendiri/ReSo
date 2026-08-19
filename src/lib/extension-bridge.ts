import type { User } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";
import { rotateRefreshToken } from "./token-handoff";

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
 * Token di-ROTASI dulu (mint pasangan segar via Firebase REST securetoken)
 * sebelum dikirim; token sesi utama halaman tidak pernah keluar. Bila
 * extensionId kosong / tidak terpasang / salah, `chrome.runtime.lastError`
 * diabaikan — ekstensi cukup tidak kehubung (handoff manual tetap ada).
 */
export async function pushTokenToExtension(user: User): Promise<void> {
  const ext = (globalThis as { chrome?: any }).chrome;
  if (!EXTENSION_ID || !ext?.runtime?.sendMessage) {
    return;
  }
  const origin = window.location.origin;
  let idToken = await user.getIdToken();
  let refreshToken = (user as { refreshToken?: string }).refreshToken || "";
  if (refreshToken) {
    const rotated = await rotateRefreshToken(refreshToken);
    if (rotated) {
      idToken = rotated.idToken;
      refreshToken = rotated.refreshToken;
    }
  }
  const payload: ResoConnectPayload = {
    type: "RESO_CONNECT",
    url: origin,
    idToken,
    refreshToken,
    uid: user.uid,
    email: user.email ?? null,
  };
  ext.runtime.sendMessage(EXTENSION_ID, payload, () => {
    void ext.runtime.lastError; // ekstensi belum terpasang / ID tak cocok
  });
}
