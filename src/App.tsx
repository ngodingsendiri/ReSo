/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { createTokenHandoffHandler, type HandoffTokenProvider } from './lib/token-handoff';
import { pushTokenToExtension } from './lib/extension-bridge';
import { motion } from 'motion/react';
import EngagementDashboard from './components/EngagementDashboard';
import LoginScreen from './components/LoginScreen';
import { useAuth } from './components/FirebaseProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAppLogo } from './hooks/useAppLogo';
import { Toaster } from './components/ui/sonner';

function LoadingScreen() {
  const logoUrl = useAppLogo();

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-slate-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="bg-white p-8 rounded-xl border border-slate-200 flex flex-col items-center w-full max-w-sm shadow-sm"
      >
        <img src={logoUrl} alt="ReSo" className="w-16 h-16 object-contain mb-6" />
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
  // KEAMANAN SESI: ekstensi HANYA menerima idToken (masa ~1 jam), BUKAN refresh
  // token. Firebase memutar & MENCABUT refresh token sumber tiap kali di-mint,
  // sehingga mengirim refresh token (asli maupun hasil rotasi) ke ekstensi akan
  // membatalkan sesi app ReSo sendiri → user logout. Ekstensi me-refresh idToken
  // lewat push on-focus / handoff ulang saat tab ReSo terbuka (lihat
  // src/lib/token-handoff.ts). Saluran balasan unik per permintaan + guard
  // sekali-pakai + cek origin tetap berlaku.
  useEffect(() => {
    const provideTokens: HandoffTokenProvider = async () => {
      if (!user) return null;
      const idToken = await user.getIdToken(true);
      return { idToken, uid: user.uid, email: user.email ?? null };
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
        <LoadingScreen />
      </>
    );
  }

  return (
    <>
      <Toaster position="top-center" duration={2500} offset={16} />
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
    </>
  );
}
