import React, { useState } from 'react';
import { signIn } from '../lib/firebase';
import { Button } from './ui/button';

export default function LoginScreen() {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (isLoggingIn) return;
    
    setIsLoggingIn(true);
    setError(null);
    
    try {
      await signIn();
    } catch (err: any) {
      console.error('Login error:', err);
      // Ignore cancelled popup request error as it's usually harmless
      if (err.code !== 'auth/cancelled-popup-request') {
        setError(err.message || 'Failed to sign in. Please try again.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen-safe min-h-[100dvh] bg-slate-50 bg-grid-pattern pb-safe">
      <div className="p-8 bg-white rounded-2xl shadow-xl border border-slate-100 text-center max-w-sm w-full mx-4">
        <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-slate-200">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 5 4 4"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold mb-2 text-slate-900">RecapLink</h1>
        <p className="text-slate-500 mb-8 text-sm">Aplikasi Rekapitulasi Engagement Pegawai. Silakan masuk untuk melanjutkan.</p>
        
        {error && (
          <div className="mb-6 p-3 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100 font-medium">
            {error}
          </div>
        )}

        <Button 
          onClick={handleSignIn} 
          disabled={isLoggingIn}
          className="w-full h-12 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-md transition-all active:scale-[0.98]"
        >
          {isLoggingIn ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Memproses...
            </div>
          ) : 'Masuk dengan Google'}
        </Button>
        
        <p className="mt-8 text-[10px] text-slate-400 uppercase tracking-widest font-bold">
          Internal Use Only
        </p>
      </div>
    </div>
  );
}
