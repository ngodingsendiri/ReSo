import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/**
 * Konvensi nama database per dinas (multi-tenant): 1 project Firebase, tiap
 * dinas = 1 akun Google = 1 database `db-<uid>`. HARUS sinkron dengan
 * `getFsBase(uid)` di api/engagement.ts.
 */
export function databaseIdFor(uid: string): string {
  return `db-${uid.toLowerCase()}`;
}

/**
 * Referensi Firestore untuk dinas tertentu. Dipanggil per-user setelah login
 * — semua operasi data (employees, dailyEngagement, admins, users, settings)
 * diarahkan ke database dinas yang login, sehingga rekap dari ekstensi
 * (yang ditulis API ke db-<uid>) muncul di dashboard dinas yang sama.
 */
export function userDb(uid: string): Firestore {
  return getFirestore(app, databaseIdFor(uid));
}

export const googleProvider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);