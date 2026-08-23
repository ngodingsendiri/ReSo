import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig, loadEnv } from 'vite';

// Versi aplikasi dibaca dari package.json saat build → dipakai UI (Settings)
// lewat `__APP_VERSION__`. Naikkan versi di package.json tiap rilis.
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig(({ mode }) => {
  loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            motion: ['motion/react'],
            recharts: ['recharts'],
            jspdf: ['jspdf', 'jspdf-autotable'],
            xlsx: ['xlsx'],
            screenshot: ['modern-screenshot'],
          },
        },
      },
      chunkSizeWarningLimit: 500,
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
