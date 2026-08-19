import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, userDb } from '../lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp, type Firestore } from 'firebase/firestore';

const ALLOWED_EMAILS = [
  'ngerjaindiri@gmail.com',
  'sipencil@gmail.com',
  'abiemputra.asn@gmail.com'
];

interface AuthContextType {
  user: User | null;
  db: Firestore | null;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  db: null,
  loading: true,
  error: null,
  clearError: () => {},
});

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const clearError = () => setError(null);
  // Database dinas untuk user yang login (multi-tenant): db-<uid>.
  const db = useMemo(() => (user ? userDb(user.uid) : null), [user]);

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

        let isAllowed = user.email ? ALLOWED_EMAILS.includes(user.email) : false;

        // Cek admin di database dinas yang sama tempat API ekstensi menulis
        // (db-<uid>) — sinkron dengan isAdminUser di api/engagement.ts.
        const uDb = userDb(user.uid);
        if (!isAllowed) {
          try {
            const adminSnap = await getDoc(doc(uDb, 'admins', user.uid));
            if (adminSnap.exists()) {
              isAllowed = true;
            }
          } catch (err) {
            console.error("Error checking dynamic admin:", err);
          }
        }

        if (!isAllowed) {
          setError('Akses ditolak. Akun Google Anda tidak terdaftar sebagai admin ReSo.');
          setUser(null);
          setLoading(false);
          await signOut(auth);
          return;
        }

        setUser(user);
        setError(null);
        setLoading(false);

        // Sync user to Firestore lazily (di database dinas)
        getDoc(doc(uDb, 'users', user.uid)).then(async (userSnap) => {
          const userRef = doc(uDb, 'users', user.uid);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
              role: 'user',
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
    <AuthContext.Provider value={{ user, db, loading, error, clearError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
