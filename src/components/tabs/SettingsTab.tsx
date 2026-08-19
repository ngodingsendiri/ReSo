import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Settings, RefreshCw, Upload, Image as ImageIcon, Download, KeyRound } from 'lucide-react';
import { Button } from '../ui/button';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import { isIosDevice, isStandaloneDisplay } from '../../lib/pwa';
import { useAuth } from '../FirebaseProvider';

interface SettingsTabProps {
  recalculateConfig: { mode: 'last_day' | 'last_week' };
  setRecalculateConfig: (config: { mode: 'last_day' | 'last_week' }) => void;
  handleRecalculateAll: () => void;
  isLoading: boolean;
  containerVariants: import('motion/react').Variants;
  metaToken: string;
  setMetaToken: (v: string) => void;
  handleSaveMetaToken: () => void;
  isSavingToken: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  recalculateConfig,
  setRecalculateConfig,
  handleRecalculateAll,
  isLoading,
  containerVariants,
  metaToken,
  setMetaToken,
  handleSaveMetaToken,
  isSavingToken,
}) => {
  const { db } = useAuth();
  const [logoBase64, setLogoBase64] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!db) return;
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

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) setSwRegistration(reg);
      });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [db]);

  const handleInstallClick = async () => {
    if (isStandaloneDisplay()) {
      toast.success('ReSo sudah terpasang sebagai aplikasi.');
      return;
    }
    if (!deferredPrompt) {
      toast.info(
        isIosDevice()
          ? 'Di iPhone/iPad: ketuk Bagikan (□↑) lalu “Tambah ke Layar Utama”.'
          : 'Prompt instal tidak tersedia. Aplikasi mungkin sudah terpasang, atau buka lewat Chrome/Edge (HTTPS).'
      );
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
      toast.success('Instalasi dimulai');
    }
    setDeferredPrompt(null);
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    if ('serviceWorker' in navigator && swRegistration) {
      try {
        await swRegistration.update();
        toast.success('Pembaruan dicek. Jika ada versi baru, notifikasi “Muat ulang” akan muncul.');
      } catch {
        toast.error('Gagal memeriksa pembaruan.');
      }
    } else {
      toast.info('Muat ulang halaman untuk memastikan versi terbaru.');
    }
    setTimeout(() => setIsCheckingUpdate(false), 1500);
  };

  const forceReloadForUpdate = () => {
    window.location.reload();
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!db) return;
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Ukuran file maksimal 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64String = event.target?.result as string;
      setIsUploading(true);
      try {
        await setDoc(doc(db, 'settings', 'appLogo'), {
          value: base64String,
          updatedAt: serverTimestamp(),
        });
        setLogoBase64(base64String);
        toast.success('Logo disimpan. Segarkan halaman untuk favicon/PWA.');
      } catch {
        toast.error('Gagal menyimpan logo');
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const SettingRow = ({
    icon,
    iconClass,
    title,
    desc,
    children,
  }: {
    icon: React.ReactNode;
    iconClass: string;
    title: string;
    desc: string;
    children: React.ReactNode;
  }) => (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200 gap-4">
      <div className="flex items-start sm:items-center gap-3 min-w-0">
        <div
          className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center border ${iconClass}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 leading-snug">{desc}</p>
        </div>
      </div>
      <div className="shrink-0 w-full sm:w-auto">{children}</div>
    </div>
  );

  return (
    <motion.div
      key="settings"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0 }}
      className="space-y-6"
    >
      <div className="bg-white rounded-xl p-5 sm:p-8 border border-slate-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center border border-slate-200">
            <Settings className="text-slate-900" size={18} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Pengaturan</h2>
            <p className="text-slate-500 text-xs">PWA, logo, Meta API, dan kalkulasi ulang</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SettingRow
            icon={<Download size={18} />}
            iconClass="bg-sky-50 text-sky-600 border-sky-100"
            title="Instal Aplikasi (PWA)"
            desc={
              isStandaloneDisplay()
                ? 'ReSo sedang berjalan dalam mode terpasang.'
                : isInstallable
                  ? 'Pasang ke layar utama perangkat.'
                  : 'Chrome/Edge: tombol muncul jika memenuhi syarat. iPhone: Bagikan → Tambah ke Layar Utama.'
            }
          >
            <Button
              onClick={handleInstallClick}
              size="sm"
              className={`w-full sm:w-auto font-bold h-10 rounded-xl ${isInstallable || isStandaloneDisplay() ? 'bg-slate-900 text-white' : ''}`}
              variant={isInstallable || isStandaloneDisplay() ? 'default' : 'outline'}
            >
              {isStandaloneDisplay()
                ? 'Sudah terpasang'
                : isInstallable
                  ? 'Instal Sekarang'
                  : 'Petunjuk instal'}
            </Button>
          </SettingRow>

          <SettingRow
            icon={<RefreshCw size={18} />}
            iconClass="bg-emerald-50 text-emerald-600 border-emerald-100"
            title="Pembaruan"
            desc="Cek versi PWA terbaru."
          >
            <div className="flex gap-2 w-full sm:w-auto">
              <Button
                onClick={handleCheckUpdate}
                disabled={isCheckingUpdate}
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none font-bold h-10 rounded-xl"
              >
                {isCheckingUpdate ? 'Memeriksa…' : 'Cek'}
              </Button>
              <Button
                onClick={forceReloadForUpdate}
                size="sm"
                className="flex-1 sm:flex-none font-bold h-10 rounded-xl bg-slate-900 text-white"
              >
                Muat Ulang
              </Button>
            </div>
          </SettingRow>

          <SettingRow
            icon={<ImageIcon size={18} />}
            iconClass="bg-indigo-50 text-indigo-600 border-indigo-100"
            title="Logo Aplikasi"
            desc="Ikon utama (disarankan 1:1, max 2MB)."
          >
            <div className="flex items-center gap-2 justify-end">
              {logoBase64 && (
                <img
                  src={logoBase64}
                  alt="Logo"
                  className="w-8 h-8 rounded-md object-contain border border-slate-200 bg-white p-0.5"
                />
              )}
              <div className="relative">
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/svg+xml"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleLogoUpload}
                  disabled={isUploading}
                />
                <Button variant="outline" size="sm" disabled={isUploading} className="font-bold h-10 rounded-xl">
                  <Upload size={14} className="mr-1.5" />
                  {isUploading ? 'Mengunggah…' : 'Pilih'}
                </Button>
              </div>
            </div>
          </SettingRow>

          {/* Meta API Token */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center">
                <KeyRound size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-sm text-slate-900">Token Meta API</h3>
                <p className="text-xs text-slate-500 leading-snug mb-3">
                  Dipakai untuk tarik komentar IG / link post di Input Rekap. Simpan di sini, bukan di form harian.
                </p>
                <textarea
                  value={metaToken}
                  onChange={(e) => setMetaToken(e.target.value)}
                  placeholder="Tempel access token Meta di sini…"
                  className="w-full h-20 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 resize-none"
                />
                <Button
                  onClick={handleSaveMetaToken}
                  disabled={isSavingToken || !metaToken.trim()}
                  size="sm"
                  className="mt-2 font-bold h-10 rounded-xl bg-slate-900 text-white w-full sm:w-auto"
                >
                  {isSavingToken ? 'Menyimpan…' : 'Simpan Token'}
                </Button>
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 shrink-0 rounded-lg bg-orange-50 text-orange-600 border border-orange-100 flex items-center justify-center">
                  <RefreshCw size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Kalkulasi Ulang</h3>
                  <p className="text-xs text-slate-500 mb-3 leading-snug">
                    Cocokkan ulang raw text rekap ke master pegawai. Berjalan di perangkat Anda.
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        checked={recalculateConfig.mode === 'last_day'}
                        onChange={() => setRecalculateConfig({ mode: 'last_day' })}
                        className="accent-slate-900 w-3.5 h-3.5"
                      />
                      1 hari terakhir
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        checked={recalculateConfig.mode === 'last_week'}
                        onChange={() => setRecalculateConfig({ mode: 'last_week' })}
                        className="accent-slate-900 w-3.5 h-3.5"
                      />
                      1 minggu terakhir
                    </label>
                  </div>
                </div>
              </div>
              <Button
                onClick={handleRecalculateAll}
                disabled={isLoading}
                size="sm"
                className="w-full sm:w-auto bg-slate-900 text-white font-bold h-10 rounded-xl shrink-0"
              >
                {isLoading ? 'Memproses…' : 'Jalankan'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
