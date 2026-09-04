import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, userDb } from '../lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp, type Firestore } from 'firebase/firestore';
import { fetchWithTimeout } from '../lib/fetch-with-timeout';

interface AuthContextType {
  user: User | null;
  db: Firestore | null;
  loading: boolean;
  error: string | null;
  provisionError: string | null;
  retryProvision: () => Promise<string | null>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  db: null,
  loading: true,
  error: null,
  provisionError: null,
  retryProvision: async () => null,
  clearError: () => {},
});

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const clearError = () => setError(null);
  // Database Firestore (single default). Pemisahan dinas lewat subtree
  // dinas/{uid} di level komponen (dinasCollection/dinasDoc).
  const db = useMemo(() => (user ? userDb(user.uid) : null), [user]);

  // Provision yang sedang berjalan — dipakai ulang bila dipanggil lagi
  // (auto-provision login + tombol "Siapkan" di Settings bersamaan hanya
  // menghasilkan SATU request, tanpa race saling timpa).
  const provisionInFlightRef = useRef<Promise<string | null> | null>(null);

  const runProvision = async (u: User): Promise<string | null> => {
    if (provisionInFlightRef.current) return provisionInFlightRef.current;
    // Batas 10 dtk (sinkron dengan limit default Vercel) — fetch yang macet
    // berhenti pasti, bukan menggantung selamanya (lihat fetch-with-timeout.ts).
    const p = (async (): Promise<string | null> => {
      try {
        const idToken = await u.getIdToken();
        const provRes = await fetchWithTimeout(
          '/api/provision',
          { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } },
          10000
        );
        if (!provRes.ok) {
          const body = (await provRes.json().catch(() => ({}))) as { error?: string };
          return body?.error || `Gagal menyiapkan database (${provRes.status}).`;
        }
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    })();
    provisionInFlightRef.current = p;
    try {
      return await p;
    } finally {
      if (provisionInFlightRef.current === p) provisionInFlightRef.current = null;
    }
  };

  const retryProvision = async (): Promise<string | null> => {
    if (!user) return null;
    const msg = await runProvision(user);
    setProvisionError(msg);
    return msg;
  };

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (cancelled) return;
      if (user) {
        // Align with Firestore rules: email must be verified
        if (!user.emailVerified) {
          // Set error BEFORE signOut — signOut retriggers this listener with user=null
          if (cancelled) return;
          setError('Email Google belum terverifikasi. Verifikasi email lalu coba lagi.');
          setUser(null);
          setLoading(false);
          await signOut(auth);
          return;
        }

        // Provision otomatis (tulis marker dinas/{uid}/admins/{uid}) via
        // /api/provision — BENAR-BENAR NON-BLOCKING. Sebelumnya `await
        // runProvision` diletakkan DI DEPAN `setUser`/`setLoading(false)`:
        // fetch yang macet mengunci layar loading sampai timeout eksternal.
        // Kini login selalu lanjut dulu; hasil provision (gagal/berhasil)
        // tampil belakangan via setProvisionError + tombol retry di Settings.
        setUser(user);
        setError(null);
        setLoading(false);
        void runProvision(user).then((provErr) => {
          if (!cancelled) setProvisionError(provErr);
        });

        // Sync user ke Firestore (top-level users/{uid}) secara lazy
        const uDb = userDb(user.uid);
        getDoc(doc(uDb, 'users', user.uid)).then(async (userSnap) => {
          if (cancelled) return;
          const userRef = doc(uDb, 'users', user.uid);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
              role: 'admin',
              createdAt: serverTimestamp(),
              lastLogin: serverTimestamp()
            }, { merge: true }).catch((e) => { if (!cancelled) console.error(e); });
          } else {
            await setDoc(userRef, {
              lastLogin: serverTimestamp(),
              displayName: user.displayName,
              photoURL: user.photoURL
            }, { merge: true }).catch((e) => { if (!cancelled) console.error(e); });
          }
        }).catch(err => {
          if (cancelled) return;
          console.error("Failed to sync user:", err);
        });
      } else {
        if (cancelled) return;
        setUser(null);
        // Do NOT clear error here — access-denied message must survive signOut callback
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, db, loading, error, provisionError, retryProvision, clearError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
