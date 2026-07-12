import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, X } from 'lucide-react';
import { Button } from './ui/button';
import { isIosDevice, isStandaloneDisplay } from '../lib/pwa';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const PWAPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay()) return;
    if (sessionStorage.getItem('pwaPromptDismissed') === 'true') return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (sessionStorage.getItem('pwaPromptDismissed') === 'true') return;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsVisible(true);
      setShowIosHint(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // iOS: no beforeinstallprompt — soft hint after short delay (once per session)
    if (isIosDevice() && !isStandaloneDisplay()) {
      const t = window.setTimeout(() => {
        if (sessionStorage.getItem('pwaPromptDismissed') === 'true') return;
        setShowIosHint(true);
        setIsVisible(true);
      }, 4000);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsVisible(false);
    } else {
      sessionStorage.setItem('pwaPromptDismissed', 'true');
      setIsVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    sessionStorage.setItem('pwaPromptDismissed', 'true');
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed left-3 right-3 z-[100] md:left-auto md:right-4 md:w-96 bg-white border border-slate-200 p-4 rounded-2xl shadow-xl flex flex-col gap-3"
          style={{ bottom: 'calc(var(--bottom-nav-h, 5rem) + 0.75rem)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                <Download size={18} className="text-slate-900" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Instal ReSo</h3>
                <p className="text-xs text-slate-500 leading-snug mt-0.5">
                  {showIosHint && !deferredPrompt
                    ? 'Di iPhone: ketuk Bagikan (□↑), lalu “Tambah ke Layar Utama”.'
                    : 'Tambahkan ke layar utama untuk akses lebih cepat.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-50"
              aria-label="Tutup"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex gap-2">
            {deferredPrompt ? (
              <Button onClick={handleInstall} className="flex-1 font-bold h-10 rounded-xl bg-slate-900 text-white">
                Instal
              </Button>
            ) : (
              <Button onClick={handleDismiss} className="flex-1 font-bold h-10 rounded-xl bg-slate-900 text-white">
                Mengerti
              </Button>
            )}
            <Button onClick={handleDismiss} variant="outline" className="font-bold h-10 rounded-xl px-4">
              Nanti
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
