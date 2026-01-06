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
    // Allow any Host header (useful behind reverse proxies / custom domains).
    // WARNING: this disables Vite's DNS-rebinding protection for the dev server.
    allowedHosts: true,
    // Allow accessing the dev UI from other devices (phones/tablets) on the LAN.
    // Note: use http://<server-ip>:5174 from other devices (not localhost).
    host: '0.0.0.0',
    port: Number.parseInt(process.env.WEB_PORT ?? '5174', 10),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${Number.parseInt(process.env.API_PORT ?? process.env.PORT ?? '3210', 10)}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    // Same rationale as `server.allowedHosts`.
    allowedHosts: true,
  },
});
