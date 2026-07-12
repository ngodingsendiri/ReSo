import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

/** Thin banner when network is offline — data rekap needs connection. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  useEffect(() => {
    const goOff = () => setOffline(true);
    const goOn = () => setOffline(false);
    window.addEventListener('offline', goOff);
    window.addEventListener('online', goOn);
    return () => {
      window.removeEventListener('offline', goOff);
      window.removeEventListener('online', goOn);
    };
  }, []);

  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed top-0 left-0 right-0 z-[110] pt-safe"
        >
          <div className="mx-auto max-w-lg m-2 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 shadow-sm">
            <WifiOff size={16} className="shrink-0" />
            <p className="text-xs font-semibold leading-snug">
              Anda offline. Tampilan app bisa dibuka, tetapi login & data rekap butuh internet.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
