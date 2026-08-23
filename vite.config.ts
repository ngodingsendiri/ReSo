import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
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
