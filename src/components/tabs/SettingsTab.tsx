import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';

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
  return (
    <motion.div 
      key="settings"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      className="space-y-8"
    >
      <div className="bg-white rounded-xl p-4 sm:p-10 border border-slate-200 ">
        <div className="lg:hidden flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-200">
            <Settings className="text-slate-600" size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800">Pengaturan Sistem</h2>
            <p className="text-slate-500 text-sm">Konfigurasi tambahan untuk sistem rekapitulasi.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center border border-orange-100">
                <RefreshCw size={20} />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Kalkulasi Ulang Semua Data</h3>
                <p className="text-xs text-slate-500">Perbaikan sinkronisasi cross-platform</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              Gunakan fitur ini jika ada kesalahan silang pada rekap data sebelumnya, akibat perubahan username pegawai.
            </p>
            
            <div className="space-y-4 mb-6">
              <label className="text-xs font-bold text-slate-700">Pilih Rentang Waktu:</label>
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="radio" value="last_day" checked={recalculateConfig.mode === 'last_day'} onChange={() => setRecalculateConfig({ mode: 'last_day' })} className="accent-slate-900 w-4 h-4" />
                  1 Hari Terakhir
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="radio" value="last_week" checked={recalculateConfig.mode === 'last_week'} onChange={() => setRecalculateConfig({ mode: 'last_week' })} className="accent-slate-900 w-4 h-4" />
                  1 Minggu Terakhir
                </label>
              </div>
            </div>

            <Button
              onClick={handleRecalculateAll}
              disabled={isLoading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold transition-all active:scale-[0.98] focus:outline-none focus:border-slate-900"
            >
              {isLoading ? 'Sedang Memproses...' : 'Kalkulasi Ulang Sekarang'}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
