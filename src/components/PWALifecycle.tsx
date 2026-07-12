import { useEffect, useRef } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';

/**
 * Registers the service worker and surfaces update UX via Sonner.
 * Mount once near <Toaster />.
 */
export function PWALifecycle() {
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    if (!('serviceWorker' in navigator)) return;
    registered.current = true;

    let registration: ServiceWorkerRegistration | undefined;
    let intervalId: number | undefined;

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        toast.message('Versi baru ReSo tersedia', {
          description: 'Muat ulang untuk memakai pembaruan.',
          duration: Infinity,
          action: {
            label: 'Muat ulang',
            onClick: () => {
              updateSW(true).catch(() => {
                window.location.reload();
              });
            },
          },
          cancel: {
            label: 'Nanti',
            onClick: () => {},
          },
        });
      },
      onOfflineReady() {
        // Shell cached — rekap data still needs network (Firebase).
      },
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        registration = reg;
        intervalId = window.setInterval(() => {
          reg.update().catch(() => {});
        }, 60 * 60 * 1000);
      },
    });

    const onVis = () => {
      if (document.visibilityState === 'visible' && registration) {
        registration.update().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  return null;
}
