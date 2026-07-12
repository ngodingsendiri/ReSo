import { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

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
  const [logoBase64, setLogoBase64] = useState<string | null>(() => {
    return localStorage.getItem('reso_appLogo') || null;
  });

  useEffect(() => {
    if (logoBase64) {
      updateDOM(logoBase64);
    }

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
  }, []);

  return logoBase64;
}
