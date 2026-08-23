/** Versi aplikasi — disuntik Vite dari package.json (`__APP_VERSION__`).
 *  Naikkan versi di package.json tiap rilis, UI (Settings) otomatis mengikuti. */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';
