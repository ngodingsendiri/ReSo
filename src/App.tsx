/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { getIdToken } from 'firebase/auth';
import { createTokenHandoffHandler, rotateRefreshToken, type HandoffTokenProvider } from './lib/token-handoff';
import { pushTokenToExtension } from './lib/extension-bridge';
import { motion } from 'motion/react';
import { Edit } from 'lucide-react';
import EngagementDashboard from './components/EngagementDashboard';
import LoginScreen from './components/LoginScreen';
import { useAuth } from './components/FirebaseProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAppLogo } from './hooks/useAppLogo';
import { PWAPrompt } from './components/PWAPrompt';
import { PWALifecycle } from './components/PWALifecycle';
import { OfflineBanner } from './components/OfflineBanner';
import { Toaster } from './components/ui/sonner';

function LoadingScreen() {
  const logoUrl = useAppLogo();

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-slate-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="bg-white p-8 rounded-2xl border border-slate-200 flex flex-col items-center w-full max-w-sm shadow-sm"
      >
        <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-slate-900/15">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="w-10 h-10 object-contain" />
          ) : (
            <Edit className="w-8 h-8 text-white" />
          )}
        </div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-1">
          Re<span className="text-slate-900">So</span>
        </h2>
        <p className="text-xs font-medium text-slate-500 mb-6">Rekap Engagement Sosmed</p>
        <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
        <p className="mt-4 text-[11px] font-medium text-slate-400">Memuat…</p>
      </motion.div>
    </div>
  );
}

export default function App() {
  const { user, loading, error } = useAuth();
  const [showLoading, setShowLoading] = useState(true);

  // Jembatan token (Opsi C — API): content script ekstensi meminta token sesi
  // Firebase operator via CustomEvent. Zero setup: tidak ada login baru di
  // ekstensi — reuse sesi Firebase ReSo yang sudah aktif.
  // Mitigasi paparan: token sesi utama TIDAK pernah keluar dari halaman —
  // refresh token di-ROTASI (mint pasangan segar via REST) sebelum dikirim;
  // saluran balasan unik per permintaan + guard sekali-pakai + cek origin
  // (lihat src/lib/token-handoff.ts).
  useEffect(() => {
    const provideTokens: HandoffTokenProvider = async () => {
      if (!user) return null;
      const current = (user as { refreshToken?: string }).refreshToken;
      if (current) {
        const rotated = await rotateRefreshToken(current);
        if (rotated) {
          return { ...rotated, uid: user.uid, email: user.email ?? null };
        }
        // Rotasi gagal (jaringan/API): kirim idToken SAJA (masa ~1 jam) —
        // ekstensi handoff ulang saat kedaluwarsa; token sesi utama tetap
        // tidak keluar dari halaman.
        const idToken = await getIdToken(user);
        return { idToken, refreshToken: '', uid: user.uid, email: user.email ?? null };
      }
      return null;
    };
    const onGetToken = createTokenHandoffHandler(provideTokens, window.location.origin);
    window.addEventListener('reso:get-token', onGetToken);
    // Jembatan ekstensi (app push): dorong token ke ekstensi ReSo saat login
    // & tiap halaman mendapat fokus, sehingga ekstensi otomatis "Terhubung"
    // tanpa harus membuka tab ReSo. Domain dipelajari dari origin halaman ini.
    if (user) {
      pushTokenToExtension(user).catch(() => {});
      const onFocus = () => pushTokenToExtension(user).catch(() => {});
      window.addEventListener('focus', onFocus);
      return () => {
        window.removeEventListener('reso:get-token', onGetToken);
        window.removeEventListener('focus', onFocus);
      };
    }
    return () => window.removeEventListener('reso:get-token', onGetToken);
  }, [user]);

  useEffect(() => {
    if (loading) {
      setShowLoading(true);
      return;
    }
    const timer = setTimeout(() => setShowLoading(false), 200);
    return () => clearTimeout(timer);
  }, [loading]);

  if (showLoading || loading) {
    return (
      <>
        <Toaster position="top-center" duration={2500} offset={16} />
        <PWALifecycle />
        <LoadingScreen />
      </>
    );
  }

  return (
    <>
      <Toaster position="top-center" duration={2500} offset={16} />
      <PWALifecycle />
      <OfflineBanner />
      <div className="font-sans antialiased text-slate-900 min-h-[100dvh] bg-slate-50 selection:bg-slate-900/10">
        {!user ? (
          <ErrorBoundary>
            <LoginScreen externalError={error} />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary>
            <EngagementDashboard />
          </ErrorBoundary>
        )}
      </div>
      <PWAPrompt />
    </>
  );
}
