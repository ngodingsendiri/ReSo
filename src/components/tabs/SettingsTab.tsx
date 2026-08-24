import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, KeyRound, Download, ExternalLink, Database, Loader2, Trash2, CheckCircle2, Eye, EyeOff, AlertTriangle, Link as LinkIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import { useAuth } from '../FirebaseProvider';
import { APP_VERSION } from '../../lib/version';
import { useAppLogo } from '../../hooks/useAppLogo';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

interface SettingsTabProps {
  recalculateConfig: { mode: 'last_day' | 'last_week' };
  setRecalculateConfig: (config: { mode: 'last_day' | 'last_week' }) => void;
  handleRecalculateAll: () => void;
  isLoading: boolean;
  containerVariants: import('motion/react').Variants;
  metaToken: string;
  setMetaToken: (v: string) => void;
  handleSaveMetaToken: () => void;
  handleClearMetaToken: () => void;
  isSavingToken: boolean;
  recalcResult: string | null;
}

// Link download extension dari GitHub Release (di-hardcode; workflow Actions
// memperbarui tiap rilis). ZIP = jalur utama (Load unpacked, tanpa error
// CRX_REQUIRED_PROOF_MISSING); CRX = opsi drag-drop.
const EXT_ZIP_URL = 'https://github.com/ngodingsendiri/ReSo/releases/latest/download/reso-extension.zip';
const EXT_CRX_URL = 'https://github.com/ngodingsendiri/ReSo/releases/latest/download/reso-extension.crx';
const EXT_INSTALL_URL = '/install.html';

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
  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 p-4 sm:p-5 bg-slate-50 rounded-xl border border-slate-200">
    <div className="flex items-start gap-3 min-w-0 flex-1">
      <div
        className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border ${iconClass}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-bold text-sm text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 leading-snug mt-0.5">{desc}</p>
      </div>
    </div>
    <div className="w-full lg:w-auto lg:max-w-[420px] shrink-0">{children}</div>
  </div>
);

export const SettingsTab: React.FC<SettingsTabProps> = ({
  recalculateConfig,
  setRecalculateConfig,
  handleRecalculateAll,
  isLoading,
  containerVariants,
  metaToken,
  setMetaToken,
  handleSaveMetaToken,
  handleClearMetaToken,
  isSavingToken,
  recalcResult,
}) => {
  const { provisionError, retryProvision, user, db } = useAuth();
  const [provisioning, setProvisioning] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [recalcConfirm, setRecalcConfirm] = useState(false);
  const appLogo = useAppLogo();
  const [socialLinks, setSocialLinks] = useState({ ig: '', fb: '', tiktok: '' });
  const [isSavingSocial, setIsSavingSocial] = useState(false);

  useEffect(() => {
    if (!user || !db) return;
    const load = async () => {
      try {
        const docRef = doc(db, 'settings', 'social_links');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data() as { ig?: string; fb?: string; tiktok?: string };
          setSocialLinks({
            ig: data.ig || '',
            fb: data.fb || '',
            tiktok: data.tiktok || ''
          });
        }
      } catch {
        // ignore
      }
    };
    load();
  }, [user, db]);

  const handleSaveSocialLinks = async () => {
    if (!user || !db) return;
    setIsSavingSocial(true);
    try {
      await setDoc(doc(db, 'settings', 'social_links'), {
        ...socialLinks,
        updatedAt: serverTimestamp()
      });
      toast.success('Link sosial media disimpan');
    } catch {
      toast.error('Gagal menyimpan link');
    } finally {
      setIsSavingSocial(false);
    }
  };

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
        <div className="flex flex-col gap-6">

          {/* ── Koneksi ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Koneksi</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            {provisionError && (
              <SettingRow
                icon={<Database size={18} />}
                iconClass="bg-rose-50 text-rose-600 border-rose-100"
                title="Database dinas belum siap"
                desc={provisionError}
              >
                <Button
                  onClick={handleRetryProvision}
                  disabled={provisioning}
                  size="sm"
                  className="w-full font-bold h-10 rounded-xl bg-slate-900 text-white"
                >
                  {provisioning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span className="ml-1.5">{provisioning ? 'Menyiapkan…' : 'Siapkan database'}</span>
                </Button>
              </SettingRow>
            )}

            {/* Meta API Token */}
            <SettingRow
              icon={<KeyRound size={18} />}
              iconClass="bg-rose-50 text-rose-600 border-rose-100"
              title="Token Meta API"
              desc="Dipakai untuk tarik komentar IG / link post di Input Rekap."
            >
              <div className="flex flex-col gap-2.5 w-full">
                <div className="relative">
                  <input
                    value={metaToken}
                    onChange={(e) => setMetaToken(e.target.value)}
                    placeholder="Tempel access token Meta di sini…"
                    aria-label="Token Meta API"
                    type={showToken ? 'text' : 'password'}
                    autoComplete="off"
                    className="w-full h-10 px-3 pr-28 rounded-xl border border-slate-200 bg-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                  <span className="absolute right-9 top-1/2 -translate-y-1/2">
                    {metaToken.trim() ? (
                      <Badge variant="outline" className="gap-1 text-[9px] font-bold border-emerald-200 text-emerald-700 bg-emerald-50 px-1.5 py-0">
                        <CheckCircle2 size={10} />
                        Tersimpan
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-[9px] font-bold border-slate-200 text-slate-500 bg-slate-100 px-1.5 py-0">
                        Belum
                      </Badge>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    aria-label={showToken ? 'Sembunyikan token' : 'Tampilkan token'}
                    title={showToken ? 'Sembunyikan token' : 'Tampilkan token'}
                  >
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveMetaToken}
                    disabled={isSavingToken || !metaToken.trim()}
                    size="sm"
                    className="flex-1 font-bold h-9 rounded-xl bg-slate-900 text-white"
                  >
                    {isSavingToken ? 'Menyimpan…' : 'Simpan Token'}
                  </Button>
                  {metaToken.trim() && (
                    <Button
                      onClick={handleClearMetaToken}
                      variant="outline"
                      size="sm"
                      className="font-bold h-9 rounded-xl border-slate-200 text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                      title="Hapus token"
                    >
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              </div>
            </SettingRow>
          </div>

          {/* ── Ekstensi ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ekstensi</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            <SettingRow
              icon={<Download size={18} />}
              iconClass="bg-sky-50 text-sky-600 border-sky-100"
              title="Ekstensi ReSo"
              desc="Pasang / perbarui ekstensi untuk menarik nama komentator otomatis ke rekap."
            >
              <div className="flex flex-col gap-2 w-full">
                <a
                  href={EXT_ZIP_URL}
                  download
                  className="inline-flex w-full items-center justify-center gap-1.5 h-10 px-4 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800"
                >
                  <Download size={14} />
                  Download .zip (disarankan)
                </a>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={EXT_CRX_URL}
                    download
                    className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
                  >
                    .crx
                  </a>
                  <a
                    href={EXT_INSTALL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
                  >
                    <ExternalLink size={14} />
                    Panduan
                  </a>
                </div>
              </div>
            </SettingRow>
          </div>

          {/* ── Data ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            <SettingRow
              icon={<RefreshCw size={18} />}
              iconClass="bg-orange-50 text-orange-600 border-orange-100"
              title="Kalkulasi Ulang"
              desc="Mencocokkan ulang seluruh raw text rekap ke master pegawai, lalu memperbarui kolom IG / FB / TT yang tercatat."
            >
              <div className="flex flex-col gap-2.5 w-full">
                <div className="flex bg-white border border-slate-200 rounded-xl p-1 gap-1">
                  {(['last_day', 'last_week'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setRecalculateConfig({ mode })}
                      className={`flex-1 px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                        recalculateConfig.mode === mode
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {mode === 'last_day' ? '1 hari' : '1 minggu'}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2.5">
                  <Button
                    onClick={() => {
                      if (!recalcConfirm) {
                        setRecalcConfirm(true);
                        setTimeout(() => setRecalcConfirm(false), 3000);
                        return;
                      }
                      setRecalcConfirm(false);
                      handleRecalculateAll();
                    }}
                    disabled={isLoading}
                    size="sm"
                    className={`font-bold h-9 rounded-xl shrink-0 transition-colors ${
                      recalcConfirm
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'bg-slate-900 text-white'
                    }`}
                  >
                    {isLoading ? (
                      'Memproses…'
                    ) : recalcConfirm ? (
                      <span className="inline-flex items-center gap-1.5">
                        <AlertTriangle size={13} />
                        Yakin?
                      </span>
                    ) : (
                      'Jalankan'
                    )}
                  </Button>
                  {recalcResult && (
                    <span className="text-[10px] font-medium text-slate-500 leading-tight min-w-0">
                      {recalcResult}
                    </span>
                  )}
                </div>
              </div>
            </SettingRow>
          </div>

          {/* ── Sosial Media ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sosial Media</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            <SettingRow
              icon={<LinkIcon size={18} />}
              iconClass="bg-indigo-50 text-indigo-600 border-indigo-100"
              title="Link Sosial Media Instansi"
              desc="Masukkan URL profil sosial media instansi/lembaga (opsional)."
            >
              <div className="flex flex-col gap-2 w-full">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Instagram</label>
                  <input
                    value={socialLinks.ig || ''}
                    onChange={(e) => setSocialLinks(prev => ({ ...prev, ig: e.target.value }))}
                    placeholder="https://instagram.com/..."
                    className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Facebook</label>
                  <input
                    value={socialLinks.fb || ''}
                    onChange={(e) => setSocialLinks(prev => ({ ...prev, fb: e.target.value }))}
                    placeholder="https://facebook.com/..."
                    className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">TikTok</label>
                  <input
                    value={socialLinks.tiktok || ''}
                    onChange={(e) => setSocialLinks(prev => ({ ...prev, tiktok: e.target.value }))}
                    placeholder="https://tiktok.com/@..."
                    className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
                <Button
                  onClick={handleSaveSocialLinks}
                  disabled={isSavingSocial}
                  size="sm"
                  className="w-full font-bold h-9 rounded-xl bg-slate-900 text-white"
                >
                  {isSavingSocial ? 'Menyimpan…' : 'Simpan Link'}
                </Button>
              </div>
            </SettingRow>
          </div>

          {/* ── Tentang ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tentang</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <img src={appLogo} alt="ReSo" className="w-10 h-10 object-contain shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-sm text-slate-900">ReSo — Rekap Engagement Sosmed</h3>
                <p className="text-xs text-slate-500 leading-snug mt-0.5">
                  Aplikasi rekap engagement pegawai ke media sosial.
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] text-slate-400">Versi</p>
                <p className="text-sm font-black text-slate-900">v{APP_VERSION}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
