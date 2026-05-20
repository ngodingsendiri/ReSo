import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, X } from 'lucide-react';
import { Button } from './ui/button';

export const PWAPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault();
      
      // Check if user already dismissed it this session
      if (sessionStorage.getItem('pwaPromptDismissed') === 'true') {
        return;
      }
      
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
      // Show the prompt
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    
    // Show the install prompt
    deferredPrompt.prompt();
    
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
      setIsVisible(false);
    } else {
      console.log('User dismissed the install prompt');
      sessionStorage.setItem('pwaPromptDismissed', 'true');
    }
    
    // We've used the prompt, and can't use it again, throw it away
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
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-2xl z-[100] flex flex-col gap-3"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center shrink-0">
                <Download size={20} className="text-slate-900 dark:text-slate-50" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Instal Aplikasi (PWA)</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Tambahkan ke Layar Utama untuk akses lebih cepat dan pengalaman natif.</p>
              </div>
            </div>
            <button 
              onClick={handleDismiss}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={handleInstall} 
              className="flex-1 font-bold"
            >
              Instal Sekarang
            </Button>
            <Button 
              onClick={handleDismiss} 
              variant="outline"
              className="font-bold flex-none"
            >
              Nanti Saja
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
