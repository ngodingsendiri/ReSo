import { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

const updateDOM = (value: string) => {
  try {
    // Update DOM Favicons
    const links = document.querySelectorAll("link[rel*='icon']");
    links.forEach((link: any) => {
      link.href = value;
    });

    // Also update apple-touch-icon
    const appleIcon: any = document.querySelector("link[rel='apple-touch-icon']");
    if (appleIcon) {
      appleIcon.href = value;
    }

    // Dynamically update PWA Manifest
    const manifestString = JSON.stringify({
      name: "ReSo - Rekap Engagement Sosmed",
      short_name: "ReSo",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#0f172a",
      description: "Aplikasi Rekapitulasi Engagement Media Sosial Diskominfo",
      icons: [
        {
          src: value,
          sizes: "any",
          type: value.startsWith('data:image/svg') ? "image/svg+xml" : "image/png",
          purpose: "any"
        },
        {
          src: "/pwa-icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable"
        }
      ]
    });
    const blob = new Blob([manifestString], { type: 'application/json' });
    const manifestUrl = URL.createObjectURL(blob);
    const manifestLink: any = document.querySelector("link[rel='manifest']");
    if (manifestLink) {
      manifestLink.href = manifestUrl;
    }
  } catch(e) {
    console.error("Failed to update manifest dynamically: ", e);
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

    const unsub = onSnapshot(doc(db, 'settings', 'appLogo'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().value) {
        const value = docSnap.data().value;
        setLogoBase64(value);
        localStorage.setItem('reso_appLogo', value);
        updateDOM(value);
      }
    });

    return () => unsub();
  }, []);

  return logoBase64;
}
