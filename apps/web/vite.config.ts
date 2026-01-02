import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Allow accessing the dev UI from other devices (phones/tablets) on the LAN.
    // Note: use http://<server-ip>:5173 from other devices (not localhost).
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: true,
      },
    },
  },
});
