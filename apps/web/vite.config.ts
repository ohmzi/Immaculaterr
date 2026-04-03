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
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.local',
      ...(process.env.WEB_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean) ?? []),
    ],
    host: '0.0.0.0',
    port: Number.parseInt(process.env.WEB_PORT ?? '5858', 10),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${Number.parseInt(process.env.API_PORT ?? process.env.PORT ?? '5859', 10)}`,
        // Preserve the original Host header so API Origin checks work for LAN IPs / tunnels.
        // Also forward X-Forwarded-* so the API can make correct decisions behind proxies.
        changeOrigin: false,
        xfwd: true,
      },
    },
  },
  preview: {
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.local',
      ...(process.env.WEB_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean) ?? []),
    ],
  },
});
