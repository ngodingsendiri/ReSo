import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

const ALLOWED_EMAILS = [
  'ngerjaindiri@gmail.com',
  'sipencil@gmail.com',
  'abiemputra.asn@gmail.com'
];

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, error: null });

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        let isAllowed = user.email ? ALLOWED_EMAILS.includes(user.email) : false;

        if (!isAllowed) {
          try {
            const adminSnap = await getDoc(doc(db, 'admins', user.uid));
            if (adminSnap.exists()) {
              isAllowed = true;
            }
          } catch (err) {
            console.error("Error checking dynamic admin:", err);
          }
        }

        if (!isAllowed) {
          await signOut(auth);
          setError("can't access");
          setUser(null);
          setLoading(false);
          return;
        }

        setUser(user);
        setError(null);
        setLoading(false); // Make sure app proceeds

        // Sync user to Firestore lazily
        getDoc(doc(db, 'users', user.uid)).then(async (userSnap) => {
          const userRef = doc(db, 'users', user.uid);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
              role: 'user', // Default role
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
        setError(null);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
