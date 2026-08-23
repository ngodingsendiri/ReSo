import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, type Firestore, type CollectionReference, type DocumentReference } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { dinasUid } from './engagement-api';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/**
 * Single database `(default)` (Spark/gratis). Pemisahan multi-tenant dilakukan
 * lewat SUBCOLLECTION `dinas/{uid}/...` — bukan database terpisah. Tiap dinas
 * = 1 akun Google = 1 subtree `dinas/<uid>` di database yang sama.
 *
 * Firestore multi-database (`db-<uid>`) butuh Blaze (billing). Dengan single
 * database + rules scope `request.auth.uid == uid`, isolasi data tetap terjaga
 * tanpa biaya.
 */
export function userDb(_uid: string): Firestore {
  return getFirestore(app);
}

/** Koleksi dalam subtree dinas: `dinas/{uid}/{name}`. */
export function dinasCollection(db: Firestore, uid: string, name: string): CollectionReference {
  return collection(db, 'dinas', dinasUid(uid), name);
}

/** Dokumen dalam subtree dinas: `dinas/{uid}/{name}/{id}`. */
export function dinasDoc(db: Firestore, uid: string, name: string, id: string): DocumentReference {
  return doc(db, 'dinas', dinasUid(uid), name, id);
}

export const googleProvider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);
