import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, RefreshCw, Upload, Image as ImageIcon, Download, Bell, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import { db } from '../../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'sonner';

interface SettingsTabProps {
  recalculateConfig: { mode: 'last_day' | 'last_week' };
  setRecalculateConfig: (config: { mode: 'last_day' | 'last_week' }) => void;
  handleRecalculateAll: () => void;
  isLoading: boolean;
  containerVariants: any;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  recalculateConfig,
  setRecalculateConfig,
  handleRecalculateAll,
  isLoading,
  containerVariants
}) => {
  const [logoBase64, setLogoBase64] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const fetchLogo = async () => {
      try {
        const logoDoc = await getDoc(doc(db, 'settings', 'appLogo'));
        if (logoDoc.exists() && logoDoc.data().value) {
          setLogoBase64(logoDoc.data().value);
        }
      } catch (error) {
        console.error('Error fetching logo:', error);
      }
    };
    fetchLogo();

    // Listen for PWA install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    
    // Attempt to find the Service Worker registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) setSwRegistration(reg);
      });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      toast.warning('Browser tidak mendukung instalasi atau aplikasi sudah diinstal.');
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
      toast.success('Pemasangan PWA berhasil dimulai!');
    }
    setDeferredPrompt(null);
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    if ('serviceWorker' in navigator && swRegistration) {
      try {
        await swRegistration.update();
        toast.success('Sistem memperbarui background Worker. App siap digunakan di versi terbaru.');
      } catch (e) {
        toast.error('Gagal memeriksa pembaruan.');
      }
    } else {
       toast.info('Pembaruan terjadi secara otomatis pada PWA ini. Reload halaman untuk efek maksimal.');
    }
    setTimeout(() => setIsCheckingUpdate(false), 2000);
  };

  const forceReloadForUpdate = () => {
    window.location.reload();
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Gagal: Ukuran file maksimal 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64String = event.target?.result as string;
      setIsUploading(true);
      try {
        await setDoc(doc(db, 'settings', 'appLogo'), {
          value: base64String,
          updatedAt: serverTimestamp()
        });
        setLogoBase64(base64String);
        toast.success('Logo berhasil diunggah! Segarkan halaman untuk melihat perubahan pada favicon/PWA.');
      } catch (error) {
        toast.error('Gagal menyimpan logo ke database');
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <motion.div 
      key="settings"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      className="space-y-8"
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-10 border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700">
            <Settings className="text-slate-900 dark:text-slate-50" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">Pengaturan Sistem</h2>
            <p className="text-slate-500 dark:text-slate-400 text-xs">Konfigurasi PWA, Kalkulasi, dan Tampilan.</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          
          {/* Instal Aplikasi */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 gap-4">
            <div className="flex items-start sm:items-center gap-4">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-900/50">
                <Download size={20} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-50">Instal Aplikasi (PWA)</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Instal ke Layar Utama perangkat Anda.</p>
              </div>
            </div>
            <Button 
              onClick={handleInstallClick} 
              disabled={!isInstallable}
              variant={isInstallable ? "default" : "outline"}
              size="sm"
              className="sm:w-auto w-full font-bold shrink-0"
            >
              {isInstallable ? 'Instal Sekarang' : 'Tidak Didukung'}
            </Button>
          </div>

          {/* Pembaruan Sistem */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 gap-4">
            <div className="flex items-start sm:items-center gap-4">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-100 dark:border-emerald-900/50">
                <RefreshCw size={20} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-50">Pembaruan Sistem</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Periksa pembaruan versi PWA terbaru.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 sm:w-auto w-full">
              <Button 
                onClick={handleCheckUpdate} 
                disabled={isCheckingUpdate}
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none font-bold bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 border-slate-200"
              >
                {isCheckingUpdate ? 'Memeriksa...' : 'Cek'}
              </Button>
              <Button 
                onClick={forceReloadForUpdate} 
                variant="default"
                size="sm"
                className="flex-1 sm:flex-none font-bold bg-slate-900 text-white"
              >
                Muat Ulang
              </Button>
            </div>
          </div>

          {/* Logo Aplikasi */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 gap-4">
            <div className="flex items-start sm:items-center gap-4">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-100 dark:border-indigo-900/50">
                <ImageIcon size={20} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-50">Logo Aplikasi</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Ubah ikon utama aplikasi (Format 1:1).</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 sm:w-auto w-full">
              {logoBase64 && <img src={logoBase64} alt="App Logo" className="w-8 h-8 rounded-md object-contain border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5" />}
              <div className="relative flex-1 sm:flex-none">
                <input 
                  type="file" 
                  accept="image/png, image/jpeg, image/svg+xml"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleLogoUpload}
                  disabled={isUploading}
                />
                <Button 
                  variant="outline" 
                  size="sm"
                  disabled={isUploading}
                  className="w-full sm:w-auto bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-50 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold"
                >
                  <Upload size={14} className="mr-2" />
                  {isUploading ? 'Mengunggah...' : 'Pilih Logo'}
                </Button>
              </div>
            </div>
          </div>

          {/* Kalkulasi Ulang */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 flex items-center justify-center border border-orange-100 dark:border-orange-900/50">
                <RefreshCw size={20} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-50">Kalkulasi Ulang Data</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Perbaiki rekap jika terjadi perubahan data yang tidak tersinkron.
                </p>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input type="radio" value="last_day" checked={recalculateConfig.mode === 'last_day'} onChange={() => setRecalculateConfig({ mode: 'last_day' })} className="accent-slate-900 w-3.5 h-3.5" />
                    1 Hari Terakhir
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input type="radio" value="last_week" checked={recalculateConfig.mode === 'last_week'} onChange={() => setRecalculateConfig({ mode: 'last_week' })} className="accent-slate-900 w-3.5 h-3.5" />
                    1 Minggu Terakhir
                  </label>
                </div>
              </div>
            </div>
            <Button
              onClick={handleRecalculateAll}
              disabled={isLoading}
              size="sm"
              className="sm:w-auto w-full bg-slate-900 hover:bg-slate-800 text-white font-bold shrink-0 mt-2 sm:mt-0"
            >
              {isLoading ? 'Memproses...' : 'Kalkulasi Ulang'}
            </Button>
          </div>
          
        </div>
      </div>
    </motion.div>
  );
};


