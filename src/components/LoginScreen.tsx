import { useState, useEffect } from 'react';
import { signIn } from '../lib/firebase';
import { Button } from './ui/button';
import { useAppLogo } from '../hooks/useAppLogo';
import { useAuth } from './FirebaseProvider';

type LoginScreenProps = {
  externalError?: string | null;
};

function mapAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return '';
  }
  if (code === 'auth/network-request-failed') {
    return 'Koneksi gagal. Periksa internet Anda lalu coba lagi.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Popup login diblokir browser. Izinkan popup untuk situs ini.';
  }
  const message = (err as { message?: string })?.message;
  return message || 'Gagal masuk. Silakan coba lagi.';
}

export default function LoginScreen({ externalError }: LoginScreenProps) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appLogo = useAppLogo();
  const { clearError } = useAuth();

  useEffect(() => {
    if (externalError) setError(externalError);
  }, [externalError]);

  const handleSignIn = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setError(null);
    clearError();
    try {
      await signIn();
    } catch (err: unknown) {
      console.error('Login error:', err);
      const mapped = mapAuthError(err);
      if (mapped) setError(mapped);
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] relative overflow-hidden bg-slate-50 px-4">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-[15%] -left-[10%] w-[55%] h-[55%] bg-slate-200/40 rounded-full blur-3xl" />
        <div className="absolute bottom-[10%] -right-[10%] w-[50%] h-[50%] bg-slate-300/30 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <img src={appLogo} alt="ReSo" className="w-16 h-16 object-contain mx-auto mb-5" />
        <h1 className="text-2xl font-bold text-center text-slate-900 mb-1">ReSo</h1>
        <p className="text-center text-slate-500 text-sm mb-6 leading-relaxed">
          Rekap Engagement Sosmed Diskominfo.
          <br />
          Masuk dengan akun Google.
        </p>

        {error && (
          <div
            role="alert"
            className="mb-5 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-100 font-medium leading-relaxed"
          >
            {error}
          </div>
        )}

        <Button
          onClick={handleSignIn}
          disabled={isLoggingIn}
          className="w-full h-12 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-sm active:scale-[0.98]"
        >
          {isLoggingIn ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Memproses…
            </span>
          ) : (
            'Masuk dengan Google'
          )}
        </Button>

        <p className="mt-6 text-center text-[11px] text-slate-400 font-medium">
          Hanya untuk penggunaan internal
        </p>
      </div>
    </div>
  );
}
