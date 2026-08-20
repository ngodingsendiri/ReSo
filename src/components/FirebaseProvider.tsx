import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, userDb } from '../lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp, type Firestore } from 'firebase/firestore';

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
  // Database dinas untuk user yang login (multi-tenant): db-<uid>.
  const db = useMemo(() => (user ? userDb(user.uid) : null), [user]);

  const runProvision = async (u: User): Promise<string | null> => {
    try {
      const idToken = await u.getIdToken();
      const provRes = await fetch('/api/provision', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!provRes.ok) {
        const body = (await provRes.json().catch(() => ({}))) as { error?: string };
        return body?.error || `Gagal menyiapkan database (${provRes.status}).`;
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  const retryProvision = async (): Promise<string | null> => {
    if (!user) return null;
    const msg = await runProvision(user);
    setProvisionError(msg);
    return msg;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Align with Firestore rules: email must be verified
        if (!user.emailVerified) {
          // Set error BEFORE signOut — signOut retriggers this listener with user=null
          setError('Email Google belum terverifikasi. Verifikasi email lalu coba lagi.');
          setUser(null);
          setLoading(false);
          await signOut(auth);
          return;
        }

        // Provision otomatis (buat db-<uid> + admins/{uid}) via /api/provision.
        // NON-BLOCKING: kalau gagal, user tetap masuk tapi error tampil + bisa
        // retry via tombol "Siapkan database" di Settings.
        setProvisionError(await runProvision(user));

        setUser(user);
        setError(null);
        setLoading(false);

        // Sync user ke database dinas (db-<uid>) secara lazy
        const uDb = userDb(user.uid);
        getDoc(doc(uDb, 'users', user.uid)).then(async (userSnap) => {
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
            }).catch(console.error);
          } else {
            await setDoc(userRef, {
              lastLogin: serverTimestamp(),
              displayName: user.displayName,
              photoURL: user.photoURL
            }, { merge: true }).catch(console.error);
          }
        }).catch(err => {
          console.error("Failed to sync user:", err);
        });
      } else {
        setUser(null);
        // Do NOT clear error here — access-denied message must survive signOut callback
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, db, loading, error, provisionError, retryProvision, clearError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
