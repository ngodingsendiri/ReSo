import { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export function useAppLogo() {
  const [logoBase64, setLogoBase64] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'appLogo'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().value) {
        setLogoBase64(docSnap.data().value);
        
        // Update DOM Favicons
        const value = docSnap.data().value;
        const links = document.querySelectorAll("link[rel*='icon']");
        links.forEach((link: any) => {
          link.href = value;
          // Set type based on base64 content type if needed, but often browser infers it
        });

        // Also update apple-touch-icon
        const appleIcon: any = document.querySelector("link[rel='apple-touch-icon']");
        if (appleIcon) {
          appleIcon.href = value;
        }

        // Technically modifying the PWA manifest dynamically is difficult because it's a static file.
        // However, updating the DOM link and apple-touch-icon covers most browser UI cases (Favicon, bookmarks).
      }
    });

    return () => unsub();
  }, []);

  return logoBase64;
}
