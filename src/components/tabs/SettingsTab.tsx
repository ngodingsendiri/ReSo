import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Settings, RefreshCw, KeyRound, Download, ExternalLink, Database, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { toast } from 'sonner';
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

// Link download extension dari GitHub Release (di-hardcode; workflow Actions
// memperbarui tiap rilis). ZIP = jalur utama (Load unpacked, tanpa error
// CRX_REQUIRED_PROOF_MISSING); CRX = opsi drag-drop.
const EXT_ZIP_URL = 'https://github.com/ngodingsendiri/ReSo/releases/latest/download/reso-extension.zip';
const EXT_CRX_URL = 'https://github.com/ngodingsendiri/ReSo/releases/latest/download/reso-extension.crx';
const EXT_INSTALL_URL = '/install.html';

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
  const { provisionError, retryProvision } = useAuth();
  const [provisioning, setProvisioning] = useState(false);

  const handleRetryProvision = async () => {
    setProvisioning(true);
    try {
      const msg = await retryProvision();
      if (msg) toast.error(`Database belum siap: ${msg}`);
      else toast.success('Database dinas siap digunakan.');
    } finally {
      setProvisioning(false);
    }
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
            <p className="text-slate-500 text-xs">Ekstensi, Meta API, dan kalkulasi ulang</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {provisionError && (
            <div className="p-4 bg-rose-50 rounded-xl border border-rose-200 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 shrink-0 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center">
                  <Database size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-slate-900">Database dinas belum siap</h3>
                  <p className="text-xs text-slate-600 leading-snug break-words">{provisionError}</p>
                </div>
              </div>
              <Button
                onClick={handleRetryProvision}
                disabled={provisioning}
                size="sm"
                className="shrink-0 font-bold h-10 rounded-xl bg-slate-900 text-white w-full sm:w-auto"
              >
                {provisioning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                <span className="ml-1.5">{provisioning ? 'Menyiapkan…' : 'Siapkan database'}</span>
              </Button>
            </div>
          )}

          <SettingRow
            icon={<Download size={18} />}
            iconClass="bg-sky-50 text-sky-600 border-sky-100"
            title="Ekstensi ReSo"
            desc="Pasang / perbarui ekstensi untuk menarik nama komentator otomatis ke rekap."
          >
            <div className="flex flex-col gap-2 w-full sm:w-auto">
              <a
                href={EXT_ZIP_URL}
                download
                className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 h-10 px-4 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800"
              >
                <Download size={14} />
                Download .zip (disarankan)
              </a>
              <div className="flex gap-2">
                <a
                  href={EXT_CRX_URL}
                  download
                  className="inline-flex flex-1 items-center justify-center gap-1.5 h-10 px-3 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
                >
                  .crx
                </a>
                <a
                  href={EXT_INSTALL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-1.5 h-10 px-3 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
                >
                  <ExternalLink size={14} />
                  Panduan
                </a>
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
