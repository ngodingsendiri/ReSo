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
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('firebase')) return 'firebase';
            if (/[\\/]react-dom[\\/]|[\\/]react[\\/]|[\\/]scheduler[\\/]/.test(id)) return 'react-vendor';
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor') || id.includes('internmap')) return 'recharts';
            if (id.includes('jspdf')) return 'jspdf';
            if (id.includes('xlsx')) return 'xlsx';
            if (id.includes('modern-screenshot')) return 'screenshot';
            if (id.includes('/motion') || id.includes('framer-motion')) return 'motion';
            return undefined;
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
