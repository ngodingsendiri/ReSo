import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, KeyRound, Download, ExternalLink, Database, Loader2, Trash2, CheckCircle2, Eye, EyeOff, AlertTriangle, Link as LinkIcon, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { toast } from 'sonner';
import { useAuth } from '../FirebaseProvider';
import { APP_VERSION } from '../../lib/version';
import { useAppLogo } from '../../hooks/useAppLogo';
import { getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { dinasDoc } from '../../lib/firebase';

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
  const [showSocial, setShowSocial] = useState(false);

  useEffect(() => {
    if (!user || !db) return;
    const load = async () => {
      try {
        const docRef = dinasDoc(db, user.uid, 'settings', 'social_links');
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
      await setDoc(dinasDoc(db, user.uid, 'settings', 'social_links'), {
        ...socialLinks,
        updatedAt: serverTimestamp()
      });
      toast.success('Link sosial media disimpan');
      setShowSocial(false);
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

  const SectionHeader = ({ title }: { title: string }) => (
    <div className="flex items-center gap-2 py-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );

  const SettingItem = ({
    icon,
    iconBg,
    title,
    desc,
    children,
  }: {
    icon: React.ReactNode;
    iconBg: string;
    title: string;
    desc: string;
    children: React.ReactNode;
  }) => (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          <p className="text-xs text-slate-500 leading-tight">{desc}</p>
        </div>
      </div>
      <div className="w-full lg:w-auto lg:max-w-[340px] shrink-0 mt-2 lg:mt-0">
        {children}
      </div>
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
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 sm:p-6 space-y-4">
          {/* Koneksi */}
          <div>
            <SectionHeader title="Koneksi" />
            {provisionError && (
              <SettingItem
                icon={<Database size={16} />}
                iconBg="bg-rose-50 text-rose-600"
                title="Database dinas belum siap"
                desc={provisionError}
              >
                <Button
                  onClick={handleRetryProvision}
                  disabled={provisioning}
                  size="sm"
                  className="rounded-lg bg-slate-900 text-white font-bold"
                >
                  {provisioning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span className="ml-1">{provisioning ? 'Menyiapkan…' : 'Siapkan'}</span>
                </Button>
              </SettingItem>
            )}
            <SettingItem
              icon={<KeyRound size={16} />}
              iconBg="bg-rose-50 text-rose-600"
              title="Token Meta API"
              desc="Token untuk tarik komentar & link post"
            >
              <div className="flex items-center gap-2">
                <input
                  value={metaToken}
                  onChange={(e) => setMetaToken(e.target.value)}
                  placeholder="Tempel token…"
                  type={showToken ? 'text' : 'password'}
                  autoComplete="off"
                  aria-label="Token Meta API"
                  className={`flex-1 h-8 px-2 rounded-lg border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-900 ${
                    metaToken.trim() ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? 'Sembunyikan token' : 'Tampilkan token'}
                  title={showToken ? 'Sembunyikan token' : 'Tampilkan token'}
                  className="p-1 rounded text-slate-400 hover:text-slate-700"
                >
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <Button
                  onClick={handleSaveMetaToken}
                  disabled={isSavingToken || !metaToken.trim()}
                  size="sm"
                  className="rounded-lg bg-slate-900 text-white font-bold"
                >
                  {isSavingToken ? '…' : 'Simpan'}
                </Button>
                {metaToken.trim() && (
                  <Button
                    onClick={handleClearMetaToken}
                    variant="outline"
                    size="sm"
                    aria-label="Hapus token"
                    title="Hapus token"
                    className="px-2 rounded-lg border-slate-200 text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </SettingItem>
          </div>

          {/* Ekstensi */}
          <div>
            <SectionHeader title="Ekstensi" />
            <SettingItem
              icon={<Download size={16} />}
              iconBg="bg-sky-50 text-sky-600"
              title="Ekstensi ReSo"
              desc="Pasang / perbarui ekstensi"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={EXT_ZIP_URL}
                  download
                  className="h-8 px-3 rounded-lg bg-slate-900 text-white text-xs font-bold flex items-center gap-1 hover:bg-slate-800"
                >
                  <Download size={13} /> .zip
                </a>
                <a
                  href={EXT_CRX_URL}
                  download
                  className="h-8 px-3 rounded-lg border border-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1 hover:bg-slate-50"
                >
                  .crx
                </a>
                <a
                  href={EXT_INSTALL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-8 px-3 rounded-lg border border-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1 hover:bg-slate-50"
                >
                  <ExternalLink size={13} /> Panduan
                </a>
              </div>
            </SettingItem>
          </div>

          {/* Data */}
          <div>
            <SectionHeader title="Data" />
            <SettingItem
              icon={<RefreshCw size={16} />}
              iconBg="bg-orange-50 text-orange-600"
              title="Kalkulasi Ulang"
              desc="Cocokkan ulang rekap ke master pegawai"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex bg-white border border-slate-200 rounded-lg p-0.5">
                  {(['last_day', 'last_week'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setRecalculateConfig({ mode })}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                        recalculateConfig.mode === mode
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {mode === 'last_day' ? '1 hari' : '1 minggu'}
                    </button>
                  ))}
                </div>
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
                  className={`rounded-lg font-bold ${
                    recalcConfirm
                      ? 'bg-rose-600 text-white hover:bg-rose-700'
                      : 'bg-slate-900 text-white'
                  }`}
                >
                  {isLoading ? '…' : recalcConfirm ? 'Yakin?' : 'Jalankan'}
                </Button>
                {recalcResult && (
                  <span className="text-[10px] text-slate-500 max-w-[100px] truncate">
                    {recalcResult}
                  </span>
                )}
              </div>
            </SettingItem>
          </div>

          {/* Sosial Media */}
          <div>
            <SectionHeader title="Sosial Media" />
            <SettingItem
              icon={<LinkIcon size={16} />}
              iconBg="bg-indigo-50 text-indigo-600"
              title="Sosial Media Instansi"
              desc="URL profil sosial media (opsional)"
            >
              <div className="flex flex-col gap-2 w-full">
                <button
                  type="button"
                  onClick={() => setShowSocial(!showSocial)}
                  aria-expanded={showSocial}
                  className="flex items-center justify-between w-full h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <span>
                    {socialLinks.ig || socialLinks.fb || socialLinks.tiktok
                      ? 'Edit Link'
                      : 'Tambah Link'}
                  </span>
                  <ChevronRight
                    size={14}
                    className={`transition-transform ${showSocial ? 'rotate-90' : ''}`}
                  />
                </button>
                {showSocial && (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 pt-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0">IG</span>
                        <input
                          value={socialLinks.ig || ''}
                          onChange={(e) => setSocialLinks(prev => ({ ...prev, ig: e.target.value }))}
                          placeholder="https://instagram.com/..."
                          aria-label="Link Instagram"
                          className="flex-1 min-w-0 h-8 px-2 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0">FB</span>
                        <input
                          value={socialLinks.fb || ''}
                          onChange={(e) => setSocialLinks(prev => ({ ...prev, fb: e.target.value }))}
                          placeholder="https://facebook.com/..."
                          aria-label="Link Facebook"
                          className="flex-1 min-w-0 h-8 px-2 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0">TT</span>
                        <input
                          value={socialLinks.tiktok || ''}
                          onChange={(e) => setSocialLinks(prev => ({ ...prev, tiktok: e.target.value }))}
                          placeholder="https://tiktok.com/@..."
                          aria-label="Link TikTok"
                          className="flex-1 min-w-0 h-8 px-2 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                      </div>
                    </div>
                    <Button
                      onClick={handleSaveSocialLinks}
                      disabled={isSavingSocial}
                      size="sm"
                      className="w-full rounded-lg bg-slate-900 text-white font-bold"
                    >
                      {isSavingSocial ? 'Menyimpan…' : 'Simpan Link'}
                    </Button>
                  </>
                )}
              </div>
            </SettingItem>
          </div>

          {/* Tentang */}
          <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
            <img src={appLogo} alt="ReSo" className="w-9 h-9 object-contain shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-sm text-slate-900">ReSo</h3>
              <p className="text-xs text-slate-500">v{APP_VERSION}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};