import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Allow accessing the dev UI from other devices (phones/tablets) on the LAN.
    // Note: use http://<server-ip>:5173 from other devices (not localhost).
    host: true,
    port: Number.parseInt(process.env.WEB_PORT ?? '5173', 10),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${Number.parseInt(process.env.API_PORT ?? process.env.PORT ?? '3210', 10)}`,
        changeOrigin: true,
      },
    },
  },
});
