/**
 * Logo ReSo sudah di-hardcode sebagai SVG statis (/logo.svg).
 * Hook ini hanya menyediakan path logo — tanpa subscription Firestore,
 * tanpa upload, tanpa frame (logo SVG ditampilkan langsung).
 */
export function useAppLogo(): string {
  return '/logo.svg';
}
