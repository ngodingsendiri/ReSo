import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, RefreshCw, Upload, Image as ImageIcon } from 'lucide-react';
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
  }, []);

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
        <div className="lg:hidden flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700">
            <Settings className="text-slate-900 dark:text-slate-50" size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-50">Pengaturan Sistem</h2>
            <p className="text-slate-600 dark:text-slate-400 text-sm">Konfigurasi tambahan untuk sistem rekapitulasi.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-50 dark:bg-slate-950 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 flex items-center justify-center border border-orange-100 dark:border-orange-900/50">
                <RefreshCw size={20} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-50">Kalkulasi Ulang Semua Data</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">Perbaikan sinkronisasi cross-platform</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 flex-1">
              Gunakan fitur ini jika ada kesalahan silang pada rekap data sebelumnya, akibat perubahan username pegawai.
            </p>
            
            <div className="space-y-4 mb-6">
              <label className="text-xs font-bold text-slate-900 dark:text-slate-50">Pilih Rentang Waktu:</label>
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-900 dark:text-slate-50 cursor-pointer">
                  <input type="radio" value="last_day" checked={recalculateConfig.mode === 'last_day'} onChange={() => setRecalculateConfig({ mode: 'last_day' })} className="accent-slate-900 w-4 h-4" />
                  1 Hari Terakhir
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-900 dark:text-slate-50 cursor-pointer">
                  <input type="radio" value="last_week" checked={recalculateConfig.mode === 'last_week'} onChange={() => setRecalculateConfig({ mode: 'last_week' })} className="accent-slate-900 w-4 h-4" />
                  1 Minggu Terakhir
                </label>
              </div>
            </div>

            <Button
              onClick={handleRecalculateAll}
              disabled={isLoading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold transition-all active:scale-[0.98] focus:outline-none focus:border-slate-900 mt-auto"
            >
              {isLoading ? 'Sedang Memproses...' : 'Kalkulasi Ulang Sekarang'}
            </Button>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-100 dark:border-indigo-900/50">
                <ImageIcon size={20} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-50">Logo Aplikasi</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">Ubah ikon/logo utama aplikasi</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 flex-1">
              Ganti logo akan otomatis memperbarui tampilan di sidebar, Favicon, dan ikon PWA secara dinamis.
            </p>

            <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 mb-6">
              {logoBase64 ? (
                <img src={logoBase64} alt="App Logo" className="w-20 h-20 object-contain mb-4" />
              ) : (
                <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center text-slate-400 mb-4">
                  <ImageIcon size={32} />
                </div>
              )}
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-50 mb-1">Upload Logo Baru</h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 text-center">Format: PNG, JPG, SVG (Maks 2MB).<br />Gunakan rasio 1:1 untuk ikon.</p>
              
              <div className="relative w-full">
                <input 
                  type="file" 
                  accept="image/png, image/jpeg, image/svg+xml"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleLogoUpload}
                  disabled={isUploading}
                />
                <Button 
                  variant="outline" 
                  disabled={isUploading}
                  className="w-full bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold"
                >
                  <Upload size={16} className="mr-2" />
                  {isUploading ? 'Mengunggah...' : 'Pilih File Logo'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

