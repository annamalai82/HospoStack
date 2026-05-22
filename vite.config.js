import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],

  server: {
    port: 5173,
    host: true,          // expose to LAN so Capacitor live-reload can connect
    strictPort: true,
  },

  build: {
    outDir: 'dist',
    // Capacitor loads from file:// on Android — relative paths are required
    assetsDir: 'assets',

    // Increase chunk size warning to 1MB (Firebase SDK is large)
    chunkSizeWarningLimit: 1200,

    rollupOptions: {
      output: {
        // Split vendor chunks for faster app startup
        manualChunks: {
          firebase:  ['firebase/app', 'firebase/firestore', 'firebase/auth', 'firebase/functions'],
          react:     ['react', 'react-dom'],
        }
      }
    }
  },

  // Prevent Vite from stripping 'global' — needed by some Firebase internals
  define: {
    global: 'globalThis',
  },
}));
