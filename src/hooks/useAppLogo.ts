import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../components/FirebaseProvider';

const updateDOM = (value: string) => {
  try {
    const links = document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']");
    links.forEach((link) => {
      link.href = value;
    });

    const appleIcon = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
    if (appleIcon) {
      appleIcon.href = value;
    }
  } catch (e) {
    console.error("Failed to update icons dynamically: ", e);
  }
};

export function useAppLogo() {
  const { db } = useAuth();
  const [logoBase64, setLogoBase64] = useState<string | null>(() => {
    return localStorage.getItem('reso_appLogo') || null;
  });

  useEffect(() => {
    if (logoBase64) {
      updateDOM(logoBase64);
    }

    // Logo per dinas dari db-<uid>. Sebelum login (db null) tidak subscribe —
    // cukup pakai logo lokal/hardcoded (logo.svg).
    if (!db) return;

    const unsub = onSnapshot(
      doc(db, 'settings', 'appLogo'),
      (docSnap) => {
        if (docSnap.exists() && docSnap.data().value) {
          const value = docSnap.data().value as string;
          setLogoBase64(value);
          localStorage.setItem('reso_appLogo', value);
          updateDOM(value);
        }
      },
      () => {
        // Offline / permission — keep localStorage logo if any
      }
    );

    return () => unsub();
  }, [db, logoBase64]);

  return logoBase64;
}
